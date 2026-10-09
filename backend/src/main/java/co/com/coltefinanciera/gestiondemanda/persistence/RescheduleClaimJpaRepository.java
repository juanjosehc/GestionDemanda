package co.com.coltefinanciera.gestiondemanda.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Acceso al registro de idempotencia.
 *
 * <p>No declara consulta de reclamo: el reclamo es un intento de insercion, y lo que decide si
 * prospera es la restriccion unica de la tabla, no una consulta.
 */
public interface RescheduleClaimJpaRepository extends JpaRepository<RescheduleClaimEntity, Long> {

    /** Indica si la pareja ya fue reclamada, sin reclamarla. */
    boolean existsByIncidentIdAndRequirementId(String incidentId, String requirementId);
}
