package co.com.coltefinanciera.gestiondemanda.persistence;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import lombok.RequiredArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.domain.model.PlanReference;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningContextSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningInputSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningResult;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkBlock;
import co.com.coltefinanciera.gestiondemanda.domain.repository.PlanSnapshotRepository;
import co.com.coltefinanciera.gestiondemanda.domain.rules.IncidentPolicy;

/**
 * Adaptador JPA del puerto de planes.
 *
 * <p>Es la unica pieza que conoce a la vez el dominio y la base de datos, y su trabajo es traducir
 * entre los dos. El dominio no sabe que existe: recibe {@code WorkBlock} y devuelve {@code WorkBlock}.
 *
 * <p>El plan, sus cuatro tablas hijas, su contexto y su entrada se escriben en una sola transaccion.
 * No es una precaucion teorica: un plan guardado sin sus bloques no es un plan incompleto, es un plan
 * que miente. Con el contexto y la entrada pasa lo mismo, y por eso entran por el mismo {@code save}
 * en lugar de por adaptadores propios.
 *
 * <p>Al releer se arma el agregado con consultas por {@code plan_id} en lugar de con relaciones JPA.
 * Es mas codigo, y a cambio no hay carga perezosa, ni N+1, ni sesion abierta durante la serializacion
 * de la respuesta.
 */
@Component
@RequiredArgsConstructor
public class JpaPlanSnapshotRepository implements PlanSnapshotRepository {

    private final PlanSnapshotJpaRepository planRows;
    private final WorkAllocationJpaRepository allocationRows;
    private final WorkBlockJpaRepository blockRows;
    private final RescheduleEventJpaRepository eventRows;
    private final PlanningConflictJpaRepository conflictRows;
    private final PlanningContextJpaRepository contextRows;
    private final PlanningContextPolicyJpaRepository contextPolicyRows;
    private final PlanningInputJpaRepository inputRows;
    private final PlanningInputIncidentJpaRepository inputIncidentRows;
    private final PlanningInputRequirementJpaRepository inputRequirementRows;

    /**
     * Cual de dos planes del mismo desarrollador es el vigente.
     *
     * <p>El sello decide. Cuando empata —dos planes guardados en el mismo instante— decide el
     * identificador, que no significa nada pero desempata igual en todas partes, que es lo unico que
     * se le pide: que dos llamadas devuelvan el mismo plan.
     */
    private static final Comparator<PlanReference> VIGENTE =
            Comparator.comparing(PlanReference::createdAt)
                    .thenComparing(referencia -> referencia.planId().toString());

