package co.com.coltefinanciera.gestiondemanda.domain;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.AppliedRule;
import co.com.coltefinanciera.gestiondemanda.domain.enums.DisplacementPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;
import co.com.coltefinanciera.gestiondemanda.domain.idempotency.RescheduleLedger;
import co.com.coltefinanciera.gestiondemanda.domain.model.Developer;
import co.com.coltefinanciera.gestiondemanda.domain.model.Incident;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningConflict;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningRequest;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningResult;
import co.com.coltefinanciera.gestiondemanda.domain.model.Requirement;
import co.com.coltefinanciera.gestiondemanda.domain.model.RescheduleEvent;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkAllocation;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkBlock;
import co.com.coltefinanciera.gestiondemanda.domain.rules.CapacityBook;
import co.com.coltefinanciera.gestiondemanda.domain.rules.IncidentPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;

/**
 * Motor de planificacion.
 *
 * <p>Java puro: sin Spring, sin JPA y sin GLPI. No lleva {@code @Service} a proposito; se registra
 * como bean en {@code PlanningConfig} para que el paquete de dominio no dependa del framework y
 * para que las pruebas puedan instanciarlo con {@code new}.
 *
 * <p>Es determinista: con la misma entrada y el mismo registro de idempotencia produce el mismo
 * plan. El reloj se inyecta ({@link Clock}) en lugar de leerse del sistema, y es lo que hace
 * verificables las marcas de tiempo de la auditoria.
 *
 * <p>Orden de resolucion: primero los incidentes que reclaman capacidad, en orden de severidad
 * (ALTO, MEDIO, BAJO) y, a igual severidad, de reporte; despues los requerimientos, en orden de
 * fecha pactada; y al final los incidentes que conviven, que ocupan solo lo que sobra.
 *
 * <p>Cuanto reclama cada incidente no lo decide el motor: lo decide la politica de su severidad
 * ({@link IncidentPolicy}). Un incidente sin severidad es dato legado y conserva el comportamiento
 * historico: consumo voraz desde el dia del reporte, con atribucion por umbral de dedicacion.
 *
 * <p><strong>Capacidad.</strong> Una jornada ya no es un numero de horas disponibles sino una agenda
 * de franjas ({@link CapacityBook}), y el reparto lo hace el mismo recorrido del calendario que
 * calcula los vencimientos de la OLA. De ahi salen las tres propiedades que definen esta fase: un
 * trabajo empieza cuando <em>de verdad</em> puede empezar, consume exactamente el tiempo que ocupa
 * aunque le sobre jornada, y un requerimiento mayor que un dia se reparte en varios bloques en lugar
 * de declararse imposible. Una jornada ocupada de 09:00 a 11:00 y de 14:00 a 17:00 sigue ofreciendo
 * las tres horas del medio.
 *
 * <p><strong>Entrega.</strong> La fecha pactada de un requerimiento —el Internal TTR— es el dia en
 * que el trabajo <em>termina</em>, no el dia en que empieza. El motor busca hacia atras el dia en
 * que hay que arrancar para cubrir las horas declaradas antes de esa fecha y reparte desde ahi, de
 * modo que el trabajo no termina despues de ella. Solo cuando no cabe en el horizonte hacia atras se degrada
 * al comportamiento anterior —arrancar en la fecha pactada y desbordar hacia delante—, que es lo que
 * la auditoria registra como desplazamiento y lo que una renegociacion tiene que cubrir. Un trabajo
 * que de verdad no cabe en el horizonte se reporta como conflicto.
 */
public class PlanningEngine {

    private final RescheduleLedger ledger;
    private final Clock clock;

    public PlanningEngine(RescheduleLedger ledger) {
        this(ledger, Clock.systemUTC());
    }

    public PlanningEngine(RescheduleLedger ledger, Clock clock) {
        this.ledger = Objects.requireNonNull(ledger, "ledger es obligatorio");
        this.clock = Objects.requireNonNull(clock, "clock es obligatorio");
    }

