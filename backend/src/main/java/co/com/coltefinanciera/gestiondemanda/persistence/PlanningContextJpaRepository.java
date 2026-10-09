package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a la tabla de contexto. La clave es la del plan: no hay contexto suelto. */
public interface PlanningContextJpaRepository extends JpaRepository<PlanningContextEntity, UUID> {
}
