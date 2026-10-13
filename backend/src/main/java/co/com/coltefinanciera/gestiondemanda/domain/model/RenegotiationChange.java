package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;

/**
 * Una renegociacion, tal como quedo registrada.
 *
 * <p>Es un hecho ocurrido, no un estado: se escribe una vez y no se modifica. Responde las cuatro
 * preguntas que la trazabilidad del acuerdo tiene que poder contestar —quien lo registro, cuando, de
 * que fecha a cual— y por eso es la pieza que hace auditable la renegociacion sin depender de la
 * fila vigente, que solo dice como esta hoy.
 *
 * <p><strong>Las fechas viajan como {@link LocalDate} y no como texto.</strong> El historial de
 * {@code PlanningMetadata} guarda texto porque tiene que servir a una fecha y a un decimal con un
 * solo par de columnas; aqui solo hay fechas, asi que el tipo dice lo que hay y nadie tiene que
 * consultar un campo antes de interpretar el valor.
 *
 * <p><strong>Una fecha anterior nula es el dato mas importante de la tabla:</strong> marca el momento
 * en que no habia acuerdo y alguien lo trajo. Sin esa fila, el primer acuerdo quedaria sin autor en
 * cuanto alguien lo cambiara.
 */
public record RenegotiationChange(
        String workItemId,
        LocalDate previousDate,
        LocalDate newDate,
        String changedBy,
        Instant changedAt) {

    public RenegotiationChange {
        DomainPreconditions.requireText(workItemId, "workItemId");
        Objects.requireNonNull(newDate, "newDate es obligatorio");
        DomainPreconditions.requireText(changedBy, "changedBy");
        Objects.requireNonNull(changedAt, "changedAt es obligatorio");
        if (Objects.equals(previousDate, newDate)) {
            throw new IllegalArgumentException("un cambio tiene que cambiar algo");
        }
    }
}