    public PlanningResult plan(PlanningRequest request) {
        PlanningRules rules = request.rules();
        Developer developer = request.developer();
        CapacityBook capacity = new CapacityBook(rules.workingCalendar(), clock.getZone());

        List<WorkAllocation> allocations = new ArrayList<>();
        List<WorkBlock> blocks = new ArrayList<>();
        List<RescheduleEvent> events = new ArrayList<>();
        List<PlanningConflict> conflicts = new ArrayList<>();

        // Incidentes que pueden justificar un desplazamiento, por dia y en conjunto.
        Map<LocalDate, List<Incident>> causingByDay = new LinkedHashMap<>();
        List<Incident> causingIncidents = new ArrayList<>();

        List<Incident> open = openIncidents(request.incidents());

        // 1. Incidentes que reclaman capacidad antes que los requerimientos. Reclamar es lo unico
        //    que puede convertir a un incidente en causa de un desplazamiento, asi que la
        //    atribucion se registra aqui y no cuando toca ubicarlo.
        for (Incident incident : open) {
            if (!preempts(incident, rules)) {
                continue;
            }
            LocalDate placedOn = placeIncident(incident, rules, developer, capacity, allocations, blocks);
            if (isCause(incident, rules)) {
                causingIncidents.add(incident);
                causingByDay.computeIfAbsent(placedOn, day -> new ArrayList<>()).add(incident);
            }
        }

        // 2. Requerimientos: trabajo desplazable, anclado a su fecha de entrega. El Internal TTR es
        //    cuando el trabajo se entrega, no cuando empieza, asi que la capacidad se busca hacia
        //    atras desde esa fecha y el reparto va hacia delante hasta aterrizar en ella.
        for (Requirement requirement : plannableRequirements(request.requirements())) {
            LocalDate plannedDate = requirement.plannedDate();

            List<WorkBlock> placed = claimForDelivery(requirement, developer, capacity, rules);

            if (placed.isEmpty()) {
                conflicts.add(new PlanningConflict(
                        requirement.id(),
                        WorkItemType.REQUERIMIENTO,
                        "Sin capacidad en el horizonte de " + rules.planningHorizonDays() + " dias"));
                continue;
            }

            blocks.addAll(placed);
            allocations.add(allocation(requirement, developer, placed.getFirst().date()));

            // La entrega es el dia en que el requerimiento cierra. Solo cuenta como desplazamiento
            // si cierra DESPUES de lo pactado: adelantarse no incumple el compromiso y no tiene a
            // quien renegociar. Con la entrega como ancla, cerrar antes deja de ser raro —la
            // capacidad de los dias previos puede estar partida— y auditarlo inventaria una
            // renegociacion que nadie pidio.
            LocalDate deliveredOn = placed.getLast().date();
            if (!deliveredOn.isAfter(plannedDate)) {
                continue;
            }

            // La causa se resuelve contra la fecha pactada: es esa franja la que se perdio.
            Incident cause = causingIncidentFor(plannedDate, causingByDay, causingIncidents);
            String causeId = cause == null ? null : cause.id();

            // El desplazamiento se audita una sola vez: la segunda corrida del mismo escenario
            // recupera el instante original y publica el mismo evento. Se publica igual porque cada
            // plan guarda solo sus propios eventos: si la segunda corrida no publicara nada, el
            // desplazamiento desapareceria del plan nuevo y con el la renegociacion que lo cubre.
            Instant auditedAt = ledger.claim(causeId, requirement.id(), Instant.now(clock));

            events.add(new RescheduleEvent(
                    auditedAt,
                    causeId,
                    requirement.id(),
                    plannedDate,
                    deliveredOn,
                    appliedRule(cause, rules),
                    cause == null ? null : cause.severity()));
        }

        // 3. Incidentes que conviven: ocupan solo la capacidad que dejo libre el trabajo pactado.
        for (Incident incident : open) {
            if (!preempts(incident, rules)) {
                placeIncident(incident, rules, developer, capacity, allocations, blocks);
            }
        }

        return new PlanningResult(allocations, blocks, events, conflicts);
    }

