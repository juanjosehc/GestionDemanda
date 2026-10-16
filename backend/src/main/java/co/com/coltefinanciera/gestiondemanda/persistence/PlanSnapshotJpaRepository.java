package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a la tabla de planes. La clave la asigna el adaptador, no la base de datos. */
public interface PlanSnapshotJpaRepository extends JpaRepository<PlanSnapshotEntity, UUID> {

    /**
     * Los planes de un desarrollador, del mas antiguo al mas reciente.
     *
     * <p>El nombre lleva los dos criterios y no solo el primero: sin `IdAsc` dos planes guardados en
     * el mismo instante saldrian en el orden que elija la base de datos, que puede no ser el mismo dos
     * veces. El desempate por identificador no significa nada, y es justo lo que se le pide: que sea
     * estable.
     */
    List<PlanSnapshotEntity> findByDeveloperIdOrderByCreatedAtAscIdAsc(String developerId);
}
