package co.com.coltefinanciera.gestiondemanda.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import co.com.coltefinanciera.gestiondemanda.config.PlanningProperties;
import co.com.coltefinanciera.gestiondemanda.domain.PlanningEngine;
import co.com.coltefinanciera.gestiondemanda.domain.enums.AppliedRule;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.TimelineItemStatus;
import co.com.coltefinanciera.gestiondemanda.domain.model.BusinessHours;
import co.com.coltefinanciera.gestiondemanda.domain.model.Developer;
import co.com.coltefinanciera.gestiondemanda.domain.model.Incident;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningConflict;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningContextSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.InputProvenance;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningInputSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningRequest;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningResult;
import co.com.coltefinanciera.gestiondemanda.domain.model.Requirement;
import co.com.coltefinanciera.gestiondemanda.domain.model.RescheduleEvent;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkAllocation;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkBlock;
import co.com.coltefinanciera.gestiondemanda.domain.repository.PlanSnapshotRepository;
import co.com.coltefinanciera.gestiondemanda.domain.rules.BusinessTimeCalculator;
import co.com.coltefinanciera.gestiondemanda.domain.rules.IncidentPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;
import co.com.coltefinanciera.gestiondemanda.domain.rules.WorkingCalendar;
import co.com.coltefinanciera.gestiondemanda.dto.PlanSnapshotResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningContextResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningInputResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningPlanResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningSimulationRequest;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningSimulationResponse;
import co.com.coltefinanciera.gestiondemanda.dto.TimelinePlanResponse;
import co.com.coltefinanciera.gestiondemanda.exception.PlanNotFoundException;