    /**
     * Ubica un incidente.
     *
     * <p>Los que conviven ({@link DisplacementPolicy#POR_SATURACION} sin saturacion) llegan aqui en
     * la tercera pasada, cuando ya no queda nada que desplazar: ocupan hueco sobrante o desbordan a
     * los dias siguientes, pero sin quitarle la franja a nadie.
     *
     * @return el dia en que arranca el bloque, que es contra el que se resuelve la atribucion.
     */
    private LocalDate placeIncident(
            Incident incident,
            PlanningRules rules,
            Developer developer,
            CapacityBook capacity,
            List<WorkAllocation> allocations,
            List<WorkBlock> blocks) {

        List<WorkBlock> placed = capacity.claim(
                incident.id(),
                WorkItemType.INCIDENTE,
                developer.id(),
                incident.reportedAt(),
                incident.estimatedHours(),
                null);

        blocks.addAll(placed);
        LocalDate startedOn = placed.getFirst().date();

        if (claimsWholeDay(incident, rules)) {
            capacity.reserveRestOfDay(startedOn, releasedAt(placed, startedOn));
        }

        allocations.add(new WorkAllocation(
                incident.id(), WorkItemType.INCIDENTE, developer.id(), startedOn, incident.estimatedHours()));

        return startedOn;
    }

    /**
     * Hora a la que el incidente suelta su primera jornada.
     *
     * <p>Es el punto desde el que la prioridad maxima cierra el dia. La manana anterior al reporte ya
     * paso y no se reclama: bloquearla seria volver a consumir capacidad que nadie uso.
     */
    private static LocalTime releasedAt(List<WorkBlock> placed, LocalDate date) {
        return placed.stream()
                .filter(block -> block.date().equals(date))
                .map(WorkBlock::end)
                .max(Comparator.naturalOrder())
                .orElseThrow()
                .toLocalTime();
    }

    /**
     * Indica si el incidente reclama capacidad antes que los requerimientos.
     *
     * <p>Un incidente sin severidad conserva el comportamiento historico: siempre reclama, y lo que
     * cambia es como se audita.
     */
    private static boolean preempts(Incident incident, PlanningRules rules) {
        if (incident.severity() == null) {
            return true;
        }
        return rules.policyFor(incident.severity())
                .displacementPolicy()
                .preempts(incident.estimatedHours(), rules.workingHoursPerDay());
    }

    private static boolean claimsWholeDay(Incident incident, PlanningRules rules) {
        return incident.severity() != null
                && rules.policyFor(incident.severity()).displacementPolicy().claimsWholeDay();
    }

    /**
     * Atribucion: un incidente legado solo explica un desplazamiento si supero el umbral, que era el
     * unico criterio disponible; uno con severidad lo explica siempre que haya reclamado capacidad
     * antes que el trabajo pactado.
     */
    private static boolean isCause(Incident incident, PlanningRules rules) {
        return incident.severity() == null ? rules.exceedsThreshold(incident) : true;
    }

    private static AppliedRule appliedRule(Incident cause, PlanningRules rules) {
        if (cause == null) {
            return AppliedRule.CAPACIDAD_DIARIA_EXCEDIDA;
        }
        if (cause.severity() == null) {
            return AppliedRule.UMBRAL_INCIDENTE_EXCEDIDO;
        }
        return rules.policyFor(cause.severity()).displacementPolicy().appliedRule();
    }

    /**
     * Incidentes abiertos en orden de prioridad: severidad declarada primero (ALTO, MEDIO, BAJO) y,
     * a igual severidad, los mas antiguos. Los incidentes sin severidad van al final.
     */
    private static List<Incident> openIncidents(List<Incident> incidents) {
        return incidents.stream()
                .filter(Incident::consumesCapacity)
                .sorted(Comparator.comparingInt(PlanningEngine::priority)
                        .thenComparing(Incident::reportedAt)
                        .thenComparing(Incident::id))
                .toList();
    }

