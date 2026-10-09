package co.com.coltefinanciera.gestiondemanda.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * La primera declaracion de la planificacion de un elemento de trabajo.
 *
 * <p><strong>{@code changedBy} firma la operacion entera</strong>, no cada campo: es quien esta
 * declarando esto ahora mismo, y con ese unico dato quedan atribuidas todas las filas de historial
 * que la peticion produzca. Los autores por campo —{@code estimatedBy}, {@code committedBy}— no se
 * piden en el cuerpo porque con un record no se puede distinguir «no vino» de «vino nulo», y esa
 * ambiguedad dejaria un borrado sin autor. El servidor los deriva: son quien cambio ese campo la
 * ultima vez.
 *
 * <p><strong>Hay que declarar al menos uno de los dos valores.</strong> Un elemento de trabajo sin
 * estimacion y sin fecha compromiso no es un metadata vacio: es la ausencia de metadata, y esa se
 * representa no teniendo fila. Crearlo igualmente seria inventar un recurso que no dice nada.
 *
 * <p>Los limites —{@code 64} caracteres, {@code 999999.9999} horas— son los de las columnas. No
 * estan para guiar al usuario sino para que un valor que no cabe sea un 400 que explica que pasa y
 * no un 409 que miente diciendo que el elemento ya existe: por debajo, una violacion de longitud y
 * una de clave primaria son la misma excepcion.
 */
public record PlanningMetadataRequest(
        @NotBlank @Size(max = 64) String workItemId,
        @DecimalMin("0.01") @DecimalMax("999999.9999") BigDecimal estimatedHours,
        LocalDate committedDate,
        @NotBlank @Size(max = 64) String changedBy) {

    @AssertTrue(message = "hay que declarar al menos la estimacion o la fecha compromiso")
    public boolean isAtLeastOneValueDeclared() {
        return estimatedHours != null || committedDate != null;
    }
}
