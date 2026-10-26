package co.com.coltefinanciera.gestiondemanda.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;

import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataRequest;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataUpdateRequest;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiAuthenticationException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiUnreachableException;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningSource;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicket;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiUser;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataHistoryJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.RenegotiationHistoryJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.RenegotiationJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.RescheduleClaimJpaRepository;
import co.com.coltefinanciera.gestiondemanda.service.PlanningMetadataService;

/**
 * Pruebas de {@code POST /api/planning/from-glpi}.
 *
 * <p>El puerto de GLPI se sustituye por un doble, asi que no hay ninguna instancia real detras: lo
 * que se comprueba es el recorrido completo del caso de uso —traer, traducir, calcular, guardar y
 * responder— y como sale cada fallo por HTTP.
 *
 * <p>El escenario es el mismo que usa {@code PlanningEndpointsTest} escrito a mano: un incidente de
 * seis horas sobre una jornada de ocho obliga a desplazar un requerimiento de cuatro pactado para ese
 * mismo dia. Que los dos caminos produzcan el mismo plan es la afirmacion que sostiene la capa
 * anticorrupcion.
 *
 * <p><strong>La planificacion se declara antes de cada prueba, y por el camino real.</strong> Desde
 * la decision 124.2 las horas y la fecha compromiso no salen del ticket, asi que un escenario que no
 * las declare no planifica nada: los tickets se descartarian todos y las pruebas del recorrido no
 * probarian el recorrido. Se declaran por {@code PlanningMetadataService} y no escribiendo filas a
 * mano para que lo que entra al motor sea un estado que el dominio admite.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GlpiPlanningEndpointsTest {

    private static final String DEVELOPER = "dev-1";

    private static final String PETICION = """
            {"developerId": "dev-1"}
            """;

    /** El dia en que ocurre el escenario: el incidente se reporta y el requerimiento se pacto. */
    private static final String DIA_DEL_ESCENARIO = "2026-10-05";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private RescheduleClaimJpaRepository claims;

    @Autowired
    private PlanningMetadataService metadataService;

    @Autowired
    private PlanningMetadataJpaRepository metadataRows;

    @Autowired
    private PlanningMetadataHistoryJpaRepository metadataHistory;

    @Autowired
    private RenegotiationHistoryJpaRepository renegotiationHistory;

    @Autowired
    private RenegotiationJpaRepository renegotiations;

    @MockitoBean
    private GlpiPlanningSource glpiPlanningSource;

    @BeforeEach
    void limpiarYDeclarar() {
        claims.deleteAll();
        renegotiationHistory.deleteAll();
        renegotiations.deleteAll();
        metadataHistory.deleteAll();
        metadataRows.deleteAll();
        // Las horas y la fecha del escenario, que antes venian del ticket: seis horas de
        // actiontime y el time_to_resolve del cinco de octubre.
        declarar("501", "6");
        declarar("502", "4");
    }

    private void declarar(String workItemId, String horas) {
        metadataService.create(new PlanningMetadataRequest(workItemId, new BigDecimal(horas),
                LocalDate.parse(DIA_DEL_ESCENARIO), "ana"));
    }

    /**
     * El ticket de seis horas, sin prioridad.
     *
     * <p>Se deja sin prioridad a proposito: asi la severidad traducida es nula y el incidente entra
     * por el umbral de horas, que es exactamente el camino del escenario escrito a mano. La prueba
     * compara entonces dos caminos distintos de entrada con el mismo resultado.
     */
    private static GlpiTicket incidencia(int id, Integer priority) {
        return new GlpiTicket(id, "Falla en produccion", 1, GlpiTicket.TYPE_INCIDENT, priority, null,
                null, 21600L, null, "2026-10-05 09:00:00");
    }

    private static GlpiTicket peticion(int id, Integer priority) {
        return new GlpiTicket(id, "Ajuste de reporte", 1, GlpiTicket.TYPE_REQUEST, priority, null,
                null, 14400L, "2026-10-05 17:00:00", "2026-10-01 08:00:00");
    }

    private void glpiResponde(GlpiTicket... tickets) {
        when(glpiPlanningSource.findUser(DEVELOPER))
                .thenReturn(Optional.of(new GlpiUser(7, "ana", "Perez", "Ana")));
        when(glpiPlanningSource.activeTicketsOf("7")).thenReturn(List.of(tickets));
    }

    private String planificarDesdeGlpi() throws Exception {
        String body = mockMvc.perform(post("/api/planning/from-glpi")
                        .contentType(APPLICATION_JSON).content(PETICION))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        return JsonPath.read(body, "$.planId");
    }

    @Test
    @DisplayName("POST /from-glpi devuelve 201 con el identificador y el plan ya calculado")
    void planificaYDevuelveElIdentificador() throws Exception {
        glpiResponde(incidencia(501, null), peticion(502, null));

        mockMvc.perform(post("/api/planning/from-glpi")
                        .contentType(APPLICATION_JSON).content(PETICION))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.planId").isNotEmpty())
                .andExpect(jsonPath("$.createdAt").isNotEmpty())
                .andExpect(jsonPath("$.discarded.length()").value(0))
                // El mismo plan que produce el escenario escrito a mano: el incidente ocupa el lunes
                // de 9 a 15 y el requerimiento cierra el martes.
                .andExpect(jsonPath("$.plan.blocks.length()").value(3))
                .andExpect(jsonPath("$.plan.allocations.length()").value(2))
                .andExpect(jsonPath("$.plan.rescheduleEvents.length()").value(1))
                .andExpect(jsonPath("$.plan.rescheduleEvents[0].requirementId").value("502"))
                .andExpect(jsonPath("$.plan.rescheduleEvents[0].appliedRule")
                        .value("UMBRAL_INCIDENTE_EXCEDIDO"));
    }

    /**
     * Un desplazamiento no se convierte en acuerdo cuando GLPI ya ubica ahi el requerimiento.
     *
     * <p>Hasta la Fase 66b el requerimiento se planificaba con la fecha declarada y el TTR de GLPI era
     * una fecha distinta, posterior, que la conciliacion leia como renegociacion. Desde la Fase 66b el
     * plan ubica el requerimiento en su fecha operativa, asi que la fecha de GLPI y la original del
     * desplazamiento son la misma por construccion: la condicion 4 de la conciliacion —que la fecha
     * de GLPI sea posterior— no se cumple y no se escribe ningun acuerdo. Es exactamente lo que se
     * busca: registrar en {@code renegotiations} lo que el plan ya dice seria inventar un compromiso.
     *
     * <p>La prueba exige las dos mitades. Que haya desplazamiento —si no lo hubiera, la ausencia de
     * acuerdo no diria nada— y que aun asi no haya acuerdo: el pendiente sigue abierto y lo cierra una
     * persona, no una lectura de GLPI.
     */
    @Test
    @DisplayName("Un desplazamiento no se vuelve acuerdo si GLPI ya ubica ahi el requerimiento")
    void laFechaDeGlpiNoInventaAcuerdos() throws Exception {
        glpiResponde(incidencia(501, null), peticion(502, null));

        mockMvc.perform(post("/api/planning/from-glpi")
                        .contentType(APPLICATION_JSON).content(PETICION))
                .andExpect(status().isCreated())
                // El incidente desborda el lunes y el requerimiento se corre: hay desplazamiento.
                .andExpect(jsonPath("$.plan.rescheduleEvents.length()").value(1))
                .andExpect(jsonPath("$.plan.rescheduleEvents[0].requirementId").value("502"));

        String body = mockMvc.perform(get("/api/renegotiations"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // Pero no es una renegociacion: la fecha de GLPI es la que el plan ya uso, no una posterior.
        // El desplazamiento queda pendiente, que es la verdad —nadie ha acordado una fecha nueva—.
        assertThat(JsonPath.<List<String>>read(body,
                "$.items[?(@.workItemId == '502')].status"))
                .containsExactly("PENDIENTE_DE_ACUERDO");
    }

    @Test
    @DisplayName("from-glpi planifica con los tickets activos y no lee el historico cerrado")
    void planificaSoloConLosTicketsActivos() throws Exception {
        glpiResponde(incidencia(501, null), peticion(502, null));

        planificarDesdeGlpi();

        // La lista que se declara y la que se planifica salen de la misma pregunta. Leer el historico
        // entero volveria a abrir la brecha que la Fase 51 cierra.
        verify(glpiPlanningSource).activeTicketsOf("7");
        verify(glpiPlanningSource, never()).ticketsOf(anyString());
    }

    @Test
    @DisplayName("El plan calculado desde GLPI se puede volver a pedir como cualquier otro")
    void elPlanSeGuardaYSePuedeReleer() throws Exception {
        glpiResponde(incidencia(501, null), peticion(502, null));
        String planId = planificarDesdeGlpi();

        // La lectura de un plan guardado devuelve el plan plano, sin envoltorio: es la misma
        // respuesta que para un plan escrito a mano.
        mockMvc.perform(get("/api/planning/{planId}", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value(planId))
                .andExpect(jsonPath("$.allocations.length()").value(2));

        mockMvc.perform(get("/api/planning/{planId}/blocks", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3));
    }

    @Test
    @DisplayName("La entrada guardada declara que vino de GLPI, cuando y con que adaptador")
    void laEntradaDeclaraSuProcedencia() throws Exception {
        glpiResponde(incidencia(501, null), peticion(502, null));
        String planId = planificarDesdeGlpi();

        mockMvc.perform(get("/api/planning/{planId}/input", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source").value("GLPI"))
                // La version 3 es el ultimo corte: la 2 fue el cambio de donde salen las horas y la 3
                // el cambio de ruta con el que se recuperan los tickets, que antes llegaba vacia.
                .andExpect(jsonPath("$.adapterVersion").value("glpi-rest-4"))
                .andExpect(jsonPath("$.extractedAt").isNotEmpty())
                .andExpect(jsonPath("$.developerId").value(DEVELOPER))
                .andExpect(jsonPath("$.incidents.length()").value(1))
                .andExpect(jsonPath("$.incidents[0].id").value("501"))
                .andExpect(jsonPath("$.requirements.length()").value(1))
                .andExpect(jsonPath("$.requirements[0].id").value("502"));
    }

    @Test
    @DisplayName("La prioridad de GLPI llega traducida a severidad del dominio")
    void laPrioridadLlegaTraducida() throws Exception {
        glpiResponde(incidencia(501, 5), peticion(502, null));
        String planId = planificarDesdeGlpi();

        mockMvc.perform(get("/api/planning/{planId}/input", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.incidents[0].severity").value("ALTO"));
    }

    /**
     * La sustitucion, comprobada de extremo a extremo.
     *
     * <p>El ticket declara seis horas en {@code actiontime} y el desarrollador declara dos. Lo que
     * queda guardado como entrada del motor son dos, y esa es la unica forma de saber que el corte
     * llego hasta el final del recorrido y no se quedo en la factoria.
     */
    @Test
    @DisplayName("Las horas que entran al motor son las declaradas, no el actiontime del ticket")
    void lasHorasSonLasDeclaradas() throws Exception {
        metadataService.update("501", new PlanningMetadataUpdateRequest(
                new BigDecimal("2"), LocalDate.parse(DIA_DEL_ESCENARIO), "ana"));
        glpiResponde(incidencia(501, null), peticion(502, null));
        String planId = planificarDesdeGlpi();

        mockMvc.perform(get("/api/planning/{planId}/input", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.incidents[0].estimatedHours").value(2.0))
                .andExpect(jsonPath("$.requirements[0].estimatedHours").value(4.0))
                .andExpect(jsonPath("$.requirements[0].plannedDate").value(DIA_DEL_ESCENARIO));
    }

    @Test
    @DisplayName("Los tickets sin planificacion declarada se devuelven con sus motivos")
    void losTicketsSinDeclaracionSeDevuelven() throws Exception {
        GlpiTicket sinDeclaracion = new GlpiTicket(503, "Sin planificacion declarada", 1,
                GlpiTicket.TYPE_REQUEST, 3, null, null, 21600L, null, null, "2026-10-05 09:00:00");
        glpiResponde(incidencia(501, null), peticion(502, null), sinDeclaracion);

        mockMvc.perform(post("/api/planning/from-glpi")
                        .contentType(APPLICATION_JSON).content(PETICION))
                .andExpect(status().isCreated())
                // Dos entradas para un solo ticket: le falta la estimacion, que la debe el
                // desarrollador, y la fecha operativa, que la debe GLPI. Son dos sistemas distintos.
                .andExpect(jsonPath("$.discarded.length()").value(2))
                .andExpect(jsonPath("$.discarded[0].ticketId").value("503"))
                .andExpect(jsonPath("$.discarded[0].code").value("SIN_ESTIMACION_DECLARADA"))
                .andExpect(jsonPath("$.discarded[0].reason").value(
                        org.hamcrest.Matchers.containsString("no hay planificacion declarada")))
                .andExpect(jsonPath("$.discarded[1].ticketId").value("503"))
                .andExpect(jsonPath("$.discarded[1].code").value("SIN_FECHA_EN_GLPI"))
                // El ticket sin declarar no impide planificar el resto.
                .andExpect(jsonPath("$.plan.allocations.length()").value(2));
    }

    @Test
    @DisplayName("Un desarrollador que no esta en GLPI responde 404 DEVELOPER_NOT_FOUND")
    void desarrolladorInexistenteResponde404() throws Exception {
        when(glpiPlanningSource.findUser(DEVELOPER)).thenReturn(Optional.empty());

        mockMvc.perform(post("/api/planning/from-glpi")
                        .contentType(APPLICATION_JSON).content(PETICION))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("DEVELOPER_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString(DEVELOPER)));
    }

    @Test
    @DisplayName("GLPI inalcanzable responde 503 GLPI_UNAVAILABLE")
    void glpiInalcanzableResponde503() throws Exception {
        when(glpiPlanningSource.findUser(anyString())).thenReturn(Optional.of(
                new GlpiUser(7, "ana", "Perez", "Ana")));
        when(glpiPlanningSource.activeTicketsOf("7")).thenThrow(
                new GlpiUnreachableException("Response timeout after 5000ms", null));

        mockMvc.perform(post("/api/planning/from-glpi")
                        .contentType(APPLICATION_JSON).content(PETICION))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("GLPI_UNAVAILABLE"))
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("timeout")));
    }

    @Test
    @DisplayName("Credenciales rechazadas responde 502 GLPI_AUTHENTICATION_FAILED")
    void credencialesRechazadasResponde502() throws Exception {
        when(glpiPlanningSource.findUser(DEVELOPER)).thenThrow(
                new GlpiAuthenticationException("GLPI respondio HTTP 401 en initSession"));

        mockMvc.perform(post("/api/planning/from-glpi")
                        .contentType(APPLICATION_JSON).content(PETICION))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").value("GLPI_AUTHENTICATION_FAILED"));
    }

    @Test
    @DisplayName("Un cuerpo de peticion sin desarrollador responde 400 VALIDATION_ERROR")
    void sinDesarrolladorResponde400() throws Exception {
        mockMvc.perform(post("/api/planning/from-glpi")
                        .contentType(APPLICATION_JSON).content("{\"developerId\": \"  \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("VALIDATION_ERROR"));
    }

    @Test
    @DisplayName("Una agenda vacia en GLPI produce un plan vacio, no un error")
    void agendaVaciaProducePlanVacio() throws Exception {
        glpiResponde();

        mockMvc.perform(post("/api/planning/from-glpi")
                        .contentType(APPLICATION_JSON).content(PETICION))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.plan.allocations.length()").value(0))
                .andExpect(jsonPath("$.discarded.length()").value(0));
    }
}