    @Override
    @Transactional
    public PlanSnapshot save(
            String developerId,
            Instant createdAt,
            PlanningResult result,
            PlanningContextSnapshot context,
            PlanningInputSnapshot input) {

        PlanSnapshotEntity plan = planRows.save(
                PlanSnapshotEntity.of(UUID.randomUUID(), developerId, createdAt));

        allocationRows.saveAll(result.allocations().stream()
                .map(allocation -> WorkAllocationEntity.of(plan.getId(), allocation))
                .toList());
        blockRows.saveAll(result.blocks().stream()
                .map(block -> WorkBlockEntity.of(plan.getId(), block))
                .toList());
        eventRows.saveAll(result.rescheduleEvents().stream()
                .map(event -> RescheduleEventEntity.of(plan.getId(), event))
                .toList());
        conflictRows.saveAll(result.conflicts().stream()
                .map(conflict -> PlanningConflictEntity.of(plan.getId(), conflict))
                .toList());

        contextRows.save(PlanningContextEntity.of(plan.getId(), context));
        // La OLA se ordena por severidad antes de escribirla. El mapa del dominio no promete orden,
        // y sin fijarlo las tres filas de dos planes equivalentes saldrian en orden distinto: la
        // prueba de ida y vuelta dejaria de comparar lo que cree comparar.
        contextPolicyRows.saveAll(context.rules().incidentPolicies().values().stream()
                .sorted(Comparator.comparingInt(policy -> policy.severity().ordinal()))
                .map(policy -> PlanningContextPolicyEntity.of(plan.getId(), policy))
                .toList());

        inputRows.save(PlanningInputEntity.of(plan.getId(), input));
        inputIncidentRows.saveAll(input.incidents().stream()
                .map(incident -> PlanningInputIncidentEntity.of(plan.getId(), incident))
                .toList());
        inputRequirementRows.saveAll(input.requirements().stream()
                .map(requirement -> PlanningInputRequirementEntity.of(plan.getId(), requirement))
                .toList());

        return new PlanSnapshot(plan.getId(), developerId, createdAt, result);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<PlanSnapshot> findById(UUID planId) {
        return planRows.findById(planId).map(plan -> new PlanSnapshot(
                plan.getId(),
                plan.getDeveloperId(),
                plan.getCreatedAt(),
                new PlanningResult(
                        allocationRows.findByPlanIdOrderByIdAsc(planId).stream()
                                .map(WorkAllocationEntity::toDomain).toList(),
                        blockRows.findByPlanIdOrderByIdAsc(planId).stream()
                                .map(WorkBlockEntity::toDomain).toList(),
                        eventRows.findByPlanIdOrderByIdAsc(planId).stream()
                                .map(RescheduleEventEntity::toDomain).toList(),
                        conflictRows.findByPlanIdOrderByIdAsc(planId).stream()
                                .map(PlanningConflictEntity::toDomain).toList())));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<PlanningContextSnapshot> findContext(UUID planId) {
        List<IncidentPolicy> policies = contextPolicyRows.findByPlanId(planId).stream()
                .map(PlanningContextPolicyEntity::toDomain)
                .toList();

        return contextRows.findById(planId).map(context -> context.toDomain(policies));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<PlanningInputSnapshot> findInput(UUID planId) {
        return inputRows.findById(planId).map(input -> new PlanningInputSnapshot(
                input.getDeveloperId(),
                inputIncidentRows.findByPlanIdOrderByIdAsc(planId).stream()
                        .map(PlanningInputIncidentEntity::toDomain).toList(),
                inputRequirementRows.findByPlanIdOrderByIdAsc(planId).stream()
                        .map(PlanningInputRequirementEntity::toDomain).toList(),
                input.toProvenance()));
    }

    @Override
    @Transactional(readOnly = true)
    public boolean exists(UUID planId) {
        return planRows.existsById(planId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<WorkBlock> findBlocks(UUID planId) {
        return blockRows.findByPlanIdOrderByIdAsc(planId).stream()
                .map(WorkBlockEntity::toDomain)
                .toList();
    }

    /**
     * {@code ponytail:} se trae la tabla entera y se agrupa en memoria, que es O(planes totales) por
     * peticion. Se sostiene porque la tabla tiene tres columnas y los planes son de decenas; y porque
     * un {@code GROUP BY} no saldria mas barato —no hay indice sobre {@code created_at}, asi que seria
     * el mismo recorrido con un orden encima— ni devolveria el identificador del ganador, que haria
     * falta resolver con una segunda consulta. Cuando el volumen lo pida, la via es un indice
     * {@code (developer_id, created_at)} y la consulta de maximo por grupo, o una vista.
     */
    @Override
    @Transactional(readOnly = true)
    public List<PlanReference> findLatestPerDeveloper() {
        return planRows.findAll().stream()
                .collect(Collectors.toMap(
                        PlanSnapshotEntity::getDeveloperId,
                        plan -> new PlanReference(plan.getId(), plan.getDeveloperId(), plan.getCreatedAt()),
                        (uno, otro) -> VIGENTE.compare(uno, otro) >= 0 ? uno : otro,
                        TreeMap::new))
                .values().stream()
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public long count() {
        return planRows.count();
    }
}
