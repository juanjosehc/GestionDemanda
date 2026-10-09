package co.com.coltefinanciera.gestiondemanda.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Respuesta de {@code GET /initSession} de GLPI.
 *
 * <p>{@code ignoreUnknown} es deliberado: GLPI versiona su API y agrega campos con frecuencia.
 * Este DTO es de la capa de integracion y no debe filtrarse fuera de {@code client}/{@code service}.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GlpiSessionResponse(
        @JsonProperty("session_token") String sessionToken) {
}
