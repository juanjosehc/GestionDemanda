package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.DeclarationStatus;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiDiscardReason;

/**
 * Salida de {@code GET /api/planning-metadata/declarations/{developerId}}: lo que tiene asignado un
 * tecnico, y en que estado de declaracion esta cada cosa.
 *
 * <p><strong>Es una lectura, y eso es lo que la define.</strong> No planifica, no guarda nada y no
 * ejecuta el motor: son los tickets que GLPI ya tiene mas lo que el negocio ya declaro, puestos uno al
 * lado del otro. La pantalla que venga despues se construye con esto y no con
 * {@code POST /api/planning/from-glpi}, que es un endpoint de escritura: pedirle el listado a un
 * endpoint que guarda un plan dejaria un plan guardado por cada vez que alguien abre la pantalla.
 *
 * <p><strong>Los cinco estados son los mismos que decide el plan.</strong>
 * {@link DeclarationStatus} no es un vocabulario nuevo: se deriva de los codigos que produce
 * {@link co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicketValidator}, que es quien
 * decide hoy que entra al plan. Un ticket marcado {@code PLANIFICABLE} aqui entraria al motor, y uno
 * marcado {@code SIN_ESTIMACION} no, por construccion y no por coincidencia.
 *
 * <p><strong>Cada elemento se puede justificar con tres cosas.</strong> {@code discards} trae el codigo
 * —que es la regla aplicada, y no cambia aunque se reescriba el texto— y el motivo en palabras; y
 * {@code source} dice, para la respuesta entera, que campos vienen del sistema ajeno y cuales de este.
 * Sin eso, un elemento clasificado como {@code NO_TRADUCIBLE} seria una afirmacion sin fundamento
 * visible.
 *
 * <p><strong>Los campos que GLPI no permite saber van en nulo, y no es un hueco.</strong> Un ticket de
 * tipo desconocido no tiene tipo ni estado en el dominio; uno con fecha ilegible no tiene
 * {@code createdAt}. Rellenarlos con algo «razonable» seria inventar el dato que el descarte esta
 * denunciando.
 *
 * <p>El orden de {@code items} es el que devolvio GLPI, igual que en la peticion que arma
 * {@code GlpiPlanningRequestFactory}: ordenar aqui seria introducir una politica de prioridad que no
 * le toca a esta capa.
 *
 * @param developer el tecnico cuyos tickets se listan
 * @param items     sus tickets, clasificados; vacio si no tiene ninguno
 * @param source    de donde sale cada dato de la respuesta
 */
public record DeveloperDeclarationsResponse(
        DeveloperView developer,
        List<DeclarationItem> items,
        Source source) {

    public DeveloperDeclarationsResponse {
        items = items == null ? List.of() : List.copyOf(items);
    }

    /**
     * El tecnico, tal como lo conoce GLPI.
     *
     * <p>{@code id} es el que pidio quien llamo, no el interno de GLPI, por el mismo motivo que en la
     * peticion del plan: la respuesta se puede correlacionar con la peticion sin conocer la numeracion
     * del sistema ajeno.
     *
     * <p>{@code name} sale del usuario de GLPI compuesto con el mismo criterio que usa el plan. Puede
     * venir nulo —un usuario sin nombre ni login utilizables—, y aqui no se rechaza: el plan lo rechaza
     * porque el dominio exige un nombre para calcular, y esta lectura no calcula nada.
     */
    public record DeveloperView(String id, String name) {
    }

    /**
     * Un ticket asignado al tecnico, con su clasificacion.
     *
     * <p><strong>{@code discards} es una lista y no un campo suelto.</strong> Un elemento al que le
     * falta la declaracion entera produce dos: le falta la estimacion, que la debe el desarrollador, y
     * la fecha operativa, que desde la Fase 66b la debe GLPI. Son dos sitios distintos y un campo unico
     * obligaria a elegir cual de los dos se calla. Cuando el ticket es planificable la lista va vacia.
     *
     * @param workItemId        identificador del ticket en GLPI, que es la clave de su declaracion.
     *                          Vale {@code "(sin id)"} cuando GLPI no lo dio, que es la misma
     *                          convencion que usa el descarte: un ticket sin identificador tiene que
     *                          verse, no desaparecer de la lista.
     * @param type              incidencia o peticion; nulo si el tipo no esta en el contrato
     * @param status            el estado del dominio ya traducido; nulo si no se puede traducir
     * @param priority          la prioridad cruda de GLPI, en su escala 1..5; nula si no la trae
     * @param createdAt         la fecha del ticket ya interpretada; nula si no se puede leer
     * @param title             el titulo del ticket, que GLPI siempre trae
     * @param declarationStatus que le falta a este ticket para poder planificarse
     * @param discards          por que no llegaria al plan; vacio si es planificable
     * @param declaration       lo declarado hoy, o {@code null} si nadie ha declarado nada. Es el
     *                          mismo recurso que sirve {@code GET /{workItemId}}, para que quien vaya a
     *                          modificarlo tenga ya delante lo que hay.
     * @param operationalDate   la fecha con la que GLPI ubica el requerimiento: {@code
     *                          internal_time_to_resolve} o, si no existe, {@code time_to_resolve}. Es
     *                          la fecha que usa el plan desde la Fase 66b. Nula en una incidencia
     *                          —que no se ubica por una promesa— y en un ticket sin ninguna de las dos.
     * @param operationalDateSource de cual de los dos campos salio. Viaja al lado de la fecha porque
     *                          2026-11-19 es la promesa de la OLA o la del SLA, y sin el origen no se
     *                          puede contrastar.
     */
    public record DeclarationItem(
            String workItemId,
            WorkItemType type,
            String status,
            Integer priority,
            Instant createdAt,
            String title,
            DeclarationStatus declarationStatus,
            List<DiscardView> discards,
            PlanningMetadataResponse declaration,
            LocalDate operationalDate,
            String operationalDateSource) {

        public DeclarationItem {
            discards = discards == null ? List.of() : List.copyOf(discards);
        }
    }

    /**
     * Una causa por la que el ticket no llegaria al plan.
     *
     * <p>El codigo es el que se cuenta y el que no cambia; el motivo es el que se lee y nombra el campo
     * que hay que corregir. Es el mismo reparto que hace
     * {@link co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiDiscardedItem} en la respuesta
     * del plan, y por eso el codigo viaja como constante y no como texto copiado.
     */
    public record DiscardView(GlpiDiscardReason code, String reason) {
    }

    /**
     * De donde sale cada campo de la respuesta.
     *
     * <p>Viaja en el payload y no solo en el javadoc por el mismo motivo que en la fotografia de
     * {@code /metrics}: quien lea el JSON dentro de seis meses no va a venir a leer este comentario, y
     * un dato sin su procedencia no se puede contrastar. Va una vez por respuesta y no en cada
     * elemento: repetir seis nombres de campo mil doscientas veces no informa mas.
     */
    public record Source(String glpi, String declaration) {

        /** Lo que el ticket dice de si mismo, que es lo unico que aporta el sistema ajeno. */
        public static final String GLPI = "/search/Ticket por criterio de tecnico (opcion 5): "
                + "workItemId, type, status, priority, createdAt, title y la fecha operativa "
                + "(internal_time_to_resolve, opcion 180; si no hay, time_to_resolve, opcion 18)";

        /** Las horas y el compromiso, que GLPI no guarda y declara el negocio. */
        public static final String DECLARATION = "planning_metadata por workItemId: estimatedHours, con "
                + "su autor y su sello. committedDate se conserva como contraste y ya no ubica el "
                + "requerimiento en el tiempo";
    }
}
