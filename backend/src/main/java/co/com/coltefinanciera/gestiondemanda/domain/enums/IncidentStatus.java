package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * Ciclo de vida de un incidente.
 *
 * <p>Solo los incidentes no resueltos compiten por la jornada: uno cerrado ya no consume
 * capacidad y el motor lo ignora.
 */
public enum IncidentStatus {

    ABIERTO,
    EN_ATENCION,
    RESUELTO
}
