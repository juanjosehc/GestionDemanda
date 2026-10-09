package co.com.coltefinanciera.gestiondemanda.persistence;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import co.com.coltefinanciera.gestiondemanda.domain.enums.PlanningMetadataField;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadataChange;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * Una modificacion de la planificacion, tal como quedo registrada.
 *
 * <p><strong>De solo insercion.</strong> Un cambio es un hecho ocurrido, no un estado: se escribe
 * una vez y no se corrige. No hay setters, y el adaptador solo la lee y la inserta. Esa es toda la
 * proteccion que necesita una tabla a la que nadie le pide que cambie.
 *
 * <p><strong>Un {@code previous_value} nulo es el dato mas importante de la tabla:</strong> marca la
 * declaracion inicial, el momento en que el valor no existia y alguien lo puso. Sin esa fila, el
 * primer valor de una estimacion quedaria sin autor en cuanto alguien la cambiara.
 *
 * <p>{@code field} se guarda por nombre y no por posicion. Un ordinal ataria la auditoria ya escrita
 * al orden en que se declararon los campos.
 */
@Entity
@Table(name = "planning_metadata_history",
        indexes = @Index(name = "ix_planning_metadata_history_item", columnList = "work_item_id"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PlanningMetadataHistoryEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "work_item_id", nullable = false, updatable = false, length = 64)
    private String workItemId;

    @Enumerated(EnumType.STRING)
    @Column(name = "field", nullable = false, length = 32)
    private PlanningMetadataField field;

    @Column(name = "previous_value", length = 64)
    private String previousValue;

    @Column(name = "new_value", length = 64)
    private String newValue;

    @Column(name = "changed_by", nullable = false, length = 64)
    private String changedBy;

    @Column(name = "changed_at", nullable = false)
    private Instant changedAt;

    private PlanningMetadataHistoryEntity(PlanningMetadataChange change) {
        this.workItemId = change.workItemId();
        this.field = change.field();
        this.previousValue = change.previousValue();
        this.newValue = change.newValue();
        this.changedBy = change.changedBy();
        this.changedAt = change.changedAt();
    }

    static PlanningMetadataHistoryEntity of(PlanningMetadataChange change) {
        return new PlanningMetadataHistoryEntity(change);
    }

    PlanningMetadataChange toDomain() {
        return new PlanningMetadataChange(
                workItemId,
                field,
                previousValue,
                newValue,
                changedBy,
                changedAt);
    }
}
