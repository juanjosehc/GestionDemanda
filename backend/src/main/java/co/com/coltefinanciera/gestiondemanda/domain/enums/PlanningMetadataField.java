package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * Los datos de planificacion que declara el negocio y que GLPI no tiene.
 *
 * <p>Existe para que el historial de cambios pueda decir <em>que</em> cambio sin necesitar una tabla
 * por campo. Son dos y solo dos porque son los dos que la investigacion de GLPI no encontro: el
 * esfuerzo estimado —{@code actiontime} vale cero y ninguna de las opciones de busqueda declara una
 * estimacion— y la fecha compromiso —alli son dos, se contradicen, y cual manda es del negocio—.
 *
 * <p>Se persiste por nombre y no por posicion. Un ordinal ataria la auditoria ya escrita al orden de
 * declaracion, y añadir un tercer campo la reinterpretaria entera.
 */
public enum PlanningMetadataField {

    /** El esfuerzo estimado, en horas. Lo declara el desarrollador asignado. */
    ESTIMATED_HOURS,

    /** La fecha compromiso. La declara el gestor de demanda. */
    COMMITTED_DATE
}
