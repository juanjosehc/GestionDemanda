package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiDiscardReason;

/**
 * Salida de {@code POST /api/planning/from-glpi}: el plan calculado con datos de GLPI.
 *
 * <p>Es {@link PlanningPlanResponse} mas una lista. El plan y su identificador se devuelven igual que
 * en {@code POST /api/planning}, porque lo que salio es un plan de los de siempre: el mismo motor,
 * las mismas tablas, los mismos endpoints de consulta despues. Lo unico que cambia es de donde
 * vinieron los datos, y eso se lee en {@code GET /{planId}/input}.
 *
 * <p><strong>La lista de descartes es la parte que no existe en ningun otro endpoint, y es
 * necesaria.</strong> Cuando la entrada la escribe quien llama, todo lo que envio esta en el plan o
 * el motor lo descarto por una regla conocida. Cuando la entrada la trae GLPI, en cambio, puede
 * haber tickets que no se pudieron traducir, y sin esta lista el plan saldria con menos trabajo del
 * que hay sin que nadie pudiera notarlo. Un descarte invisible es la peor forma de perder datos.
 */
public record PlanningFromGlpiResponse(
        UUID planId,
        Instant createdAt,
        PlanningSimulationResponse plan,
        List<DiscardedView> discarded) {

    public PlanningFromGlpiResponse {
        discarded = discarded == null ? List.of() : List.copyOf(discarded);
    }

    /**
     * Un ticket que GLPI devolvio y que no llego al motor.
     *
     * <p><strong>Un ticket puede aparecer mas de una vez.</strong> El descarte dice causas y no
     * tickets: a un elemento sin planificacion declarada le falta la estimacion y el compromiso, y las
     * dos se informan porque son dos personas distintas las que tienen que actuar. Contar la lista da
     * el numero de causas; contar identificadores distintos da el de tickets.
     *
     * @param ticketId identificador del ticket en GLPI, para poder ir a mirarlo
     * @param code     la causa, para agrupar y contar; no cambia aunque se reescriba el texto
     * @param reason   que le falta, en terminos del campo que hay que corregir
     */
    public record DiscardedView(String ticketId, GlpiDiscardReason code, String reason) {
    }
}
