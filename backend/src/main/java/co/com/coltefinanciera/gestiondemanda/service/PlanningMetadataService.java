package co.com.coltefinanciera.gestiondemanda.service;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;
import co.com.coltefinanciera.gestiondemanda.domain.repository.PlanningMetadataRepository;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataHistoryResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataRequest;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataUpdateRequest;
import co.com.coltefinanciera.gestiondemanda.exception.PlanningMetadataAlreadyExistsException;
import co.com.coltefinanciera.gestiondemanda.exception.PlanningMetadataNotFoundException;

import lombok.RequiredArgsConstructor;

/**
 * La planificacion que declara el negocio: quien la escribe, quien la lee y que queda registrado.
 *
 * <p>No decide nada sobre como se planifica —eso sigue siendo del motor, que esta fase no toca—.
 * Solo custodia los dos datos que GLPI no tiene y la historia de como llegaron a su valor actual.
 *
 * <p><strong>El reloj lo pone el servidor.</strong> Los sellos de tiempo salen del bean
 * {@code Clock}, nunca del cuerpo de la peticion: un instante que elige el cliente no fecha nada,
 * solo dice lo que el cliente queria que dijera. Es el mismo reloj que fecha los planes, y por eso
 * las pruebas pueden fijarlo y comprobar el vencimiento de un compromiso sin depender de que dia se
 * ejecuten.
 */
@Service
@RequiredArgsConstructor
public class PlanningMetadataService {

    private final PlanningMetadataRepository repository;
    private final Clock clock;

    /**
     * Declara por primera vez la planificacion de un elemento de trabajo.
     *
     * <p><strong>La declaracion inicial tambien entra al historial</strong>, con valor anterior
     * nulo. Cuesta una fila y evita que el primer valor quede sin autor en cuanto alguien lo cambie:
     * sin ella, el historial empezaria en el segundo valor y afirmaria que el primero nunca existio.
     *
     * <p><strong>No lleva {@code @Transactional}, y es a proposito.</strong> La transaccion vive en
     * el adaptador, que escribe estado e historial juntos. Si el metodo estuviera envuelto aqui, la
     * violacion de clave —que hay que capturar para responder 409— dejaria la transaccion marcada
     * para deshacer y ya no habria nada que capturar: la excepcion saldria convertida en otra cosa.
     * Es el mismo reparto que el ledger de reprogramaciones, donde la restriccion de la tabla decide
     * y quien traduce corre fuera.
     */
    public PlanningMetadataResponse create(PlanningMetadataRequest request) {
        Instant now = clock.instant();
        String workItemId = request.workItemId();
        PlanningMetadata before = PlanningMetadata.undeclared(workItemId, InputSource.HTTP);
        PlanningMetadata after = PlanningMetadata.declared(workItemId, request.estimatedHours(),
                request.committedDate(), request.changedBy(), now, InputSource.HTTP);
        try {
            repository.create(after, after.changesFrom(before, request.changedBy(), now));
        } catch (DataIntegrityViolationException alreadyDeclared) {
            throw new PlanningMetadataAlreadyExistsException(request.workItemId());
        }
        return toResponse(after);
    }

    /**
     * Reemplaza la planificacion declarada, dejando constancia de lo que cambio.
     *
     * <p><strong>Lee con bloqueo y escribe en la misma transaccion.</strong> Aqui no basta con que
     * la escritura sea atomica, porque el estado se reemplaza en vez de añadirse: dos peticiones
     * simultaneas que lean el mismo valor calcularian cada una su cambio sobre el mismo punto de
     * partida, y el historial acabaria afirmando dos cambios incompatibles. Con el bloqueo, la
     * segunda espera y calcula sobre el valor que la primera ya confirmo. Un doble clic bastaria para
     * provocarlo, asi que la proteccion no es teorica.
     */
    @Transactional
    public PlanningMetadataResponse update(String workItemId, PlanningMetadataUpdateRequest request) {
        Instant now = clock.instant();
        PlanningMetadata before = repository.findByWorkItemIdForUpdate(workItemId)
                .orElseThrow(() -> new PlanningMetadataNotFoundException(workItemId));
        PlanningMetadata after = before.declaredWith(
                request.estimatedHours(), request.committedDate(), request.changedBy(), now);
        repository.update(after, after.changesFrom(before, request.changedBy(), now));
        return toResponse(after);
    }

    @Transactional(readOnly = true)
    public PlanningMetadataResponse find(String workItemId) {
        return toResponse(repository.findByWorkItemId(workItemId)
                .orElseThrow(() -> new PlanningMetadataNotFoundException(workItemId)));
    }

    /**
     * La historia completa de un elemento de trabajo.
     *
     * <p>La existencia se comprueba contra el estado y no contra el historial. Un elemento sin
     * planificacion no tiene historia que contar, y responder una lista vacia diria que si la tiene
     * —y ademas seria un estado inalcanzable, porque la primera declaracion siempre deja fila—.
     */
    @Transactional(readOnly = true)
    public PlanningMetadataHistoryResponse history(String workItemId) {
        if (repository.findByWorkItemId(workItemId).isEmpty()) {
            throw new PlanningMetadataNotFoundException(workItemId);
        }
        return new PlanningMetadataHistoryResponse(
                workItemId,
                repository.findHistory(workItemId).stream()
                        .map(PlanningMetadataHistoryResponse.ChangeView::of)
                        .toList());
    }

    private PlanningMetadataResponse toResponse(PlanningMetadata metadata) {
        return PlanningMetadataResponse.of(metadata, LocalDate.now(clock));
    }
}
