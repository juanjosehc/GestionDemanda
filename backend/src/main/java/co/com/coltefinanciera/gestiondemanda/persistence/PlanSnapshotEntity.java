package co.com.coltefinanciera.gestiondemanda.persistence;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * Tabla de planes.
 *
 * <p>La clave la asigna el adaptador y no la base de datos: un plan tiene identidad antes de que su
 * transaccion termine, porque esa identidad es parte de la respuesta HTTP.
 *
 * <p>No declara relaciones hacia las tablas hijas. El plan es el agregado, pero se arma leyendo
 * cada tabla por {@code plan_id}: con cuatro consultas explicitas no hay carga perezosa, ni
 * cascadas, ni sesion abierta en la vista, que es justo lo que se quiere de una capa que solo
 * guarda y devuelve.
 *
 * <p><strong>El indice es {@code (developer_id, created_at)} y sirve a una sola consulta</strong>: la
 * que lista el historial de un tecnico, que es la unica lectura de esta tabla que filtra por
 * desarrollador. {@code findLatestPerDeveloper} sigue leyendo la tabla entera y no se beneficia. Se
 * declara aqui y no en un fichero de migracion porque el esquema lo mantiene Hibernate
 * ({@code ddl-auto=update}) y el proyecto no tiene Flyway ni Liquibase: el indice se emite y se
 * reemite sin duplicarse, que es lo unico que hay que exigirle.
 */
@Entity
@Table(name = "plan_snapshot",
        indexes = @Index(name = "ix_plan_snapshot_developer", columnList = "developer_id, created_at"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PlanSnapshotEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "developer_id", nullable = false, length = 64)
    private String developerId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    private PlanSnapshotEntity(UUID id, String developerId, Instant createdAt) {
        this.id = id;
        this.developerId = developerId;
        this.createdAt = createdAt;
    }

    static PlanSnapshotEntity of(UUID id, String developerId, Instant createdAt) {
        return new PlanSnapshotEntity(id, developerId, createdAt);
    }
}
