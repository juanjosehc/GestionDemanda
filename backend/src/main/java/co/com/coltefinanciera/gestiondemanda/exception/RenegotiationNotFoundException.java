package co.com.coltefinanciera.gestiondemanda.exception;

/**
 * No hay acuerdo registrado para ese elemento de trabajo.
 *
 * <p>No significa que el requerimiento no este desplazado: significa que nadie ha registrado aun la
 * fecha nueva, que es un estado legitimo y no un error del que llama. Se responde {@code 404} porque
 * el recurso que se pide —el acuerdo— no existe todavia.
 */
public class RenegotiationNotFoundException extends RuntimeException {

    public RenegotiationNotFoundException(String workItemId) {
        super("No hay renegociacion registrada para el elemento de trabajo " + workItemId);
    }
}
