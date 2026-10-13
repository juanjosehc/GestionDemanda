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
 *
 * <p><strong>{@code agreed_reason} guarda el motivo que se dio en ese cambio, no el vigente.</strong>
 * Es lo que hace que la historia se pueda leer sola: cada fila dice a que fecha se llego, quien lo
 * decidio, cuando y por que, sin tener que mirar la fila del acuerdo para saber que se pensaba
 * entonces. Si el motivo viviera solo en el acuerdo vigente, corregirlo reescribiria el pasado y la
 * historia afirmaria que siempre se dijo lo que se dice hoy.
 *
 * <p><strong>Admite nulo por las filas anteriores al campo.</strong> Es la misma excepcion que en
 * {@code renegotiation} y por la misma razon: un cambio registrado antes de que el motivo existiera no
 * tiene uno, y rellenarlo inventaria una explicacion.
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

    /** El motivo de ese cambio. Anulable por las filas anteriores al campo, y por ninguna otra razon. */
    @Column(name = "agreed_reason", length = 500)
    private String agreedReason;

    @Column(name = "changed_by", nullable = false, length = 64)
    private String changedBy;

    @Column(name = "changed_at", nullable = false)
    private Instant changedAt;

    private RenegotiationHistoryEntity(RenegotiationChange change) {
        this.workItemId = change.workItemId();
        this.previousDate = change.previousDate();
        this.newDate = change.newDate();
        this.agreedReason = change.agreedReason();
        this.changedBy = change.changedBy();
        this.changedAt = change.changedAt();
    }

    static RenegotiationHistoryEntity of(RenegotiationChange change) {
        return new RenegotiationHistoryEntity(change);
    }

    RenegotiationChange toDomain() {
        return new RenegotiationChange(
                workItemId, previousDate, newDate, agreedReason, changedBy, changedAt);
    }
}
