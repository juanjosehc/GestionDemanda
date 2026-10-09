package co.com.coltefinanciera.gestiondemanda.exception;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.context.request.WebRequest;

import lombok.extern.slf4j.Slf4j;

import co.com.coltefinanciera.gestiondemanda.dto.ApiError;

/** Manejo global de excepciones: todo error sale con el mismo contrato {@link ApiError}. */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(GlpiConnectionException.class)
    public ResponseEntity<ApiError> handleGlpiConnection(GlpiConnectionException ex, WebRequest request) {
        log.warn("Fallo de integracion con GLPI: {}", ex.getMessage());
        return build(HttpStatus.SERVICE_UNAVAILABLE, "GLPI_UNAVAILABLE", ex.getMessage(), request);
    }

    /**
     * GLPI rechazo las credenciales.
     *
     * <p>Va antes que {@link GlpiConnectionException} en la jerarquia y por eso se declara aparte: el
     * codigo {@code 502} dice que el fallo no es de quien llama —la peticion estaba bien— sino de la
     * configuracion de la integracion, que es exactamente donde hay que mirar.
     */
    @ExceptionHandler(GlpiAuthenticationException.class)
    public ResponseEntity<ApiError> handleGlpiAuthentication(
            GlpiAuthenticationException ex, WebRequest request) {
        log.error("GLPI rechazo las credenciales: {}", ex.getMessage());
        return build(HttpStatus.BAD_GATEWAY, "GLPI_AUTHENTICATION_FAILED", ex.getMessage(), request);
    }

    /**
     * GLPI respondio algo que no se puede traducir al dominio.
     *
     * <p>Se separa del {@code 503} de disponibilidad porque son dos averias distintas: una se arregla
     * en la red o en el servicio, y esta se arregla en el contrato. Quien recibe el error necesita
     * saber cual de las dos es antes de abrir un ticket.
     */
    @ExceptionHandler(GlpiInvalidDataException.class)
    public ResponseEntity<ApiError> handleGlpiInvalidData(
            GlpiInvalidDataException ex, WebRequest request) {
        log.error("GLPI respondio datos que no se pueden traducir: {}", ex.getMessage());
        return build(HttpStatus.BAD_GATEWAY, "GLPI_INVALID_DATA", ex.getMessage(), request);
    }

    @ExceptionHandler(PlanNotFoundException.class)
    public ResponseEntity<ApiError> handlePlanNotFound(PlanNotFoundException ex, WebRequest request) {
        log.warn("Plan inexistente: {}", ex.getMessage());
        return build(HttpStatus.NOT_FOUND, "PLAN_NOT_FOUND", ex.getMessage(), request);
    }

    /**
     * El desarrollador pedido no existe en GLPI.
     *
     * <p>Es un {@code 404} y no un fallo de integracion: la peticion estaba bien formada, GLPI
     * respondio bien, y lo que falta es el usuario. Un {@code 503} mandaria a revisar la conexion
     * cuando el problema es el identificador.
     */
    @ExceptionHandler(GlpiDeveloperNotFoundException.class)
    public ResponseEntity<ApiError> handleDeveloperNotFound(
            GlpiDeveloperNotFoundException ex, WebRequest request) {
        log.warn("Desarrollador inexistente en GLPI: {}", ex.getMessage());
        return build(HttpStatus.NOT_FOUND, "DEVELOPER_NOT_FOUND", ex.getMessage(), request);
    }

    @ExceptionHandler(PlanningMetadataNotFoundException.class)
    public ResponseEntity<ApiError> handlePlanningMetadataNotFound(
            PlanningMetadataNotFoundException ex, WebRequest request) {
        log.warn("Planificacion inexistente: {}", ex.getMessage());
        return build(HttpStatus.NOT_FOUND, "PLANNING_METADATA_NOT_FOUND", ex.getMessage(), request);
    }

    /**
     * Ya hay planificacion declarada para ese elemento de trabajo.
     *
     * <p>Es un {@code 409} y no un {@code 400}: la peticion esta bien formada y el servidor la
     * entiende; lo que ocurre es que choca con el estado actual del recurso. Quien lo recibe sabe
     * que su camino no es corregir el cuerpo sino ir a {@code PUT}, y el mensaje se lo dice.
     */
    @ExceptionHandler(PlanningMetadataAlreadyExistsException.class)
    public ResponseEntity<ApiError> handlePlanningMetadataAlreadyExists(
            PlanningMetadataAlreadyExistsException ex, WebRequest request) {
        log.warn("Planificacion ya declarada: {}", ex.getMessage());
        return build(HttpStatus.CONFLICT, "PLANNING_METADATA_ALREADY_EXISTS", ex.getMessage(), request);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex, WebRequest request) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getField() + ": " + error.getDefaultMessage())
                .reduce((a, b) -> a + "; " + b)
                .orElse("Solicitud invalida");

        return build(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message, request);
    }

    /**
     * Un parametro de camino que no se puede convertir al tipo declarado.
     *
     * <p>Aparece con {@code GET /api/planning/{planId}}: si el identificador no es un UUID, el error
     * es de quien lo envia. Sin este manejador caeria en el generico y responderia 500, que dice
     * justo lo contrario: que el fallo es del servidor.
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiError> handleTypeMismatch(
            MethodArgumentTypeMismatchException ex, WebRequest request) {

        String message = "El parametro " + ex.getName() + " no tiene un formato valido";
        log.warn("Parametro invalido: {}", message);
        return build(HttpStatus.BAD_REQUEST, "INVALID_PARAMETER", message, request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex, WebRequest request) {
        log.error("Error no controlado", ex);
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                "Ocurrio un error inesperado", request);
    }

    private static ResponseEntity<ApiError> build(
            HttpStatus status, String error, String message, WebRequest request) {

        ApiError body = ApiError.of(
                status.value(),
                error,
                message,
                request.getDescription(false).replace("uri=", ""));

        return ResponseEntity.status(status).body(body);
    }
}