/**
 * Adaptador entre el contrato HTTP y el motor de dominio.
 *
 * <p>Su unico trabajo es traducir: no decide nada sobre planificacion. Por eso el controlador
 * puede delegar en el sin que la logica de negocio quede acoplada a la capa web.
 *
 * <p>El unico texto que compone es el motivo del desplazamiento, que es presentacion: la auditoria
 * guarda la regla aplicada y el dominio no se ocupa de redactar. El calculo de vencimientos es
 * aritmetica de calendario y vive en el dominio ({@link BusinessTimeCalculator}); aqui solo se le
 * pide el resultado.
 *
 * <p><strong>Lo mismo vale para el timeline.</strong> {@link #timeline} no decide nada: lee la agenda
 * guardada y la cuenta. La capacidad de un dia es una suma sobre los tramos que ya existen, y la
 * jornada con la que se mide se le pide al calendario <em>congelado en el plan</em> —a
 * {@link WorkingCalendar}, no a la configuracion vigente—. Proyectar no es planificar, y por eso esta
 * clase puede hacerlo sin salirse de su oficio.
 *
 * <p><strong>Persistencia.</strong> Desde esta fase hay dos caminos sobre el mismo motor:
 * {@link #simulate} calcula y no guarda nada, y {@link #plan} calcula y guarda. Se mantienen los dos
 * porque no son lo mismo: uno sirve para preguntar "que pasaria si", y el otro para dejar constancia
 * de lo que se decidio. Comparten la ejecucion ({@link #run}) y solo se diferencian en si el
 * resultado sobrevive a la respuesta.
 *
 * <p>Guardar no forma parte de la ejecucion. El motor corre primero y la escritura va despues, en su
 * propia transaccion: asi un reclamo de idempotencia perdido durante el calculo no arrastra consigo
 * el guardado del plan.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PlanningService {

    private final PlanningEngine planningEngine;
    private final PlanningProperties planningProperties;
    private final PlanSnapshotRepository planSnapshots;
    private final Clock clock;

    /**
     * {@code POST /api/planning/simulate}: calcula y devuelve, sin guardar.
     *
     * <p>Es el endpoint que existia antes de que hubiera persistencia, y sigue siendo el mismo.
     */
    public PlanningSimulationResponse simulate(PlanningSimulationRequest request) {
        return toResponse(run(request));
    }

    /**
     * {@code POST /api/planning/plan}: calcula, guarda y devuelve.
     *
     * <p>Devuelve el resultado entero ademas del identificador, para que quien acaba de planificar no
     * tenga que pedirlo otra vez. La segunda lectura existe para el caso que justifica la fase:
     * volver al plan despues de un reinicio.
     */
    public PlanningPlanResponse plan(PlanningSimulationRequest request) {
        return save(run(request));
    }

    /**
     * El mismo calculo, con una peticion que ya viene del dominio.
     *
     * <p>Es la puerta que usa la integracion con GLPI. Existe para que el camino HTTP y el camino de
     * GLPI ejecuten <em>el mismo</em> codigo desde aqui hacia abajo: la capa anticorrupcion construye
     * la {@link PlanningRequest} fuera, y este metodo no sabe —ni puede saber— que detras hubo un
     * sistema externo. Si la traduccion se hiciera dentro, habria dos caminos que mantener y el motor
     * acabaria viendo detalles de GLPI por la puerta de atras.
     *
     * <p>La procedencia solo se usa para dejar constancia; no interviene en el calculo. Es
     * deliberado: el motor no debe comportarse distinto segun de donde vinieron los datos, porque
     * entonces el origen seria una variable del resultado y la trazabilidad dejaria de ser una
     * etiqueta para volverse una regla de negocio.
     */
    public PlanningPlanResponse plan(PlanningRequest request, InputProvenance provenance) {
        return save(run(request, provenance));
    }

    /** Calcula y guarda: lo unico que comparten las dos puertas de entrada. */
    private PlanningPlanResponse save(Run run) {
        Instant createdAt = Instant.now(clock);
        PlanSnapshot snapshot = planSnapshots.save(
                run.developerId(), createdAt, run.result(), context(run, createdAt), input(run));

        log.info(
                "Plan {} guardado para {}: {} asignaciones, {} bloques, {} desplazamientos, {} conflictos",
                snapshot.id(),
                run.developerId(),
                run.result().allocations().size(),
                run.result().blocks().size(),
                run.result().rescheduleEvents().size(),
                run.result().conflicts().size());

        return new PlanningPlanResponse(snapshot.id(), createdAt, toResponse(run));
    }

    /** {@code GET /api/planning/{planId}}: un plan guardado, tal como quedo. */
    public PlanSnapshotResponse findPlan(UUID planId) {
        PlanSnapshot snapshot = planSnapshots.findById(planId)
                .orElseThrow(() -> new PlanNotFoundException(planId));
        return toSnapshotResponse(snapshot);
    }

    /**
     * {@code GET /api/planning/{planId}/blocks}: solo los tramos de agenda de un plan.
     *
     * <p>Es lo que pide un timeline, y por eso tiene endpoint propio: devolver el plan entero para
     * quedarse con una lista obliga a traerse la auditoria y los conflictos de propina.
     */
    public List<PlanningSimulationResponse.Block> blocks(UUID planId) {
        if (!planSnapshots.exists(planId)) {
            throw new PlanNotFoundException(planId);
        }
        return planSnapshots.findBlocks(planId).stream().map(PlanningService::toBlock).toList();
    }

    /**
     * {@code GET /api/planning/{planId}/timeline}: la agenda de un plan guardado, con su capacidad.
     *
     * <p>Es la lectura que necesita una interfaz de linea de tiempo. {@link #blocks} da los tramos y
     * nada mas, de modo que responder «cuanto queda libre el martes» obligaba a traerse tambien el
     * contexto, sacar de el la jornada y hacer la cuenta en el navegador. Aqui las dos preguntas
     * vienen juntas.
     *
     * <p><strong>No recalcula el plan.</strong> Lee lo que ya estaba escrito —bloques, asignaciones,
     * la foto de la entrada y el contexto congelado— y suma. No hay ninguna llamada al motor, y por
     * tanto el timeline no puede discrepar del plan que pinta: los dos salen de las mismas filas.
     *
     * <p><strong>Las horas y el compromiso son los de la foto, no los de hoy.</strong> Es la garantia
     * que sostiene la fase: el mismo identificador devuelve siempre la misma representacion, aunque
     * despues se vuelva a declarar la estimacion de un elemento. Lo que se pinta es el plan guardado,
     * no la situacion actual del ticket.
     *
     * <p>Las tres lecturas devuelven vacio tanto si el plan no existe como si le falta el contexto o
     * la entrada, y las tres responden {@code 404 PLAN_NOT_FOUND}. Hoy no puede ocurrir —{@link #plan}
     * escribe las tres cosas en la misma transaccion— y tratarlo como un plan inexistente es
     * preferible a devolver una capacidad medida con un calendario que no es el suyo.
     */
    public TimelinePlanResponse timeline(UUID planId) {
        PlanSnapshot snapshot = planSnapshots.findById(planId)
                .orElseThrow(() -> new PlanNotFoundException(planId));
        PlanningInputSnapshot input = planSnapshots.findInput(planId)
                .orElseThrow(() -> new PlanNotFoundException(planId));
        PlanningContextSnapshot context = planSnapshots.findContext(planId)
                .orElseThrow(() -> new PlanNotFoundException(planId));

        return toTimelineResponse(planId, snapshot, input, context);
    }

    /**
     * {@code GET /api/planning/{planId}/context}: con que se calculo un plan guardado.
     *
     * <p>Es lo que convierte la auditoria en explicable. El evento dice que un requerimiento se movio
     * y bajo que regla; esto dice cual era el umbral, cual el horizonte, cual la OLA de cada
     * severidad y cual el calendario aquel dia. Sin ello, un {@code UMBRAL_INCIDENTE_EXCEDIDO}
     * guardado es un nombre sin contenido.
     *
     * <p>Un plan sin contexto responde {@code 404}: hoy no puede ocurrir —{@link #plan} escribe los
     * dos en la misma transaccion— y tratarlo como un plan inexistente es preferible a devolver un
     * contexto vacio, que se leeria como "se calculo sin reglas".
     */
    public PlanningContextResponse context(UUID planId) {
        PlanningContextSnapshot context = planSnapshots.findContext(planId)
                .orElseThrow(() -> new PlanNotFoundException(planId));
        return toContextResponse(planId, context);
    }

    /**
     * {@code GET /api/planning/{planId}/input}: con que datos se calculo un plan guardado.
     *
     * <p>Cierra la pregunta que el resultado no responde. Hasta aqui un plan decia que salio y con
     * que reglas, pero no con que entro: la entrada vivia solo en la peticion que la trajo, y con ella
     * se iba. Ahora la foto queda guardada y un auditor puede reconstruir el escenario completo.
     *
     * <p>Un plan sin entrada responde {@code 404}, igual que uno sin contexto y por el mismo motivo:
     * devolver una entrada vacia se leeria como "el motor recibio una agenda vacia", que es una
     * afirmacion distinta de "no consta" y ademas falsa para los planes anteriores a esta fase.
     */
    public PlanningInputResponse input(UUID planId) {
        PlanningInputSnapshot input = planSnapshots.findInput(planId)
                .orElseThrow(() -> new PlanNotFoundException(planId));
        return toInputResponse(planId, input);
    }

    /**
     * Una ejecucion del motor, con lo que hace falta para leerla.
     *
     * <p>Existe para que calcular sea una sola cosa: quien simula y quien guarda ejecutan el mismo
     * codigo y solo se diferencian despues.
     */
    private record Run(
            String developerId,
            List<Incident> incidents,
            List<Requirement> requirements,
            PlanningResult result,
            PlanningRules rules,
            InputProvenance provenance) {
    }

    private Run run(PlanningSimulationRequest request) {
        PlanningRules rules = toRules(request.rules());
        PlanningRequest domainRequest = new PlanningRequest(
                new Developer(request.developer().id(), request.developer().name()),
                request.incidents().stream().map(PlanningService::toDomain).toList(),
                request.requirements().stream().map(PlanningService::toDomain).toList(),
                rules);

        return run(domainRequest, InputProvenance.HTTP);
    }

    /**
     * La unica llamada al motor.
     *
     * <p>No se toca desde la Fase 9 y esa es la prueba de que la capa anticorrupcion esta bien puesta:
     * el motor sigue recibiendo lo mismo que recibia, y el trabajo de traducir quedo entero del lado
     * de afuera. Lo unico que cambio aqui es que ahora sabe con que procedencia se ejecuto, y solo
     * para poder registrarla.
     */
    private Run run(PlanningRequest domainRequest, InputProvenance provenance) {
        PlanningResult result = planningEngine.plan(domainRequest);

        log.info(
                "Planificacion para {}: {} asignaciones, {} desplazamientos, {} conflictos",
                domainRequest.developer().id(),
                result.allocations().size(),
                result.rescheduleEvents().size(),
                result.conflicts().size());

        return new Run(
                domainRequest.developer().id(),
                domainRequest.incidents(),
                domainRequest.requirements(),
                result,
                domainRequest.rules(),
                provenance);
    }

    /**
     * El contexto con el que se acaba de calcular.
     *
     * <p>Se arma con las reglas que el motor <em>recibio</em>, no con las configuradas: si la
     * peticion sobrescribio el umbral o el horizonte, lo que hay que dejar escrito es el valor con
     * el que se decidio. Y con las severidades que participaron de verdad, que son las de los
     * incidentes que consumian capacidad: un incidente ya resuelto no influyo en el plan y no tiene
     * por que aparecer en su contexto.
     */
    private PlanningContextSnapshot context(Run run, Instant calculatedAt) {
        Set<IncidentSeverity> severities = run.incidents().stream()
                .filter(Incident::consumesCapacity)
                .map(Incident::severity)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());

        return PlanningContextSnapshot.of(run.rules(), severities, calculatedAt, clock.getZone());
    }

    /**
     * La entrada que el motor acaba de recibir.
     *
     * <p>Se arma con lo que entro, no con lo que se uso: los incidentes ya resueltos y los
     * requerimientos finalizados viajan igual que los demas. La foto es de la entrada, y saber que
     * estaban ahi es lo que permite distinguir "no influyo" de "no llego".
     */
    private static PlanningInputSnapshot input(Run run) {
        return new PlanningInputSnapshot(
                run.developerId(), run.incidents(), run.requirements(), run.provenance());
    }

    /** Las reglas configuradas, con los campos que el solicitante haya decidido sobrescribir. */
    private PlanningRules toRules(PlanningSimulationRequest.RulesInput overrides) {
        PlanningRules configured = planningProperties.toRules();
        if (overrides == null) {
            return configured;
        }

        // Sobrescribir la jornada es cambiar la duracion del bloque, no descartar el calendario: los
        // festivos y el fin de semana declarados siguen vigentes.
        WorkingCalendar calendar = overrides.workingHoursPerDay() == null
                ? configured.workingCalendar()
                : new WorkingCalendar(
                        BusinessHours.startingAt(
                                configured.workingCalendar().businessHours().start(),
                                overrides.workingHoursPerDay()),
                        configured.workingCalendar().weekend(),
                        configured.workingCalendar().holidays());

        return new PlanningRules(
                overrides.incidentThresholdHours() == null
                        ? configured.incidentThresholdHours()
                        : overrides.incidentThresholdHours(),
                overrides.workingHoursPerDay() == null
                        ? configured.workingHoursPerDay()
                        : overrides.workingHoursPerDay(),
                overrides.planningHorizonDays() == null
                        ? configured.planningHorizonDays()
                        : overrides.planningHorizonDays(),
                configured.incidentPolicies(),
                calendar);
    }

    private static Incident toDomain(PlanningSimulationRequest.IncidentInput input) {
        return new Incident(
                input.id(),
                input.title(),
                input.estimatedHours(),
                input.reportedAt(),
                input.status(),
                input.severity());
    }

    private static Requirement toDomain(PlanningSimulationRequest.RequirementInput input) {
        return new Requirement(
                input.id(), input.title(), input.estimatedHours(), input.plannedDate(), input.status());
    }

    private static PlanningSimulationResponse toResponse(Run run) {
        return toResponse(run.developerId(), run.incidents(), run.result(), run.rules());
    }

    private static PlanningSimulationResponse toResponse(
            String developerId, List<Incident> incidents, PlanningResult result, PlanningRules rules) {

        List<PlanningSimulationResponse.DisplacedRequirement> displaced = result.rescheduleEvents().stream()
                .map(event -> new PlanningSimulationResponse.DisplacedRequirement(
                        event.requirementId(),
                        event.originalDate(),
                        event.rescheduledDate(),
                        RequirementStatus.PENDIENTE_DE_RENEGOCIACION,
                        event.incidentId()))
                .toList();

        List<PlanningSimulationResponse.IncidentPolicyView> policies = policyViews(rules);

        return new PlanningSimulationResponse(
                developerId,
                result.allocations().stream().map(PlanningService::toAllocation).toList(),
                result.blocks().stream().map(PlanningService::toBlock).toList(),
                displaced,
                result.rescheduleEvents().stream().map(PlanningService::toEventView).toList(),
                result.conflicts().stream().map(PlanningService::toConflict).toList(),
                policies,
                calendarView(rules.workingCalendar()),
                deadlines(incidents, rules));
    }

    /**
     * Un plan releido, con la misma forma que el plan recien calculado.
     *
     * <p>Los mapeos son los mismos metodos que usa la simulacion, y esa es la garantia que importa:
     * un plan guardado y vuelto a leer se ve igual que el plan que se acaba de calcular. Si los
     * mapeos fueran dos, la diferencia apareceria sola con el primer campo que se anadiera a uno.
     */
    private static PlanSnapshotResponse toSnapshotResponse(PlanSnapshot snapshot) {
        PlanningResult result = snapshot.result();
        return new PlanSnapshotResponse(
                snapshot.id(),
                snapshot.developerId(),
                snapshot.createdAt(),
                result.allocations().stream().map(PlanningService::toAllocation).toList(),
                result.blocks().stream().map(PlanningService::toBlock).toList(),
                result.rescheduleEvents().stream().map(PlanningService::toEventView).toList(),
                result.conflicts().stream().map(PlanningService::toConflict).toList());
    }

    /**
     * El contexto de un plan guardado.
     *
     * <p>Es la traduccion de la foto, tal como se guardo. No se recalcula nada —ni siquiera la
     * jornada, que sale del bloque del calendario—: el sentido de la tabla es no volver a derivar lo
     * que ya se decidio.
     */
    private static PlanningContextResponse toContextResponse(UUID planId, PlanningContextSnapshot context) {
        PlanningRules rules = context.rules();
        return new PlanningContextResponse(
                planId,
                context.engineVersion(),
                context.calculatedAt(),
                context.zoneId(),
                context.severities().stream().sorted().toList(),
                new PlanningContextResponse.RulesView(
                        rules.incidentThresholdHours(),
                        rules.workingHoursPerDay(),
                        rules.planningHorizonDays(),
                        policyViews(rules),
                        calendarView(rules.workingCalendar())));
    }

    /**
     * La entrada de un plan guardado.
     *
     * <p>Traduce la foto tal como se guardo. El titulo no viaja —no se guarda, porque el motor no lo
     * lee— y por eso la respuesta es mas estrecha que la peticion que la origino. La asimetria es la
     * decision, no un descuido.
     */
    private static PlanningInputResponse toInputResponse(UUID planId, PlanningInputSnapshot input) {
        InputProvenance provenance = input.provenance();
        return new PlanningInputResponse(
                planId,
                input.developerId(),
                input.incidents().stream().map(PlanningService::toIncidentView).toList(),
                input.requirements().stream().map(PlanningService::toRequirementView).toList(),
                provenance.source(),
                provenance.extractedAt(),
                provenance.adapterVersion());
    }

    private static PlanningInputResponse.IncidentView toIncidentView(Incident incident) {
        return new PlanningInputResponse.IncidentView(
                incident.id(),
                incident.estimatedHours(),
                incident.reportedAt(),
                incident.status(),
                incident.severity());
    }

    private static PlanningInputResponse.RequirementView toRequirementView(Requirement requirement) {
        return new PlanningInputResponse.RequirementView(
                requirement.id(),
                requirement.estimatedHours(),
                requirement.plannedDate(),
                requirement.status());
    }

    private static PlanningSimulationResponse.Allocation toAllocation(WorkAllocation allocation) {
        return new PlanningSimulationResponse.Allocation(
                allocation.workItemId(),
                allocation.workItemType(),
                allocation.developerId(),
                allocation.date(),
                allocation.hours());
    }

    private static PlanningSimulationResponse.Block toBlock(WorkBlock block) {
        return new PlanningSimulationResponse.Block(
                block.workItemId(),
                block.workItemType(),
                block.developerId(),
                block.start(),
                block.end(),
                block.hours());
    }

    /**
     * La proyeccion completa: ventana, recursos con su capacidad, tramos y asignaciones.
     *
     * <p>La ventana son las fechas de los propios tramos, no el horizonte configurado. El horizonte
     * dice cuantos dias hacia adelante miro el motor, pero no desde cuando —arranca del reporte de los
     * incidentes— y esa fecha de inicio no se guarda. Inventarla seria derivar lo que no consta;
     * abarcar lo que hay es lo que el dato sostiene.
     */
    private static TimelinePlanResponse toTimelineResponse(
            UUID planId, PlanSnapshot snapshot, PlanningInputSnapshot input,
            PlanningContextSnapshot context) {

        List<WorkBlock> blocks = snapshot.result().blocks();
        LocalDate from = blocks.stream().map(WorkBlock::date).min(Comparator.naturalOrder()).orElse(null);
        LocalDate to = blocks.stream().map(WorkBlock::date).max(Comparator.naturalOrder()).orElse(null);

        return new TimelinePlanResponse(
                planId,
                input.developerId(),
                from,
                to,
                timelineResources(blocks, input.developerId(), context.rules().workingCalendar(), from, to),
                timelineItems(blocks, input, planId, snapshot.result().rescheduleEvents()),
                snapshot.result().allocations().stream().map(PlanningService::toAllocation).toList());
    }

    /**
     * Un recurso por desarrollador con tramos, con su capacidad dia a dia.
     *
     * <p>Se agrupa por el desarrollador de los bloques y no por el del plan para que el dia que un
     * plan cubra a mas de uno la respuesta siga siendo correcta sin tocarla. Hoy son el mismo, y con
     * una agenda vacia no hay bloques de los que tirar: ahi sale el desarrollador del plan con la
     * capacidad vacia, porque ese dato se conoce aunque no haya nada que pintar.
     *
     * <p>El orden es por identificador y no el que devuelva el mapa, para que dos llamadas devuelvan
     * la misma respuesta.
     */
    private static List<TimelinePlanResponse.TimelineResource> timelineResources(
            List<WorkBlock> blocks, String planDeveloperId, WorkingCalendar calendar,
            LocalDate from, LocalDate to) {

        Map<String, List<WorkBlock>> byDeveloper = blocks.stream()
                .collect(Collectors.groupingBy(WorkBlock::developerId, TreeMap::new, Collectors.toList()));

        if (byDeveloper.isEmpty()) {
            return List.of(new TimelinePlanResponse.TimelineResource(planDeveloperId, List.of()));
        }

        return byDeveloper.entrySet().stream()
                .map(entry -> new TimelinePlanResponse.TimelineResource(
                        entry.getKey(), timelineCapacity(entry.getValue(), calendar, from, to)))
                .toList();
    }

    /**
     * La capacidad de cada dia de la ventana, para un desarrollador.
     *
     * <p>Lo disponible sale del calendario del plan y lo ocupado de sumar sus tramos. Se recorre la
     * ventana entera, tambien los dias sin trabajo y los no laborables: un festivo tiene jornada cero
     * y sale igual, porque el frontend necesita la fila para no dejar un hueco en el eje.
     *
     * <p>{@code ponytail:} se da por hecho que un tramo ocupa el dia en que empieza. Hoy se cumple
     * —la jornada es de 09:00 a 17:00 y el motor parte el trabajo por dia—, y un tramo que cruzara
     * medianoche atribuiria sus horas al dia equivocado. Si el calendario admitiera jornadas que
     * cruzan el dia, habria que repartir las horas entre las dos fechas.
     */
    private static List<TimelinePlanResponse.TimelineCapacity> timelineCapacity(
            List<WorkBlock> blocks, WorkingCalendar calendar, LocalDate from, LocalDate to) {

        Map<LocalDate, BigDecimal> occupied = blocks.stream()
                .collect(Collectors.toMap(WorkBlock::date, WorkBlock::hours, BigDecimal::add));

        List<TimelinePlanResponse.TimelineCapacity> days = new ArrayList<>();
        for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
            BusinessHours hours = calendar.businessHoursOn(date);
            BigDecimal available = hours == null ? BigDecimal.ZERO : hours.duration();
            BigDecimal taken = occupied.getOrDefault(date, BigDecimal.ZERO);
            days.add(new TimelinePlanResponse.TimelineCapacity(
                    date, published(available), published(taken), published(available.subtract(taken))));
        }
        return days;
    }

    /**
     * Los tramos, ordenados por inicio y con lo que la foto de la entrada sabe de su elemento.
     *
     * <p>El motor devuelve los bloques en el orden en que los produjo, que no es el cronologico. Un
     * timeline se pinta de izquierda a derecha, asi que el orden se arregla aqui y no en el navegador.
     *
     * <p>Un bloque cuyo elemento no aparezca en la foto sale con las horas y el compromiso nulos en
     * lugar de reventar. No puede pasar —los bloques salen de esos mismos elementos—, pero esto es una
     * lectura: devolver nulos ante una inconsistencia es preferible a un error en una pantalla.
     */
    private static List<TimelinePlanResponse.TimelineItem> timelineItems(
            List<WorkBlock> blocks, PlanningInputSnapshot input, UUID planId,
            List<RescheduleEvent> rescheduleEvents) {

        Map<String, Incident> incidents = byId(input.incidents(), Incident::id);
        Map<String, Requirement> requirements = byId(input.requirements(), Requirement::id);
        Set<String> displaced = rescheduleEvents.stream()
                .map(RescheduleEvent::requirementId)
                .collect(Collectors.toSet());

        return blocks.stream()
                .sorted(Comparator.comparing(WorkBlock::start))
                .map(block -> timelineItem(block, incidents.get(block.workItemId()),
                        requirements.get(block.workItemId()), planId,
                        displaced.contains(block.workItemId())))
                .toList();
    }

    /**
     * Un tramo con los datos de su elemento.
     *
     * <p>Incidente y requerimiento llegan los dos y solo uno viene: el tipo del bloque dice cual. Se
     * pasan los dos en lugar de ramificar fuera para que este metodo sea el unico sitio donde se
     * decide que campo sale de cual, y no haya dos listas de reglas que mantener.
     */
    private static TimelinePlanResponse.TimelineItem timelineItem(
            WorkBlock block, Incident incident, Requirement requirement, UUID planId, boolean displaced) {

        BigDecimal estimatedHours = incident != null ? incident.estimatedHours()
                : requirement == null ? null : requirement.estimatedHours();
        LocalDate committedDate = requirement == null ? null : requirement.plannedDate();
        IncidentSeverity severity = incident == null ? null : incident.severity();

        return new TimelinePlanResponse.TimelineItem(
                block.workItemId(),
                block.workItemType(),
                block.start(),
                block.end(),
                published(block.hours()),
                block.developerId(),
                estimatedHours,
                committedDate,
                severity,
                displaced ? TimelineItemStatus.DESPLAZADO : TimelineItemStatus.PLANIFICADO,
                planId);
    }

    private static <T> Map<String, T> byId(List<T> items, Function<T, String> id) {
        return items.stream()
                .collect(Collectors.toMap(id, Function.identity(), (first, ignored) -> first));
    }

    /**
     * Las horas tal como se publican: sin los ceros que deja {@code NUMERIC(10,4)} al rehidratar.
     *
     * <p>Un bloque guardado como ocho horas vuelve de la base de datos como {@code 8.0000}, y sumar
     * esos valores arrastra la escala hasta la respuesta. {@code 8} y {@code 8.0000} son el mismo
     * numero, pero no se leen igual.
     *
     * <p>No es privado porque la fotografia operativa suma capacidad de varios planes y tiene que
     * publicarla con la misma limpieza: {@code 8.5 + 8.5} vuelve a dar {@code 17.0} en cuanto se
     * suman dos valores ya limpios. Que la limpieza sea una sola es lo que impide que el timeline y
     * las metricas publiquen el mismo numero escrito de dos formas.
     */
    static BigDecimal published(BigDecimal hours) {
        return hours.stripTrailingZeros();
    }

    private static PlanningSimulationResponse.RescheduleEventView toEventView(RescheduleEvent event) {
        return new PlanningSimulationResponse.RescheduleEventView(
                event.timestamp(),
                event.incidentId(),
                event.requirementId(),
                event.originalDate(),
                event.rescheduledDate(),
                event.appliedRule(),
                event.severity(),
                reason(event.appliedRule()));
    }

    private static PlanningSimulationResponse.Conflict toConflict(PlanningConflict conflict) {
        return new PlanningSimulationResponse.Conflict(
                conflict.workItemId(), conflict.workItemType(), conflict.reason());
    }

    /**
     * La OLA vigente, una entrada por severidad y en orden de prioridad.
     *
     * <p>Se recorre el enum y no el mapa: el mapa solo contiene las severidades declaradas, y lo que
     * se reporta es el acuerdo completo, con el valor por defecto de las que falten.
     */
    private static List<PlanningSimulationResponse.IncidentPolicyView> policyViews(PlanningRules rules) {
        return Arrays.stream(IncidentSeverity.values())
                .map(severity -> {
                    IncidentPolicy policy = rules.policyFor(severity);
                    return new PlanningSimulationResponse.IncidentPolicyView(
                            severity,
                            policy.targetOwnershipMinutes(),
                            policy.targetResolutionHours(),
                            policy.displacementPolicy());
                })
                .toList();
    }

    private static PlanningSimulationResponse.WorkingCalendarView calendarView(WorkingCalendar calendar) {
        BusinessHours hours = calendar.businessHours();
        return new PlanningSimulationResponse.WorkingCalendarView(
                hours.start(),
                hours.end(),
                calendar.weekend().stream().sorted().toList(),
                calendar.holidays().stream().sorted().toList());
    }

    /**
     * Vencimiento de la OLA de cada incidente, en horas habiles.
     *
     * <p>Los incidentes sin severidad quedan fuera: su dedicacion la gobierna el umbral, no un
     * objetivo de resolucion. Los ya resueltos tampoco vencen.
     */
    private static List<PlanningSimulationResponse.IncidentDeadline> deadlines(
            List<Incident> incidents, PlanningRules rules) {

        BusinessTimeCalculator businessTime = new BusinessTimeCalculator(rules.workingCalendar());
        return incidents.stream()
                .filter(incident -> incident.severity() != null && incident.consumesCapacity())
                .map(incident -> {
                    BigDecimal target = rules.policyFor(incident.severity()).targetResolutionHours();
                    return new PlanningSimulationResponse.IncidentDeadline(
                            incident.id(),
                            incident.severity(),
                            incident.reportedAt(),
                            target,
                            businessTime.dueAt(incident.reportedAt(), target));
                })
                .toList();
    }

    /** Por que se movio el requerimiento, en los terminos del negocio. */
    private static String reason(AppliedRule rule) {
        return switch (rule) {
            case REPLANIFICACION_INMEDIATA ->
                    "Incidente de severidad alta: reclama lo que queda de la jornada en que arranca.";
            case CAPACIDAD_COMPROMETIDA ->
                    "El incidente comprometio la capacidad de la jornada pactada.";
            case SATURACION ->
                    "El dia estaba saturado: el incidente no cupo sin desplazar trabajo pactado.";
            case UMBRAL_INCIDENTE_EXCEDIDO ->
                    "El incidente supero el umbral de dedicacion configurado.";
            case CAPACIDAD_DIARIA_EXCEDIDA ->
                    "La jornada ya estaba comprometida por trabajo previo.";
        };
    }
}
