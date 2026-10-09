package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PlanningMetadataHistoryJpaRepository
        extends JpaRepository<PlanningMetadataHistoryEntity, Long> {

    /**
     * Los cambios de un elemento de trabajo, en el orden en que se registraron.
     *
     * <p>Se ordena por {@code id} y no por {@code changed_at} a proposito: con el reloj fijo de las
     * pruebas —y tambien en la realidad, donde dos cambios caben en el mismo instante— dos filas
     * consecutivas pueden compartir fecha, y una auditoria que no sabe cual fue primero no sirve.
     * El identificador generado si conserva ese orden.
     */
    List<PlanningMetadataHistoryEntity> findByWorkItemIdOrderByIdAsc(String workItemId);
}
