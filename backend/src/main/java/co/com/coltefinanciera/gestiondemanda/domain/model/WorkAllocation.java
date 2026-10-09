package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;

/**
 * Bloque de trabajo ubicado en la agenda de un desarrollador.
 *
 * <p>Es la unidad de salida del motor: el plan no es mas que la lista de asignaciones resultante.
 *
 * @param date  dia en que arranca el bloque. Un incidente que no cabe en una jornada se reporta
 *              igualmente de una pieza: la asignacion marca su inicio, no su reparto diario.
 * @param hours horas comprometidas del elemento, no las que caben ese dia.
 */
public record WorkAllocation(
        String workItemId,
        WorkItemType workItemType,
        String developerId,
        LocalDate date,
        BigDecimal hours) {

    public WorkAllocation {
        DomainPreconditions.requireText(workItemId, "workItemId");
        Objects.requireNonNull(workItemType, "workItemType es obligatorio");
        DomainPreconditions.requireText(developerId, "developerId");
        Objects.requireNonNull(date, "date es obligatorio");
        DomainPreconditions.requirePositive(hours, "hours");
    }
}
