package co.com.coltefinanciera.gestiondemanda.domain.rules;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Objects;
import java.util.Set;

import co.com.coltefinanciera.gestiondemanda.domain.model.BusinessHours;

/**
 * Calendario laboral: que dias se trabaja y con que jornada.
 *
 * <p>Es la respuesta a <em>cuando hay alguien trabajando</em>. Hasta ahora el dominio daba por hecho
 * que todos los dias eran laborables y valian la jornada completa, de modo que el motor planificaba
 * sobre sabados y no sabia de festivos. El calendario es el unico sitio donde eso se decide.
 *
 * <p>Es configuracion de negocio, no infraestructura: el calendario de la oficina no cambia de una
 * peticion a otra, y por eso vive en el dominio igual que {@link PlanningRules}, sin conocer Spring.
 *
 * <p><strong>Alcance.</strong> Un calendario vale para todos los desarrolladores. Diferencias por
 * persona (vacaciones, incapacidades, media jornada) y por equipo son capacidad parcial, que no se
 * modela aqui: quien consume el calendario es {@link CapacityBook}, y es ahi donde un calendario
 * por desarrollador encontraria su sitio.
 *
 * @param businessHours jornada de un dia laborable. Un dia no laborable no tiene ninguna.
 * @param weekend       dias de la semana que nunca son laborables.
 * @param holidays      fechas concretas no laborables, ademas de los fines de semana.
 */
public record WorkingCalendar(
        BusinessHours businessHours,
        Set<DayOfWeek> weekend,
        Set<LocalDate> holidays) {

    /** Apertura por defecto. Con la jornada estandar, el cierre es a las 17:30. */
    public static final LocalTime DEFAULT_START = LocalTime.of(7, 0);

    public static final Set<DayOfWeek> DEFAULT_WEEKEND = Set.of(DayOfWeek.SATURDAY, DayOfWeek.SUNDAY);

    public WorkingCalendar {
        Objects.requireNonNull(businessHours, "businessHours es obligatorio");
        weekend = weekend == null ? DEFAULT_WEEKEND : Set.copyOf(weekend);
        holidays = holidays == null ? Set.of() : Set.copyOf(holidays);
        if (weekend.size() >= DayOfWeek.values().length) {
            throw new IllegalArgumentException("El calendario no puede tener todos los dias como no laborables");
        }
    }

    /** Calendario por defecto: de lunes a viernes, jornada estandar y sin festivos. */
    public static WorkingCalendar standard() {
        return standardWithDuration(PlanningRules.DEFAULT_WORKING_HOURS_PER_DAY);
    }

    /**
     * Calendario de lunes a viernes con una jornada de las horas indicadas y sin festivos.
     *
     * <p>Es como se traduce la jornada declarada en {@code planning.working-hours-per-day} cuando no
     * hay un bloque de calendario explicito.
     */
    public static WorkingCalendar standardWithDuration(BigDecimal hours) {
        return new WorkingCalendar(BusinessHours.startingAt(DEFAULT_START, hours), DEFAULT_WEEKEND, Set.of());
    }

    /** Indica si una fecha es laborable. */
    public boolean isWorkingDay(LocalDate date) {
        Objects.requireNonNull(date, "date es obligatorio");
        return !weekend.contains(date.getDayOfWeek()) && !holidays.contains(date);
    }

    /**
     * Jornada de una fecha, o {@code null} si no es laborable.
     *
     * <p>El nulo es la representacion del dia no laborable en todo el dominio: asi lo consume ya
     * {@link BusinessTimeCalculator}, que recorre el calendario saltando las fechas que no ofrecen
     * bloque en lugar de preguntar si son laborables.
     */
    public BusinessHours businessHoursOn(LocalDate date) {
        return isWorkingDay(date) ? businessHours : null;
    }
}
