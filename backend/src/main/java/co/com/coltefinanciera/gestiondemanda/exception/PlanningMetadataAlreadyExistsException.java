package co.com.coltefinanciera.gestiondemanda.exception;

public class PlanningMetadataAlreadyExistsException extends RuntimeException {

    public PlanningMetadataAlreadyExistsException(String workItemId) {
        super("Ya hay planificacion declarada para el elemento de trabajo " + workItemId
                + "; para modificarla se usa PUT");
    }
}
