package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a la OLA guardada con cada plan. */
public interface PlanningContextPolicyJpaRepository
        extends JpaRepository<PlanningContextPolicyEntity, Long> {

    /** La OLA de un plan. El orden no importa: se rearma en un mapa por severidad. */
    List<PlanningContextPolicyEntity> findByPlanId(UUID planId);
}
