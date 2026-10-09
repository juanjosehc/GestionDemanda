package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Un ticket de GLPI, tal como lo devuelve {@code GET /Ticket}.
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
        @JsonProperty("date") String date,
        @JsonProperty("users_id_assign") Integer assignedUserId) {

    /** {@code type} de un ticket que GLPI considera una incidencia. */
    public static final int TYPE_INCIDENT = 1;

    /** {@code type} de un ticket que GLPI considera una peticion. */
    public static final int TYPE_REQUEST = 2;
}