    private static int priority(Incident incident) {
        return incident.severity() == null ? Integer.MAX_VALUE : incident.severity().ordinal();
    }

    /**
     * Ubica un requerimiento para que <em>termine</em> en su fecha de entrega.
     *
     * <p>Primero pregunta a la agenda por el dia en que hay que arrancar para cubrir las horas
     * declaradas antes de la entrega, y reparte desde ahi. Ese dia es el arranque mas tardio posible,
     * asi que el trabajo <strong>nunca termina despues de la fecha pactada</strong>: un trabajo de
     * 16 h con entrega el martes ocupa lunes y martes, y no martes y miercoles. Puede terminar antes
     * si la capacidad de los dias intermedios esta partida, y eso tambien sirve.
     *
     * <p>Cuando no cabe mirando el horizonte hacia atras, se degrada al comportamiento anterior:
     * arrancar en la fecha pactada y desbordar hacia delante, que es lo que produce el
     * {@link RescheduleEvent} y, con el, la renegociacion. La degradacion no es un resto: un
     * compromiso que de verdad no cabe se sigue auditando con la fecha en que de verdad se entrega,
     * en lugar de perderse en un conflicto sin fecha.
     */
    private List<WorkBlock> claimForDelivery(
            Requirement requirement,
            Developer developer,
            CapacityBook capacity,
            PlanningRules rules) {

        LocalDate dueOn = requirement.plannedDate();
        // La ventana hacia atras no cruza hoy: buscar capacidad en dias que ya pasaron seria
        // planificar trabajo que nadie pudo hacer. Cuando la entrega es hoy o el hueco no alcanza
        // desde aqui, el ancla no devuelve dia y el motor cae al reparto hacia delante.
        LocalDate earliestStart = dueOn.minusDays(rules.planningHorizonDays());
        LocalDate today = LocalDate.now(clock);
        if (today.isAfter(earliestStart)) {
            earliestStart = today;
        }
        LocalDate from = capacity.startDayFor(requirement.estimatedHours(), dueOn, earliestStart);

        // Anclado: lo que se entrega se entrega el dia pactado.
        if (from != null) {
            return capacity.claim(
                    requirement.id(),
                    WorkItemType.REQUERIMIENTO,
                    developer.id(),
                    from.atStartOfDay(clock.getZone()).toInstant(),
                    requirement.estimatedHours(),
                    dueOn);
        }

        return capacity.claim(
                requirement.id(),
                WorkItemType.REQUERIMIENTO,
                developer.id(),
                dueOn.atStartOfDay(clock.getZone()).toInstant(),
                requirement.estimatedHours(),
                dueOn.plusDays(rules.planningHorizonDays()));
    }

    private static List<Requirement> plannableRequirements(List<Requirement> requirements) {
        return requirements.stream()
                .filter(Requirement::isPlannable)
                .sorted(Comparator.comparing(Requirement::plannedDate).thenComparing(Requirement::id))
                .toList();
    }

    /**
     * Incidente al que se atribuye el desplazamiento: el que ocupa la fecha pactada. Si ninguno
     * la ocupa, el primero de los que reclamaron capacidad, para que la atribucion sea estable y
     * el evento quede siempre con una causa identificable cuando exista.
     */
    private static Incident causingIncidentFor(
            LocalDate date,
            Map<LocalDate, List<Incident>> causingByDay,
            List<Incident> causingIncidents) {

        List<Incident> onThatDay = causingByDay.get(date);
        if (onThatDay != null && !onThatDay.isEmpty()) {
            return onThatDay.get(0);
        }
        return causingIncidents.isEmpty() ? null : causingIncidents.get(0);
    }

    private static WorkAllocation allocation(Requirement requirement, Developer developer, LocalDate date) {
        return new WorkAllocation(
                requirement.id(), WorkItemType.REQUERIMIENTO, developer.id(), date, requirement.estimatedHours());
    }
}
