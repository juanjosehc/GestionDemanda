package co.com.coltefinanciera.gestiondemanda.persistence;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.model.BusinessHours;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningContextSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.rules.IncidentPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;
import co.com.coltefinanciera.gestiondemanda.domain.rules.WorkingCalendar;

/**
 * Tabla del contexto de una ejecucion: con que se planifico.
 *
 * <p>Una fila por plan, y la clave es la del plan: no hay contexto sin plan al que pertenecer, y por
 * eso no se genera una sustituta. La fila se escribe en la misma transaccion que el plan, por el
 * mismo motivo que los bloques: un plan guardado sin su contexto es un plan que miente sobre lo que
 * se puede explicar.
 *
 * <p><strong>Que se guarda y que no.</strong> Se guardan los valores que el motor leyo: umbral,
 * horizonte, calendario y OLA por severidad. No se guarda
 * {@code PlanningRules.workingHoursPerDay}, porque es la duracion del bloque del calendario y se
 * deriva de {@code calendar_start} y {@code calendar_end} al releer: guardarlo seria escribir el
 * mismo numero dos veces, que es la forma mas barata de que un dia discrepen.
 *
 * <p>La OLA por severidad no cabe en una columna —son tres filas por plan— y vive en
 * {@link PlanningContextPolicyEntity}. El fin de semana, los festivos y las severidades si caben, y
 * se guardan como listas de valores separados por coma en lugar de en tablas propias: son conjuntos
 * cortos de identificadores, no entidades. La cadena vacia es el conjunto vacio, y es el unico valor
 * que representa la ausencia.
 *
 * <p><strong>Zona horaria.</strong> {@code calculated_at} es un instante y {@code calendar_start} y
 * {@code calendar_end} son horas de calendario local, igual que los bloques (decision 46). La zona
 * que los une se guarda aparte, en {@code zone_id}: sin ella, un tramo guardado no se puede volver a
 * situar en el tiempo.
 */
@Entity
@Table(name = "planning_context")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PlanningContextEntity {

    @Id
    @Column(name = "plan_id", nullable = false, updatable = false)
    private UUID planId;

    @Column(name = "engine_version", nullable = false, length = 32)
    private String engineVersion;

    @Column(name = "calculated_at", nullable = false)
    private Instant calculatedAt;

    @Column(name = "zone_id", nullable = false, length = 64)
    private String zoneId;

    @Column(name = "incident_threshold_hours", nullable = false, precision = 10, scale = 4)
    private BigDecimal incidentThresholdHours;

    @Column(name = "planning_horizon_days", nullable = false)
    private int planningHorizonDays;

    @Column(name = "calendar_start", nullable = false)
    private LocalTime calendarStart;

    @Column(name = "calendar_end", nullable = false)
    private LocalTime calendarEnd;

    /** Dias no laborables de la semana, por nombre. Vacio cuando no hay ninguno. */
    @Column(name = "weekend", nullable = false, length = 128)
    private String weekend;

    /** Festivos en formato ISO, separados por coma. Vacio cuando no hay ninguno. */
    @Column(name = "holidays", nullable = false, length = 2000)
    private String holidays;

    /** Severidades que participaron, por nombre. Vacio cuando ningun incidente declaro severidad. */
    @Column(name = "severities", nullable = false, length = 128)
    private String severities;

    private PlanningContextEntity(UUID planId, PlanningContextSnapshot context) {
        PlanningRules rules = context.rules();
        WorkingCalendar calendar = rules.workingCalendar();

        this.planId = planId;
        this.engineVersion = context.engineVersion();
        this.calculatedAt = context.calculatedAt();
        this.zoneId = context.zoneId();
        this.incidentThresholdHours = rules.incidentThresholdHours();
        this.planningHorizonDays = rules.planningHorizonDays();
        this.calendarStart = calendar.businessHours().start();
        this.calendarEnd = calendar.businessHours().end();
        this.weekend = calendar.weekend().stream()
                .sorted()
                .map(DayOfWeek::name)
                .collect(Collectors.joining(","));
        this.holidays = calendar.holidays().stream()
                .sorted()
                .map(LocalDate::toString)
                .collect(Collectors.joining(","));
        this.severities = context.severities().stream()
                .sorted()
                .map(IncidentSeverity::name)
                .collect(Collectors.joining(","));
    }

    static PlanningContextEntity of(UUID planId, PlanningContextSnapshot context) {
        return new PlanningContextEntity(planId, context);
    }

    /**
     * Reconstruye el contexto, con la OLA que aporta la tabla hija.
     *
     * <p>La jornada de {@link PlanningRules} se recalcula desde el bloque del calendario en lugar de
     * leerse de una columna, y es lo que hace que el objeto que vuelve sea el mismo que se guardo
     * aunque en la base de datos no exista ese numero.
     */
    PlanningContextSnapshot toDomain(List<IncidentPolicy> policies) {
        Map<IncidentSeverity, IncidentPolicy> bySeverity = new EnumMap<>(IncidentSeverity.class);
        policies.forEach(policy -> bySeverity.put(policy.severity(), policy));

        WorkingCalendar calendar = new WorkingCalendar(
                new BusinessHours(calendarStart, calendarEnd),
                parseNames(weekend, DayOfWeek::valueOf),
                parseNames(holidays, LocalDate::parse));

        return new PlanningContextSnapshot(
                engineVersion,
                calculatedAt,
                zoneId,
                parseNames(severities, IncidentSeverity::valueOf),
                new PlanningRules(
                        incidentThresholdHours,
                        calendar.businessHours().duration(),
                        planningHorizonDays,
                        bySeverity,
                        calendar));
    }

    /**
     * Lista separada por comas a conjunto de valores.
     *
     * <p>{@code ponytail:} formato propio en lugar de una tabla hija. Son conjuntos cortos y
     * cerrados —a lo sumo siete dias, los festivos de un ano y tres severidades— y una tabla por
     * cada uno costaria tres entidades y tres consultas mas para no cambiar nada de lo que se puede
     * preguntar. Si algun dia hay que filtrar por festivo en SQL, ese es el momento de separarlos.
     */
    private static <T> Set<T> parseNames(String text, Function<String, T> parser) {
        if (text.isEmpty()) {
            return Set.of();
        }
        return Arrays.stream(text.split(",")).map(parser).collect(Collectors.toSet());
    }
}
