package co.com.coltefinanciera.gestiondemanda.persistence;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.model.InputProvenance;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningInputSnapshot;

/**
 * Tabla de la entrada de una ejecucion: con que datos se planifico.
 *
 * <p>Una fila por plan, y la clave es la del plan, igual que en {@code planning_context}: no hay
 * entrada sin plan al que pertenecer. Se escribe en la misma transaccion que el plan, por el mismo
 * motivo que los bloques y el contexto.
 *
 * <p><strong>La fila existe aunque no tenga hijos.</strong> Un plan de un escenario vacio —sin
 * incidentes y sin requerimientos— guarda esta fila y ninguna hija. Es lo que distingue "el motor
 * recibio una agenda vacia" de "nadie registro la entrada", que es el caso de los planes calculados
 * antes de esta fase: esos no tienen fila, y su entrada se lee como ausente en lugar de como vacia.
 * Sin esa distincion, un plan viejo responderia con una entrada en blanco y la respuesta afirmaria
 * algo que no consta.
 *
 * <p>{@code developer_id} se copia aqui aunque el plan ya lo tenga. La entrada se lee entera de sus
 * propias tablas, sin tocar la del plan, y con eso la foto se explica sola.
 *
 * <p><strong>Las tres columnas de procedencia son nulas en las filas anteriores a la integracion con
 * GLPI, y el nulo se interpreta.</strong> No hay migracion que rellenar: una fila sin {@code source}
 * es una fila que entro por la API HTTP, porque no habia otra via. Escribirlo hacia atras seria
 * afirmar algo que no consta en ningun sitio; deducirlo, en cambio, es exacto, porque el conjunto de
 * orígenes posibles era de un solo elemento.
 */
@Entity
@Table(name = "planning_input")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PlanningInputEntity {

    @Id
    @Column(name = "plan_id", nullable = false, updatable = false)
    private UUID planId;

    @Column(name = "developer_id", nullable = false, length = 64)
    private String developerId;

    @Column(name = "source", length = 16)
    private String source;

    @Column(name = "extracted_at")
    private Instant extractedAt;

    @Column(name = "adapter_version", length = 32)
    private String adapterVersion;

    private PlanningInputEntity(UUID planId, PlanningInputSnapshot input) {
        this.planId = planId;
        this.developerId = input.developerId();
        InputProvenance provenance = input.provenance();
        this.source = provenance.source().name();
        this.extractedAt = provenance.extractedAt();
        this.adapterVersion = provenance.adapterVersion();
    }

    static PlanningInputEntity of(UUID planId, PlanningInputSnapshot input) {
        return new PlanningInputEntity(planId, input);
    }

    /** La procedencia guardada, con el nulo historico ya interpretado. */
    InputProvenance toProvenance() {
        if (source == null) {
            return InputProvenance.HTTP;
        }
        return new InputProvenance(InputSource.valueOf(source), extractedAt, adapterVersion);
    }
}
