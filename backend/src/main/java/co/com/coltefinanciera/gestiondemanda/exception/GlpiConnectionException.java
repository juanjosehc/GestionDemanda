package co.com.coltefinanciera.gestiondemanda.exception;

/**
 * Falla controlada en la comunicacion con GLPI (red, HTTP, o respuesta invalida).
 *
 * <p>Es la unica excepcion que la capa de integracion proyecta hacia afuera: el resto de la
 * aplicacion no necesita conocer tipos de Reactor ni de Spring WebClient.
 */
public class GlpiConnectionException extends RuntimeException {

    public GlpiConnectionException(String message) {
        super(message);
    }

    public GlpiConnectionException(String message, Throwable cause) {
        super(message, cause);
    }
}
