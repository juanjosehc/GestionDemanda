package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.LocalTime;
import java.util.Objects;

/**
 * Bloque de jornada de un dia habil: a que hora abre y a que hora cierra.
 *
 * <p>Es la unidad con la que se mide el tiempo habil. Un dia no laborable no tiene bloque, y uno
 * laborable tiene exactamente uno: el modelo no contempla (todavia) jornadas partidas por almuerzo.
 *
 * <p>El bloque es la unica fuente de <em>cuanto dura un dia</em>. {@link #duration()} es, por tanto,
 * la capacidad de un dia habil, y {@code PlanningRules.workingHoursPerDay} se deriva de aqui en
 * lugar de declararse por separado.
 *
 * @param start hora de apertura, inclusive.
 * @param end   hora de cierre, exclusive. El bloque {@code 09:00-17:00} son ocho horas de jornada.
 */
public record BusinessHours(LocalTime start, LocalTime end) {

    /** Precision de las horas que se publican. Por debajo del minuto no significa nada aqui. */
    private static final int HOURS_SCALE = 4;

    public BusinessHours {
        Objects.requireNonNull(start, "start es obligatorio");
        Objects.requireNonNull(end, "end es obligatorio");
        if (!start.isBefore(end)) {
            throw new IllegalArgumentException("start debe ser anterior a end");
        }
    }

    /** Bloque que abre a una hora y dura las horas indicadas. */
    public static BusinessHours startingAt(LocalTime start, BigDecimal hours) {
        Objects.requireNonNull(start, "start es obligatorio");
        Objects.requireNonNull(hours, "hours es obligatorio");
        if (hours.signum() <= 0) {
            throw new IllegalArgumentException("hours debe ser mayor que cero");
        }
        return new BusinessHours(start, start.plusMinutes(toMinutes(hours)));
    }

    /** Jornada del bloque, en horas. Es la capacidad de un dia habil. */
    public BigDecimal duration() {
        return toHours(durationMinutes());
    }

    public long durationMinutes() {
        return Duration.between(start, end).toMinutes();
    }

    /**
     * Minutos de jornada que quedan desde {@code from} hasta el cierre.
     *
     * @return cero si el bloque ya cerro o si {@code from} es posterior al cierre.
     */
    public long remainingMinutes(LocalTime from) {
        Objects.requireNonNull(from, "from es obligatorio");
        if (!from.isBefore(end)) {
            return 0;
        }
        LocalTime effective = from.isBefore(start) ? start : from;
        return Duration.between(effective, end).toMinutes();
    }

    /**
     * Horas a minutos.
     *
     * <p>{@code ponytail:} redondeo al minuto. Quien declare una OLA de 0,001 h vera 0 minutos, y es
     * lo correcto: el calendario no tiene resolucion por debajo del minuto.
     */
    public static long toMinutes(BigDecimal hours) {
        Objects.requireNonNull(hours, "hours es obligatorio");
        return hours.multiply(BigDecimal.valueOf(60)).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    /** Minutos a horas, sin ceros de relleno: 480 minutos son {@code 8}, no {@code 8.0000}. */
    public static BigDecimal toHours(long minutes) {
        return BigDecimal.valueOf(minutes)
                .divide(BigDecimal.valueOf(60), HOURS_SCALE, RoundingMode.HALF_UP)
                .stripTrailingZeros();
    }
}
