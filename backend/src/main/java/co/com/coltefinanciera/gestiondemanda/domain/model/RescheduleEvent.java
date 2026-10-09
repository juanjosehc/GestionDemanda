package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.AppliedRule;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;

/**
 * Evento de auditoria de un desplazamiento.
 *
 * <p>Es la trazabilidad del sistema: explica, para cada requerimiento que cambio de fecha, quien
 * lo empujo, desde cuando, hasta cuando y bajo que regla. Se emite una sola vez por pareja
 * (incidente, requerimiento); el registro de idempotencia es quien lo garantiza.
 *
 * @param incidentId incidente que consumio la franja. Es {@code null} cuando el desplazamiento lo
 *                   provoco la ocupacion previa de la jornada y no un incidente concreto.
 * @param severity   severidad que tenia el incidente causante en el momento del evento. Es una
 *                   copia deliberada, no una referencia: la auditoria debe poder explicarse sola, y
 *                   la severidad de un incidente puede reclasificarse despues en GLPI. Un
 *                   {@code null} significa que el evento no tuvo incidente causante o que este
 *                   carecia de severidad.
 */
public record RescheduleEvent(
        Instant timestamp,
        String incidentId,
        String requirementId,
        LocalDate originalDate,
        LocalDate rescheduledDate,
        AppliedRule appliedRule,
        IncidentSeverity severity) {

    public RescheduleEvent {
        Objects.requireNonNull(timestamp, "timestamp es obligatorio");
        DomainPreconditions.requireText(requirementId, "requirementId");
        Objects.requireNonNull(originalDate, "originalDate es obligatorio");
        Objects.requireNonNull(rescheduledDate, "rescheduledDate es obligatorio");
        Objects.requireNonNull(appliedRule, "appliedRule es obligatorio");
    }
}
