package co.com.coltefinanciera.gestiondemanda.config;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.EnumMap;
import java.util.Map;
import java.util.Set;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import co.com.coltefinanciera.gestiondemanda.domain.enums.DisplacementPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.model.BusinessHours;
import co.com.coltefinanciera.gestiondemanda.domain.rules.IncidentPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;
import co.com.coltefinanciera.gestiondemanda.domain.rules.WorkingCalendar;

/**
 * Configuracion externa de las reglas de planificacion.
 *
 * <p>Es un transporte tonto: mantiene el dominio libre de Spring. {@link #toRules()} entrega el
 * objeto de dominio, que es el unico que el motor conoce.
 *
 * <p>Todos los valores tienen valor por defecto, de modo que la aplicacion arranca sin
 * configuracion adicional. La OLA por severidad es el caso interesante: es el unico punto donde
 * ajustar el acuerdo con el negocio no exige tocar codigo ni recompilar.
 *
 * <p><strong>Compatibilidad:</strong> {@code incident-threshold-hours} solo gobierna a los
 * incidentes sin severidad. Cuando GLPI empiece a enviar prioridad, esta propiedad queda sin efecto
 * y puede retirarse junto con los datos legados.
 *
 * <p><strong>Compatibilidad:</strong> {@code working-hours-per-day} describe la jornada cuando no se
 * declara un bloque de calendario. Declarar {@code planning.calendar.end-time} tiene prioridad sobre
 * ella, porque un bloque con cierre explicito ya dice cuanto dura el dia.
 */
@ConfigurationProperties(prefix = "planning")
public record PlanningProperties(
        @DefaultValue("4") BigDecimal incidentThresholdHours,
        @DefaultValue("8") BigDecimal workingHoursPerDay,
        @DefaultValue("10") int planningHorizonDays,
        @DefaultValue Map<IncidentSeverity, IncidentPolicyProperties> incidentPolicies,
        CalendarProperties calendar) {

    /**
     * OLA declarada para una severidad.
     *
     * <p>Todos los campos son opcionales por separado: el que falte se resuelve con el valor por
     * defecto de esa severidad, no con el de otra. Declarar solo el objetivo de resolucion de
     * {@code ALTO} no arrastra el comportamiento de planificacion de {@code MEDIO}.
     */
    public record IncidentPolicyProperties(
            Integer targetOwnershipMinutes,
            BigDecimal targetResolutionHours,
            DisplacementPolicy displacementPolicy) {

        IncidentPolicy toPolicy(IncidentSeverity severity) {
            IncidentPolicy defaults = IncidentPolicy.defaults(severity);
            return new IncidentPolicy(
                    severity,
                    targetOwnershipMinutes == null
                            ? defaults.targetOwnershipMinutes()
                            : targetOwnershipMinutes,
                    targetResolutionHours == null
                            ? defaults.targetResolutionHours()
                            : targetResolutionHours,
                    displacementPolicy == null
                            ? defaults.displacementPolicy()
                            : displacementPolicy);
        }
    }

    /**
     * Calendario laboral declarado. Todos los campos son opcionales y se resuelven por separado.
     *
     * <p>Se declara como una ausencia y no como una lista vacia: sin bloque {@code planning.calendar},
     * {@code calendar} llega {@code null} y la jornada sale de {@code working-hours-per-day}, que es
     * como se configuraba antes de que existiera el calendario.
     *
     * @param startTime apertura de la jornada. Por defecto, {@link WorkingCalendar#DEFAULT_START}.
     * @param endTime   cierre de la jornada. Si falta, cierra a la apertura mas la jornada declarada.
     * @param weekend   dias no laborables de la semana. Por defecto, sabado y domingo.
     * @param holidays  festivos. Ademas de los fines de semana, no hay ningun dia no laborable.
     */
    public record CalendarProperties(
            LocalTime startTime,
            LocalTime endTime,
            Set<DayOfWeek> weekend,
            Set<LocalDate> holidays) {

        WorkingCalendar toCalendar(BigDecimal workingHoursPerDay) {
            LocalTime start = startTime == null ? WorkingCalendar.DEFAULT_START : startTime;
            BusinessHours hours = endTime == null
                    ? BusinessHours.startingAt(start, workingHoursPerDay)
                    : new BusinessHours(start, endTime);
            return new WorkingCalendar(
                    hours,
                    weekend == null ? WorkingCalendar.DEFAULT_WEEKEND : weekend,
                    holidays == null ? Set.of() : holidays);
        }
    }

    public PlanningRules toRules() {
        Map<IncidentSeverity, IncidentPolicy> policies = new EnumMap<>(IncidentSeverity.class);
        for (IncidentSeverity severity : IncidentSeverity.values()) {
            IncidentPolicyProperties declared = incidentPolicies == null ? null : incidentPolicies.get(severity);
            policies.put(severity, declared == null ? IncidentPolicy.defaults(severity) : declared.toPolicy(severity));
        }
        WorkingCalendar workingCalendar = calendar == null
                ? WorkingCalendar.standardWithDuration(workingHoursPerDay)
                : calendar.toCalendar(workingHoursPerDay);
        return new PlanningRules(
                incidentThresholdHours, workingHoursPerDay, planningHorizonDays, policies, workingCalendar);
    }
}
