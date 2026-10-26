package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Component;

import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;

/**
 * Decide si un ticket de GLPI se puede traducir, y si no, por que no.
 *
 * <p>Es la politica de la capa anticorrupcion, separada de la traduccion que hace
 * {@link GlpiTicketMapper}. La separacion importa porque son dos decisiones distintas: el mapeador
 * sabe <em>como</em> se traduce un ticket, y el validador decide <em>si</em> se traduce. Mezclarlas
 * dejaria la politica de descarte repartida entre los metodos de traduccion, que es donde nadie la
 * busca cuando hay que cambiarla.
 *
 * <p><strong>La politica es descartar el ticket, no la planificacion.</strong> Un ticket mal formado
 * en GLPI es un dato de entrada defectuoso, no un fallo del sistema, y tumbar la peticion entera por
 * el haria que un solo ticket malo bloqueara el trabajo de todo un desarrollador. Se descarta el
 * elemento, se registra el motivo y se planifica con el resto. La alternativa —planificar con un
 * valor inventado para el campo que falta— es peor: produciria un plan que parece completo y no lo
 * esta.
 *
 * <p><strong>Hay una excepcion deliberada: la prioridad no descarta.</strong> Un ticket sin prioridad
 * sigue siendo planificable, porque el dominio sabe trabajar sin severidad y lo hace desde antes de
 * esta fase. La prioridad ausente degrada a severidad nula.
 *
 * <p><strong>El {@code actiontime} no se valida aqui, y la fecha si.</strong> Hasta la decision 124.2
 * este validador descartaba el ticket cuyo {@code actiontime} no fuera positivo; esa regla se retiro
 * porque las horas dejaron de salir del ticket y descartar por un dato que ya no se usa sacaria
 * trabajo del plan por un defecto que no lo afecta. La fecha tomo el camino contrario en la Fase 66b:
 * volvio a ser un dato del ticket, y por eso vuelve a descartar —con un motivo distinto, porque el
 * arreglo esta en GLPI y no en una declaracion—. Lo que se comprueba aqui es lo que de verdad impide
 * construir el objeto del dominio.
 *
 * <p>De donde salen ahora las horas y la fecha es de {@link #missingInputs}: las horas de la
 * planificacion que declaro el negocio y la fecha del propio ticket —{@code internal_time_to_resolve}
 * o {@code time_to_resolve}—. Es la unica puerta por la que un ticket llega a ser planificable, y por
 * eso las dos decisiones —la de GLPI y la del negocio— viven en la misma clase y se aplican en este
 * orden.
 */
@Component
public class GlpiTicketValidator {

    private final GlpiTicketMapper mapper;

