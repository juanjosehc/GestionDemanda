package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;

/** Cuerpo estandar de error de la API. */
public record ApiError(
        Instant timestamp,
        int status,
        String error,
        String message,
        String path) {

    public static ApiError of(int status, String error, String message, String path) {
        return new ApiError(Instant.now(), status, error, message, path);
    }
}
