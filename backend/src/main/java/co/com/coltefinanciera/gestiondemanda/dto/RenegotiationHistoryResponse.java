package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import co.com.coltefinanciera.gestiondemanda.domain.model.RenegotiationChange;

/**
 * Todo lo que le ha pasado al acuerdo de un requerimiento, en orden.
 *
 * <p>Es la mitad que hace comprobable la trazabilidad: sin poder leer el historial, la renegociacion
 * existiria y nadie podria verificar que esta completa ni quien la movio la ultima vez.
 *
 * <p><strong>Una fecha anterior nula es informacion, no una ausencia.</strong> Marca el primer
 * acuerdo, el momento en que no habia fecha y alguien la trajo. Una lista vacia <strong>no
 * ocurre</strong>: mientras haya fila hay historia, porque el primer acuerdo tambien se registra.
 *
 * <p><strong>Las fechas viajan como fecha.</strong> El historial de la declaracion manda texto porque
 * sirve a dos tipos de valor; aqui solo hay fechas y el tipo las dice.
 */
public record RenegotiationHistoryResponse(String workItemId, List<ChangeView> changes) {

    public record ChangeView(
            LocalDate previousDate,
            LocalDate newDate,
            String changedBy,
            Instant changedAt) {

        public static ChangeView of(RenegotiationChange change) {
            return new ChangeView(
                    change.previousDate(),
                    change.newDate(),
                    change.changedBy(),
                    change.changedAt());
        }
    }
}
