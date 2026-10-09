package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.util.Map;
import java.util.Optional;
import java.util.Set;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;

/**
 * El contrato de GLPI que esta capa anticorrupcion asume, escrito como datos y no como codigo.
 *
 * <p>Hasta aqui las suposiciones sobre GLPI estaban dentro de los mapeadores: el {@code 1} y el
 * {@code 2} de {@code type}, las tablas de estados, la escala de prioridad 1-5 y el formato de fecha
 * eran constantes y {@code switch} repartidos por tres clases. Estaban escritas, pero no <em>declaradas</em>:
 * no habia un sitio donde leer de un golpe que es lo que se esta dando por cierto del sistema ajeno,
 * ni forma de compararlo con lo que la instancia responde de verdad.
 *
 * <p>Este registro es ese sitio. No anade comportamiento nuevo: recoge el que ya existia y lo vuelve
 * un valor. Con eso se consiguen las dos cosas que la fase pide. La primera, que el contrato se pueda
 * <em>comparar</em> contra una respuesta real —de eso se encarga {@link GlpiContractVerifier}—. La
 * segunda, que una variante distinta de GLPI se adapte cambiando el bean de esta clase en
 * {@code PlanningConfig}, sin tocar el dominio ni el motor: el dia que una instancia use otros
 * codigos de estado, se declara otro contrato y nada mas cambia.
 *
 * <p><strong>Lo que este registro no declara.</strong> Los nombres de los campos viajan en los
 * {@code @JsonProperty} de {@link GlpiTicket}, porque cambiarlos exige otro DTO y no otro valor; y las
 * reglas de que se descarta y que se tolera siguen en {@link GlpiTicketValidator}, porque son politica
 * y no forma. Aqui solo esta lo que varia entre instancias y lo que hay que comprobar contra la real.
 *
 * @param version             identificador de esta variante de contrato. Viaja en los informes de
 *                            verificacion para que una diferencia se pueda atribuir a una version
 *                            concreta y no a "el contrato" en abstracto.
 * @param incidentTypes       codigos de {@code type} que el dominio lee como incidencia.
 * @param requirementTypes    codigos de {@code type} que el dominio lee como peticion.
 * @param incidentStatuses    tabla de {@code status} a estado de incidencia.
 * @param requirementStatuses tabla de {@code status} a estado de peticion.
 * @param minPriority         extremo bajo de la escala de prioridad admitida.
 * @param maxPriority         extremo alto de la escala de prioridad admitida.
 * @param datePattern         formato de las fechas de GLPI, que llegan sin zona horaria.
 * @param ticketFields        campos del ticket que el adaptador lee, con su tipo y su obligatoriedad.
 */
