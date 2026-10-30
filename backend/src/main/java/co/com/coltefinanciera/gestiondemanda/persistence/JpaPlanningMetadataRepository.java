package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import co.com.coltefinanciera.gestiondemanda.domain.enums.DeclaredGap;
import co.com.coltefinanciera.gestiondemanda.domain.model.DeclaredPlanningMetrics;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadataChange;
import co.com.coltefinanciera.gestiondemanda.domain.repository.PlanningMetadataRepository;

import lombok.RequiredArgsConstructor;

/**
 * El adaptador de persistencia de la planificacion declarada.
 *
 * <p><strong>El estado y su historia se escriben en la misma transaccion.</strong> Un estado
 * guardado sin la fila que dice quien lo cambio no es un estado incompleto: es un estado que miente,
 * porque afirma haber llegado ahi sin que nadie lo moviera.
 *
 * <p><strong>{@link #create} inserta y vuelca de inmediato.</strong> El volcado es lo que hace saltar
 * la violacion de la clave primaria aqui dentro, donde la transaccion puede deshacerse entera. La
 * excepcion sale del adaptador —no se captura dentro, porque una transaccion marcada para deshacer
 * ya no puede confirmar nada— y quien decide que significa es el servicio, que corre fuera de ella.
 * Es el mismo reparto que documenta {@code JpaRescheduleLedger}: la restriccion de la tabla es quien
 * resuelve, no una comprobacion previa.
 *
 * <p>Que {@link #create} inserte de verdad depende de {@code PlanningMetadataEntity.ofNew}: con la
 * clave natural puesta, Spring Data elegiria actualizar en vez de insertar y no habria violacion que
 * capturar. Esta dicho alli con mas detalle porque es la clase de detalle que solo se nota el dia
 * que alguien declara dos veces el mismo elemento.
 */
@Component
@RequiredArgsConstructor
public class JpaPlanningMetadataRepository implements PlanningMetadataRepository {

    private final PlanningMetadataJpaRepository rows;
    private final PlanningMetadataHistoryJpaRepository historyRows;

    @Override
    @Transactional
    public void create(PlanningMetadata metadata, List<PlanningMetadataChange> changes) {
        rows.saveAndFlush(PlanningMetadataEntity.ofNew(metadata));
        historyRows.saveAll(changes.stream().map(PlanningMetadataHistoryEntity::of).toList());
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<PlanningMetadata> findByWorkItemId(String workItemId) {
        return rows.findById(workItemId).map(PlanningMetadataEntity::toDomain);
    }

    @Override
    @Transactional(readOnly = true)
    public List<PlanningMetadata> findByWorkItemIdIn(Collection<String> workItemIds) {
        // Una lista vacia se contesta aqui y no abajo: un IN sin valores no tiene traduccion SQL
        // portable, y ademas no hay nada que preguntar. Es el caso de una agenda sin tickets.
        if (workItemIds.isEmpty()) {
            return List.of();
        }
        return rows.findByWorkItemIdIn(workItemIds).stream()
                .map(PlanningMetadataEntity::toDomain)
                .toList();
    }

    @Override
    public Optional<PlanningMetadata> findByWorkItemIdForUpdate(String workItemId) {
        return rows.findForUpdate(workItemId).map(PlanningMetadataEntity::toDomain);
    }

    @Override
    @Transactional
    public void update(PlanningMetadata metadata, List<PlanningMetadataChange> changes) {
        rows.save(PlanningMetadataEntity.of(metadata));
        historyRows.saveAll(changes.stream().map(PlanningMetadataHistoryEntity::of).toList());
    }

    @Override
    @Transactional(readOnly = true)
    public List<PlanningMetadataChange> findHistory(String workItemId) {
        return historyRows.findByWorkItemIdOrderByIdAsc(workItemId).stream()
                .map(PlanningMetadataHistoryEntity::toDomain)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public DeclaredPlanningMetrics declaredMetrics() {
        return new DeclaredPlanningMetrics(rows.count(), rows.countByEstimatedHoursIsNull());
    }

    /**
     * Elige el listado segun la carencia.
     *
     * <p>El {@code switch} no tiene rama por defecto y no la quiere: con todas las constantes
     * cubiertas el compilador lo da por exhaustivo, asi que el dia que se añada otra carencia esto
     * deja de compilar en vez de devolver una lista vacia en silencio.
     */
    @Override
    @Transactional(readOnly = true)
    public List<PlanningMetadata> findByDeclaredGap(DeclaredGap gap) {
        List<PlanningMetadataEntity> found = switch (gap) {
            case SIN_ESTIMACION -> rows.findByEstimatedHoursIsNullOrderByWorkItemIdAsc();
        };

        return found.stream().map(PlanningMetadataEntity::toDomain).toList();
    }
}
