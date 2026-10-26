package co.com.coltefinanciera.gestiondemanda.domain.rules;

import java.math.BigDecimal;
import java.util.EnumMap;
import java.util.Map;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.model.Incident;

/**
 * Reglas de negocio de la planificacion.
 *
 * <p>Es configuracion, no infraestructura: vive en el dominio y no conoce Spring. La capa de
 * configuracion la construye desde {@code planning.*} (ver {@code PlanningProperties}).
 *
 * <p>Declara <em>que</em> se puede hacer; <em>cuanto</em> cabe lo responde {@link CapacityBook},
 * que consulta el calendario fecha a fecha. Las reglas ya no llevan la cuenta de la capacidad: el
 * punto de extension para la capacidad por desarrollador es el calendario que recibe el libro.
 *
 * @param incidentThresholdHours dedicacion a partir de la cual un incidente obliga a recalcular.
 *                               El umbral se supera en sentido estricto: exactamente el umbral
 *                               no dispara replanificacion. Solo se aplica a incidentes <em>sin</em>
 *                               severidad; los que la declaran se rigen por su politica. Se conserva
 *                               para no cambiar el plan de los datos ya existentes.
 * @param workingHoursPerDay     jornada de un dia laborable, <strong>derivada del calendario</strong>.
 *                               Se acepta como parametro por compatibilidad con el modelo anterior al
 *                               calendario laboral, pero el valor que sobrevive es el que declara el
 *                               bloque de {@code workingCalendar}: dos fuentes para la misma duracion
 *                               acaban discrepando.
 * @param planningHorizonDays    cuantos dias hacia adelante se busca hueco antes de declarar que
 *                               no hay capacidad.
 * @param incidentPolicies       OLA de cada severidad. Una severidad ausente del mapa usa su OLA
 *                               por defecto ({@link IncidentPolicy#defaults}), de modo que una
 *                               configuracion parcial es valida y el motor nunca se queda sin
 *                               politica que aplicar.
 * @param workingCalendar        que dias se trabaja y con que jornada. Es lo que decide la capacidad
 *                               de cada fecha; {@code null} equivale al calendario estandar de lunes
 *                               a viernes con la jornada declarada.
 */
public record PlanningRules(
        BigDecimal incidentThresholdHours,
        BigDecimal workingHoursPerDay,
        int planningHorizonDays,
        Map<IncidentSeverity, IncidentPolicy> incidentPolicies,
        WorkingCalendar workingCalendar) {

    public static final BigDecimal DEFAULT_INCIDENT_THRESHOLD_HOURS = new BigDecimal("4");
    /** Jornada laboral oficial: lunes a viernes, 07:00-17:30. */
    public static final BigDecimal DEFAULT_WORKING_HOURS_PER_DAY = new BigDecimal("10.5");
    public static final int DEFAULT_PLANNING_HORIZON_DAYS = 10;

    public PlanningRules {
        Objects.requireNonNull(incidentThresholdHours, "incidentThresholdHours es obligatorio");
        Objects.requireNonNull(workingHoursPerDay, "workingHoursPerDay es obligatorio");
        if (incidentThresholdHours.signum() <= 0) {
            throw new IllegalArgumentException("incidentThresholdHours debe ser mayor que cero");
        }
        if (workingHoursPerDay.signum() <= 0) {
            throw new IllegalArgumentException("workingHoursPerDay debe ser mayor que cero");
        }
        if (planningHorizonDays < 1) {
            throw new IllegalArgumentException("planningHorizonDays debe ser al menos 1");
        }
        incidentPolicies = incidentPolicies == null
                ? defaultPolicies()
                : Map.copyOf(incidentPolicies);
        workingCalendar = workingCalendar == null
                ? WorkingCalendar.standardWithDuration(workingHoursPerDay)
                : workingCalendar;
        workingHoursPerDay = workingCalendar.businessHours().duration();
    }

    /** Reglas con la OLA por defecto, sin configuracion externa. */
    public static PlanningRules defaults() {
        return new PlanningRules(
                DEFAULT_INCIDENT_THRESHOLD_HOURS,
                DEFAULT_WORKING_HOURS_PER_DAY,
                DEFAULT_PLANNING_HORIZON_DAYS,
                defaultPolicies(),
                WorkingCalendar.standard());
    }

    /**
     * Constructor del modelo previo a la priorizacion por severidad.
     *
     * <p>Conserva compilando a quien construia las reglas con tres valores; el cuarto se resuelve
     * con la OLA por defecto y el calendario, con una jornada de las horas indicadas.
     */
    public PlanningRules(
            BigDecimal incidentThresholdHours, BigDecimal workingHoursPerDay, int planningHorizonDays) {
        this(incidentThresholdHours, workingHoursPerDay, planningHorizonDays, defaultPolicies(), null);
    }

    /** Constructor del modelo previo al calendario laboral. */
    public PlanningRules(
            BigDecimal incidentThresholdHours,
            BigDecimal workingHoursPerDay,
            int planningHorizonDays,
            Map<IncidentSeverity, IncidentPolicy> incidentPolicies) {
        this(incidentThresholdHours, workingHoursPerDay, planningHorizonDays, incidentPolicies, null);
    }

    /** OLA de una severidad, con su valor por defecto si la configuracion no la declaro. */
    public IncidentPolicy policyFor(IncidentSeverity severity) {
        Objects.requireNonNull(severity, "severity es obligatoria");
        IncidentPolicy configured = incidentPolicies.get(severity);
        return configured == null ? IncidentPolicy.defaults(severity) : configured;
    }

    /** Un incidente dispara recalculo cuando su dedicacion supera el umbral. */
    public boolean exceedsThreshold(Incident incident) {
        return incident.estimatedHours().compareTo(incidentThresholdHours) > 0;
    }

    private static Map<IncidentSeverity, IncidentPolicy> defaultPolicies() {
        Map<IncidentSeverity, IncidentPolicy> policies = new EnumMap<>(IncidentSeverity.class);
        for (IncidentSeverity severity : IncidentSeverity.values()) {
            policies.put(severity, IncidentPolicy.defaults(severity));
        }
        return policies;
    }
}
