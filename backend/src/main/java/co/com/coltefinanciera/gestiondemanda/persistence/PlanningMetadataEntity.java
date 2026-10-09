package co.com.coltefinanciera.gestiondemanda.persistence;

import java.math.BigDecimal;
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
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * La fila donde vive la planificacion declarada por el negocio.
 *
 * <p><strong>La clave primaria es el identificador del ticket, no un sustituto.</strong> Es la
 * diferencia deliberada con las tablas del plan: aquellas son hijas de un agregado con UUID y
 * necesitan un {@code id} generado para distinguir filas hermanas, mientras que aqui hay
 * <em>uno</em> y solo uno por elemento de trabajo. Que la clave sea natural es lo que lo impide, y
 * es la base de datos quien lo impide, no una comprobacion previa.
 *
 * <p><strong>Todas las columnas salvo la clave admiten nulo</strong>, porque el estado vacio es
 * legitimo: un ticket puede tener estimacion y no fecha compromiso, o ninguna de las dos, y eso hay
 * que poder guardarlo. Lo que no admite nulo es {@code source}: de donde vino la declaracion es
 * siempre un dato.
 *
 * <p><strong>Implementa {@link Persistable} por una razon que no se ve leyendo el codigo.</strong>
 * Spring Data decide entre insertar y actualizar mirando si el identificador es nulo, y aqui nunca
 * lo es: la clave es natural. Sin esta interfaz, {@code save} de una fila nueva haria un
 * <em>merge</em>, y un merge sobre una clave que ya existe no falla —actualiza en silencio—, asi que
 * la segunda declaracion del mismo elemento pisaria la primera en vez de responder que ya estaba.
 * Con ella, la fila que nace se inserta de verdad y la clave primaria puede hacer su trabajo.
 */
@Entity
@Table(name = "planning_metadata")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PlanningMetadataEntity implements Persistable<String> {

    @Id
    @Column(name = "work_item_id", nullable = false, updatable = false, length = 64)
    private String workItemId;

    @Column(name = "estimated_hours", precision = 10, scale = 4)
    private BigDecimal estimatedHours;

    @Column(name = "committed_date")
    private LocalDate committedDate;

    @Column(name = "estimated_by", length = 64)
    private String estimatedBy;

    @Column(name = "committed_by", length = 64)
    private String committedBy;

    @Column(name = "estimated_at")
    private Instant estimatedAt;

    @Column(name = "committed_at")
    private Instant committedAt;

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

    private PlanningMetadataEntity(PlanningMetadata metadata, boolean nueva) {
        this.workItemId = metadata.workItemId();
        this.estimatedHours = metadata.estimatedHours();
        this.committedDate = metadata.committedDate();
        this.estimatedBy = metadata.estimatedBy();
        this.committedBy = metadata.committedBy();
        this.estimatedAt = metadata.estimatedAt();
        this.committedAt = metadata.committedAt();
        this.source = metadata.source();
        this.nueva = nueva;
    }

    /** Una fila que ya existe y se va a reemplazar. */
    static PlanningMetadataEntity of(PlanningMetadata metadata) {
        return new PlanningMetadataEntity(metadata, false);
    }

    /** Una fila que nace ahora y hay que insertar. */
    static PlanningMetadataEntity ofNew(PlanningMetadata metadata) {
        return new PlanningMetadataEntity(metadata, true);
    }

    @Override
    public String getId() {
        return workItemId;
    }

    @Override
    public boolean isNew() {
        return nueva;
    }

    PlanningMetadata toDomain() {
        return new PlanningMetadata(
                workItemId,
                estimatedHours,
                committedDate,
                estimatedBy,
                committedBy,
                estimatedAt,
                committedAt,
                source);
    }
}
