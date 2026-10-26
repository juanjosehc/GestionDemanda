package co.com.coltefinanciera.gestiondemanda.domain.idempotency;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Registro de idempotencia en memoria, para pruebas.
 *
 * <p>Vivia en el codigo de produccion cuando no habia persistencia. Ahora la implementacion real es
 * {@code JpaRescheduleLedger} y esta se queda donde corresponde: es el doble que usan las pruebas
 * del motor, que no deben depender de una base de datos para comprobar reglas de planificacion.
 *
 * <p>El mapa es concurrente porque el motor es un bean unico y puede atender peticiones
 * simultaneas. No se limpia ni expira, y eso es precisamente lo que la descalifica para produccion:
 * un reinicio reabre el registro. Se conserva porque reproduce ese comportamiento en una prueba,
 * sin motor ni esquema.
 */
public class InMemoryRescheduleLedger implements RescheduleLedger {

    /** Marca de los desplazamientos sin incidente causante, para no confundirlos con un id real. */
    private static final String SIN_INCIDENTE = "-";

    /** Instante con el que quedo auditada cada pareja. Solo el primer reclamo lo fija. */
    private final Map<String, Instant> claimed = new ConcurrentHashMap<>();

    @Override
    public Instant claim(String incidentId, String requirementId, Instant auditedAt) {
        return claimed.computeIfAbsent(key(incidentId, requirementId), pareja -> auditedAt);
    }

    @Override
    public boolean contains(String incidentId, String requirementId) {
        return claimed.containsKey(key(incidentId, requirementId));
    }

    private static String key(String incidentId, String requirementId) {
        String cause = incidentId == null || incidentId.isBlank() ? SIN_INCIDENTE : incidentId;
        return cause + '|' + requirementId;
    }
}
