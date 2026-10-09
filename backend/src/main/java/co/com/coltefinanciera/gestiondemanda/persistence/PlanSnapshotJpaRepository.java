package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a la tabla de planes. La clave la asigna el adaptador, no la base de datos. */
public interface PlanSnapshotJpaRepository extends JpaRepository<PlanSnapshotEntity, UUID> {
}
