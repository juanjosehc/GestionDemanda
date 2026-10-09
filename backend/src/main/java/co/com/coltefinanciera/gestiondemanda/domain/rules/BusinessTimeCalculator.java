package co.com.coltefinanciera.gestiondemanda.domain.rules;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.Function;

import co.com.coltefinanciera.gestiondemanda.domain.model.BusinessHours;
import co.com.coltefinanciera.gestiondemanda.domain.model.TimeSlot;

/**
 * Calculo de tiempo habil.
 *
 * <p>Responde a la pregunta que el dominio no sabia contestar: <em>cuanto tiempo de jornada real
 * consume un trabajo, y cuando</em>. Sumar horas de reloj no vale: cuatro horas pedidas un viernes a
 * las 16:30 no se resuelven a las 20:30, sino el lunes a las 12:30.
 *
 * <p>No guarda estado mas alla del calendario y la zona, de modo que es seguro compartirlo y trivial
 * de probar. Es la pieza que consumen el motor de SLA, la auditoria y la planificacion de capacidad;
 * y la que consumira la integracion con GLPI y el timeline del frontend. Ninguna de esas capas debe
 * volver a implementar el recorrido del calendario.
 *
 * <p><strong>Una sola linea temporal.</strong> El recorrido acepta una agenda de franjas ocupadas,
 * de modo que medir un vencimiento y ubicar trabajo son la misma operacion: la primera la invoca con
 * la agenda vacia y la segunda con la agenda del desarrollador. Una jornada medio ocupada se salta
 * igual que un festivo, y por eso capacidad y SLA comparten modelo temporal en lugar de mantener dos.
 *
 * <p><strong>Zona horaria.</strong> Un bloque de jornada esta en hora local, pero un
 * {@link Instant} no. El calculador resuelve la conversion con la zona que se le da, UTC por defecto,
 * que es la que usa hoy todo el backend. Cuando GLPI entregue marcas de tiempo de la oficina, el
 * punto de cambio es este constructor y no cada llamante.
 */
public final class BusinessTimeCalculator {

    /** Tope defensivo: corta el recorrido si el calendario no ofreciera ningun dia laborable. */
    private static final int MAX_CALENDAR_DAYS = 3650;

    /** Agenda vacia: la jornada entera esta libre, que es lo que necesita el SLA. */
    private static final Function<LocalDate, List<TimeSlot>> FREE = date -> List.of();

    private final WorkingCalendar calendar;
    private final ZoneId zone;

    public BusinessTimeCalculator(WorkingCalendar calendar) {
        this(calendar, ZoneOffset.UTC);
    }

    public BusinessTimeCalculator(WorkingCalendar calendar, ZoneId zone) {
        this.calendar = Objects.requireNonNull(calendar, "calendar es obligatorio");
        this.zone = Objects.requireNonNull(zone, "zone es obligatoria");
    }

    /**
     * Trozos de jornada que consume un trabajo, en orden y sin huecos de calendario entre ellos.
     *
     * <p>Es la operacion base: el primer trozo empieza en {@code from} si cae dentro del horario, o en
     * la siguiente apertura si cae fuera; los festivos y los fines de semana intermedios no aparecen
     * porque no consumen tiempo habil.
     *
     * @param from          instante en que el trabajo esta listo para empezar.
     * @param businessHours horas de jornada que necesita.
     * @return al menos un trozo, tantos como dias laborables haga falta tocar.
     */
    public List<BusinessSegment> segments(Instant from, BigDecimal businessHours) {
        return segments(from, businessHours, FREE, null);
    }

