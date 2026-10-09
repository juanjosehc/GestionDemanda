package co.com.coltefinanciera.gestiondemanda.persistence;

import java.math.BigDecimal;
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

import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;
import co.com.coltefinanciera.gestiondemanda.domain.model.Requirement;

/**
 * Tabla de los requerimientos que entraron al motor.
 *
 * <p>Columnas: las tres que el motor consulta —{@code estimated_hours}, {@code planned_date} y
 * {@code status}— mas el {@code work_item_id}. El titulo no esta, por el mismo motivo que en los
 * incidentes.
 *
 * <p>Se guardan tambien los requerimientos finalizados y los ya renegociados, que el motor descarta
 * por no estar vivos. Saber que estaban en la entrada es lo que permite explicar por que no se
 * planificaron.
 */
@Entity
@Table(
        name = "planning_input_requirement",
        indexes = @Index(name = "ix_planning_input_requirement_plan", columnList = "plan_id"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PlanningInputRequirementEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "plan_id", nullable = false, updatable = false)
    private UUID planId;

    @Column(name = "work_item_id", nullable = false, length = 64)
    private String workItemId;

    @Column(name = "estimated_hours", nullable = false, precision = 10, scale = 4)
    private BigDecimal estimatedHours;

    @Column(name = "planned_date", nullable = false)
    private LocalDate plannedDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private RequirementStatus status;

    private PlanningInputRequirementEntity(UUID planId, Requirement requirement) {
        this.planId = planId;
        this.workItemId = requirement.id();
        this.estimatedHours = requirement.estimatedHours();
        this.plannedDate = requirement.plannedDate();
        this.status = requirement.status();
    }

    static PlanningInputRequirementEntity of(UUID planId, Requirement requirement) {
        return new PlanningInputRequirementEntity(planId, requirement);
    }

    /** Reconstruye el requerimiento con el titulo en nulo, por el mismo motivo que los incidentes. */
    Requirement toDomain() {
        return new Requirement(workItemId, null, estimatedHours, plannedDate, status);
    }
}
