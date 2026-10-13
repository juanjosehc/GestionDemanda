package co.com.coltefinanciera.gestiondemanda.service;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RenegotiationStatus;
import co.com.coltefinanciera.gestiondemanda.domain.model.Renegotiation;
import co.com.coltefinanciera.gestiondemanda.domain.repository.RenegotiationRepository;
import co.com.coltefinanciera.gestiondemanda.dto.DisplacedRequirementsResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningSimulationResponse;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationHistoryResponse;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationRequest;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationResponse;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationUpdateRequest;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationsResponse;
import co.com.coltefinanciera.gestiondemanda.exception.RenegotiationAlreadyExistsException;
import co.com.coltefinanciera.gestiondemanda.exception.RenegotiationNotFoundException;

import lombok.RequiredArgsConstructor;

/**
 * Los acuerdos de renegociacion: registrarlos, leerlos y contarlos.
 *
 * <p><strong>Este servicio no planifica y no puede planificar.</strong> No conoce el motor, ni las
 * reglas, ni el calendario. Registra una fecha que dos personas acordaron y la devuelve; el
 * desplazamiento que la motiva ya ocurrio y esta auditado en el plan. Es la frontera que pide el
 * modelo: la renegociacion es una consecuencia humana de un desplazamiento ya detectado, no una
 * entrada del calculo.
 *
 * <p><strong>El sello de tiempo sale del bean {@code Clock}, nunca del cuerpo de la peticion.</strong>
 * Quien registra un acuerdo dice a que fecha se llego, quien lo acordó y por que; cuando quedo
 * registrado lo dice el servidor, porque una fecha de registro que elige quien llama no es un sello,
 * es una afirmacion.
 *
 * <p><strong>La lectura consolidada reutiliza la de desplazamientos.</strong> Llama a
 * {@link PlanningMetricsService#displaced()} en lugar de recorrer los planes por su cuenta. Es
 * deliberado: si esta lista se armara aparte, podria discrepar de la tarjeta de desplazamientos y no
 * habria forma de saber cual de las dos miente. Una sola fuente, dos presentaciones.
 */
@Service
@RequiredArgsConstructor
public class RenegotiationService {

    private final RenegotiationRepository repository;
    private final PlanningMetricsService metrics;
    private final Clock clock;

    /**
     * Registra el acuerdo de un elemento de trabajo.
     *
     * <p><strong>Sin {@code @Transactional}, a proposito.</strong> Es el mismo reparto que la
     * declaracion: la insercion corre en su propia transaccion —la del adaptador— para que la
     * violacion de la clave primaria se pueda capturar aqui, ya deshecha, y traducir a un conflicto.
     * Capturarla dentro de la transaccion no serviria: una transaccion marcada para deshacer no puede
     * confirmar nada despues.
     *
     * <p>La primera fila de historial se crea con la fecha anterior en nulo, que es el dato que dice
     * que el acuerdo nacio aqui y quien lo trajo.
     */
    public RenegotiationResponse create(RenegotiationRequest request) {
        Instant now = clock.instant();
        Renegotiation renegotiation = new Renegotiation(
                request.workItemId(),
                request.agreedDate(),
                request.agreedBy(),
                request.agreedReason(),
                now,
                InputSource.HTTP);

        try {
            repository.create(renegotiation, renegotiation.changesFrom(null, request.agreedBy(), now));
        } catch (DataIntegrityViolationException alreadyRenegotiated) {
            throw new RenegotiationAlreadyExistsException(request.workItemId());
        }

        return RenegotiationResponse.of(renegotiation);
    }

    /**
     * Reemplaza el acuerdo vigente de un elemento de trabajo.
     *
     * <p>Lee con bloqueo antes de calcular el cambio, y por eso si lleva {@code @Transactional}: dos
     * peticiones simultaneas que lean la misma fecha y escriban cada una la suya dejarian un historial
     * que afirma dos cambios partiendo del mismo punto.
     *
     * <p>Reenviar la misma fecha y el mismo motivo no es un error y no ensucia la auditoria: el estado
     * se reemplaza por uno igual, y {@code changesFrom} devuelve la lista vacia, de modo que no se
     * escribe ninguna fila de historial por un cambio que no ocurrio. Corregir solo el motivo, en
     * cambio, si es un cambio, y queda registrado como tal.
     */
    @Transactional
    public RenegotiationResponse update(String workItemId, RenegotiationUpdateRequest request) {
        Instant now = clock.instant();
        Renegotiation before = repository.findByWorkItemIdForUpdate(workItemId)
                .orElseThrow(() -> new RenegotiationNotFoundException(workItemId));

        Renegotiation after = before.agreedWith(
                request.agreedDate(), request.agreedReason(), request.agreedBy(), now);
        repository.update(after, after.changesFrom(before, request.agreedBy(), now));

        return RenegotiationResponse.of(after);
    }

