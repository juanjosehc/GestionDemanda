package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentStatus;

/**
 * Incidente reportado.
 *
 * <p>Es prioridad maxima: consume capacidad antes que cualquier requerimiento. Cuanto reclama y
 * como lo reclama lo decide su severidad a traves de la politica configurada; sin severidad, el
 * motor aplica el comportamiento historico.
 *
 * @param estimatedHours dedicacion estimada, en horas. Es lo que compite por la jornada.
 * @param reportedAt     momento del reporte. Determina el dia en que empieza a consumir.
 * @param severity       severidad declarada. Es {@code null} en los incidentes anteriores a la
 *                       priorizacion por severidad; el motor los planifica con el umbral de
 *                       dedicacion y los audita con la regla antigua. Es la migracion controlada:
 *                       mientras GLPI no envie prioridad, ambos caminos conviven y los datos viejos
 *                       siguen produciendo el mismo plan.
 */
public record Incident(
        String id,
        String title,
        BigDecimal estimatedHours,
        Instant reportedAt,
        IncidentStatus status,
        IncidentSeverity severity) {

    public Incident {
        DomainPreconditions.requireText(id, "id");
        DomainPreconditions.requirePositive(estimatedHours, "estimatedHours");
        Objects.requireNonNull(reportedAt, "reportedAt es obligatorio");
        Objects.requireNonNull(status, "status es obligatorio");
    }

    /** Constructor del modelo previo a la severidad: deja el incidente como dato legado. */
    public Incident(
            String id, String title, BigDecimal estimatedHours, Instant reportedAt, IncidentStatus status) {
        this(id, title, estimatedHours, reportedAt, status, null);
    }

    /** Un incidente ya resuelto dejo de competir por la jornada. */
    public boolean consumesCapacity() {
        return status != IncidentStatus.RESUELTO;
    }

    /** Construye un incidente recien reportado sin severidad declarada. */
    public static Incident open(String id, String title, BigDecimal estimatedHours, Instant reportedAt) {
        return new Incident(id, title, estimatedHours, reportedAt, IncidentStatus.ABIERTO, null);
    }

    /** Construye un incidente recien reportado con severidad, que es lo que enviara GLPI. */
    public static Incident open(
            String id, String title, BigDecimal estimatedHours, Instant reportedAt, IncidentSeverity severity) {
        return new Incident(id, title, estimatedHours, reportedAt, IncidentStatus.ABIERTO, severity);
    }
}
