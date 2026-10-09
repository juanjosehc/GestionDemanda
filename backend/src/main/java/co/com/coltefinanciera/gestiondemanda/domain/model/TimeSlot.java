package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.time.LocalTime;
import java.util.Objects;

/**
 * Franja horaria dentro de una jornada, con apertura inclusive y cierre exclusive.
 *
 * <p>Es la unidad con la que se dice <em>cuando</em> algo ocupa la agenda. Una jornada de ocho horas
 * ocupada de 09:00 a 11:00 y de 14:00 a 17:00 son dos franjas, y lo que queda entre ellas sigue
 * ofreciendose al siguiente trabajo.
 *
 * @param start hora de inicio, inclusive.
 * @param end   hora de fin, exclusive.
 */
public record TimeSlot(LocalTime start, LocalTime end) {

    public TimeSlot {
        Objects.requireNonNull(start, "start es obligatorio");
        Objects.requireNonNull(end, "end es obligatorio");
        if (!start.isBefore(end)) {
            throw new IllegalArgumentException("start debe ser anterior a end");
        }
    }
}
