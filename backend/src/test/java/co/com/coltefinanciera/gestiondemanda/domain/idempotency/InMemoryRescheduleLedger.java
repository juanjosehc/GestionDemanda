package co.com.coltefinanciera.gestiondemanda.domain.idempotency;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Registro de idempotencia en memoria, para pruebas.
 *
 * <p>Vivia en el codigo de produccion cuando no habia persistencia. Ahora la implementacion real es
 * {@code JpaRescheduleLedger} y esta se queda donde corresponde: es el doble que usan las pruebas
 * del motor, que no deben depender de una base de datos para comprobar reglas de planificacion.
 *
 * <p>El conjunto es concurrente porque el motor es un bean unico y puede atender peticiones
 * simultaneas. No se limpia ni expira, y eso es precisamente lo que la descalifica para produccion:
 * un reinicio reabre el registro. Se conserva porque reproduce ese comportamiento en una prueba,
 * sin motor ni esquema.
 */
public class InMemoryRescheduleLedger implements RescheduleLedger {

    /** Marca de los desplazamientos sin incidente causante, para no confundirlos con un id real. */
    private static final String SIN_INCIDENTE = "-";

    private final Set<String> claimed = ConcurrentHashMap.newKeySet();

    @Override
    public boolean claim(String incidentId, String requirementId) {
        return claimed.add(key(incidentId, requirementId));
    }

    @Override
    public boolean contains(String incidentId, String requirementId) {
        return claimed.contains(key(incidentId, requirementId));
    }

    private static String key(String incidentId, String requirementId) {
        String cause = incidentId == null || incidentId.isBlank() ? SIN_INCIDENTE : incidentId;
        return cause + '|' + requirementId;
    }
}
