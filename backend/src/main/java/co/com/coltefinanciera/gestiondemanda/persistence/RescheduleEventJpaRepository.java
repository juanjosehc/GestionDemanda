package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a la tabla de auditoria. */
public interface RescheduleEventJpaRepository extends JpaRepository<RescheduleEventEntity, Long> {

    /** Eventos de un plan, en el orden en que se emitieron. */
    List<RescheduleEventEntity> findByPlanIdOrderByIdAsc(UUID planId);
}
