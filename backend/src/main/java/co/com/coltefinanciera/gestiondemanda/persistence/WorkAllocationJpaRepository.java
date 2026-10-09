package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a la tabla de asignaciones. */
public interface WorkAllocationJpaRepository extends JpaRepository<WorkAllocationEntity, Long> {

    /**
     * Asignaciones de un plan, en el orden en que el motor las produjo.
     *
     * <p>El orden importa y no es alfabetico: el motor resuelve primero los incidentes que reclaman
     * capacidad, despues los requerimientos y al final los que conviven. Ordenar por clave es lo que
     * devuelve esa secuencia, porque las claves se asignan al insertar y en el mismo orden.
     */
    List<WorkAllocationEntity> findByPlanIdOrderByIdAsc(UUID planId);
}
