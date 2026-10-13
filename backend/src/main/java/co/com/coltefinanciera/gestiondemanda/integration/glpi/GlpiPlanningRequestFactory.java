package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;

import lombok.extern.slf4j.Slf4j;

import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;
import co.com.coltefinanciera.gestiondemanda.domain.model.Developer;
import co.com.coltefinanciera.gestiondemanda.domain.model.Incident;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningRequest;
import co.com.coltefinanciera.gestiondemanda.domain.model.Requirement;
import co.com.coltefinanciera.gestiondemanda.domain.repository.PlanningMetadataRepository;
import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiInvalidDataException;

/**
 * Arma la {@link PlanningRequest} que entra al motor a partir de tickets de GLPI.
 *
 * <p>Es el punto donde la capa anticorrupcion cumple su contrato: lo que sale de aqui es una peticion
 * del dominio, construida con objetos del dominio, y el motor la recibe sin poder saber de donde
 * vino. No hay un solo tipo de GLPI en la firma de {@code PlanningEngine}, y eso no es casualidad:
 * es la unica razon por la que este paquete existe.
 *
 * <p>Recorre los tickets una vez, decide con el validador si cada uno se traduce, lo mapea con el
 * mapeador y acumula los que no. El orden se conserva: el de la lista que devolvio GLPI. Ordenar
 * aqui seria introducir una politica de prioridad que no le toca a esta capa; el motor ya tiene la
 * suya y decide con ella.
 *
 * <p><strong>De GLPI salen los tickets; de este sistema, la planificacion.</strong> Es el corte de la
 * decision 124.2, y se ve entero en esta clase: el identificador del ticket, su estado, su severidad y
 * su fecha de creacion se traducen del ticket, y en cambio las horas y la fecha compromiso se leen de
 * {@code PlanningMetadata} por el identificador del ticket. GLPI dice <em>que</em> hay que hacer; el
 * negocio dice <em>cuanto dura y para cuando</em>. Ni {@code actiontime} ni {@code time_to_resolve} ni
 * {@code internal_time_to_resolve} participan ya en la construccion de la peticion.
 *
 * <p><strong>Sin las dos cosas no hay elemento planificable, y el ticket se descarta.</strong> No se
 * completa la que falta con lo que GLPI tenga: la decision 124.1 exige las dos, y rellenar el hueco
 * produciria un plan que parece completo y no lo esta. Es el mismo criterio con el que esta capa
 * descartaba antes los tickets sin {@code actiontime}, aplicado ahora a la fuente correcta.
 *
 * <p><strong>Una lista vacia no es un error.</strong> Si GLPI no devuelve tickets, el motor recibe una
 * agenda vacia y produce un plan vacio, que es la respuesta correcta a "este desarrollador no tiene
 * trabajo pendiente". Tratarlo como fallo obligaria a inventar una excepcion para el caso mas normal
 * de todos.
 *
 * <p><strong>La clasificacion de un ticket se hace una sola vez y la comparten los dos caminos.</strong>
 * Esta clase no solo construye la peticion: expone {@link #verdicts} con lo que decidio de cada ticket,
 * y es lo que lee la pantalla de declaracion. Podria haber sido un clasificador aparte, y habria sido
 * el error: dos sitios decidiendo lo mismo acaban discrepando, y la discrepancia se ve como un ticket
 * que la pantalla ofrece declarar y que el plan descarta igual. Aqui no hay dos decisiones que puedan
 * separarse porque solo hay una.
 */
@Slf4j
@Component
public class GlpiPlanningRequestFactory {

    private final GlpiTicketMapper mapper;
    private final GlpiTicketValidator validator;
    private final GlpiContract contract;
    private final PlanningMetadataRepository metadataRepository;

    public GlpiPlanningRequestFactory(GlpiTicketMapper mapper, GlpiTicketValidator validator,
            GlpiContract contract, PlanningMetadataRepository metadataRepository) {
        this.mapper = mapper;
        this.validator = validator;
        this.contract = contract;
        this.metadataRepository = metadataRepository;
    }

    /** La peticion del dominio y los descartes que quedaron por el camino. */
    public record Result(PlanningRequest request, List<GlpiDiscardedItem> discarded) {

        public Result {
            discarded = discarded == null ? List.of() : List.copyOf(discarded);
        }
    }

