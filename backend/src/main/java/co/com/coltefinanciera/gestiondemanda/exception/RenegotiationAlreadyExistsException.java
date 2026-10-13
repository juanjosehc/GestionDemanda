package co.com.coltefinanciera.gestiondemanda.exception;

/**
 * Ya hay un acuerdo registrado para ese elemento de trabajo.
 *
 * <p>Es un {@code 409} y no un {@code 400}: la peticion esta bien formada y el servidor la entiende;
 * lo que ocurre es que choca con el estado actual del recurso. Quien lo recibe sabe que su camino no
 * es corregir el cuerpo sino ir a {@code PUT}, y el mensaje se lo dice.
 */
public class RenegotiationAlreadyExistsException extends RuntimeException {

    public RenegotiationAlreadyExistsException(String workItemId) {
        super("Ya hay renegociacion registrada para el elemento de trabajo " + workItemId
                + "; para modificarla se usa PUT");
    }
}
