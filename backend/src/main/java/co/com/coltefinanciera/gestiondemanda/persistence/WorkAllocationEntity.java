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

import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkAllocation;

/**
 * Tabla de asignaciones: que se comprometio con cada elemento y desde que dia arranca.
 *
 * <p>{@code hours} es {@code NUMERIC(10,4)}, la misma precision con la que el dominio publica
 * horas. Guardar un {@code BigDecimal} con escala libre obligaria a elegir una escala en la base de
 * datos de todos modos, y elegirla aqui la deja escrita.
 */
@Entity
@Table(name = "work_allocation", indexes = @Index(name = "ix_work_allocation_plan", columnList = "plan_id"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class WorkAllocationEntity {

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

    @Column(name = "developer_id", nullable = false, length = 64)
    private String developerId;

    @Column(name = "allocated_date", nullable = false)
    private LocalDate date;

    @Column(name = "hours", nullable = false, precision = 10, scale = 4)
    private BigDecimal hours;

    private WorkAllocationEntity(UUID planId, WorkAllocation allocation) {
        this.planId = planId;
        this.workItemId = allocation.workItemId();
        this.workItemType = allocation.workItemType();
        this.developerId = allocation.developerId();
        this.date = allocation.date();
        this.hours = allocation.hours();
    }

    static WorkAllocationEntity of(UUID planId, WorkAllocation allocation) {
        return new WorkAllocationEntity(planId, allocation);
    }

    WorkAllocation toDomain() {
        return new WorkAllocation(workItemId, workItemType, developerId, date, hours);
    }
}