    public GlpiTicketValidator(GlpiTicketMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * El descarte del ticket por un defecto de GLPI, vacio si GLPI lo entrego bien.
     *
     * <p>Los motivos estan escritos para que los lea una persona que opera GLPI, no para que los lea
     * un programa: nombran el campo de GLPI que hay que corregir. El texto viaja tal cual hasta la
     * respuesta del endpoint, con su codigo al lado para quien necesite contarlos.
     *
     * <p>El orden de las comprobaciones es el de la gravedad: primero lo que impide hasta nombrar el
     * ticket, despues lo que impide saber que es, y al final lo que impide leer sus campos. Un ticket
     * sin identificador y sin fecha se denuncia por lo primero, que es lo que hay que arreglar antes.
     */
    public Optional<GlpiDiscardedItem> rejection(GlpiTicket ticket) {
        if (ticket.id() == null) {
            return Optional.of(GlpiDiscardedItem.of(ticket, GlpiDiscardReason.SIN_IDENTIFICADOR_TICKET,
                    "sin identificador de ticket"));
        }
        if (!mapper.isIncident(ticket) && !mapper.isRequirement(ticket)) {
            return Optional.of(GlpiDiscardedItem.of(ticket, GlpiDiscardReason.TIPO_DESCONOCIDO,
                    "tipo de ticket desconocido: " + ticket.type()
                            + " (el contrato solo declara incidencias y peticiones)"));
        }
        if (mapper.isIncident(ticket)) {
            if (mapper.incidentStatus(ticket.status()).isEmpty()) {
                return Optional.of(GlpiDiscardedItem.of(ticket, GlpiDiscardReason.ESTADO_DESCONOCIDO,
                        "estado de incidencia desconocido: " + ticket.status()));
            }
            if (mapper.reportedAt(ticket).isEmpty()) {
                return Optional.of(GlpiDiscardedItem.of(ticket, GlpiDiscardReason.FECHA_CREACION_ILEGIBLE,
                        "fecha de creacion ausente o ilegible: '" + ticket.date() + "'"));
            }
            return Optional.empty();
        }
        if (mapper.requirementStatus(ticket.status()).isEmpty()) {
            return Optional.of(GlpiDiscardedItem.of(ticket, GlpiDiscardReason.ESTADO_DESCONOCIDO,
                    "estado de peticion desconocido: " + ticket.status()));
        }
        return Optional.empty();
    }

    /**
     * Lo que le falta al ticket para que sea planificable, venga de donde venga.
     *
     * <p><strong>Se siguen exigiendo las dos cosas a la vez —horas y fecha—, y ahora son dos
     * fuentes.</strong> Las horas las declara el desarrollador y siguen en {@code PlanningMetadata};
     * la fecha es la operativa de GLPI, que desde la Fase 66b es {@code internal_time_to_resolve} o,
     * en su defecto, {@code time_to_resolve}. La decision 124.1 —que un trabajo sabe cuanto dura y no
     * cuando se prometio no es media planificacion— sigue en pie; lo que cambio es de quien es la
     * segunda mitad. No se rellena la fecha con una declaracion de validacion, que es exactamente lo
     * que la Fase 66b vino a quitar.
     *
     * <p><strong>La fecha solo se le exige a un requerimiento.</strong> Una incidencia no se ubica en
     * el tiempo por una promesa: el motor la coloca por su fecha de creacion y su duracion, y pedirle
     * una fecha de OLA sacaria del plan trabajo que el dominio sabe colocar sin ella.
     *
     * <p><strong>Devuelve una lista y no un {@code Optional}, y puede traer dos.</strong> Un elemento
     * sin nada no es "un ticket incompleto": le falta la estimacion, que la debe el desarrollador, y le
     * falta la fecha, que la debe GLPI. Son dos sitios distintos los que tienen que actuar, asi que se
     * informan los dos. El precio es que un ticket puede aparecer dos veces en la lista de descartes, y
     * esta dicho en {@link GlpiDiscardedItem}.
     *
     * <p><strong>El texto distingue los dos casos que el codigo junta.</strong> "No hay planificacion
     * declarada" y "la planificacion declarada no tiene estimacion" son la misma accion —declarar la
     * estimacion— pero no el mismo diagnostico: lo primero dice que nadie ha empezado, lo segundo que
     * alguien empezo y retiro el valor. Quien opera necesita saber cual de las dos es.
     *
     * @param metadata la planificacion declarada del ticket, o {@code null} si nadie la declaro
     */
    public List<GlpiDiscardedItem> missingInputs(GlpiTicket ticket, PlanningMetadata metadata) {
        boolean hayEstimacion = metadata != null && metadata.estimatedHours() != null;
        boolean hayFecha = mapper.isIncident(ticket) || mapper.operationalDate(ticket).isPresent();
        if (hayEstimacion && hayFecha) {
            return List.of();
        }
        List<GlpiDiscardedItem> missing = new ArrayList<>(2);
        if (!hayEstimacion) {
            missing.add(GlpiDiscardedItem.of(ticket, GlpiDiscardReason.SIN_ESTIMACION_DECLARADA,
                    texto(metadata, "no tiene estimacion")));
        }
        if (!hayFecha) {
            missing.add(GlpiDiscardedItem.of(ticket, GlpiDiscardReason.SIN_FECHA_EN_GLPI,
                    "GLPI no trae ni internal_time_to_resolve ni time_to_resolve"));
        }
        return missing;
    }

    /**
     * El texto del descarte, segun haya declaracion o no.
     *
     * <p>Una fila con los dos valores nulos y la ausencia de fila son el mismo hecho para quien tiene
     * que actuar —no hay nada declarado que sirva— y distinto para quien diagnostica: en el primer
     * caso alguien paso por aqui y retiro lo que habia.
     */
    private static String texto(PlanningMetadata metadata, String loQueFalta) {
        return metadata == null
                ? "no hay planificacion declarada para este elemento"
                : "la planificacion declarada " + loQueFalta;
    }
}
