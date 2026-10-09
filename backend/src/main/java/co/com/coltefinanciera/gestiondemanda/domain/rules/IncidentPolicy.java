package co.com.coltefinanciera.gestiondemanda.domain.rules;

import java.math.BigDecimal;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.DisplacementPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;

/**
 * Acuerdo de nivel operativo de una severidad: que se promete y como se planifica.
 *
 * <p>Es la pieza que faltaba entre la severidad y el motor. Antes, la unica palanca era un umbral
 * de horas unico para todos los incidentes; ahora cada severidad declara su objetivo de
 * adquisicion, su objetivo de resolucion y su comportamiento de planificacion.
 *
 * <p>Los objetivos son <strong>metas que se reportan</strong>, no volumen de trabajo. El motor
 * planifica con la dedicacion estimada del incidente ({@code Incident.estimatedHours}) y usa esta
 * politica solo para decidir como compite por la jornada. Mezclar ambas cosas haria que el plan
 * fuese incorrecto cada vez que una estimacion se aparte de la meta, que es lo normal.
 *
 * <p>Los valores por defecto son los acordados con el negocio y viven aqui, no en el motor, del
 * mismo modo que {@link PlanningRules#defaults()}. La capa de configuracion los sobrescribe desde
 * {@code planning.incident-policies.*}, de modo que ajustar la OLA no exige recompilar.
 *
 * @param targetOwnershipMinutes minutos objetivo para adueñarse del incidente.
 * @param targetResolutionHours  horas objetivo para resolverlo.
 * @param displacementPolicy     como compite por la jornada.
 */
public record IncidentPolicy(
        IncidentSeverity severity,
        int targetOwnershipMinutes,
        BigDecimal targetResolutionHours,
        DisplacementPolicy displacementPolicy) {

    public static final int DEFAULT_TARGET_OWNERSHIP_MINUTES = 15;

    public IncidentPolicy {
        Objects.requireNonNull(severity, "severity es obligatoria");
        Objects.requireNonNull(targetResolutionHours, "targetResolutionHours es obligatorio");
        Objects.requireNonNull(displacementPolicy, "displacementPolicy es obligatoria");
        if (targetOwnershipMinutes < 0) {
            throw new IllegalArgumentException("targetOwnershipMinutes no puede ser negativo");
        }
        if (targetResolutionHours.signum() <= 0) {
            throw new IllegalArgumentException("targetResolutionHours debe ser mayor que cero");
        }
    }

    /**
     * OLA por defecto de una severidad.
     *
     * <p>Adquisicion uniforme de 15 minutos y resolucion de 4, 8 y 12 horas para ALTO, MEDIO y
     * BAJO respectivamente.
     */
    public static IncidentPolicy defaults(IncidentSeverity severity) {
        Objects.requireNonNull(severity, "severity es obligatoria");
        return switch (severity) {
            case ALTO -> new IncidentPolicy(
                    severity, DEFAULT_TARGET_OWNERSHIP_MINUTES, new BigDecimal("4"), DisplacementPolicy.INMEDIATA);
            case MEDIO -> new IncidentPolicy(
                    severity, DEFAULT_TARGET_OWNERSHIP_MINUTES, new BigDecimal("8"), DisplacementPolicy.POR_CAPACIDAD);
            case BAJO -> new IncidentPolicy(
                    severity, DEFAULT_TARGET_OWNERSHIP_MINUTES, new BigDecimal("12"), DisplacementPolicy.POR_SATURACION);
        };
    }
}
