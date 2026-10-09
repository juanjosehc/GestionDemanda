package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.util.List;

import co.com.coltefinanciera.gestiondemanda.domain.enums.PlanningMetadataField;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadataChange;

/**
 * Todo lo que le ha pasado a la planificacion de un elemento de trabajo, en orden.
 *
 * <p>Es la mitad que hace comprobable la trazabilidad: sin poder leer el historial, existiria y
 * nadie podria verificar que esta completo.
 *
 * <p><strong>Los valores viajan como texto, y {@code field} dice como leerlos.</strong> Una fecha se
 * lee en ISO y unas horas en decimal, y quien consume esto tiene que mirar el campo antes de
 * interpretar el valor. Es el precio de que un solo historial sirva a los dos, y es preferible a
 * devolver dos formas distintas del mismo hecho.
 *
 * <p><strong>Un nulo es informacion, no una ausencia.</strong> En {@code previousValue} marca el
 * momento en que el valor no existia y alguien lo puso; en {@code newValue} marca que se retiro.
 * Una lista vacia <strong>no ocurre</strong>: mientras haya fila hay historia, porque la primera
 * declaracion tambien se registra.
 */
public record PlanningMetadataHistoryResponse(String workItemId, List<ChangeView> changes) {

    public record ChangeView(
            PlanningMetadataField field,
            String previousValue,
            String newValue,
            String changedBy,
            Instant changedAt) {

        public static ChangeView of(PlanningMetadataChange change) {
            return new ChangeView(
                    change.field(),
                    change.previousValue(),
                    change.newValue(),
                    change.changedBy(),
                    change.changedAt());
        }
    }
}
