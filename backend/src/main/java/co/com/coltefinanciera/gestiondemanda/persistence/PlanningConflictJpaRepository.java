package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a la tabla de conflictos. */
public interface PlanningConflictJpaRepository extends JpaRepository<PlanningConflictEntity, Long> {

    /** Conflictos de un plan, en el orden en que se detectaron. */
    List<PlanningConflictEntity> findByPlanIdOrderByIdAsc(UUID planId);
}
