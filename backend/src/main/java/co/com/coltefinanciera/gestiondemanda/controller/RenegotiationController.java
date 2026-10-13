package co.com.coltefinanciera.gestiondemanda.controller;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationHistoryResponse;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationRequest;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationResponse;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationUpdateRequest;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationsResponse;
import co.com.coltefinanciera.gestiondemanda.service.RenegotiationService;

import lombok.RequiredArgsConstructor;

/**
 * Los acuerdos de renegociacion, por HTTP.
 *
 * <p><strong>Es la operacion que faltaba.</strong> El motor ya dejaba constancia de que un
 * requerimiento se movio —{@code RescheduleEvent}— y ya lo marcaba como pendiente de renegociar,
 * pero no existia la operacion con la que el responsable confirma la fecha nueva. Ese hueco estaba
 * anotado como mejora pendiente desde la Fase 3, y es lo que esta ruta cierra.
 *
 * <p><strong>La ruta de lectura es la raiz.</strong> {@code GET /api/renegotiations} devuelve todo lo
 * que hay que saber para trabajar: que esta desplazado, que sigue pendiente y que ya se renegocio,
 * con la trazabilidad de cada uno. Las rutas por elemento existen para el formulario —leer antes de
 * escribir, como en la declaracion— y para poder comprobar una fila contra su original.
 *
 * <p>El identificador del elemento de trabajo va en el camino y es el mismo que usa GLPI como
 * identificador de ticket, como texto. No es un UUID como el de los planes, porque no lo es en
 * origen: es la clave con la que el trabajo se conoce fuera de aqui.
 *
 * <p><strong>Nada de esto toca el motor.</strong> Registrar un acuerdo no recalcula capacidad, no
 * mueve desplazamientos y no altera ningun {@code RescheduleEvent}: añade informacion auditable al
 * lado de un hecho que ya estaba auditado.
 */
@RestController
@RequestMapping("/api/renegotiations")
@RequiredArgsConstructor
public class RenegotiationController {

    private final RenegotiationService service;

    /**
     * Lo que hay que renegociar y lo que ya se renegocio.
     *
     * <p>Una sola lectura contesta las seis preguntas de la trazabilidad —que requerimiento, que
     * incidente, que fecha original, que fecha nueva, quien y cuando— sin pedir el plan ni el
     * timeline por separado.
     */
    @GetMapping
    public RenegotiationsResponse renegotiations() {
        return service.renegotiations();
    }

    /** El acuerdo vigente de un elemento de trabajo. {@code 404} si todavia no hay ninguno. */
    @GetMapping("/{workItemId}")
    public RenegotiationResponse find(@PathVariable String workItemId) {
        return service.find(workItemId);
    }

    /**
     * Todo lo que le ha pasado al acuerdo de un elemento de trabajo.
     *
     * <p>Un elemento sin acuerdo devuelve una lista vacia y no un {@code 404}: «no ha pasado nada» es
     * una respuesta completa a la pregunta por el historial.
     */
    @GetMapping("/{workItemId}/history")
    public RenegotiationHistoryResponse history(@PathVariable String workItemId) {
        return service.history(workItemId);
    }

    /**
     * Registra la fecha acordada tras un desplazamiento.
     *
     * <p>Responde {@code 201} con el acuerdo ya sellado por el servidor, o {@code 409} si ese elemento
     * ya tenia uno.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public RenegotiationResponse create(@Valid @RequestBody RenegotiationRequest request) {
        return service.create(request);
    }

    /**
     * Reemplaza la fecha acordada de un elemento de trabajo.
     *
     * <p>Es la operacion de la renegociacion repetida: volver a acordar no crea un acuerdo nuevo, deja
     * el vigente en la fecha nueva y anota el cambio en el historial.
     */
    @PutMapping("/{workItemId}")
    public RenegotiationResponse update(
            @PathVariable String workItemId,
            @Valid @RequestBody RenegotiationUpdateRequest request) {

        return service.update(workItemId, request);
    }
}
