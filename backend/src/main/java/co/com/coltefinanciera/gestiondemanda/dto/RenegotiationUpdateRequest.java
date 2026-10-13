package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.LocalDate;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Lo que se envia para reemplazar la fecha acordada de un requerimiento.
 *
 * <p><strong>Reemplaza, no parchea</strong>, igual que la declaracion: lo que venga es la fecha
 * vigente. Aqui el cuerpo tiene un solo valor y es obligatorio, asi que no hay medio cuerpo que
 * enviar ni informacion que se pueda perder por omision —el motivo por el que el formulario de
 * declaracion tiene que mandar los dos campos siempre no llega a aplicar—.
 *
 * <p>El identificador va en el camino y no en el cuerpo: es el recurso que se reemplaza, y repetirlo
 * dentro permitiria que los dos no coincidieran.
 */
public record RenegotiationUpdateRequest(
        @NotNull LocalDate agreedDate,
        @NotBlank @Size(max = 64) String agreedBy) {
}
