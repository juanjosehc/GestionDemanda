package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Salida de {@code GET /api/planning/{planId}}: un plan releido de la base de datos.
 *
 * <p>No es el mismo cuerpo que devuelve {@code POST /plan}, y la diferencia es el punto: aqui solo
 * esta el plan. Faltan los vencimientos, que son datos de entrada —se derivan de los incidentes, que
 * son de GLPI— y no se guardan.
 *
 * <p>La OLA y el calendario faltan aqui a proposito, y no porque no se guarden: desde la Fase 7 se
 * persisten con el plan y se leen por {@code GET /api/planning/{planId}/context}. Son dos lecturas
 * distintas porque son dos preguntas distintas: quien relee un plan quiere su agenda, y quien audita
 * quiere sus reglas. Devolverlo todo junto obligaria a traerse la configuracion para pintar un
 * timeline.
 *
 * <p>Lo que si sobrevive es la explicacion: cada evento lleva su regla aplicada y la severidad que
 * tenia el incidente, que es lo que permite entender un desplazamiento viejo sin reconstruir el
 * estado de aquel dia. El contexto le da el resto: bajo que umbral, con que horizonte y con que
 * calendario se aplico esa regla.
 *
 * <p>Reutiliza los tipos de {@link PlanningSimulationResponse} en lugar de declarar los suyos: son
 * la misma forma, y dos declaraciones de la misma forma acaban divergiendo.
 */
public record PlanSnapshotResponse(
        UUID planId,
        String developerId,
        Instant createdAt,
        List<PlanningSimulationResponse.Allocation> allocations,
        List<PlanningSimulationResponse.Block> blocks,
        List<PlanningSimulationResponse.RescheduleEventView> rescheduleEvents,
        List<PlanningSimulationResponse.Conflict> conflicts) {
}