    /**
     * Traduce un desarrollador de GLPI y sus tickets a la peticion del dominio.
     *
     * <p>El identificador que se guarda es el que pidio quien llamo, no el numero interno de GLPI. Es
     * una eleccion con una consecuencia visible: el plan queda registrado con la misma clave con la
     * que se pidio, de modo que la respuesta y la peticion se pueden correlacionar sin conocer la
     * numeracion de GLPI. El precio es que dos formas de nombrar al mismo usuario —su numero y su
     * login— producirian dos planes con identificadores distintos; queda anotado como riesgo.
     */
    public Result build(String developerId, GlpiUser user, List<GlpiTicket> tickets,
            PlanningRules rules) {
        Developer developer = new Developer(developerId, displayName(developerId, user));

        List<Incident> incidents = new ArrayList<>();
        List<Requirement> requirements = new ArrayList<>();
        List<GlpiDiscardedItem> discarded = new ArrayList<>();

        // El recorrido lo decide verdicts(), que es el mismo que lee la pantalla de declaracion. Aqui
        // solo se reparte lo que ya se decidio: lo traducido al motor, lo descartado a la respuesta.
        for (Verdict verdict : verdicts(tickets)) {
            if (verdict.incident() != null) {
                incidents.add(verdict.incident());
            } else if (verdict.requirement() != null) {
                requirements.add(verdict.requirement());
            } else {
                discarded.addAll(verdict.discards());
            }
        }

        // El contrato se nombra en cada traduccion a proposito: una lectura con menos tickets de los
        // esperados tiene que poder atribuirse a una version concreta de lo que se da por cierto de
        // GLPI, y no quedar como un misterio de "el adaptador".
        //
        // Se cuentan descartes Y tickets descartados, y no es redundante: un elemento sin declaracion
        // produce dos descartes, asi que los dos numeros difieren justo en el caso que interesa
        // vigilar durante la transicion.
        log.info("Traduccion GLPI para {} con el contrato {}: {} tickets recibidos, {} incidencias, "
                + "{} requerimientos, {} descartes sobre {} tickets", developer.id(), contract.version(),
                tickets.size(), incidents.size(), requirements.size(), discarded.size(),
                ticketsDescartados(discarded));
        if (!discarded.isEmpty()) {
            log.warn("Descartes de la traduccion: {}", discarded);
        }

        return new Result(new PlanningRequest(developer, incidents, requirements, rules), discarded);
    }

    /**
     * Lo que la capa anticorrupcion decidio de un ticket, y con que lo decidio.
     *
     * <p>Es la unica clasificacion que existe. {@link #build} la usa para repartir los tickets entre el
     * motor y los descartes, y la lectura de la pantalla de declaracion la lee tal cual. Las dos
     * preguntas —«entra al plan?» y «que le falta a este ticket?»— son la misma, y por eso tienen una
     * sola respuesta.
     *
     * @param ticket      el ticket tal como lo devolvio GLPI
     * @param declaration su planificacion declarada, o {@code null} si nadie declaro nada
     * @param reading     lo que el ticket dice de si mismo, ya traducido
     * @param status      el estado de la clasificacion
     * @param discards    por que no llego al motor; vacio si llego
     * @param incident    la incidencia del dominio, o {@code null} si no lo es o no se pudo traducir
     * @param requirement el requerimiento del dominio, o {@code null} si no lo es o no se pudo traducir
     */
    public record Verdict(
            GlpiTicket ticket,
            PlanningMetadata declaration,
            Reading reading,
            DeclarationStatus status,
            List<GlpiDiscardedItem> discards,
            Incident incident,
            Requirement requirement) {

        public Verdict {
            discards = discards == null ? List.of() : List.copyOf(discards);
        }
    }

