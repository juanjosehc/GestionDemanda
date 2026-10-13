package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import co.com.coltefinanciera.gestiondemanda.domain.model.Renegotiation;
import co.com.coltefinanciera.gestiondemanda.domain.model.RenegotiationChange;
import co.com.coltefinanciera.gestiondemanda.domain.repository.RenegotiationRepository;

import lombok.RequiredArgsConstructor;

/**
 * El adaptador de persistencia de los acuerdos de renegociacion.
 *
 * <p><strong>El acuerdo y su historia se escriben en la misma transaccion.</strong> Un acuerdo
 * guardado sin la fila que dice quien lo trajo no es un estado incompleto: es un estado que miente,
 * porque afirma haber llegado ahi sin que nadie lo moviera.
 *
 * <p><strong>{@link #create} inserta y vuelca de inmediato.</strong> El volcado es lo que hace saltar
 * la violacion de la clave primaria aqui dentro, donde la transaccion puede deshacerse entera. La
 * excepcion sale del adaptador —no se captura dentro, porque una transaccion marcada para deshacer
 * ya no puede confirmar nada— y quien decide que significa es el servicio, que corre fuera de ella.
 * Es el mismo reparto que documenta {@code JpaPlanningMetadataRepository}: la restriccion de la tabla
 * es quien resuelve, no una comprobacion previa.
 */
@Component
@RequiredArgsConstructor
public class JpaRenegotiationRepository implements RenegotiationRepository {

    private final RenegotiationJpaRepository rows;
    private final RenegotiationHistoryJpaRepository historyRows;

    @Override
    @Transactional
    public void create(Renegotiation renegotiation, List<RenegotiationChange> changes) {
        rows.saveAndFlush(RenegotiationEntity.ofNew(renegotiation));
        historyRows.saveAll(changes.stream().map(RenegotiationHistoryEntity::of).toList());
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Renegotiation> findByWorkItemId(String workItemId) {
        return rows.findById(workItemId).map(RenegotiationEntity::toDomain);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Renegotiation> findByWorkItemIdIn(Collection<String> workItemIds) {
        // Una lista vacia se contesta aqui y no abajo: un IN sin valores no tiene traduccion SQL
        // portable, y ademas no hay nada que preguntar. Es el caso de una agenda sin desplazados.
        if (workItemIds.isEmpty()) {
            return List.of();
        }
        return rows.findByWorkItemIdIn(workItemIds).stream()
                .map(RenegotiationEntity::toDomain)
                .toList();
    }

    @Override
    public Optional<Renegotiation> findByWorkItemIdForUpdate(String workItemId) {
        return rows.findForUpdate(workItemId).map(RenegotiationEntity::toDomain);
    }

    @Override
    @Transactional
    public void update(Renegotiation renegotiation, List<RenegotiationChange> changes) {
        rows.save(RenegotiationEntity.of(renegotiation));
        historyRows.saveAll(changes.stream().map(RenegotiationHistoryEntity::of).toList());
    }

    @Override
    @Transactional(readOnly = true)
    public List<RenegotiationChange> findHistory(String workItemId) {
        return historyRows.findByWorkItemIdOrderByIdAsc(workItemId).stream()
                .map(RenegotiationHistoryEntity::toDomain)
                .toList();
    }
}
