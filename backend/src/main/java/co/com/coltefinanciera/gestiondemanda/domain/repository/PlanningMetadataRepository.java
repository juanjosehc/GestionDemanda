package co.com.coltefinanciera.gestiondemanda.domain.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import co.com.coltefinanciera.gestiondemanda.domain.enums.DeclaredGap;
import co.com.coltefinanciera.gestiondemanda.domain.model.DeclaredPlanningMetrics;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadataChange;

/**
 * El puerto por el que la planificacion que declara el negocio entra y sale de la base de datos.
 *
 * <p>No asoma nada de JPA: ni entidades, ni sesiones, ni consultas. El dominio dice lo que necesita
 * y el adaptador decide como lo consigue.
 *
 * <p><strong>El estado y su historia entran por el mismo metodo.</strong> No hay un {@code save}
 * para el estado y otro para el historial porque no son dos hechos: son uno. Guardar las horas
 * nuevas sin la fila que dice quien las cambio deja un estado que no se puede explicar —y una
 * auditoria que se contradice—, que es peor que no tenerlas.
 *
 * <p><strong>{@link #findByWorkItemIdForUpdate} existe por una razon concreta.</strong> A
 * diferencia del plan, que solo se añade, el estado de la metadata se <em>reemplaza</em>. Dos
 * peticiones simultaneas que lean el mismo valor y escriban cada una el suyo producen un historial
 * que afirma dos cambios partiendo del mismo punto: una cadena que miente, y un doble clic basta
 * para provocarla. Quien va a escribir lee con bloqueo y no lo suelta hasta haber escrito; el que
 * llega despues espera y lee el valor ya confirmado. Por eso ese metodo <strong>exige una
 * transaccion abierta</strong> alrededor: sin ella el bloqueo nace y muere en la misma linea.
 */
public interface PlanningMetadataRepository {

    /**
     * Guarda la primera declaracion de un elemento de trabajo, con su historia.
     *
     * <p>Falla si ya existe. Quien decide no es una comprobacion previa —entre la comprobacion y la
     * escritura cabe otra peticion— sino la clave de la tabla.
     */
    void create(PlanningMetadata metadata, List<PlanningMetadataChange> changes);

    /** El estado declarado de un elemento de trabajo, si alguien lo declaro. */
    Optional<PlanningMetadata> findByWorkItemId(String workItemId);

    /**
     * El estado declarado de varios elementos de trabajo, de una sola vez.
     *
     * <p>Existe para la capa anticorrupcion. Al traducir los tickets de un desarrollador hay que
     * saber la planificacion de todos, y preguntarla de uno en uno convierte una traduccion en una
     * consulta por ticket: con una agenda de verdad, decenas. Es el mismo dato que
     * {@link #findByWorkItemId}, pedido de la forma en que se necesita.
     *
     * <p><strong>Los que no tienen declaracion no aparecen.</strong> No hay hueco que rellenar ni
     * nulo que devolver: la ausencia de planificacion no es un valor del conjunto, es la ausencia del
     * elemento, y quien pregunta ya sabe con que identificadores pregunto.
     */
    List<PlanningMetadata> findByWorkItemIdIn(Collection<String> workItemIds);

    /**
     * El mismo estado, pero reteniendolo para escritura hasta que la transaccion termine.
     *
     * <p>Es el unico metodo del puerto que necesita una transaccion ya abierta por quien llama.
     */
    Optional<PlanningMetadata> findByWorkItemIdForUpdate(String workItemId);

    /** Reemplaza el estado declarado y añade a la historia lo que haya cambiado. */
    void update(PlanningMetadata metadata, List<PlanningMetadataChange> changes);

    /** Todo lo que le ha pasado a la planificacion de un elemento de trabajo, en orden. */
    List<PlanningMetadataChange> findHistory(String workItemId);

    /**
     * Cuenta el estado declarado entero, sin traerlo.
     *
     * <p>Es la unica lectura de este puerto que no es de un elemento concreto, y la unica que no
     * devuelve estado: devuelve numeros. Traer las filas para contarlas en memoria diria lo mismo
     * costando mas, y lo que se pregunta —cuantas faltan por estimar, cuantas por comprometer— es
     * una cuenta, no una lista.
     *
     * <p>Cuenta el estado de hoy y nada mas. El historial de cambios no entra: lo que se quiere
     * saber es que falta ahora, no cuanto ha faltado.
     */
    DeclaredPlanningMetrics declaredMetrics();

    /**
     * El estado declarado que hoy cae en una de las tres carencias, en una lista.
     *
     * <p>Es la segunda lectura de este puerto que no es de un elemento concreto, y existe porque la
     * primera contesta «cuantas» y la pregunta que sigue es «cuales»: {@link #declaredMetrics()} sirve
     * para ver que hay un problema, y esto para ver de quien. Las dos se apoyan en el mismo predicado
     * sobre la misma tabla, asi que la cuenta y la lista no pueden separarse.
     *
     * <p><strong>Ordenado por identificador de elemento.</strong> Una lista que cambia de orden entre
     * dos lecturas iguales no se puede comparar ni con los ojos ni con una prueba.
     */
    List<PlanningMetadata> findByDeclaredGap(DeclaredGap gap);
}