    /**
     * Lo que el ticket dice de si mismo, traducido, y que no depende de ninguna declaracion.
     *
     * <p>Se calcula en la misma pasada que la clasificacion porque sale del mismo mapeador y del mismo
     * contrato. Hacerlo aparte obligaria a que quien lee supiera distinguir incidencia de peticion para
     * saber que tabla de estados mirar, que es exactamente la regla que esta clase tiene en un solo
     * sitio y que la capa anticorrupcion existe para no repartir.
     *
     * <p>Los tres campos son nulos cuando GLPI no permite saberlos —tipo desconocido, estado
     * desconocido, fecha ilegible—, y el descarte que acompaña al veredicto dice cual falta y por que.
     * Un nulo aqui no es un dato que se perdio: es un dato que GLPI no tiene.
     *
     * @param type      incidencia o peticion, {@code null} si el contrato no conoce el tipo
     * @param status    el estado del dominio, {@code null} si no se puede traducir
     * @param createdAt la fecha del ticket ya interpretada, {@code null} si no se puede leer
     */
    public record Reading(WorkItemType type, String status, Instant createdAt) {
    }

    /**
     * La clasificacion de una agenda entera, con las declaraciones leidas en una sola consulta.
     *
     * <p>Es la puerta que usa la lectura de la pantalla de declaracion, y existe para que esa lectura
     * no pueda tener su propia version de las reglas. El orden se conserva —es el de la lista que
     * devolvio GLPI—: reordenar aqui seria introducir una politica de prioridad que no le toca a esta
     * capa.
     */
    public List<Verdict> verdicts(List<GlpiTicket> tickets) {
        Map<String, PlanningMetadata> declared = declaredFor(tickets);
        return tickets.stream()
                .map(ticket -> verdict(ticket, declared.get(workItemIdOf(ticket))))
                .toList();
    }

    /**
     * La clasificacion de un ticket.
     *
     * <p>El orden de las comprobaciones es el de siempre: primero GLPI —un ticket que no se puede ni
     * nombrar no llega a preguntar por su declaracion y tiene un solo motivo por el que esta fuera—,
     * despues la declaracion, y al final la traduccion. Quien decide cada paso son
     * {@link GlpiTicketValidator} y {@link GlpiTicketMapper}; lo unico que se hace aqui es nombrar el
     * resultado con {@link DeclarationStatus}.
     *
     * @param declaration la planificacion declarada del ticket, o {@code null} si no hay fila
     */
    public Verdict verdict(GlpiTicket ticket, PlanningMetadata declaration) {
        Optional<GlpiDiscardedItem> glpi = validator.rejection(ticket);
        if (glpi.isPresent()) {
            return new Verdict(ticket, declaration, reading(ticket), DeclarationStatus.NO_TRADUCIBLE,
                    List.of(glpi.get()), null, null);
        }

        List<GlpiDiscardedItem> missing = validator.missingDeclaration(ticket, declaration);
        if (!missing.isEmpty()) {
            return new Verdict(ticket, declaration, reading(ticket), statusOf(missing), missing,
                    null, null);
        }

        if (mapper.isIncident(ticket)) {
            Optional<Incident> incident = mapper.toIncident(ticket, declaration.estimatedHours());
            return incident
                    .map(found -> plannable(ticket, declaration, found, null))
                    .orElseGet(() -> failed(ticket, declaration, "la incidencia"));
        }
        Optional<Requirement> requirement = mapper.toRequirement(ticket,
                declaration.estimatedHours(), declaration.committedDate());
        return requirement
                .map(found -> plannable(ticket, declaration, null, found))
                .orElseGet(() -> failed(ticket, declaration, "la peticion"));
    }

    /**
     * El estado que nombran los codigos que el validador produjo.
     *
     * <p><strong>Se deriva de los codigos, no de los valores nulos.</strong> Volver a preguntar aqui si
     * la estimacion es nula seria escribir por segunda vez la regla que ya decidio
     * {@code missingDeclaration}, y el dia que esa regla cambie esta se quedaria atras sin que nada
     * avisara. Los codigos son la unica fuente, y los dos que el validador puede devolver a la vez
     * significan lo mismo que no tener declaracion: hay que declarar las dos cosas.
     */
    private static DeclarationStatus statusOf(List<GlpiDiscardedItem> missing) {
        boolean estimacion = missing.stream()
                .anyMatch(item -> item.code() == GlpiDiscardReason.SIN_ESTIMACION_DECLARADA);
        boolean compromiso = missing.stream()
                .anyMatch(item -> item.code() == GlpiDiscardReason.SIN_COMPROMISO_DECLARADO);

        if (estimacion && compromiso) {
            return DeclarationStatus.SIN_DECLARACION;
        }
        return estimacion ? DeclarationStatus.SIN_ESTIMACION : DeclarationStatus.SIN_COMPROMISO;
    }

