package co.com.coltefinanciera.gestiondemanda.domain.repository;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import org.springframework.dao.DataIntegrityViolationException;

import co.com.coltefinanciera.gestiondemanda.domain.enums.DeclaredGap;
import co.com.coltefinanciera.gestiondemanda.domain.model.DeclaredPlanningMetrics;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadataChange;

/**
 * El puerto de la planificacion en memoria, para pruebas.
 *
 * <p>Vive junto al puerto que implementa, como {@code InMemoryRescheduleLedger} y por el mismo
 * motivo: las pruebas del servicio no deben necesitar una base de datos para comprobar reglas de
 * trazabilidad.
 *
 * <p><strong>Cuando el elemento ya existe lanza {@code DataIntegrityViolationException}</strong>,
 * que es exactamente lo que lanza el adaptador de verdad. Un doble que fallara de otra forma
 * probaria una traduccion a {@code 409} que en produccion no llegaria a ocurrir, y la prueba daria
 * por buena una respuesta que nadie recibiria.
 *
 * <p><strong>No reproduce el bloqueo de escritura, y no puede.</strong> El bloqueo existe para
 * resolver una carrera entre peticiones simultaneas, y una prueba de una sola hebra no tiene
 * ninguna que resolver. Que el bloqueo este puesto se comprueba contra la base de datos, no aqui.
 */
public class InMemoryPlanningMetadataRepository implements PlanningMetadataRepository {

    private final Map<String, PlanningMetadata> state = new LinkedHashMap<>();
    private final List<PlanningMetadataChange> history = new ArrayList<>();

    @Override
    public void create(PlanningMetadata metadata, List<PlanningMetadataChange> changes) {
        if (state.containsKey(metadata.workItemId())) {
            throw new DataIntegrityViolationException(
                    "ya hay planificacion declarada para " + metadata.workItemId());
        }
        state.put(metadata.workItemId(), metadata);
        history.addAll(changes);
    }

    @Override
    public Optional<PlanningMetadata> findByWorkItemId(String workItemId) {
        return Optional.ofNullable(state.get(workItemId));
    }

    @Override
    public List<PlanningMetadata> findByWorkItemIdIn(Collection<String> workItemIds) {
        return workItemIds.stream()
                .map(state::get)
                .filter(Objects::nonNull)
                .toList();
    }

    @Override
    public Optional<PlanningMetadata> findByWorkItemIdForUpdate(String workItemId) {
        return findByWorkItemId(workItemId);
    }

    @Override
    public void update(PlanningMetadata metadata, List<PlanningMetadataChange> changes) {
        state.put(metadata.workItemId(), metadata);
        history.addAll(changes);
    }

    @Override
    public List<PlanningMetadataChange> findHistory(String workItemId) {
        return history.stream()
                .filter(change -> change.workItemId().equals(workItemId))
                .toList();
    }

    @Override
    public DeclaredPlanningMetrics declaredMetrics() {
        return new DeclaredPlanningMetrics(
                state.size(),
                state.values().stream().filter(uno -> uno.estimatedHours() == null).count(),
                state.values().stream().filter(uno -> uno.committedDate() == null).count(),
                state.values().stream()
                        .filter(uno -> uno.estimatedHours() == null && uno.committedDate() == null)
                        .count());
    }

    /**
     * Las filas que caen en una carencia, en orden de identificador.
     *
     * <p>El orden no es cosmetico: es el que devuelven las tres consultas derivadas del adaptador
     * —todas acaban en {@code OrderByWorkItemIdAsc}—, y sin el, el doble y la base de datos darian
     * listas distintas con los mismos elementos y la prueba del servicio afirmaria un orden que en
     * produccion no se cumple. Un {@code LinkedHashMap} conserva el orden de insercion, no el
     * alfabetico, asi que hay que ordenar de verdad.
     */
    @Override
    public List<PlanningMetadata> findByDeclaredGap(DeclaredGap gap) {
        return state.values().stream()
                .filter(uno -> switch (gap) {
                    case SIN_ESTIMACION -> uno.estimatedHours() == null;
                    case SIN_COMPROMISO -> uno.committedDate() == null;
                    case METADATA_INCOMPLETA ->
                            uno.estimatedHours() == null || uno.committedDate() == null;
                })
                .sorted(Comparator.comparing(PlanningMetadata::workItemId))
                .toList();
    }
}
