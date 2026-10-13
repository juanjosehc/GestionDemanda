package co.com.coltefinanciera.gestiondemanda.domain.repository;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import org.springframework.dao.DataIntegrityViolationException;

import co.com.coltefinanciera.gestiondemanda.domain.model.Renegotiation;
import co.com.coltefinanciera.gestiondemanda.domain.model.RenegotiationChange;

/**
 * El puerto de los acuerdos de renegociacion en memoria, para pruebas.
 *
 * <p>Vive junto al puerto que implementa, como {@code InMemoryPlanningMetadataRepository} y por el
 * mismo motivo: las pruebas del servicio no deben necesitar una base de datos para comprobar reglas
 * de trazabilidad.
 *
 * <p><strong>Cuando el elemento ya existe lanza {@code DataIntegrityViolationException}</strong>,
 * que es exactamente lo que lanza el adaptador de verdad. Un doble que fallara de otra forma probaria
 * una traduccion a {@code 409} que en produccion no llegaria a ocurrir, y la prueba daria por buena
 * una respuesta que nadie recibiria.
 *
 * <p><strong>No reproduce el bloqueo de escritura, y no puede.</strong> El bloqueo existe para
 * resolver una carrera entre peticiones simultaneas, y una prueba de una sola hebra no tiene ninguna
 * que resolver. Que el bloqueo este puesto se comprueba contra la base de datos, no aqui.
 */
public class InMemoryRenegotiationRepository implements RenegotiationRepository {

    private final Map<String, Renegotiation> state = new LinkedHashMap<>();
    private final List<RenegotiationChange> history = new ArrayList<>();

    @Override
    public void create(Renegotiation renegotiation, List<RenegotiationChange> changes) {
        if (state.containsKey(renegotiation.workItemId())) {
            throw new DataIntegrityViolationException(
                    "ya hay renegociacion registrada para " + renegotiation.workItemId());
        }
        state.put(renegotiation.workItemId(), renegotiation);
        history.addAll(changes);
    }

    @Override
    public Optional<Renegotiation> findByWorkItemId(String workItemId) {
        return Optional.ofNullable(state.get(workItemId));
    }

    @Override
    public List<Renegotiation> findByWorkItemIdIn(Collection<String> workItemIds) {
        return workItemIds.stream()
                .map(state::get)
                .filter(Objects::nonNull)
                .toList();
    }

    @Override
    public Optional<Renegotiation> findByWorkItemIdForUpdate(String workItemId) {
        return findByWorkItemId(workItemId);
    }

    @Override
    public void update(Renegotiation renegotiation, List<RenegotiationChange> changes) {
        state.put(renegotiation.workItemId(), renegotiation);
        history.addAll(changes);
    }

    @Override
    public List<RenegotiationChange> findHistory(String workItemId) {
        return history.stream()
                .filter(change -> change.workItemId().equals(workItemId))
                .toList();
    }
}
