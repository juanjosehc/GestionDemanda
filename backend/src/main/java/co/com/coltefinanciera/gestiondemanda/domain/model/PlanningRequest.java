package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.util.List;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;

/**
 * Entrada del motor: a quien se le planifica, con que trabajo y bajo que reglas.
 *
 * <p>Las listas se copian al construir, de modo que el resultado no dependa de lo que el llamante
 * haga despues con sus colecciones.
 */
public record PlanningRequest(
        Developer developer,
        List<Incident> incidents,
        List<Requirement> requirements,
        PlanningRules rules) {

    public PlanningRequest {
        Objects.requireNonNull(developer, "developer es obligatorio");
        incidents = incidents == null ? List.of() : List.copyOf(incidents);
        requirements = requirements == null ? List.of() : List.copyOf(requirements);
        Objects.requireNonNull(rules, "rules es obligatorio");
    }
}
