package co.com.coltefinanciera.gestiondemanda.persistence;

import java.math.BigDecimal;
import java.time.LocalDateTime;
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
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkBlock;

/**
 * Tabla de tramos de agenda: cuando se trabaja de verdad.
 *
 * <p>Es la tabla que hace util la persistencia mas alla de la auditoria: los bloques de un plan son
 * lo que un timeline pinta, y sobreviven al reinicio sin volver a planificar.
 *
 * <p>{@code start_at} y {@code end_at} son {@code TIMESTAMP} sin zona, no {@code TIMESTAMPTZ}:
 * un bloque es una hora de calendario local, no un instante. Guardarlo con zona obligaria a elegir
 * una y a convertir en cada lectura, que es exactamente el error que la Fase 5 deshizo.
 */
@Entity
@Table(name = "work_block", indexes = @Index(name = "ix_work_block_plan", columnList = "plan_id"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class WorkBlockEntity {

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

    @Column(name = "start_at", nullable = false)
    private LocalDateTime start;

    @Column(name = "end_at", nullable = false)
    private LocalDateTime end;

    @Column(name = "hours", nullable = false, precision = 10, scale = 4)
    private BigDecimal hours;

    private WorkBlockEntity(UUID planId, WorkBlock block) {
        this.planId = planId;
        this.workItemId = block.workItemId();
        this.workItemType = block.workItemType();
        this.developerId = block.developerId();
        this.start = block.start();
        this.end = block.end();
        this.hours = block.hours();
    }

    static WorkBlockEntity of(UUID planId, WorkBlock block) {
        return new WorkBlockEntity(planId, block);
    }

    WorkBlock toDomain() {
        return new WorkBlock(workItemId, workItemType, developerId, start, end, hours);
    }
}
