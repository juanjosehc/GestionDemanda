package co.com.coltefinanciera.gestiondemanda.controller;

import java.util.List;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import co.com.coltefinanciera.gestiondemanda.dto.DeveloperDeclarationsResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataHistoryResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataRequest;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataUpdateRequest;
import co.com.coltefinanciera.gestiondemanda.dto.TeamDeclarationsResponse;
import co.com.coltefinanciera.gestiondemanda.service.PlanningDeclarationService;
import co.com.coltefinanciera.gestiondemanda.service.PlanningMetadataService;

import lombok.RequiredArgsConstructor;

/**
 * La planificacion que declara el negocio, por HTTP.
 *
 * <p>Es una capa nueva y <strong>hoy nadie la consume</strong>, ni el motor ni el frontend. Es
 * deliberado: existe para fijar y poder validar el modelo antes de que nada dependa de el. Cuando
 * la ACL empiece a leer de aqui, lo hara sin que este contrato cambie.
 *
 * <p>El identificador del elemento de trabajo va en el camino y es el mismo que usa GLPI como
 * identificador de ticket, como texto. No es un UUID como el de los planes, porque no lo es en
 * origen: es la clave con la que el trabajo se conoce fuera de aqui, y traducirla obligaria a
 * mantener una tabla de equivalencias para no ganar nada.
 */
@RestController
@RequestMapping("/api/planning-metadata")
@RequiredArgsConstructor
public class PlanningMetadataController {

    private final PlanningMetadataService service;
    private final PlanningDeclarationService declarationService;

    /**
     * Declara la planificacion de un elemento de trabajo.
     *
     * <p>Responde {@code 201} con el estado ya sellado por el servidor, o {@code 409} si ese elemento
     * ya tenia planificacion declarada.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public PlanningMetadataResponse create(@Valid @RequestBody PlanningMetadataRequest request) {
        return service.create(request);
    }

    /**
     * Reemplaza la planificacion declarada de un elemento de trabajo.
     *
     * <p>Reemplaza, no parchea: lo que no venga en el cuerpo queda en nulo. Modificar un valor se
     * hace leyendo antes el estado, y la respuesta dice como quedo el recurso entero.
     */
    @PutMapping("/{workItemId}")
    public PlanningMetadataResponse update(
            @PathVariable String workItemId,
            @Valid @RequestBody PlanningMetadataUpdateRequest request) {

        return service.update(workItemId, request);
    }

    /** El estado declarado hoy. Un recurso sin valores sigue siendo un {@code 200}. */
    @GetMapping("/{workItemId}")
    public PlanningMetadataResponse find(@PathVariable String workItemId) {
        return service.find(workItemId);
    }

    /** Todo lo que le ha pasado a esta planificacion, en el orden en que ocurrio. */
    @GetMapping("/{workItemId}/history")
    public PlanningMetadataHistoryResponse history(@PathVariable String workItemId) {
        return service.history(workItemId);
    }

    /**
     * Lo que tiene asignado un tecnico, con lo que le falta a cada ticket para poder planificarse.
     *
     * <p><strong>Es de solo lectura y no planifica.</strong> No es una forma de crear un plan: quien
     * quiera uno sigue llamando a {@code POST /api/planning/from-glpi}, que es el unico endpoint que
     * escribe. Esta ruta existe para que la pantalla de declaracion tenga que leer, y no para darle
     * una segunda via de escritura que ademas seria invisible: pedir el listado crearia un plan
     * guardado por cada vez que alguien abre la pantalla.
     *
     * <p>{@code 404} si el tecnico no esta en GLPI, igual que el flujo que planifica: un
     * identificador equivocado no es «no tiene trabajo».
     */
    @GetMapping("/declarations/{developerId}")
    public DeveloperDeclarationsResponse declarations(@PathVariable String developerId) {
        return declarationService.declarationsFor(developerId);
    }

    /**
     * Lo mismo, para varias personas en una sola lectura.
     *
     * <p><strong>Es la ruta del timeline.</strong> La pantalla de declaracion sigue preguntando por un
     * tecnico; el timeline del equipo pregunta por todos los que tienen plan vigente de una vez,
     * porque pintar la capa de pendientes no justifica una peticion por fila.
     *
     * <p>El parametro se repite —{@code ?developerId=a&developerId=b}— en vez de venir separado por
     * comas: los identificadores son datos de fuera y una coma dentro de un login no tiene por que
     * partir la lista en dos.
     *
     * <p>Un identificador que GLPI no conoce no da {@code 404}: sale en {@code unknownDevelopers} y
     * el resto de la respuesta se sirve igual. La ruta por persona conserva su {@code 404}, que es lo
     * que necesita la pantalla de declaracion para decir que el identificador esta mal.
     */
    @GetMapping("/declarations")
    public TeamDeclarationsResponse declarations(
            @RequestParam("developerId") List<String> developerIds) {
        return declarationService.declarationsFor(developerIds);
    }
}
