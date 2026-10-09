package co.com.coltefinanciera.gestiondemanda.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;

/**
 * La planificacion declarada de un elemento de trabajo, tal como esta hoy.
 *
 * <p><strong>Un cuerpo con los dos valores en nulo es un 200, no un 404.</strong> El recurso existe
 * —alguien lo declaro y su historia lo prueba— aunque ahora mismo no afirme nada. Confundir «existe
 * y esta vacio» con «no existe» borraria de un plumazo la trazabilidad de haberlo tenido.
 *
 * <p>{@code estimatedBy} y {@code committedBy} son el autor del ultimo cambio de ese campo, y
 * sobreviven al valor: una estimacion retirada conserva quien la retiro. {@code estimatedAt} se lee
 * como <em>cuando se fijo o se retiro</em>, no como «cuando hay estimacion».
 *
 * <p><strong>{@code commitmentOverdue} es un derivado, no un dato guardado.</strong> Se calcula al
 * responder con el mismo reloj que fecha todo lo demas, para que no pueda quedar desfasado respecto
 * al compromiso que describe. Un compromiso de hoy no esta vencido; uno de ayer si.
 */
public record PlanningMetadataResponse(
        String workItemId,
        BigDecimal estimatedHours,
        LocalDate committedDate,
        String estimatedBy,
        String committedBy,
        Instant estimatedAt,
        Instant committedAt,
        InputSource source,
        boolean commitmentOverdue) {

    public static PlanningMetadataResponse of(PlanningMetadata metadata, LocalDate today) {
        return new PlanningMetadataResponse(
                metadata.workItemId(),
                metadata.estimatedHours(),
                metadata.committedDate(),
                metadata.estimatedBy(),
                metadata.committedBy(),
                metadata.estimatedAt(),
                metadata.committedAt(),
                metadata.source(),
                metadata.commitmentOverdue(today));
    }
}
