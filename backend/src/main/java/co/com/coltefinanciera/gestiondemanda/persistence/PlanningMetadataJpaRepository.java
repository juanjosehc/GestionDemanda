package co.com.coltefinanciera.gestiondemanda.persistence;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PlanningMetadataJpaRepository extends JpaRepository<PlanningMetadataEntity, String> {

    /** Los estados declarados de varios elementos de trabajo, en una sola consulta. */
    List<PlanningMetadataEntity> findByWorkItemIdIn(Collection<String> workItemIds);

    /**
     * Cuantas filas declaradas no tienen horas estimadas.
     *
     * <p>Son nombres derivados y no consultas escritas a mano: Spring Data los traduce a un
     * {@code count} con su {@code where}, que es exactamente lo que se quiere preguntar. El total no
     * tiene metodo propio porque {@code count()} ya viene heredado.
     */
    long countByEstimatedHoursIsNull();

    /**
     * Las filas declaradas sin horas estimadas, en orden de identificador.
     *
     * <p>Es la pareja de {@link #countByEstimatedHoursIsNull()}: la misma condicion, escrita por
     * Spring Data dos veces, una para contar y otra para listar. Van juntas a proposito —de una sale
     * el numero de la tarjeta y de la otra el numero de elementos del detalle— y por eso estan
     * declaradas juntas: cambiarlas por separado es lo unico que podria hacerlas discrepar.
     */
    List<PlanningMetadataEntity> findByEstimatedHoursIsNullOrderByWorkItemIdAsc();

    /**
     * El estado de un elemento de trabajo, retenido para escritura hasta que acabe la transaccion.
     *
     * <p>El bloqueo es lo que convierte «leer, calcular el cambio y escribir» en una operacion sin
     * carrera. Sin el, dos peticiones simultaneas leen ambas el mismo valor y cada una escribe el
     * suyo: el estado acaba en el ultimo que escribio y el historial afirma dos cambios que parten
     * del mismo punto. Con el, la segunda espera y calcula su cambio sobre el valor ya confirmado.
     *
     * <p>Necesita una transaccion abierta por quien llama: fuera de ella, el bloqueo se suelta en
     * cuanto la consulta termina y no protege nada.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from PlanningMetadataEntity m where m.workItemId = :workItemId")
    Optional<PlanningMetadataEntity> findForUpdate(@Param("workItemId") String workItemId);
}
