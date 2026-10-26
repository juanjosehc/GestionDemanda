package co.com.coltefinanciera.gestiondemanda.domain.idempotency;

import java.time.Instant;

/**
 * Registro de parejas (incidente, requerimiento) ya auditadas como desplazamiento.
 *
 * <p>Existe para que un mismo incidente no deje dos auditorias por el mismo hecho. {@link #claim}
 * comprueba y registra en una sola operacion, de modo que dos ejecuciones concurrentes no puedan
 * colarse entre la comprobacion y la escritura.
 *
 * <p><strong>Reclamar no es publicar.</strong> Desde la Fase 64 el registro devuelve el instante de
 * la auditoria y el motor publica el evento siempre, con ese instante: en la primera corrida es el
 * de ahora y en las siguientes es el original. Antes, la segunda corrida no publicaba nada, y como
 * cada plan guarda solo sus propios eventos, el desplazamiento desaparecia del plan nuevo y con el
 * la conciliacion. Lo que se evita sigue siendo lo mismo —auditar dos veces—, pero sin perder el
 * hecho de vista.
 *
 * <p>Es una interfaz a proposito, y la promesa se cumplio: la implementacion que se registro
 * primero vivia en memoria y la actual escribe en base de datos, y {@code PlanningEngine} no cambio
 * una linea entre una y otra. Lo que cambio no fue el comportamiento sino su alcance: el registro
 * dejo de reabrirse en cada reinicio.
 */
public interface RescheduleLedger {

    /**
     * Reclama la pareja y devuelve cuando quedo auditada.
     *
     * <p>El instante lo propone quien llama y solo vale la primera vez: si la pareja ya estaba
     * registrada se devuelve el original, no el propuesto. Es lo que hace que dos corridas del mismo
     * escenario produzcan el mismo evento, con la misma marca, en vez de dos auditorias.
     *
     * @param auditedAt el instante a registrar si la pareja es nueva.
     * @return el instante de auditoria de la pareja: el original si ya estaba reclamada.
     */
    Instant claim(String incidentId, String requirementId, Instant auditedAt);

    /** Indica si la pareja ya fue procesada, sin reclamarla. */
    boolean contains(String incidentId, String requirementId);
}
