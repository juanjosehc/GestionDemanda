package co.com.coltefinanciera.gestiondemanda.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Una modificacion de la planificacion ya declarada de un elemento de trabajo.
 *
 * <p><strong>Reemplaza el recurso, no lo parchea.</strong> Un cuerpo que solo quiere cambiar la
 * fecha compromiso <em>tiene que reenviar</em> la estimacion; si no la manda, la esta retirando. No
 * es un descuido del diseño: distinguir «no vino» de «vino nulo» exigiria envolver cada campo en un
 * tipo opcional, y para dos campos no compensa. La consecuencia practica es que modificar un valor
 * se hace leyendo antes el estado —un GET y luego un PUT—, y eso queda dicho aqui para que nadie lo
 * descubra borrando una estimacion sin querer.
 *
 * <p>Un nulo <strong>siempre</strong> significa borrado, y es una operacion legitima: el negocio
 * decidio que tanto la estimacion como el compromiso pueden dejar de existir. El borrado no toca el
 * historial, que registra el paso a nulo con su autor y su fecha.
 *
 * <p>A diferencia del POST, este cuerpo puede dejar los dos valores en nulo. Es deliberado: la
 * exigencia de declarar algo protege el nacimiento del recurso, no su evolucion.
 */
public record PlanningMetadataUpdateRequest(
        @DecimalMin("0.01") @DecimalMax("999999.9999") BigDecimal estimatedHours,
        LocalDate committedDate,
        @NotBlank @Size(max = 64) String changedBy) {
}
