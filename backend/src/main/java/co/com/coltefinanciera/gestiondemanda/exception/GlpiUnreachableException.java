package co.com.coltefinanciera.gestiondemanda.exception;

/**
 * GLPI no respondio: DNS, conexion rechazada, timeout. El servidor no fue alcanzado.
 *
 * <p>Se separa de {@link GlpiConnectionException} porque el endpoint de salud distingue
 * "conectado" de "autenticado": si el servidor responde con un error HTTP hay conectividad
 * aunque las credenciales fallen.
 */
public class GlpiUnreachableException extends GlpiConnectionException {

    public GlpiUnreachableException(String message, Throwable cause) {
        super(message, cause);
    }
}
