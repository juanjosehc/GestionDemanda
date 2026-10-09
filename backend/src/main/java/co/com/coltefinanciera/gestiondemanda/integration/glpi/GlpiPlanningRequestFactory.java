package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;

import lombok.extern.slf4j.Slf4j;

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
        Map<String, PlanningMetadata> declared = declaredFor(tickets);

        List<Incident> incidents = new ArrayList<>();
        List<Requirement> requirements = new ArrayList<>();
        List<GlpiDiscardedItem> discarded = new ArrayList<>();

        for (GlpiTicket ticket : tickets) {
            // Primero GLPI: un ticket que no se puede ni nombrar no llega a preguntar por su
            // declaracion, y tiene un solo motivo por el que esta fuera.
            Optional<GlpiDiscardedItem> glpi = validator.rejection(ticket);
            if (glpi.isPresent()) {
                discarded.add(glpi.get());
                continue;
            }
            PlanningMetadata metadata = declared.get(String.valueOf(ticket.id()));
            List<GlpiDiscardedItem> faltantes = validator.missingDeclaration(ticket, metadata);
            if (!faltantes.isEmpty()) {
                discarded.addAll(faltantes);
                continue;
            }
            if (mapper.isIncident(ticket)) {
                Optional<Incident> incident = mapper.toIncident(ticket, metadata.estimatedHours());
                if (incident.isPresent()) {
                    incidents.add(incident.get());
                } else {
                    discarded.add(GlpiDiscardedItem.of(ticket, GlpiDiscardReason.TRADUCCION_FALLIDA,
                            "no se pudo traducir la incidencia al dominio"));
                }
            } else {
                Optional<Requirement> requirement = mapper.toRequirement(ticket,
                        metadata.estimatedHours(), metadata.committedDate());
                if (requirement.isPresent()) {
                    requirements.add(requirement.get());
                } else {
                    discarded.add(GlpiDiscardedItem.of(ticket, GlpiDiscardReason.TRADUCCION_FALLIDA,
                            "no se pudo traducir la peticion al dominio"));
                }
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
