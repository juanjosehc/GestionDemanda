package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RenegotiationJpaRepository extends JpaRepository<RenegotiationEntity, String> {

    /** Los acuerdos vigentes de varios elementos de trabajo, en una sola consulta. */
    List<RenegotiationEntity> findByWorkItemIdIn(Collection<String> workItemIds);

    /**
     * El acuerdo de un elemento de trabajo, retenido para escritura hasta que acabe la transaccion.
     *
     * <p>El bloqueo es lo que convierte «leer, calcular el cambio y escribir» en una operacion sin
     * carrera. Sin el, dos peticiones simultaneas leen ambas la misma fecha y cada una escribe la
     * suya: el acuerdo acaba en el ultimo que escribio y el historial afirma dos cambios que parten
     * del mismo punto. Con el, la segunda espera y calcula su cambio sobre el valor ya confirmado.
     *
     * <p>Necesita una transaccion abierta por quien llama: fuera de ella, el bloqueo se suelta en
     * cuanto la consulta termina y no protege nada.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from RenegotiationEntity r where r.workItemId = :workItemId")
    Optional<RenegotiationEntity> findForUpdate(@Param("workItemId") String workItemId);
}
