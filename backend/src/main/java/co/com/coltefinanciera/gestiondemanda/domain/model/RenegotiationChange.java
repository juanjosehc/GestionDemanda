package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;

/**
 * Una renegociacion, tal como quedo registrada.
 *
 * <p>Es un hecho ocurrido, no un estado: se escribe una vez y no se modifica. Responde las cinco
 * preguntas que la trazabilidad del acuerdo tiene que poder contestar —quien lo registro, cuando, de
 * que fecha a cual y por que— y por eso es la pieza que hace auditable la renegociacion sin depender
 * de la fila vigente, que solo dice como esta hoy.
 *
 * <p><strong>{@code agreedReason} es el motivo del acuerdo y no el del desplazamiento.</strong> Por
 * que se movio el requerimiento lo audita el motor en el {@code RescheduleEvent}; por que se llego a
 * esa fecha lo dice quien la acuerda, y es lo unico de esta fila que no se deduce de ningun dato. Los
 * dos motivos conviven en la lectura consolidada —uno dentro del evento y otro aqui— y nombran cosas
 * distintas: el del evento explica el movimiento, este explica la decision.
 *
 * <p><strong>Admite nulo, y solo por las filas que ya existian.</strong> Las escritas antes de que
 * este campo existiera no tienen motivo, y rellenarlas con un texto cualquiera inventaria una
 * explicacion que nadie dio. La escritura siempre trae uno: lo exigen los dos contratos de entrada.
 *
 * <p><strong>Una fecha anterior igual a la nueva ya no es imposible.</strong> Antes esta fila exigia
 * que las dos fechas difirieran, porque un cambio tenia que cambiar algo. Ahora cambiar el motivo de
 * un acuerdo es un cambio legitimo —una explicacion corregida es una decision nueva—, y esta fila solo
 * conoce el motivo nuevo: no tiene con que compararlo. La regla no se perdio, se mudo a
 * {@link Renegotiation#changesFrom}, que es el unico sitio donde estan los dos motivos y donde puede
 * decidirse si de verdad cambio algo.
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
        String agreedReason,
        String changedBy,
        Instant changedAt) {

    public RenegotiationChange {
        DomainPreconditions.requireText(workItemId, "workItemId");
        Objects.requireNonNull(newDate, "newDate es obligatorio");
        DomainPreconditions.requireText(changedBy, "changedBy");
        Objects.requireNonNull(changedAt, "changedAt es obligatorio");
    }
}
