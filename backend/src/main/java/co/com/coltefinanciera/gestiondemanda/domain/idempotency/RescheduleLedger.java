package co.com.coltefinanciera.gestiondemanda.domain.idempotency;

/**
 * Registro de parejas (incidente, requerimiento) ya procesadas.
 *
 * <p>Existe para que un mismo incidente no desplace dos veces al mismo requerimiento ni deje dos
 * eventos de auditoria por el mismo hecho. {@link #claim} comprueba y registra en una sola
 * operacion, de modo que dos ejecuciones concurrentes no puedan colarse entre la comprobacion y
 * la escritura.
 *
 * <p>Es una interfaz a proposito, y la promesa se cumplio: la implementacion que se registro
 * primero vivia en memoria y la actual escribe en base de datos, y {@code PlanningEngine} no cambio
 * una linea entre una y otra. Lo que cambio no fue el comportamiento sino su alcance: el registro
 * dejo de reabrirse en cada reinicio.
 */
public interface RescheduleLedger {

    /**
     * Reclama la pareja.
     *
     * @return {@code true} si nadie la habia reclamado antes (y queda registrada), {@code false}
     *         si ya estaba.
     */
    boolean claim(String incidentId, String requirementId);

    /** Indica si la pareja ya fue procesada, sin reclamarla. */
    boolean contains(String incidentId, String requirementId);
}
