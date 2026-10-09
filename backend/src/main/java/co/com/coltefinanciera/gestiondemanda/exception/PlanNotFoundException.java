package co.com.coltefinanciera.gestiondemanda.exception;

import java.util.UUID;

/**
 * El plan solicitado no existe.
 *
 * <p>No es un fallo del servidor: es una peticion sobre algo que no esta. Se separa del resto para
 * que la respuesta sea un 404 con su propio codigo y no un 500 generico, que es lo que saldria si
 * esta excepcion cayera en el manejador de errores no controlados.
 */
public class PlanNotFoundException extends RuntimeException {

    public PlanNotFoundException(UUID planId) {
        super("No existe el plan " + planId);
    }
}
