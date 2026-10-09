package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * Ciclo de vida de un requerimiento.
 *
 * <p>{@link #PENDIENTE_DE_RENEGOCIACION} es el estado al que el motor lleva un requerimiento
 * cuando un incidente le quita su franja: la fecha pactada con el usuario dejo de ser alcanzable
 * y hay que volver a acordarla. No es un estado de fallo, es una senal para el responsable.
 */
public enum RequirementStatus {

    PLANIFICADO,
    EN_EJECUCION,
    PENDIENTE_DE_RENEGOCIACION,
    FINALIZADO
}
