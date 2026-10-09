package co.com.coltefinanciera.gestiondemanda.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;

/**
 * Salida de {@code GET /api/planning/{planId}/context}: con que se calculo un plan guardado.
 *
 * <p>Es la otra mitad del plan. {@code GET /{planId}} devuelve que se decidio; esto devuelve con que
 * reglas, con que calendario y con que version del motor. Las dos juntas responden las preguntas que
 * un plan tiene que poder contestar: que ocurrio, por que ocurrio y si la regla se aplico bien.
 *
 * <p>Reutiliza {@link PlanningSimulationResponse.IncidentPolicyView} y
 * {@link PlanningSimulationResponse.WorkingCalendarView} en lugar de declarar los suyos, igual que
 * {@link PlanSnapshotResponse}: son la misma forma, y dos declaraciones de la misma forma acaban
 * divergiendo.
 *
 * @param severities severidades que participaron en el calculo, en orden de prioridad. Vacio cuando
 *                   ningun incidente declaro severidad, que es el caso de los datos legados.
 */
public record PlanningContextResponse(
        UUID planId,
        String engineVersion,
        Instant calculatedAt,
        String zoneId,
        List<IncidentSeverity> severities,
        RulesView rules) {

    /**
     * Las reglas vigentes tal como estaban.
     *
     * <p>{@code workingHoursPerDay} no se guarda: es la duracion del bloque de {@code calendar}, y
     * viaja aqui derivada para que quien lea la respuesta no tenga que restar dos horas. La fuente
     * sigue siendo una sola.
     */
    public record RulesView(
            BigDecimal incidentThresholdHours,
            BigDecimal workingHoursPerDay,
            int planningHorizonDays,
            List<PlanningSimulationResponse.IncidentPolicyView> incidentPolicies,
            PlanningSimulationResponse.WorkingCalendarView calendar) {
    }
}
