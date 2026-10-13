package co.com.coltefinanciera.gestiondemanda.persistence;

import java.time.Instant;
import java.time.LocalDate;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import co.com.coltefinanciera.gestiondemanda.domain.model.RenegotiationChange;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * Una renegociacion, tal como quedo registrada.
 *
 * <p><strong>De solo insercion.</strong> Un cambio de fecha acordada es un hecho ocurrido, no un
 * estado: se escribe una vez y no se corrige. No hay setters, y el adaptador solo la lee y la
 * inserta. Esa es toda la proteccion que necesita una tabla a la que nadie le pide que cambie.
 *
 * <p><strong>Un {@code previous_date} nulo es el dato mas importante de la tabla:</strong> marca el
 * primer acuerdo, el momento en que la fecha no existia y alguien la trajo. Sin esa fila, el primer
 * acuerdo quedaria sin autor en cuanto alguien lo cambiara.
 *
 * <p><strong>Las fechas se guardan como fecha, no como texto.</strong> El historial de la
 * declaracion usa texto porque tiene que servir a una fecha y a un decimal con un solo par de
 * columnas; aqui solo hay fechas, y una columna {@code date} dice lo que hay sin que nadie tenga que
 * consultar otro campo para interpretarla.
 */
@Entity
@Table(name = "renegotiation_history",
        indexes = @Index(name = "ix_renegotiation_history_item", columnList = "work_item_id"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RenegotiationHistoryEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "work_item_id", nullable = false, updatable = false, length = 64)
    private String workItemId;

    @Column(name = "previous_date")
    private LocalDate previousDate;

    @Column(name = "new_date", nullable = false)
    private LocalDate newDate;

    @Column(name = "changed_by", nullable = false, length = 64)
    private String changedBy;

    @Column(name = "changed_at", nullable = false)
    private Instant changedAt;

    private RenegotiationHistoryEntity(RenegotiationChange change) {
        this.workItemId = change.workItemId();
        this.previousDate = change.previousDate();
        this.newDate = change.newDate();
        this.changedBy = change.changedBy();
        this.changedAt = change.changedAt();
    }

    static RenegotiationHistoryEntity of(RenegotiationChange change) {
        return new RenegotiationHistoryEntity(change);
    }

    RenegotiationChange toDomain() {
        return new RenegotiationChange(
                workItemId, previousDate, newDate, changedBy, changedAt);
    }
}
