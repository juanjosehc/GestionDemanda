package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.time.Instant;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.PlanningMetadataField;

/**
 * Una modificacion de la planificacion de un elemento de trabajo.
 *
 * <p>Es un hecho ocurrido, no un estado: se escribe una vez y no se modifica. Responde las cuatro
 * preguntas que la trazabilidad tiene que poder contestar —quien cambio, cuando, de que valor a
 * cual— y las responde para los dos campos, porque el tipo del valor lo dice {@link #field}.
 *
 * <p><strong>Los valores viajan como texto.</strong> Un solo par de columnas sirve asi a una fecha y
 * a un decimal, que es lo que permite que el historial sea uno y no dos. El texto es canonico —ISO
 * para la fecha, decimal normalizado a escala 4 para las horas— de modo que dos filas que dicen lo
 * mismo se leen igual. Quien interprete {@code previousValue} mira {@link #field} primero.
 *
 * <p><strong>Un nulo significa "no habia valor", y es un dato, no una ausencia.</strong> En
 * {@code previousValue} marca la declaracion inicial —el valor no existia antes—; en
 * {@code newValue} marca el borrado. Los dos son modificaciones legitimas y quedan registradas con
 * su autor y su fecha, que es justo lo que hace falta para que retirar una estimacion no borre su
 * historia.
 */
public record PlanningMetadataChange(
        String workItemId,
        PlanningMetadataField field,
        String previousValue,
        String newValue,
        String changedBy,
        Instant changedAt) {

    public PlanningMetadataChange {
        DomainPreconditions.requireText(workItemId, "workItemId");
        Objects.requireNonNull(field, "field es obligatorio");
        DomainPreconditions.requireText(changedBy, "changedBy");
        Objects.requireNonNull(changedAt, "changedAt es obligatorio");
        if (Objects.equals(previousValue, newValue)) {
            throw new IllegalArgumentException("un cambio tiene que cambiar algo");
        }
    }
}