public record GlpiContract(
        String version,
        Set<Integer> incidentTypes,
        Set<Integer> requirementTypes,
        Map<Integer, IncidentStatus> incidentStatuses,
        Map<Integer, RequirementStatus> requirementStatuses,
        int minPriority,
        int maxPriority,
        String datePattern,
        Map<String, Field> ticketFields) {

    /** Un campo del ticket tal como el contrato lo declara. */
    public record Field(String type, boolean required) {

        public static final String INTEGER = "integer";
        public static final String STRING = "string";

        public static Field required(String type) {
            return new Field(type, true);
        }

        public static Field optional(String type) {
            return new Field(type, false);
        }
    }

    public GlpiContract {
        incidentTypes = Set.copyOf(incidentTypes);
        requirementTypes = Set.copyOf(requirementTypes);
        incidentStatuses = Map.copyOf(incidentStatuses);
        requirementStatuses = Map.copyOf(requirementStatuses);
        ticketFields = Map.copyOf(ticketFields);
    }

    public boolean isIncident(Integer type) {
        return type != null && incidentTypes.contains(type);
    }

    public boolean isRequirement(Integer type) {
        return type != null && requirementTypes.contains(type);
    }

    /**
     * El estado de incidencia del codigo de GLPI, vacio si el contrato no lo declara.
     *
     * <p>Se comprueba la nulidad antes de consultar la tabla a proposito: {@code Map.copyOf} devuelve
     * un mapa inmutable que rechaza la clave nula, y un {@code status} ausente es un caso normal de
     * GLPI, no un fallo.
     */
    public Optional<IncidentStatus> incidentStatus(Integer status) {
        return status == null ? Optional.empty() : Optional.ofNullable(incidentStatuses.get(status));
    }

    /** El estado de peticion del codigo de GLPI, vacio si el contrato no lo declara. */
    public Optional<RequirementStatus> requirementStatus(Integer status) {
        return status == null ? Optional.empty() : Optional.ofNullable(requirementStatuses.get(status));
    }

    /** Si el valor esta dentro de la escala de prioridad declarada. */
    public boolean inScale(Integer value) {
        return value != null && value >= minPriority && value <= maxPriority;
    }

    /**
     * El contrato del API REST de GLPI tal como lo usa hoy el adaptador {@code glpi-rest-2}.
     *
     * <p>Las tablas de estados son las mismas que estaban en {@link GlpiTicketMapper}, sin cambiar
     * ningun valor. {@code date} se declara opcional aunque el adaptador lo necesite para una
     * incidencia: su obligatoriedad depende del {@code type} del ticket y eso no cabe en un mapa plano
     * de campos. Quien lo comprueba, ticket a ticket y con un motivo legible, es
     * {@link GlpiTicketValidator}.
     *
     * <p><strong>{@code time_to_resolve} y {@code actiontime} siguen en el mapa y ya no obligan.</strong>
     * Los dos dejan de ser entradas del motor con la decision 124.2: la fecha compromiso la declara el
     * gestor de demanda y las horas el desarrollador, asi que el SLA y el tiempo de accion de GLPI
     * quedan como datos de diagnostico. El verificador los sigue exigiendo al leer una instancia real
     * —que el campo exista es una pregunta sobre GLPI, no sobre la planificacion— y quien decide que
     * un ticket planifique es la declaracion, no el ticket.
     *
     * <p>{@code priority}, {@code impact} y {@code urgency} son opcionales por decision: un ticket sin
     * prioridad se planifica con severidad nula, que es un camino que el dominio ya sabia recorrer
     * antes de esta integracion. {@code date_creation} no aparece en el mapa porque el adaptador no lo
     * lee; si la instancia real lo devuelve, el verificador lo reportara como campo no modelado, que
     * es exactamente la pregunta que hay que responder contra el GLPI de verdad.
     */
    public static final GlpiContract REST_V1 = new GlpiContract(
            "glpi-contract-1",
            Set.of(GlpiTicket.TYPE_INCIDENT),
            Set.of(GlpiTicket.TYPE_REQUEST),
            Map.of(
                    1, IncidentStatus.ABIERTO,
                    2, IncidentStatus.EN_ATENCION,
                    3, IncidentStatus.EN_ATENCION,
                    4, IncidentStatus.EN_ATENCION,
                    5, IncidentStatus.RESUELTO,
                    6, IncidentStatus.RESUELTO),
            Map.of(
                    1, RequirementStatus.PLANIFICADO,
                    2, RequirementStatus.EN_EJECUCION,
                    3, RequirementStatus.EN_EJECUCION,
                    4, RequirementStatus.EN_EJECUCION,
                    5, RequirementStatus.FINALIZADO,
                    6, RequirementStatus.FINALIZADO),
            1,
            5,
            "yyyy-MM-dd HH:mm:ss",
            Map.ofEntries(
                    Map.entry("id", Field.required(Field.INTEGER)),
                    Map.entry("name", Field.optional(Field.STRING)),
                    Map.entry("type", Field.required(Field.INTEGER)),
                    Map.entry("status", Field.required(Field.INTEGER)),
                    Map.entry("priority", Field.optional(Field.INTEGER)),
                    Map.entry("impact", Field.optional(Field.INTEGER)),
                    Map.entry("urgency", Field.optional(Field.INTEGER)),
                    Map.entry("actiontime", Field.required(Field.INTEGER)),
                    Map.entry("date", Field.optional(Field.STRING)),
                    Map.entry("time_to_resolve", Field.optional(Field.STRING)),
                    Map.entry("users_id_assign", Field.optional(Field.INTEGER))));
}