    private Verdict plannable(GlpiTicket ticket, PlanningMetadata declaration,
            Incident incident, Requirement requirement) {
        return new Verdict(ticket, declaration, reading(ticket), DeclarationStatus.PLANIFICABLE,
                List.of(), incident, requirement);
    }

    /**
     * El veredicto de un ticket que paso la validacion y aun asi no se pudo traducir.
     *
     * <p>Es el descarte que {@link GlpiDiscardReason#TRADUCCION_FALLIDA} documenta como hoy
     * inalcanzable, y se conserva por el mismo motivo que alli: el mapeador devuelve un {@code Optional}
     * y el dia que sus condiciones y las del validador se separen, el ticket tiene que salir como
     * descarte visible en lugar de desaparecer de las dos listas.
     */
    private Verdict failed(GlpiTicket ticket, PlanningMetadata declaration, String queEs) {
        return new Verdict(ticket, declaration, reading(ticket), DeclarationStatus.NO_TRADUCIBLE,
                List.of(GlpiDiscardedItem.of(ticket, GlpiDiscardReason.TRADUCCION_FALLIDA,
                        "no se pudo traducir " + queEs + " al dominio")),
                null, null);
    }

    /** Lo que el ticket dice de si mismo. El tipo decide que tabla de estados se consulta. */
    private Reading reading(GlpiTicket ticket) {
        if (mapper.isIncident(ticket)) {
            return new Reading(WorkItemType.INCIDENTE, name(mapper.incidentStatus(ticket.status())),
                    mapper.reportedAt(ticket).orElse(null));
        }
        if (mapper.isRequirement(ticket)) {
            return new Reading(WorkItemType.REQUERIMIENTO,
                    name(mapper.requirementStatus(ticket.status())),
                    mapper.reportedAt(ticket).orElse(null));
        }
        // El tipo no esta en el contrato: no se sabe que es, asi que no se sabe su estado. Los dos
        // nulos son la respuesta honesta, y el descarte TIPO_DESCONOCIDO dice por que.
        return new Reading(null, null, mapper.reportedAt(ticket).orElse(null));
    }

    private static String name(Optional<? extends Enum<?>> value) {
        return value.map(found -> found.name()).orElse(null);
    }

    /** El identificador del ticket como texto, o {@code null} si GLPI no lo dio. */
    private static String workItemIdOf(GlpiTicket ticket) {
        return ticket.id() == null ? null : String.valueOf(ticket.id());
    }

    /**
     * La planificacion declarada de todos los tickets, en una sola consulta.
     *
     * <p>Se leen todos de golpe y no uno por uno dentro del bucle: con una agenda de verdad la
     * diferencia es una consulta contra decenas, y el caso de uso no tiene ninguna razon para pagar la
     * segunda. El mapa que sale de aqui es la unica lectura que hace esta clase.
     */
    private Map<String, PlanningMetadata> declaredFor(List<GlpiTicket> tickets) {
        List<String> ids = tickets.stream()
                .map(GlpiTicket::id)
                .filter(Objects::nonNull)
                .map(String::valueOf)
                .toList();
        return metadataRepository.findByWorkItemIdIn(ids).stream()
                .collect(Collectors.toMap(PlanningMetadata::workItemId, Function.identity()));
    }

    /** Cuantos tickets distintos hay detras de los descartes: uno puede aparecer mas de una vez. */
    private static long ticketsDescartados(List<GlpiDiscardedItem> discarded) {
        return discarded.stream().map(GlpiDiscardedItem::ticketId).distinct().count();
    }

    /**
     * El nombre del desarrollador, o un fallo de datos si GLPI no da ninguno.
     *
     * <p>{@code Developer} exige texto, y un usuario de GLPI sin nombre ni login no se puede traducir.
     * Se falla con {@link GlpiInvalidDataException} en lugar de dejar que reviente la invariante del
     * dominio: es un dato de GLPI el que esta mal, y el mensaje debe decir eso.
     */
    private static String displayName(String developerId, GlpiUser user) {
        String name = user.displayName();
        if (name == null) {
            throw new GlpiInvalidDataException(
                    "El usuario " + developerId + " de GLPI no tiene nombre ni login utilizables");
        }
        return name;
    }
}
