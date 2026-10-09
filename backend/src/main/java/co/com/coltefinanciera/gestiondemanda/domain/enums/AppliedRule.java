package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * Regla de negocio que provoco un desplazamiento.
 *
 * <p>Queda registrada en cada evento de auditoria para poder explicar, tiempo despues y sin
 * reconstruir el estado, por que un requerimiento cambio de fecha.
 *
 * <p>Las tres primeras corresponden a los comportamientos de planificacion de
 * {@link DisplacementPolicy}: nombran <em>que hizo</em> el motor, no <em>que severidad</em> lo
 * provoco. La severidad viaja aparte en el evento, porque la correspondencia entre ambas es
 * configurable: si la OLA decide que BAJO compita por capacidad, la regla correcta es
 * {@code CAPACIDAD_COMPROMETIDA} y la severidad sigue siendo {@code BAJO}.
 */
public enum AppliedRule {

    /** Un incidente reclamó la jornada completa del día en que se reportó. */
    REPLANIFICACION_INMEDIATA,

    /** El incidente comprometió la capacidad de la jornada y el requerimiento ya no cabía. */
    CAPACIDAD_COMPROMETIDA,

    /** El día estaba saturado: el incidente no cabía ni conviviendo con el trabajo pactado. */
    SATURACION,

    /**
     * Un incidente superó el umbral de dedicación y ocupó la franja del requerimiento.
     *
     * @deprecated regla previa a la priorización por severidad. Solo la emiten los incidentes sin
     *             severidad, que son dato legado. Se conserva para no reinterpretar la auditoría ya
     *             emitida ni romper a quien la consuma.
     */
    @Deprecated
    UMBRAL_INCIDENTE_EXCEDIDO,

    /**
     * La jornada ya estaba comprometida por trabajo previo. El desplazamiento es real pero no
     * hay un incidente concreto a quien atribuirlo.
     */
    CAPACIDAD_DIARIA_EXCEDIDA
}
