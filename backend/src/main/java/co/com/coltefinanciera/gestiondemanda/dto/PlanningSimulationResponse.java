package co.com.coltefinanciera.gestiondemanda.dto;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import co.com.coltefinanciera.gestiondemanda.domain.enums.AppliedRule;
import co.com.coltefinanciera.gestiondemanda.domain.enums.DisplacementPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;

/**
 * Salida de la simulacion: agenda resultante, requerimientos afectados, nuevas fechas y eventos
 * de auditoria generados.
 *
 * <p>{@code allocations} y {@code blocks} son la misma agenda leida de dos maneras. La asignacion
 * dice que se pacto y desde que dia arranca, una pieza por elemento; el bloque dice cuando se
 * trabaja, un tramo por jornada tocada. Un requerimiento de veinte horas son una asignacion y tres
 * bloques, y hacen falta los dos: la asignacion para saber cuanto se comprometio, el bloque para
 * pintar la agenda.
 *
 * <p>{@code displacedRequirements} se deriva de los eventos y no de las asignaciones: un
 * requerimiento que cambia de fecha y otro que ya estaba registrado por una ejecucion previa se
 * ven distintos aqui, que es justo lo que la idempotencia promete.
 *
 * <p>{@code incidentPolicies} es la OLA vigente con la que se calculo el plan. Se devuelve para que
 * el resultado sea interpretable sin consultar la configuracion de la aplicacion: un desplazamiento
 * con severidad {@code BAJO} y regla {@code SATURACION} solo se entiende sabiendo que la OLA
 * configurada le da ese comportamiento.
 *
 * <p>{@code calendar} e {@code incidentDeadlines} siguen el mismo criterio para el calendario: sin
 * ellos, un vencimiento calculado en horas habiles es un numero que nadie puede explicar.
 */
public record PlanningSimulationResponse(
        String developerId,
        List<Allocation> allocations,
        List<Block> blocks,
        List<DisplacedRequirement> displacedRequirements,
        List<RescheduleEventView> rescheduleEvents,
        List<Conflict> conflicts,
        List<IncidentPolicyView> incidentPolicies,
        WorkingCalendarView calendar,
        List<IncidentDeadline> incidentDeadlines) {

    /** Elemento ubicado en la agenda: que se comprometio y desde que dia arranca. */
    public record Allocation(
            String workItemId,
            WorkItemType workItemType,
            String developerId,
            LocalDate date,
            BigDecimal hours) {
    }

    /**
     * Tramo continuo de agenda: cuando se trabaja de verdad.
     *
     * <p>Es lo que consume un timeline. {@code hours} es la duracion del tramo, no el total del
     * elemento: un incidente de cuatro horas partido entre el viernes y el lunes produce dos bloques
     * de media hora y tres horas y media.
     */
    public record Block(
            String workItemId,
            WorkItemType workItemType,
            String developerId,
            LocalDateTime start,
            LocalDateTime end,
            BigDecimal hours) {
    }

    /** Requerimiento desplazado en esta ejecucion, con su fecha original y la recalculada. */
    public record DisplacedRequirement(
            String requirementId,
            LocalDate originalDate,
            LocalDate newDate,
            RequirementStatus newStatus,
            String causedByIncidentId) {
    }

    /**
     * Evento de auditoria generado en esta ejecucion.
     *
     * @param severity severidad del incidente causante tal como estaba al emitirse el evento.
     * @param reason   motivo legible del desplazamiento. Se deriva de la regla aplicada en esta capa
     *                 y no se guarda en el dominio: seria el mismo hecho escrito dos veces, y dos
     *                 copias del mismo hecho acaban divergiendo.
     */
    public record RescheduleEventView(
            Instant timestamp,
            String incidentId,
            String requirementId,
            LocalDate originalDate,
            LocalDate rescheduledDate,
            AppliedRule appliedRule,
            IncidentSeverity severity,
            String reason) {
    }

    /** Trabajo que no cupo en el horizonte planificado. */
    public record Conflict(String workItemId, WorkItemType workItemType, String reason) {
    }

    /** Acuerdo de nivel operativo vigente para una severidad. */
    public record IncidentPolicyView(
            IncidentSeverity severity,
            int targetOwnershipMinutes,
            BigDecimal targetResolutionHours,
            DisplacementPolicy displacementPolicy) {
    }

    /**
     * Calendario laboral con el que se calculo el plan.
     *
     * @param weekend  dias no laborables de la semana, en orden.
     * @param holidays festivos, en orden cronologico.
     */
    public record WorkingCalendarView(
            LocalTime startTime,
            LocalTime endTime,
            List<DayOfWeek> weekend,
            List<LocalDate> holidays) {
    }

    /**
     * Vencimiento de la OLA de un incidente, medido en tiempo habil.
     *
     * <p>Solo aparece para los incidentes que declaran severidad: un incidente legado se rige por el
     * umbral de dedicacion y no tiene objetivo de resolucion que vencer.
     *
     * @param dueAt instante en que se agota el objetivo. Cae siempre dentro de un bloque de jornada,
     *              nunca en fin de semana ni en festivo.
     */
    public record IncidentDeadline(
            String incidentId,
            IncidentSeverity severity,
            Instant reportedAt,
            BigDecimal targetResolutionHours,
            Instant dueAt) {
    }
}
