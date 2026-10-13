package co.com.coltefinanciera.gestiondemanda.domain.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import co.com.coltefinanciera.gestiondemanda.domain.model.Renegotiation;
import co.com.coltefinanciera.gestiondemanda.domain.model.RenegotiationChange;

/**
 * El puerto por el que los acuerdos de renegociacion entran y salen de la base de datos.
 *
 * <p>No asoma nada de JPA: ni entidades, ni sesiones, ni consultas. El dominio dice lo que necesita
 * y el adaptador decide como lo consigue. Es el mismo reparto que
 * {@link PlanningMetadataRepository}, y deliberadamente el mismo: un acuerdo y una declaracion son
 * las dos cosas que el negocio afirma sobre un ticket y que GLPI no guarda, asi que se leen, se
 * escriben y se auditan igual.
 *
 * <p><strong>El acuerdo y su historia entran por el mismo metodo.</strong> No hay un {@code save}
 * para el estado y otro para el historial porque no son dos hechos: son uno. Guardar la fecha nueva
 * sin la fila que dice quien la acordó deja un estado que no se puede explicar, y una auditoria que
 * se contradice, que es peor que no tenerla.
 *
 * <p><strong>{@link #findByWorkItemIdForUpdate} existe por la misma razon que en la declaracion.</strong>
 * El acuerdo se <em>reemplaza</em>, no se añade: dos peticiones simultaneas que lean la misma fecha y
 * escriban cada una la suya producen un historial que afirma dos cambios partiendo del mismo punto.
 * Quien va a escribir lee con bloqueo y no lo suelta hasta haber escrito. Por eso ese metodo
 * <strong>exige una transaccion abierta</strong> alrededor: sin ella el bloqueo nace y muere en la
 * misma linea.
 */
public interface RenegotiationRepository {

    /**
     * Guarda el primer acuerdo sobre un elemento de trabajo, con su historia.
     *
     * <p>Falla si ya existe. Quien decide no es una comprobacion previa —entre la comprobacion y la
     * escritura cabe otra peticion— sino la clave de la tabla.
     */
    void create(Renegotiation renegotiation, List<RenegotiationChange> changes);

    /** El acuerdo vigente de un elemento de trabajo, si alguien lo registro. */
    Optional<Renegotiation> findByWorkItemId(String workItemId);

    /**
     * Los acuerdos vigentes de varios elementos de trabajo, de una sola vez.
     *
     * <p>Existe para la lectura consolidada. Al armar la lista de requerimientos desplazados hay que
     * saber cuales ya tienen acuerdo, y preguntarlo de uno en uno convertiria la lectura en una
     * consulta por requerimiento: con una agenda de verdad, decenas.
     *
     * <p><strong>Los que no tienen acuerdo no aparecen.</strong> No hay hueco que rellenar ni nulo
     * que devolver: la ausencia de acuerdo no es un valor del conjunto, es la ausencia del elemento,
     * y quien pregunta ya sabe con que identificadores pregunto.
     */
    List<Renegotiation> findByWorkItemIdIn(Collection<String> workItemIds);

    /**
     * El mismo acuerdo, pero reteniendolo para escritura hasta que la transaccion termine.
     *
     * <p>Es el unico metodo del puerto que necesita una transaccion ya abierta por quien llama.
     */
    Optional<Renegotiation> findByWorkItemIdForUpdate(String workItemId);

    /** Reemplaza el acuerdo vigente y añade a la historia lo que haya cambiado. */
    void update(Renegotiation renegotiation, List<RenegotiationChange> changes);

    /** Todo lo que le ha pasado al acuerdo de un elemento de trabajo, en orden. */
    List<RenegotiationChange> findHistory(String workItemId);
}
