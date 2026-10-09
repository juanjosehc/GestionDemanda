package co.com.coltefinanciera.gestiondemanda.domain.model;

/**
 * Desarrollador al que se le planifica el trabajo.
 *
 * <p>Solo identidad. Su capacidad no vive aqui sino en {@code PlanningRules}: la jornada es una
 * regla de negocio configurable, no un atributo de la persona.
 */
public record Developer(String id, String name) {

    public Developer {
        DomainPreconditions.requireText(id, "id");
        DomainPreconditions.requireText(name, "name");
    }
}
