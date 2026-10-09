package co.com.coltefinanciera.gestiondemanda.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;

/**
 * Salida de {@code GET /api/planning/{planId}/input}: los datos exactos que recibio el motor.
 *
 * <p>Responde la pregunta que el resultado no responde. {@code GET /{planId}} dice que salio,
 * {@code GET /{planId}/context} dice con que reglas se decidio, y esto dice con que datos se entro.
 * Los tres juntos, mas la version del motor del contexto, son la afirmacion completa: <em>con estas
 * entradas, este contexto y esta version se obtuvo este resultado</em>.
 *
 * <p><strong>Sin titulos, y es deliberado.</strong> La peticion acepta {@code title} y esta respuesta
 * no lo devuelve, porque {@code PlanningEngine} nunca lo lee: no interviene en el calculo, y copiarlo
 * solo añadiria a la evidencia un texto que no explica nada de lo que salio. La asimetria se ve desde
 * fuera a proposito, para que nadie la tome por un olvido. Tampoco viaja el nombre del desarrollador
 * —solo su {@code id}— por el mismo motivo.
 *
 * <p>Se devuelven <em>todos</em> los elementos recibidos, incluidos los que el motor descarto por
 * estar resueltos o finalizados: la foto es de lo que entro, no de lo que se uso.
 *
 * <p>Desde la integracion con GLPI lleva ademas la procedencia. Es la mitad que faltaba para leer
 * una foto de la que no se sabe el origen: {@code source} dice quien la puso, {@code extractedAt}
 * cuando se extrajo y {@code adapterVersion} con que traduccion. Los dos ultimos solo viajan cuando
 * {@code source} es {@code GLPI}; en una entrada HTTP son nulos, porque no hubo extraccion ni
 * traduccion que fechar. Los planes anteriores a esta fase responden {@code HTTP}, que es lo que
 * fueron.
 */
public record PlanningInputResponse(
        UUID planId,
        String developerId,
        List<IncidentView> incidents,
        List<RequirementView> requirements,
        InputSource source,
        Instant extractedAt,
        String adapterVersion) {

    /**
     * Un incidente tal como entro al motor.
     *
     * @param severity severidad declarada, o {@code null} en los incidentes anteriores a la
     *                 priorizacion por severidad. El nulo significa lo que dice y no se disfraza.
     */
    public record IncidentView(
            String id,
            BigDecimal estimatedHours,
            Instant reportedAt,
            IncidentStatus status,
            IncidentSeverity severity) {
    }

    /** Un requerimiento tal como entro al motor. */
    public record RequirementView(
            String id,
            BigDecimal estimatedHours,
            LocalDate plannedDate,
            RequirementStatus status) {
    }
}
