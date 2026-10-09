package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;

/**
 * Trabajo que el motor no pudo ubicar dentro del horizonte planificado.
 *
 * <p>No es un error de ejecucion: es un resultado de negocio que alguien debe resolver
 * repartiendo la tarea, ampliando el horizonte o sumando capacidad.
 */
public record PlanningConflict(String workItemId, WorkItemType workItemType, String reason) {

    public PlanningConflict {
        DomainPreconditions.requireText(workItemId, "workItemId");
        Objects.requireNonNull(workItemType, "workItemType es obligatorio");
        DomainPreconditions.requireText(reason, "reason");
    }
}
