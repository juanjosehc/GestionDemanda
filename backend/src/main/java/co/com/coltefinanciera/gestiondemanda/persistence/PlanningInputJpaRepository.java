package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a la entrada guardada con cada plan. */
public interface PlanningInputJpaRepository extends JpaRepository<PlanningInputEntity, UUID> {
}