    /**
     * El mismo recorrido, saltando lo ya ocupado y sin salirse de una fecha.
     *
     * <p>Es lo que permite que la capacidad use este calculador en lugar de llevar su propia cuenta
     * de dias: una franja ocupada se trata como una jornada que no ofrece esas horas, que es
     * exactamente lo que hace un sabado con la jornada entera.
     *
     * <p>Es de paquete porque acotar es una pregunta de la planificacion, no del calculo de tiempo
     * habil: quien pregunta "cabe antes del dia tal?" decide que hacer con el no, y esa decision no
     * pertenece aqui.
     *
     * @param from          instante en que el trabajo esta listo para empezar.
     * @param businessHours horas de jornada que necesita.
     * @param busy          franjas ocupadas de cada fecha, ordenadas y sin solapes. Debe respetar el
     *                      contrato: franjas desordenadas o solapadas dan un recorrido incorrecto.
     * @param until         ultimo dia que se puede tocar, o {@code null} para no acotar. Al agotarlo
     *                      devuelve lo que haya cabido en vez de fallar.
     * @return los tramos conseguidos, que son menos de los pedidos solo si {@code until} los corta.
     */
    List<BusinessSegment> segments(
            Instant from,
            BigDecimal businessHours,
            Function<LocalDate, List<TimeSlot>> busy,
            LocalDate until) {

        Objects.requireNonNull(from, "from es obligatorio");
        Objects.requireNonNull(businessHours, "businessHours es obligatorio");
        Objects.requireNonNull(busy, "busy es obligatorio");
        if (businessHours.signum() <= 0) {
            throw new IllegalArgumentException("businessHours debe ser mayor que cero");
        }

        List<BusinessSegment> segments = new ArrayList<>();
        long pending = BusinessHours.toMinutes(businessHours);
        LocalDate date = LocalDate.ofInstant(from, zone);
        LocalDateTime cursor = LocalDateTime.ofInstant(from, zone);
        int guard = 0;

        while (pending > 0) {
            if (until != null && date.isAfter(until)) {
                break;
            }
            if (++guard > MAX_CALENDAR_DAYS) {
                throw new IllegalStateException("El calendario no ofrece tiempo habil desde " + from
                        + " para consumir " + businessHours + " horas");
            }

            BusinessHours window = calendar.businessHoursOn(date);
            if (window != null) {
                for (TimeSlot free : freeSlots(window, busy.apply(date))) {
                    LocalDateTime opening = date.atTime(free.start());
                    // Antes de abrir se espera a la apertura; dentro de la franja se empieza donde toca.
                    LocalDateTime start = cursor.isBefore(opening) ? opening : cursor;
                    LocalDateTime end = date.atTime(free.end());
                    if (!start.isBefore(end)) {
                        continue;
                    }

                    long taken = Math.min(Duration.between(start, end).toMinutes(), pending);
                    segments.add(new BusinessSegment(
                            date, start, start.plusMinutes(taken), BusinessHours.toHours(taken)));
                    pending -= taken;
                    if (pending == 0) {
                        break;
                    }
                    cursor = start.plusMinutes(taken);
                }
            }

            if (pending > 0) {
                date = date.plusDays(1);
                cursor = date.atStartOfDay();
            }
        }

        return List.copyOf(segments);
    }

    /**
     * Instante en que vence un objetivo de las horas habiles indicadas.
     *
     * <p>Es el calculo de SLA/OLA: el objetivo no se cumple en horas de reloj sino en horas de
     * jornada, asi que un festivo en medio lo corre un dia sin consumirlo.
     */
    public Instant dueAt(Instant from, BigDecimal businessHours) {
        return segments(from, businessHours).getLast().end().atZone(zone).toInstant();
    }

    /**
     * Tramos libres de una jornada: el bloque de calendario menos las franjas ocupadas.
     *
     * @param busy franjas ocupadas del dia, ordenadas y sin solapes. Las que caen fuera del bloque se
     *             ignoran, y las que lo desbordan se recortan contra el.
     */
    static List<TimeSlot> freeSlots(BusinessHours window, List<TimeSlot> busy) {
        List<TimeSlot> free = new ArrayList<>();
        LocalTime from = window.start();

        for (TimeSlot slot : busy) {
            LocalTime start = slot.start().isBefore(from) ? from : slot.start();
            LocalTime end = slot.end().isAfter(window.end()) ? window.end() : slot.end();
            if (!end.isAfter(start)) {
                continue;
            }
            if (from.isBefore(start)) {
                free.add(new TimeSlot(from, start));
            }
            from = end;
        }

        if (from.isBefore(window.end())) {
            free.add(new TimeSlot(from, window.end()));
        }
        return List.copyOf(free);
    }

    /**
     * Tramo continuo de jornada consumido por un trabajo, dentro de un dia laborable.
     *
     * <p>Va anidado porque no significa nada suelto: un tramo es un trozo de un trabajo concreto
     * medido contra un calendario concreto.
     */
    public record BusinessSegment(LocalDate date, LocalDateTime start, LocalDateTime end, BigDecimal hours) {

        public BusinessSegment {
            Objects.requireNonNull(date, "date es obligatorio");
            Objects.requireNonNull(start, "start es obligatorio");
            Objects.requireNonNull(end, "end es obligatorio");
            Objects.requireNonNull(hours, "hours es obligatorio");
        }
    }
}
