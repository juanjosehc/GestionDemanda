package co.com.coltefinanciera.gestiondemanda.domain.rules;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;
import co.com.coltefinanciera.gestiondemanda.domain.model.BusinessHours;
import co.com.coltefinanciera.gestiondemanda.domain.model.TimeSlot;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkBlock;
import co.com.coltefinanciera.gestiondemanda.domain.rules.BusinessTimeCalculator.BusinessSegment;

/**
 * Agenda de capacidad de un desarrollador: que queda libre en cada jornada y donde aterriza el
 * trabajo que se le asigna.
 *
 * <p>Sustituye al libro de horas por dia. Antes una jornada era un numero {@code BigDecimal} y
 * consumir era restar, de modo que en cuanto algo tocaba el dia habia que cerrarlo entero: un
 * incidente reportado un viernes a las 16:30 bloqueaba las ocho horas del viernes cuando solo podia
 * consumir media. Ahora la agenda son franjas: la jornada parcialmente ocupada sigue ofreciendo lo
 * que le queda, y el reparto lo hace {@link BusinessTimeCalculator}, el mismo recorrido que calcula
 * los vencimientos de la OLA.
 *
 * <p>No es un contenedor de estado de la aplicacion: se instancia por plan y por desarrollador, y
 * vive lo que dura la planificacion. Persistir la ocupacion entre ejecuciones es trabajo de una fase
 * posterior y no cambia esta interfaz: {@link #busyOn(LocalDate)} ya es la forma en que se leerian
 * las franjas guardadas.
 */
public final class CapacityBook {

    private final WorkingCalendar calendar;
    private final ZoneId zone;
    private final Map<LocalDate, List<TimeSlot>> busy = new HashMap<>();
    private final BusinessTimeCalculator walker;

    public CapacityBook(WorkingCalendar calendar, ZoneId zone) {
        this.calendar = Objects.requireNonNull(calendar, "calendar es obligatorio");
        this.zone = Objects.requireNonNull(zone, "zone es obligatoria");
        this.walker = new BusinessTimeCalculator(calendar, zone);
    }

    /**
     * Ubica las horas de un elemento en la primera jornada libre a partir de {@code notBefore}.
     *
     * <p>Reparte en tantos bloques como haga falta y consume exactamente las horas pedidas: un
     * incidente de cuatro horas reportado un viernes a las 16:30 ocupa media hora del viernes y tres
     * horas y media del lunes, y no le quita al viernes lo que ya habia pasado.
     *
     * @param notBefore instante a partir del cual el trabajo puede empezar. Si cae fuera del horario,
     *                  el primer bloque arranca en la siguiente apertura.
     * @param until     ultimo dia que el trabajo puede tocar, o {@code null} para no acotar. Si no
     *                  cabe antes, no se consume nada y la lista vuelve vacia: media asignacion es
     *                  peor que ninguna, porque desplaza a los demas sin haber resuelto el trabajo.
     * @return los bloques ocupados en orden, o vacio si no cupo antes de {@code until}.
     */
    public List<WorkBlock> claim(
            String workItemId,
            WorkItemType workItemType,
            String developerId,
            Instant notBefore,
            BigDecimal hours,
            LocalDate until) {

        List<BusinessSegment> segments = walker.segments(notBefore, hours, this::busyOn, until);
        long placed = segments.stream()
                .mapToLong(segment -> Duration.between(segment.start(), segment.end()).toMinutes())
                .sum();
        if (placed < BusinessHours.toMinutes(hours)) {
            return List.of();
        }

        segments.forEach(segment ->
                occupy(segment.date(), segment.start().toLocalTime(), segment.end().toLocalTime()));

        return segments.stream()
                .map(segment -> new WorkBlock(
                        workItemId, workItemType, developerId, segment.start(), segment.end(), segment.hours()))
                .toList();
    }

    /**
     * Tramos libres de una jornada, en orden.
     *
     * <p>Es la lectura de la capacidad en su forma util: una jornada ocupada de 09:00 a 11:00 y de
     * 14:00 a 17:00 devuelve un unico tramo libre de 11:00 a 14:00, en lugar de un numero que habria
     * que interpretar. Vacio en un dia no laborable.
     */
    public List<TimeSlot> freeSlots(LocalDate date) {
        Objects.requireNonNull(date, "date es obligatorio");
        BusinessHours window = calendar.businessHoursOn(date);
        return window == null ? List.of() : BusinessTimeCalculator.freeSlots(window, busyOn(date));
    }

    /**
     * Cierra una jornada a partir de {@code from}: nada mas cabe ese dia.
     *
     * <p>Es lo que hace efectiva la prioridad maxima de un incidente con politica
     * {@link co.com.coltefinanciera.gestiondemanda.domain.enums.DisplacementPolicy#INMEDIATA} sobre
     * el trabajo pactado. Solo alcanza a la jornada en que el incidente arranca y solo a lo que
     * queda por delante: la manana que ya paso no se puede reclamar, y los dias siguientes no son
     * suyos.
     */
    public void reserveRestOfDay(LocalDate date, LocalTime from) {
        BusinessHours window = calendar.businessHoursOn(date);
        if (window == null || !from.isBefore(window.end())) {
            return;
        }
        occupy(date, from.isBefore(window.start()) ? window.start() : from, window.end());
    }

    /** Franjas ocupadas de una fecha, ordenadas y sin solapes. */
    private List<TimeSlot> busyOn(LocalDate date) {
        return busy.getOrDefault(date, List.of());
    }

    private void occupy(LocalDate date, LocalTime start, LocalTime end) {
        List<TimeSlot> slots = new ArrayList<>(busyOn(date));
        slots.add(new TimeSlot(start, end));
        // ponytail: reordena el dia entero en cada consumo; con las franjas que caben en una jornada
        // no compensa nada mas listo, y si algun dia compensa, el sitio es este metodo.
        slots.sort(Comparator.comparing(TimeSlot::start));
        busy.put(date, merge(slots));
    }

    /**
     * Funde franjas contiguas o solapadas.
     *
     * <p>La agenda guarda ocupacion, no el historial de quien la pidio: dos bloques pegados son un
     * unico hueco, y asi el calculador solo tiene que saltar franjas y no decidir entre vecinas.
     */
    private static List<TimeSlot> merge(List<TimeSlot> sorted) {
        List<TimeSlot> merged = new ArrayList<>();
        for (TimeSlot slot : sorted) {
            TimeSlot last = merged.isEmpty() ? null : merged.getLast();
            if (last == null || slot.start().isAfter(last.end())) {
                merged.add(slot);
                continue;
            }
            LocalTime end = last.end().isAfter(slot.end()) ? last.end() : slot.end();
            merged.set(merged.size() - 1, new TimeSlot(last.start(), end));
        }
        return List.copyOf(merged);
    }
}
