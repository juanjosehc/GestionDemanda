package co.com.coltefinanciera.gestiondemanda.persistence;

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

import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningConflict;

/**
 * Tabla de conflictos: trabajo que no cupo en el horizonte.
 *
 * <p>Se persiste aunque no sea auditoria, porque forma parte del resultado: un plan releido que
 * ocultara lo que no se pudo ubicar contaria una historia mas optimista que la real.
 */
@Entity
@Table(name = "planning_conflict", indexes = @Index(name = "ix_planning_conflict_plan", columnList = "plan_id"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PlanningConflictEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "plan_id", nullable = false, updatable = false)
    private UUID planId;

    @Column(name = "work_item_id", nullable = false, length = 64)
    private String workItemId;

    @Enumerated(EnumType.STRING)
    @Column(name = "work_item_type", nullable = false, length = 32)
    private WorkItemType workItemType;

    @Column(name = "reason", nullable = false, length = 512)
    private String reason;

    private PlanningConflictEntity(UUID planId, PlanningConflict conflict) {
        this.planId = planId;
        this.workItemId = conflict.workItemId();
        this.workItemType = conflict.workItemType();
        this.reason = conflict.reason();
    }

    static PlanningConflictEntity of(UUID planId, PlanningConflict conflict) {
        return new PlanningConflictEntity(planId, conflict);
    }

    PlanningConflict toDomain() {
        return new PlanningConflict(workItemId, workItemType, reason);
    }
}
