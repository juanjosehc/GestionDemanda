package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * Severidad de un incidente.
 *
 * <p>Es la clasificacion que el negocio ya usa en GLPI y la que determina, a traves de su
 * {@code IncidentPolicy}, como compite el incidente por la jornada de un desarrollador.
 *
 * <p>El orden de declaracion es el orden de prioridad: {@code ALTO} reclama capacidad antes que
 * {@code MEDIO}, y este antes que {@code BAJO}. El motor lo usa para ordenar los incidentes, de
 * modo que la prioridad vive en un solo sitio y no en una tabla de comparacion.
 *
 * <p>Un incidente sin severidad es un dato legado: el motor lo planifica con el umbral de
 * dedicacion historico ({@code incidentThresholdHours}) y lo audita con la regla antigua.
 */
public enum IncidentSeverity {

    /** Prioridad maxima: reclama la jornada completa del dia en que se reporta. */
    ALTO,

    /** Compite por capacidad: desplaza solo cuando su consumo ya no deja caber el trabajo pactado. */
    MEDIO,

    /** Intenta convivir con los requerimientos: solo desplaza si el dia esta saturado. */
    BAJO
}
