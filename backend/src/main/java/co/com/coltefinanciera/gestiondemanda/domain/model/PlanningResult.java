package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.util.List;

/**
 * Resultado estructurado del motor.
 *
 * @param allocations      agenda resultante: incidentes y requerimientos ya ubicados. Una pieza por
 *                         elemento, con la fecha en que arranca y las horas comprometidas.
 * @param blocks           la misma agenda troceada por jornadas: cada tramo continuo con su hora de
 *                         inicio y de fin. Es la lectura que necesita un timeline, y la que permite
 *                         ver que una jornada tiene huecos en lugar de suponerla entera.
 * @param rescheduleEvents desplazamientos auditados en esta ejecucion. Vacio si nada se movio o
 *                         si todo lo que se movio ya estaba registrado por una ejecucion previa.
 * @param conflicts        trabajo que no cupo en el horizonte.
 */
public record PlanningResult(
        List<WorkAllocation> allocations,
        List<WorkBlock> blocks,
        List<RescheduleEvent> rescheduleEvents,
        List<PlanningConflict> conflicts) {

    public PlanningResult {
        allocations = List.copyOf(allocations);
        blocks = List.copyOf(blocks);
        rescheduleEvents = List.copyOf(rescheduleEvents);
        conflicts = List.copyOf(conflicts);
    }

    public boolean hasDisplacements() {
        return !rescheduleEvents.isEmpty();
    }
}
