package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;

/**
 * Estado de la integracion con GLPI. Es la representacion que consume el frontend.
 *
 * <p>Se retorna siempre con HTTP 200: es un reporte de estado, no un fallo del endpoint.
 * El campo {@code detail} explica en lenguaje humano que fallo cuando algo no esta operativo.
 */
public record GlpiHealthResponse(
        boolean connected,
        boolean authenticated,
        String baseUrl,
        Instant checkedAt,
        String detail) {
}
