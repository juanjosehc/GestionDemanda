package co.com.coltefinanciera.gestiondemanda.persistence;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.domain.enums.AppliedRule;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.model.RescheduleEvent;

/**
 * Tabla de auditoria: por que un requerimiento cambio de fecha.
 *
 * <p>Es la razon de ser de esta fase. Un evento es un hecho ocurrido, no un estado: se escribe una
 * vez y no se modifica, y por eso la tabla es de solo insercion. {@code severity} se copia en lugar
 * de referenciar al incidente, igual que en el dominio: la auditoria tiene que poder explicarse sola
 * aunque despues se reclasifique el incidente en GLPI.
 *
 * <p>{@code incident_id} admite nulo porque un desplazamiento puede deberse a la ocupacion previa de
 * la jornada y no a un incidente concreto (regla {@code CAPACIDAD_DIARIA_EXCEDIDA}). El registro de
 * idempotencia resuelve ese caso con una marca, pero aqui el nulo significa lo que dice.
 */
@Entity
@Table(name = "reschedule_event", indexes = @Index(name = "ix_reschedule_event_plan", columnList = "plan_id"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RescheduleEventEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "plan_id", nullable = false, updatable = false)
    private UUID planId;

    @Column(name = "occurred_at", nullable = false)
    private Instant timestamp;

    @Column(name = "incident_id", length = 64)
    private String incidentId;

    @Column(name = "requirement_id", nullable = false, length = 64)
    private String requirementId;

    @Column(name = "original_date", nullable = false)
    private LocalDate originalDate;

    @Column(name = "rescheduled_date", nullable = false)
    private LocalDate rescheduledDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "applied_rule", nullable = false, length = 32)
    private AppliedRule appliedRule;

    @Enumerated(EnumType.STRING)
    @Column(name = "severity", length = 32)
    private IncidentSeverity severity;

    private RescheduleEventEntity(UUID planId, RescheduleEvent event) {
        this.planId = planId;
        this.timestamp = event.timestamp();
        this.incidentId = event.incidentId();
        this.requirementId = event.requirementId();
        this.originalDate = event.originalDate();
        this.rescheduledDate = event.rescheduledDate();
        this.appliedRule = event.appliedRule();
        this.severity = event.severity();
    }

    static RescheduleEventEntity of(UUID planId, RescheduleEvent event) {
        return new RescheduleEventEntity(planId, event);
    }

    RescheduleEvent toDomain() {
        return new RescheduleEvent(
                timestamp, incidentId, requirementId, originalDate, rescheduledDate, appliedRule, severity);
    }
}
