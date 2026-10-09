package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a los incidentes guardados con la entrada de cada plan. */
public interface PlanningInputIncidentJpaRepository
        extends JpaRepository<PlanningInputIncidentEntity, Long> {

    /** Los incidentes de un plan, en el orden en que se escribieron. */
    List<PlanningInputIncidentEntity> findByPlanIdOrderByIdAsc(UUID planId);
}
