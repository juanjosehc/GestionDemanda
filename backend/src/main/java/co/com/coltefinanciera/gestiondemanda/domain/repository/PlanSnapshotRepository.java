package co.com.coltefinanciera.gestiondemanda.domain.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import co.com.coltefinanciera.gestiondemanda.domain.model.PlanReference;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningContextSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningInputSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningResult;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkBlock;

/**
 * Puerto de persistencia de los planes.
 *
 * <p>Es una interfaz del dominio aunque quien la implemente sea infraestructura, igual que
 * {@code RescheduleLedger}: el motor no la conoce —no la recibe ni la usa— y quien la consume es la
 * capa de servicio. Existe para que el plan sobreviva a un reinicio y para que se pueda releer sin
 * volver a planificar.
 *
 * <p>No asoma nada de JPA: ni entidades, ni sesiones, ni consultas. Solo tipos del dominio, de modo
 * que sustituir el motor de persistencia no obliga a tocar a nadie mas.
 *
 * <p><strong>El contexto y la entrada entran por aqui, no por puertos propios.</strong> El plan, su
 * contexto y su entrada son un solo hecho: guardar uno sin los otros deja un plan que no se puede
 * explicar. Con puertos separados habria varias transacciones, y una escritura fallida en la segunda
 * dejaria el plan a medias —que es exactamente el fallo que la escritura unica evita para los
 * bloques. Por eso el contexto y la entrada se entregan en el mismo {@link #save}.
 */
public interface PlanSnapshotRepository {

    /**
     * Guarda el plan, su contexto y su entrada, y le asigna identidad al primero.
     *
     * <p>Todo se escribe en una sola transaccion: plan, agenda, auditoria, conflictos, contexto y
     * entrada. O queda entero, o no queda nada.
     *
     * @param context con que se calculo. Es obligatorio: un plan sin contexto es un plan que no
     *                puede responder "por que".
     * @param input   con que datos se calculo. Es obligatorio por el mismo motivo: sin la entrada, el
     *                plan responde "que salio" pero no "con que entro".
     * @return el plan tal como quedo guardado, con su identificador.
     */
    PlanSnapshot save(
            String developerId,
            Instant createdAt,
            PlanningResult result,
            PlanningContextSnapshot context,
            PlanningInputSnapshot input);

    /** El plan completo, o vacio si no existe. */
    Optional<PlanSnapshot> findById(UUID planId);

    /**
     * El contexto con el que se calculo un plan, o vacio si el plan no existe.
     *
     * <p>Es una lectura aparte y no un campo de {@link PlanSnapshot} porque quien lo pide no siempre
     * es quien lee el plan: un timeline quiere los bloques, un auditor quiere el contexto, y el
     * endpoint que devuelve el plan no ha cambiado de forma.
     *
     * <p>Devuelve {@link Optional} y no una excepcion por el mismo motivo que {@link #findBlocks}:
     * distinguir "no existe" de "existe sin contexto" es decision de quien llama. Hoy
     * {@link #save} siempre escribe el contexto, asi que un plan sin el es un plan cuya fila de
     * contexto se perdio.
     */
    Optional<PlanningContextSnapshot> findContext(UUID planId);

    /**
     * La entrada con la que se calculo un plan, o vacio si no consta.
     *
     * <p>Con esta lectura y {@link #findContext}, un auditor puede responder la pregunta que la fase
     * viene a cerrar: <em>que datos exactos recibio el motor</em>. El contexto dice con que reglas, la
     * entrada dice con que datos, y el resultado dice que salio.
     *
     * <p>Vacio significa que no consta, no que fuera vacia. Un escenario sin incidentes ni
     * requerimientos guarda su fila de entrada y se lee como una foto sin trabajo; un plan calculado
     * antes de que esta tabla existiera no tiene fila, y esa diferencia es justamente la que impide
     * afirmar que el motor recibio una agenda vacia cuando lo que pasa es que nadie la registro.
     */
    Optional<PlanningInputSnapshot> findInput(UUID planId);

    /** Indica si el plan existe, sin traerlo. */
    boolean exists(UUID planId);

    /**
     * El plan vigente de cada desarrollador: el mas reciente por {@code createdAt}.
     *
     * <p>Existe porque un desarrollador acumula planes y sumarlos todos contaria su jornada tantas
     * veces como veces se haya planificado. Lo que se quiere saber es con que plan se esta trabajando
     * hoy, y eso es el ultimo que se guardo.
     *
     * <p>Un empate de sello se rompe por identificador, que no es significativo —los identificadores
     * son aleatorios— pero si estable: dos llamadas devuelven el mismo. La salida va ordenada por
     * desarrollador, para que dos llamadas devuelvan ademas la misma lista.
     */
    List<PlanReference> findLatestPerDeveloper();

    /**
     * Todos los planes de un desarrollador, del mas antiguo al mas reciente.
     *
     * <p>Existe porque {@link #findLatestPerDeveloper} contesta "con que plan se trabaja hoy" y tira el
     * resto, y hay una pregunta que necesita justo lo que tira: <em>que cambio entre este plan y el
     * anterior</em>. Sin esta lectura, "el plan anterior de un tecnico" no es una cosa nombrable —no
     * hay forma de obtener su identificador— y la pregunta no se puede ni formular.
     *
     * <p><strong>El orden es parte del contrato, no un detalle de la consulta.</strong> Quien compara
     * elige "el anterior" por posicion, asi que el orden no puede quedar a criterio del motor de base
     * de datos ni reordenarse despues: dos llamadas devuelven la misma lista, y un empate de sello se
     * rompe por identificador —que no significa nada, pero desempata igual en todas partes—.
     *
     * <p>Un desarrollador sin planes devuelve una lista vacia y no un error: este puerto no sabe si un
     * identificador corresponde a alguien, y contestar "no tiene planes" es lo unico que puede afirmar.
     */
    List<PlanReference> findByDeveloper(String developerId);

    /**
     * Cuantos planes hay guardados, sin traerlos.
     *
     * <p>Cuenta filas, no planes distintos: guardar un plan no es idempotente, asi que una peticion
     * repetida deja otra fila. Es la unica lectura de este puerto que no es de un plan concreto.
     */
    long count();

    /**
     * Solo los bloques de un plan, en el orden en que el motor los produjo.
     *
     * <p>Es la consulta que hace un timeline: del plan le sobra todo lo demas. Devuelve una lista
     * vacia si el plan no existe, de modo que quien necesite distinguirlo pregunte antes con
     * {@link #exists}.
     */
    List<WorkBlock> findBlocks(UUID planId);
}
