package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a los requerimientos guardados con la entrada de cada plan. */
public interface PlanningInputRequirementJpaRepository
        extends JpaRepository<PlanningInputRequirementEntity, Long> {

    /** Los requerimientos de un plan, en el orden en que se escribieron. */
    List<PlanningInputRequirementEntity> findByPlanIdOrderByIdAsc(UUID planId);
}
