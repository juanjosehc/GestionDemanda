package co.com.coltefinanciera.gestiondemanda.exception;

/**
 * GLPI rechazo las credenciales.
 *
 * <p>Hereda de {@link GlpiConnectionException} porque para quien no distingue —cualquier manejador
 * generico de fallos de integracion— es lo mismo: no se pudo hablar con GLPI. Pero se separa para
 * poder responder distinto y, sobre todo, para poder registrar distinto: un fallo de autenticacion
 * casi siempre es un token caducado o mal copiado, y verlo aparte en los logs y en la respuesta
 * ahorra la primera hora de diagnostico.
 *
 * <p>Se lanza con {@code 401} y {@code 403}, que son los dos codigos con que GLPI expresa "no te
 * conozco" y "te conozco pero no puedes".
 */
public class GlpiAuthenticationException extends GlpiConnectionException {

    public GlpiAuthenticationException(String message) {
        super(message);
    }

    public GlpiAuthenticationException(String message, Throwable cause) {
        super(message, cause);
    }
}
