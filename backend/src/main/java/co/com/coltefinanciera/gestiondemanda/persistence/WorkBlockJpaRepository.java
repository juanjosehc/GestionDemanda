package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Acceso a la tabla de tramos de agenda. */
public interface WorkBlockJpaRepository extends JpaRepository<WorkBlockEntity, Long> {

    /**
     * Bloques de un plan, en el orden en que el motor los produjo.
     *
     * <p>Se ordena por clave y no por hora de inicio a proposito: el orden de produccion es el
     * orden de resolucion del motor (incidentes, requerimientos, convivientes), y es el que hace que
     * un plan releido sea identico al plan que se calculo. Quien pinte una agenda cronologica
     * ordena por {@code start_at}; el dato esta ahi para eso.
     */
    List<WorkBlockEntity> findByPlanIdOrderByIdAsc(UUID planId);
}
