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
 *
 * <p><strong>Cada cambio trae su propio motivo, y ese es el punto.</strong> El motivo que se guarda en
 * el historial es el que se dio <em>en ese cambio</em>, no el vigente: si solo viviera en el acuerdo
 * actual, corregirlo reescribiria el pasado y esta lista afirmaria que siempre se dijo lo que se dice
 * hoy. Con el motivo por fila, cada entrada contesta las cinco preguntas de la trazabilidad por si
 * sola —que fecha habia, que fecha se acordo, quien, cuando y por que—, y una fila cuya fecha anterior
 * es igual a la nueva se lee por lo que es: un cambio de motivo.
 */
public record RenegotiationHistoryResponse(String workItemId, List<ChangeView> changes) {

    public record ChangeView(
            LocalDate previousDate,
            LocalDate newDate,
            String agreedReason,
            String changedBy,
            Instant changedAt) {

        public static ChangeView of(RenegotiationChange change) {
            return new ChangeView(
                    change.previousDate(),
                    change.newDate(),
                    change.agreedReason(),
                    change.changedBy(),
                    change.changedAt());
        }
    }
}
