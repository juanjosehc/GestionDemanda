package co.com.coltefinanciera.gestiondemanda.domain.enums;

/** Naturaleza del trabajo que compite por la capacidad de un desarrollador. */
public enum WorkItemType {

    /** Prioridad maxima. Consume capacidad desde el dia en que se reporta. */
    INCIDENTE,

    /** Fecha pactada con el usuario. Es el trabajo desplazable. */
    REQUERIMIENTO
}
