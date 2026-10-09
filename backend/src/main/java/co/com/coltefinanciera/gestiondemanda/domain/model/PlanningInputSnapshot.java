package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.util.List;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;

/**
 * Fotografia de la entrada del motor: a quien se le planifico y con que trabajo.
 *
 * <p>Es la mitad que faltaba. El contexto dice con que se decidio; esto dice con que datos. Los dos
 * juntos, mas la version del motor, sostienen la unica afirmacion que un auditor necesita poder
 * comprobar: <em>con estas entradas, este contexto y esta version se obtuvo este resultado</em>.
 *
 * <p>Se guarda lo que el motor lee, y nada mas. De cada incidente: {@code id}, {@code estimatedHours},
 * {@code reportedAt}, {@code severity} y {@code status}. De cada requerimiento: {@code id},
 * {@code estimatedHours}, {@code plannedDate} y {@code status}. Del desarrollador, su {@code id}.
 * Quedan fuera los titulos y el nombre del desarrollador porque el motor no los consulta en ningun
 * punto: un texto que no interviene en el calculo no se copia, y copiarlo daria a la foto una
 * apariencia de completitud que no aporta nada a la reproduccion.
 *
 * <p>Se guardan <em>todos</em> los incidentes y requerimientos recibidos, incluidos los que el motor
 * descarta por estar resueltos o finalizados. La foto es de lo que se recibio, no de lo que se uso:
 * un incidente resuelto que no influyo en el calculo sigue siendo parte de la entrada, y saber que
 * estaba ahi es lo que permite distinguir "no influyo" de "no llego".
 *
 * <p>Desde la integracion con GLPI lleva ademas la {@link InputProvenance}: de donde salieron estos
 * datos. La foto dice que entro; la procedencia dice quien lo puso. Las dos son parte de la misma
 * afirmacion auditable y por eso viven en el mismo registro.
 */
public record PlanningInputSnapshot(
        String developerId,
        List<Incident> incidents,
        List<Requirement> requirements,
        InputProvenance provenance) {

    public PlanningInputSnapshot {
        DomainPreconditions.requireText(developerId, "developerId");
        incidents = incidents == null ? List.of() : List.copyOf(incidents);
        requirements = requirements == null ? List.of() : List.copyOf(requirements);
        provenance = provenance == null ? InputProvenance.HTTP : provenance;
    }

    /**
     * La foto de una entrada escrita a mano por la API.
     *
     * <p>Es el constructor de siempre y sigue siendo el de la via HTTP: los llamadores anteriores a
     * la integracion con GLPI no cambian, y su procedencia queda declarada como lo que es.
     */
    public PlanningInputSnapshot(
            String developerId,
            List<Incident> incidents,
            List<Requirement> requirements) {
        this(developerId, incidents, requirements, InputProvenance.HTTP);
    }

    /** La foto de una peticion, tal como entro al motor. */
    public static PlanningInputSnapshot of(PlanningRequest request) {
        return of(request, InputProvenance.HTTP);
    }

    /** La foto de una peticion, con la procedencia de sus datos. */
    public static PlanningInputSnapshot of(PlanningRequest request, InputProvenance provenance) {
        Objects.requireNonNull(request, "request es obligatorio");
        return new PlanningInputSnapshot(
                request.developer().id(), request.incidents(), request.requirements(), provenance);
    }

    /**
     * Rearma la peticion que el motor recibio, para volver a correrla.
     *
     * <p>El nombre del desarrollador no viaja: el motor solo lee su {@code id} y la respuesta HTTP
     * tampoco lo devuelve, asi que no se guarda y aqui se rellena con el propio id. Es una eleccion
     * consciente y no un descuido; el dia que el nombre entre en el calculo, tendra que guardarse.
     */
    public PlanningRequest toRequest(PlanningRules rules) {
        return new PlanningRequest(
                new Developer(developerId, developerId), incidents, requirements, rules);
    }
}
