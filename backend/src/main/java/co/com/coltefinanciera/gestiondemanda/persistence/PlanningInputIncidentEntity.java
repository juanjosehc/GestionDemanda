package co.com.coltefinanciera.gestiondemanda.persistence;

import java.math.BigDecimal;
import java.time.Instant;
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

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentStatus;
import co.com.coltefinanciera.gestiondemanda.domain.model.Incident;

/**
 * Tabla de los incidentes que entraron al motor.
 *
 * <p>Columnas: las cuatro que el motor consulta —{@code estimated_hours}, {@code reported_at},
 * {@code status} y {@code severity}— mas el {@code work_item_id} que las identifica. El titulo no
 * esta, y su ausencia es la decision: {@code PlanningEngine} nunca lo lee, y guardar un texto que no
 * interviene en el calculo daria a la foto una apariencia de completitud que no aporta nada a la
 * reproduccion.
 *
 * <p>{@code severity} admite nulo porque los incidentes anteriores a la priorizacion por severidad no
 * la declaran, y el motor los planifica con el umbral de dedicacion. Es la misma migracion controlada
 * que documenta {@link Incident}: un nulo aqui significa lo que dice.
 *
 * <p>Se guardan tambien los incidentes ya resueltos, que el motor descarta. La foto es de lo que se
 * recibio, no de lo que se uso, y saber que un incidente resuelto estaba en la entrada es lo que
 * permite distinguir "no influyo" de "no llego".
 */
@Entity
@Table(
        name = "planning_input_incident",
        indexes = @Index(name = "ix_planning_input_incident_plan", columnList = "plan_id"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PlanningInputIncidentEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "plan_id", nullable = false, updatable = false)
    private UUID planId;

    @Column(name = "work_item_id", nullable = false, length = 64)
    private String workItemId;

    @Column(name = "estimated_hours", nullable = false, precision = 10, scale = 4)
    private BigDecimal estimatedHours;

    @Column(name = "reported_at", nullable = false)
    private Instant reportedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private IncidentStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "severity", length = 32)
    private IncidentSeverity severity;

    private PlanningInputIncidentEntity(UUID planId, Incident incident) {
        this.planId = planId;
        this.workItemId = incident.id();
        this.estimatedHours = incident.estimatedHours();
        this.reportedAt = incident.reportedAt();
        this.status = incident.status();
        this.severity = incident.severity();
    }

    static PlanningInputIncidentEntity of(UUID planId, Incident incident) {
        return new PlanningInputIncidentEntity(planId, incident);
    }

    /**
     * Reconstruye el incidente con el titulo en nulo.
     *
     * <p>El dominio lo admite —no lo valida— y el motor no lo lee, asi que el objeto que vuelve sirve
     * para volver a planificar. La respuesta HTTP tampoco lo expone, para que la asimetria se vea
     * desde fuera y no solo en el comentario.
     */
    Incident toDomain() {
        return new Incident(workItemId, null, estimatedHours, reportedAt, status, severity);
    }
}
