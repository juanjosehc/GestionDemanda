package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;

/**
 * Tramo concreto de agenda: las horas de un elemento que caen en una fecha, con hora de inicio y de
 * fin.
 *
 * <p>Es lo que {@link WorkAllocation} no puede decir. Una asignacion cuenta <em>que</em> se pacto y
 * desde que dia arranca; un bloque cuenta <em>cuando</em> se trabaja, y es lo que necesita una
 * agenda. Un requerimiento de veinte horas son las dos cosas a la vez: una asignacion de veinte
 * horas que empieza el lunes, y tres bloques que dicen que cae de 09:00 a 17:00, de 09:00 a 17:00 y
 * de 09:00 a 13:00.
 *
 * <p>Va sin identificador propio porque no es una entidad: es la forma que toma un elemento al
 * aterrizar en la agenda, y se reconoce por {@code workItemId} mas {@code start}.
 *
 * @param start inicio del tramo, hora local del calendario.
 * @param end   fin del tramo, exclusive.
 * @param hours jornada que consume el tramo, que es la duracion del tramo y no el total del
 *              elemento.
 */
public record WorkBlock(
        String workItemId,
        WorkItemType workItemType,
        String developerId,
        LocalDateTime start,
        LocalDateTime end,
        BigDecimal hours) {

    public WorkBlock {
        DomainPreconditions.requireText(workItemId, "workItemId");
        Objects.requireNonNull(workItemType, "workItemType es obligatorio");
        DomainPreconditions.requireText(developerId, "developerId");
        Objects.requireNonNull(start, "start es obligatorio");
        Objects.requireNonNull(end, "end es obligatorio");
        DomainPreconditions.requirePositive(hours, "hours");
        if (!start.isBefore(end)) {
            throw new IllegalArgumentException("start debe ser anterior a end");
        }
    }

    /** Fecha en que cae el tramo. */
    public LocalDate date() {
        return start.toLocalDate();
    }
}
