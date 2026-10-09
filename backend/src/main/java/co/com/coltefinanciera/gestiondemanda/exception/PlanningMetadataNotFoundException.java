package co.com.coltefinanciera.gestiondemanda.exception;

public class PlanningMetadataNotFoundException extends RuntimeException {

    public PlanningMetadataNotFoundException(String workItemId) {
        super("No hay planificacion declarada para el elemento de trabajo " + workItemId);
    }
}
