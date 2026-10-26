package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Un ticket de GLPI, con los campos crudos que la planificacion necesita.
 *
 * <p>Los campos se declaran <em>crudos</em>: los codigos numericos se guardan como numeros y las
 * fechas como el texto que GLPI envia. Ninguna interpretacion ocurre aqui. Es deliberado y es la
 * razon de que este tipo exista: si el DTO ya tradujera, la traduccion quedaria repartida entre el
 * DTO y el mapeador, y la capa anticorrupcion no tendria un unico sitio donde leerla. Todo el
 * significado —que es un incidente y no un requerimiento, que prioridad 5 es severidad alta, que
 * {@code actiontime} son segundos— se decide en {@link GlpiTicketMapper}.
 *
 * <p>Los enteros llegan como {@code Integer} y no como {@code int} porque en GLPI son opcionales de
 * hecho: un ticket sin prioridad es un ticket valido, y el mapeador tiene que poder distinguir "no
 * vino" de "vino cero". Un {@code int} primitivo convertiria la ausencia en un cero que no significa
 * nada, y esa es exactamente la clase de dato inventado que una capa anticorrupcion debe impedir.
 *
 * <p><strong>El objeto lo construye {@link GlpiRestPlanningSource}, no Jackson.</strong> Los nombres de
 * {@code @JsonProperty} son los de {@code GET /Ticket} y quedan como documentacion de a que campo de
 * GLPI corresponde cada valor; pero la lectura real pasa por {@code /search/Ticket}, donde las filas
 * llegan indexadas por numero de opcion de busqueda en lugar de por nombre. Traducir de una forma a la
 * otra es trabajo del adaptador, que es quien conoce los numeros.
 *
 * <p><strong>No hay un campo para el tecnico asignado, y no es un olvido.</strong> Hasta la decision
 * 159 este registro declaraba {@code users_id_assign}, que <em>no existe</em>: en la instancia real el
 * campo no viene en {@code /Ticket} —ausente en 1000 respuestas— y leerlo dejaba siempre la lista
 * vacia. Quien esta asignado no es un campo del ticket, es una fila de {@code Ticket_User}, y el filtro
 * por tecnico se resuelve en el servidor con la opcion de busqueda 5. Reponer el campo seria reponer el
 * fallo.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GlpiTicket(
        @JsonProperty("id") Integer id,
        @JsonProperty("name") String name,
        @JsonProperty("status") Integer status,
        @JsonProperty("type") Integer type,
        @JsonProperty("priority") Integer priority,
        @JsonProperty("impact") Integer impact,
        @JsonProperty("urgency") Integer urgency,
        @JsonProperty("actiontime") Long actiontime,
        @JsonProperty("time_to_resolve") String timeToResolve,
        @JsonProperty("internal_time_to_resolve") String internalTimeToResolve,
        @JsonProperty("date") String date) {

    /** {@code type} de un ticket que GLPI considera una incidencia. */
    public static final int TYPE_INCIDENT = 1;

    /** {@code type} de un ticket que GLPI considera una peticion. */
    public static final int TYPE_REQUEST = 2;

    /**
     * Un ticket sin Internal TTR, para quien no quiera nombrarlo.
     *
     * <p>Lo construye asi el codigo de prueba y cualquier lectura anterior a la Fase 66b. La
     * produccion siempre pasa el valor: lo lee de la opcion de busqueda 180 y no de aqui.
     */
    public GlpiTicket(
            Integer id,
            String name,
            Integer status,
            Integer type,
            Integer priority,
            Integer impact,
            Integer urgency,
            Long actiontime,
            String timeToResolve,
            String date) {
        this(id, name, status, type, priority, impact, urgency, actiontime, timeToResolve, null, date);
    }
}
