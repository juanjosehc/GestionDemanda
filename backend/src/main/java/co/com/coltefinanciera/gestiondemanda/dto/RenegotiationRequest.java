package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.LocalDate;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Lo que se envia para registrar la fecha acordada tras un desplazamiento.
 *
 * <p><strong>No lleva el incidente ni la fecha original.</strong> Los dos son hechos que el plan ya
 * audito y que la respuesta devuelve: pedirlos aqui dejaria que quien registra el acuerdo dijera cual
 * fue el incidente, y bastaria equivocarse para que la trazabilidad afirmara dos cosas distintas del
 * mismo desplazamiento. El acuerdo aporta lo unico que nadie mas puede saber —a que fecha se llego y
 * quien lo acordó—.
 *
 * <p><strong>{@code agreedAt} tampoco viaja.</strong> El sello lo pone el servidor desde el bean
 * {@code Clock}, como en toda la aplicacion: una fecha de registro que elige quien llama no es un
 * sello, es una afirmacion.
 *
 * <p><strong>La fecha acordada no se valida contra hoy.</strong> Aceptar una fecha pasada no es un
 * descuido: si acordar una fecha ya vencida es o no legitimo es una decision del negocio que todavia
 * no se ha tomado, y escribirla aqui la inventaria. Queda anotado como riesgo.
 *
 * <p><strong>{@code agreedReason} es obligatorio, y es el motivo del acuerdo, no el del
 * desplazamiento.</strong> Por que se movio el requerimiento ya esta auditado en el plan y este
 * contrato no lo pide —ni lo deja escribir—: lo que se pregunta aqui es por que se llego a esa fecha,
 * que es lo unico que nadie puede deducir de los datos. Es obligatorio porque un acuerdo sin motivo no
 * se puede auditar: quien lo lea manana sabra que se decidio y no podra saber por que, que es
 * exactamente el hueco que este campo cierra. Un motivo en blanco no es un motivo, y por eso se
 * rechaza en vez de guardarse.
 */
public record RenegotiationRequest(
        @NotBlank @Size(max = 64) String workItemId,
        @NotNull LocalDate agreedDate,
        @NotBlank @Size(max = 64) String agreedBy,
        @NotBlank @Size(max = 500) String agreedReason) {
}
