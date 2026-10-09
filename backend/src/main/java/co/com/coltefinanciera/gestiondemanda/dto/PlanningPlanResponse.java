package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Salida de {@code POST /api/planning/plan}: el plan guardado y su identificador.
 *
 * <p>Devuelve el resultado completo ademas de la clave para no obligar a una segunda llamada: quien
 * acaba de planificar quiere ver que salio, y quien quiera volver a verlo mas tarde tiene
 * {@code GET /api/planning/{planId}}.
 *
 * <p>El contenido es el mismo que el de la simulacion, con la OLA y el calendario vigentes incluidos.
 * Se devuelven aqui porque son el contexto con el que se calculo, y sin ellos un plan es dificil de
 * interpretar. Desde la Fase 7 ese contexto tambien queda guardado, y se relee por
 * {@code GET /api/planning/{planId}/context}: lo que se acaba de calcular y lo que se guardo se
 * pueden comparar. Lo que sigue sin guardarse son los vencimientos, que se derivan de los
 * incidentes y son de GLPI.
 *
 * @param createdAt momento en que se calculo. Es la marca que queda guardada, no la de la respuesta.
 */
public record PlanningPlanResponse(
        UUID planId,
        Instant createdAt,
        PlanningSimulationResponse plan) {
}