    /**
     * El acuerdo vigente de un elemento de trabajo.
     *
     * <p>{@code 404} si no hay ninguno. No es un fallo: mientras nadie acuerde nada no hay fila, y
     * ese es el estado normal de un requerimiento recien desplazado.
     */
    @Transactional(readOnly = true)
    public RenegotiationResponse find(String workItemId) {
        return repository.findByWorkItemId(workItemId)
                .map(RenegotiationResponse::of)
                .orElseThrow(() -> new RenegotiationNotFoundException(workItemId));
    }

    /**
     * Todo lo que le ha pasado al acuerdo de un elemento de trabajo, en orden.
     *
     * <p>A diferencia de {@link #find}, un elemento sin acuerdo devuelve una lista vacia y no un
     * {@code 404}: lo que se pregunta aqui es el historial, y «no ha pasado nada» es una respuesta
     * completa a esa pregunta.
     */
    @Transactional(readOnly = true)
    public RenegotiationHistoryResponse history(String workItemId) {
        return new RenegotiationHistoryResponse(
                workItemId,
                repository.findHistory(workItemId).stream()
                        .map(RenegotiationHistoryResponse.ChangeView::of)
                        .toList());
    }

    /**
     * La lectura consolidada: que esta desplazado, que sigue pendiente y que ya se renegocio.
     *
     * <p>Recorre los desplazamientos del plan vigente de cada desarrollador y le pega a cada uno su
     * acuerdo. El acuerdo se busca para todos los elementos de una sola vez: preguntarlo de uno en uno
     * convertiria esta lectura en una consulta por desplazado, que con una agenda de verdad son
     * decenas.
     *
     * <p>Un requerimiento desplazado <strong>no desaparece de la lista al renegociarse</strong>: pasa
     * de {@code PENDIENTE_DE_ACUERDO} a {@code ACORDADA}. La lista es la historia de lo que se movio,
     * y esconder lo ya resuelto dejaria sin explicacion por que la fecha de un requerimiento no es la
     * que se le prometio al usuario.
     */
    @Transactional(readOnly = true)
    public RenegotiationsResponse renegotiations() {
        Instant generatedAt = clock.instant();
        List<DisplacedRequirementsResponse.Element> displaced = metrics.displaced().items();

        if (displaced.isEmpty()) {
            return new RenegotiationsResponse(
                    RenegotiationsResponse.SOURCE, RenegotiationsResponse.SCOPE, generatedAt,
                    new RenegotiationsResponse.Summary(0, 0, 0), List.of());
        }

        Map<String, Renegotiation> acuerdos = repository
                .findByWorkItemIdIn(displaced.stream()
                        .map(DisplacedRequirementsResponse.Element::workItemId)
                        .distinct()
                        .toList())
                .stream()
                .collect(Collectors.toMap(Renegotiation::workItemId, Function.identity()));

        long pendientes = 0;
        List<RenegotiationsResponse.Item> items = new ArrayList<>(displaced.size());

        for (DisplacedRequirementsResponse.Element element : displaced) {
            Renegotiation acuerdo = acuerdos.get(element.workItemId());
            boolean cubierto = cubre(acuerdo, element.events());

            if (!cubierto) {
                pendientes++;
            }

            items.add(new RenegotiationsResponse.Item(
                    element.developerId(),
                    element.planId(),
                    element.calculatedAt(),
                    element.workItemId(),
                    cubierto ? RenegotiationStatus.ACORDADA : RenegotiationStatus.PENDIENTE_DE_ACUERDO,
                    element.events(),
                    acuerdo == null ? null : RenegotiationResponse.of(acuerdo)));
        }

        return new RenegotiationsResponse(
                RenegotiationsResponse.SOURCE,
                RenegotiationsResponse.SCOPE,
                generatedAt,
                new RenegotiationsResponse.Summary(
                        items.size(), pendientes, items.size() - pendientes),
                items);
    }

    /**
     * Si el acuerdo cubre todos los desplazamientos vigentes del elemento.
     *
     * <p><strong>Un acuerdo nulo no cubre nada</strong>, y un elemento sin eventos tampoco queda
     * cubierto: no habria sello con el que comparar, y dar por acordado lo que no se puede comprobar
     * esconderia una renegociacion pendiente. No ocurre —el timeline solo marca desplazado a quien
     * tiene un evento que lo justifique, y los dos salen del mismo {@code rescheduleEvents} del
     * plan— pero el dia que ocurriera, la respuesta honesta es «pendiente».
     */
    private static boolean cubre(
            Renegotiation acuerdo, List<PlanningSimulationResponse.RescheduleEventView> events) {

        return acuerdo != null
                && !events.isEmpty()
                && events.stream().allMatch(event -> acuerdo.covers(event.timestamp()));
    }
}
