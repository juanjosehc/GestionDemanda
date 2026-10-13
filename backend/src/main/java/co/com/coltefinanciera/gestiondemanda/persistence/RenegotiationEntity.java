package co.com.coltefinanciera.gestiondemanda.persistence;

import java.time.Instant;
import java.time.LocalDate;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;

import org.springframework.data.domain.Persistable;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.model.Renegotiation;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * La fila donde vive el acuerdo de renegociacion vigente de un requerimiento.
 *
 * <p><strong>La clave primaria es el identificador del ticket, no un sustituto.</strong> Hay
 * <em>uno</em> y solo uno por elemento de trabajo, y que la clave sea natural es lo que lo impide:
 * lo impide la base de datos, no una comprobacion previa. Es la misma decision que tomo
 * {@code PlanningMetadataEntity}, y por el mismo motivo.
 *
 * <p><strong>Ninguna columna del acuerdo admite nulo</strong>, a diferencia de la declaracion. Aqui no
 * hay estado vacio que guardar: un acuerdo sin fecha no es un acuerdo, y mientras no haya fecha no hay
 * fila. Es lo que hace que «no hay acuerdo» y «no hay fila» sean la misma cosa.
 *
 * <p><strong>{@code agreed_reason} es la excepcion, y es una excepcion con fecha.</strong> Los
 * acuerdos registrados antes de que el motivo existiera no tienen uno, y esta columna tiene que poder
 * representar esa ausencia en vez de inventar un texto: rellenarla con «no registrado» o con cualquier
 * otra cadena guardaria una explicacion que nadie dio, y la auditoria afirmaria algo falso. La columna
 * nace anulable por eso, y nulo significa exactamente «este acuerdo es anterior al motivo». La
 * escritura no puede producir ese nulo —los dos contratos de entrada declaran el motivo obligatorio—,
 * asi que la unica via por la que entra es una fila que ya estaba.
 *
 * <p><strong>Implementa {@link Persistable} por una razon que no se ve leyendo el codigo.</strong>
 * Spring Data decide entre insertar y actualizar mirando si el identificador es nulo, y aqui nunca lo
 * es: la clave es natural. Sin esta interfaz, {@code save} de una fila nueva haria un <em>merge</em>,
 * y un merge sobre una clave que ya existe no falla —actualiza en silencio—, asi que el segundo
 * acuerdo del mismo elemento pisaria el primero en vez de responder que ya estaba. Con ella, la fila
 * que nace se inserta de verdad y la clave primaria puede hacer su trabajo.
 */
@Entity
@Table(name = "renegotiation")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RenegotiationEntity implements Persistable<String> {

    @Id
    @Column(name = "work_item_id", nullable = false, updatable = false, length = 64)
    private String workItemId;

    @Column(name = "agreed_date", nullable = false)
    private LocalDate agreedDate;

    @Column(name = "agreed_by", nullable = false, length = 64)
    private String agreedBy;

    /** El motivo del acuerdo. Anulable por las filas anteriores al campo, y por ninguna otra razon. */
    @Column(name = "agreed_reason", length = 500)
    private String agreedReason;

    @Column(name = "agreed_at", nullable = false)
    private Instant agreedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "source", nullable = false, length = 16)
    private InputSource source;

    /**
     * Si esta fila todavia no esta en la base de datos.
     *
     * <p>No es una columna: es lo que Spring Data consulta para saber si tiene que insertar o
     * actualizar, y por eso se declara aqui y no se deduce de {@code workItemId}, que siempre viene
     * puesto.
     */
    @Transient
    private boolean nueva;

    private RenegotiationEntity(Renegotiation renegotiation, boolean nueva) {
        this.workItemId = renegotiation.workItemId();
        this.agreedDate = renegotiation.agreedDate();
        this.agreedBy = renegotiation.agreedBy();
        this.agreedReason = renegotiation.agreedReason();
        this.agreedAt = renegotiation.agreedAt();
        this.source = renegotiation.source();
        this.nueva = nueva;
    }

    /** Una fila que ya existe y se va a reemplazar. */
    static RenegotiationEntity of(Renegotiation renegotiation) {
        return new RenegotiationEntity(renegotiation, false);
    }

    /** Una fila que nace ahora y hay que insertar. */
    static RenegotiationEntity ofNew(Renegotiation renegotiation) {
        return new RenegotiationEntity(renegotiation, true);
    }

    @Override
    public String getId() {
        return workItemId;
    }

    @Override
    public boolean isNew() {
        return nueva;
    }

    Renegotiation toDomain() {
        return new Renegotiation(workItemId, agreedDate, agreedBy, agreedReason, agreedAt, source);
    }
}
