package co.com.coltefinanciera.gestiondemanda.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

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
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningSource;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicket;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiUser;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataHistoryJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.RescheduleClaimJpaRepository;
import co.com.coltefinanciera.gestiondemanda.service.PlanningMetadataService;

/**
 * Pruebas de {@code GET /api/planning/{planId}/timeline}.
 *
 * <p>Lo que se comprueba es una proyeccion de lectura, asi que la prueba es de lectura: se guarda un
 * plan por el camino real —{@code POST /plan} o {@code POST /from-glpi}— y despues se mira que lo que
 * devuelve el timeline sea lo que ya estaba escrito, con la capacidad contada encima. Un doble en el
 * servicio probaria el mapeo y no la lectura.
 *
 * <p>El escenario es el de {@code PlanningEndpointsTest}: un incidente de seis horas sobre una jornada
 * de ocho obliga a desplazar un requerimiento de cuatro pactado para ese mismo dia. Deja tres tramos
 * —el incidente de 09:00 a 15:00 el lunes, el requerimiento de 15:00 a 17:00 el lunes y de 09:00 a
 * 11:00 el martes— y un evento de desplazamiento sobre {@code REQ-1}. Con esos numeros la capacidad
 * del lunes y la del martes se pueden afirmar exactas, que es de lo que va la estrategia de capacidad.
 *
 * <p><strong>El escenario no declara severidad, y es a proposito.</strong> Un incidente {@code ALTO}
 * se comporta de forma {@code INMEDIATA}, que cierra el resto de la jornada en que arranca: el
 * requerimiento se iria entero al martes y el reparto de horas cambiaria. Sin severidad el incidente
 * entra por el umbral de horas, que es el camino con el que el plan ya esta fijado en las pruebas
 * anteriores. La severidad se prueba aparte, con {@code MEDIO}, que compite por capacidad y deja el
 * mismo reparto.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PlanningTimelineEndpointsTest {

    private static final String LUNES = "2026-10-05";
    private static final String MARTES = "2026-10-06";
    private static final String VIERNES = "2026-10-09";

    /** Un incidente de 6 h el lunes y un requerimiento de 4 h pactado para ese lunes. */
    private static final String ESCENARIO = """
            {
              "developer": {"id": "dev-1", "name": "Ana"},
              "incidents": [
                {
                  "id": "INC-1",
                  "title": "Falla en produccion",
                  "estimatedHours": 6,
                  "reportedAt": "2026-10-05T09:00:00Z",
                  "status": "ABIERTO"
                }
              ],
              "requirements": [
                {
                  "id": "REQ-1",
                  "title": "Ajuste de reporte",
                  "estimatedHours": 4,
                  "plannedDate": "2026-10-05",
                  "status": "PLANIFICADO"
                }
              ]
            }
            """;

    /** El mismo escenario sin trabajo: la agenda vacia, que no es un error. */
    private static final String SOLO_REGLAS = """
            {
              "developer": {"id": "dev-1", "name": "Ana"},
              "incidents": [],
              "requirements": [],
              "rules": {
                "incidentThresholdHours": 9,
                "workingHoursPerDay": 6,
                "planningHorizonDays": 3
              }
            }
            """;

    /** El mismo escenario con la severidad declarada, para poder agrupar por ella. */
    private static final String CON_SEVERIDAD = """
            {
              "developer": {"id": "dev-1", "name": "Ana"},
              "incidents": [
                {
                  "id": "INC-1",
                  "estimatedHours": 6,
                  "reportedAt": "2026-10-05T09:00:00Z",
                  "status": "ABIERTO",
                  "severity": "MEDIO"
                }
              ],
              "requirements": [
                {
                  "id": "REQ-1",
                  "estimatedHours": 4,
                  "plannedDate": "2026-10-05",
                  "status": "PLANIFICADO"
                }
              ]
            }
            """;

    /** Un requerimiento de doce horas pactado para el viernes: obliga a saltar el fin de semana. */
    private static final String CRUZA_EL_FIN_DE_SEMANA = """
            {
              "developer": {"id": "dev-1", "name": "Ana"},
              "incidents": [],
              "requirements": [
                {
                  "id": "REQ-LARGO",
                  "estimatedHours": 12,
                  "plannedDate": "2026-10-09",
                  "status": "PLANIFICADO"
                }
              ]
            }
            """;

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

    @MockitoBean
    private GlpiPlanningSource glpiPlanningSource;

    @BeforeEach
    void limpiar() {
        claims.deleteAll();
        metadataHistory.deleteAll();
        metadataRows.deleteAll();
    }

    @Test
    @DisplayName("El timeline trae los tramos ordenados por inicio con las horas y el compromiso de la foto")
    void elTimelineTraeLosTramosOrdenadosPorInicio() throws Exception {
        String planId = guardarPlan(ESCENARIO);

        mockMvc.perform(get("/api/planning/{planId}/timeline", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value(planId))
                .andExpect(jsonPath("$.developerId").value("dev-1"))
                .andExpect(jsonPath("$.from").value(LUNES))
                .andExpect(jsonPath("$.to").value(MARTES))
                .andExpect(jsonPath("$.items.length()").value(3))
                // Ordenados por inicio, que no es el orden en que el motor los produjo: alli los dos
                // tramos del requerimiento van seguidos, y aqui queda entre ellos su tramo del lunes.
                .andExpect(jsonPath("$.items[0].workItemId").value("INC-1"))
                .andExpect(jsonPath("$.items[0].workItemType").value("INCIDENTE"))
                .andExpect(jsonPath("$.items[0].startsAt").value("2026-10-05T09:00:00"))
                .andExpect(jsonPath("$.items[0].endsAt").value("2026-10-05T15:00:00"))
                .andExpect(jsonPath("$.items[0].developerId").value("dev-1"))
                .andExpect(jsonPath("$.items[0].estimatedHours").value(6.0))
                .andExpect(jsonPath("$.items[0].planningStatus").value("PLANIFICADO"))
                .andExpect(jsonPath("$.items[0].sourcePlanId").value(planId))
                .andExpect(jsonPath("$.items[1].workItemId").value("REQ-1"))
                .andExpect(jsonPath("$.items[1].workItemType").value("REQUERIMIENTO"))
                .andExpect(jsonPath("$.items[1].startsAt").value("2026-10-05T15:00:00"))
                .andExpect(jsonPath("$.items[1].committedDate").value(LUNES))
                .andExpect(jsonPath("$.items[1].planningStatus").value("DESPLAZADO"))
                .andExpect(jsonPath("$.items[2].workItemId").value("REQ-1"))
                .andExpect(jsonPath("$.items[2].startsAt").value("2026-10-06T09:00:00"));

        String timeline = timelineDe(planId);
        // Las horas de cada tramo, no las del elemento: seis el incidente y dos cada tramo del
        // requerimiento de cuatro. El total estimado viaja aparte, en estimatedHours.
        assertThat(numeroEn(timeline, "$.items[0].durationHours")).isEqualByComparingTo("6");
        assertThat(numeroEn(timeline, "$.items[1].durationHours")).isEqualByComparingTo("2");
        assertThat(numeroEn(timeline, "$.items[2].durationHours")).isEqualByComparingTo("2");
        assertThat(numeroEn(timeline, "$.items[2].estimatedHours")).isEqualByComparingTo("4");
        // Los dos nulos que la respuesta declara en vez de rellenar: el compromiso de un incidente no
        // esta en la foto —fue una puerta de planificabilidad, no una entrada del calculo— y la
        // severidad de un requerimiento no existe. Ninguno se reconstruye desde el estado de hoy.
        assertThat(textoEn(timeline, "$.items[0].committedDate")).isNull();
        assertThat(textoEn(timeline, "$.items[0].severity")).isNull();
        assertThat(textoEn(timeline, "$.items[1].severity")).isNull();
    }

    @Test
    @DisplayName("Un plan sin agenda devuelve un timeline vacio, no un error")
    void unPlanSinAgendaDevuelveUnTimelineVacio() throws Exception {
        String planId = guardarPlan(SOLO_REGLAS);

        mockMvc.perform(get("/api/planning/{planId}/timeline", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value(planId))
                .andExpect(jsonPath("$.developerId").value("dev-1"))
                // La ventana es la agenda: sin tramos no hay fechas que abarcar, y se dice con nulo en
                // vez de inventar el horizonte, cuya fecha de inicio no se guarda.
                .andExpect(jsonPath("$.from").doesNotExist())
                .andExpect(jsonPath("$.to").doesNotExist())
                .andExpect(jsonPath("$.items.length()").value(0))
                .andExpect(jsonPath("$.allocations.length()").value(0))
                // Y aun asi sale el recurso: el desarrollador del plan se conoce aunque no haya nada
                // que pintarle, y el frontend necesita la fila.
                .andExpect(jsonPath("$.resources.length()").value(1))
                .andExpect(jsonPath("$.resources[0].developerId").value("dev-1"))
                .andExpect(jsonPath("$.resources[0].capacity.length()").value(0));
    }

    @Test
    @DisplayName("Los tramos se pueden agrupar por desarrollador sin pedir nada mas")
    void losTramosSeAgrupanPorDesarrollador() throws Exception {
        String planId = guardarPlan(ESCENARIO);
        String timeline = timelineDe(planId);

        Map<String, List<String>> porDesarrollador = agrupar(timeline, "developerId");

        // Un solo desarrollador y todos los tramos suyos. La agrupacion se hace sobre la respuesta tal
        // como llega: el timeline no exige una llamada mas para saber de quien es cada tramo.
        assertThat(porDesarrollador).containsOnlyKeys("dev-1");
        assertThat(porDesarrollador.get("dev-1"))
                .containsExactlyInAnyOrder("INC-1", "REQ-1", "REQ-1");
        // Y el recurso que declara la capacidad es el mismo que el de los tramos.
        assertThat(desarrolladoresDeRecursos(timeline)).containsExactly("dev-1");
    }

    @Test
    @DisplayName("Los tramos se pueden agrupar por tipo de trabajo sin pedir nada mas")
    void losTramosSeAgrupanPorTipo() throws Exception {
        String planId = guardarPlan(ESCENARIO);
        String timeline = timelineDe(planId);

        Map<String, List<String>> porTipo = agrupar(timeline, "workItemType");

        assertThat(porTipo.get("INCIDENTE")).containsExactly("INC-1");
        assertThat(porTipo.get("REQUERIMIENTO")).containsExactly("REQ-1", "REQ-1");
    }

    /**
     * Severidad y estado de planificacion, que son las otras dos dimensiones de agrupacion.
     *
     * <p>Se usa {@code MEDIO} y no {@code ALTO}: el comportamiento inmediato cierra la jornada del dia
     * en que arranca el incidente y el reparto de horas dejaria de ser el del escenario. {@code MEDIO}
     * compite por capacidad, desplaza lo que ya no cabe y produce los mismos tres tramos.
     */
    @Test
    @DisplayName("Los tramos se pueden agrupar por severidad y por estado de planificacion")
    void losTramosSeAgrupanPorSeveridadYEstado() throws Exception {
        String planId = guardarPlan(CON_SEVERIDAD);
        String timeline = timelineDe(planId);

        // La severidad solo la tiene el incidente: es un atributo suyo en la foto, y el requerimiento
        // agrupa aparte bajo su nulo en vez de heredar una severidad que no tiene.
        assertThat(agrupar(timeline, "severity").get("MEDIO")).containsExactly("INC-1");
        assertThat(agrupar(timeline, "severity").get("null")).containsExactly("REQ-1", "REQ-1");

        // Y el estado de planificacion separa lo que se movio de lo que no, que es la lectura que un
        // timeline usa para pintar de otro color.
        Map<String, List<String>> porEstado = agrupar(timeline, "planningStatus");
        assertThat(porEstado.get("PLANIFICADO")).containsExactly("INC-1");
        assertThat(porEstado.get("DESPLAZADO")).containsExactly("REQ-1", "REQ-1");

        // El reparto de horas es el mismo que sin severidad: seis del incidente y dos del primer
        // tramo del requerimiento el lunes.
        assertThat(numeroEn(timeline, "$.resources[0].capacity[0].occupiedHours"))
                .isEqualByComparingTo("8");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[1].remainingHours"))
                .isEqualByComparingTo("6");
    }

    @Test
    @DisplayName("La capacidad del dia es la jornada menos lo que ocupan sus tramos")
    void laCapacidadDelDiaEsLaJornadaMenosSusTramos() throws Exception {
        String planId = guardarPlan(ESCENARIO);

        mockMvc.perform(get("/api/planning/{planId}/timeline", planId))
                .andExpect(status().isOk())
                // Una entrada por cada dia de la ventana, para que el frontend alinee las filas sin
                // rellenar huecos.
                .andExpect(jsonPath("$.resources[0].capacity.length()").value(2))
                .andExpect(jsonPath("$.resources[0].capacity[0].date").value(LUNES))
                .andExpect(jsonPath("$.resources[0].capacity[1].date").value(MARTES));

        String timeline = timelineDe(planId);
        // El lunes: seis horas de incidente y dos del primer tramo del requerimiento. El martes: dos
        // horas del segundo tramo y seis libres.
        assertThat(numeroEn(timeline, "$.resources[0].capacity[0].availableHours"))
                .isEqualByComparingTo("8");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[0].occupiedHours"))
                .isEqualByComparingTo("8");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[0].remainingHours"))
                .isEqualByComparingTo("0");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[1].availableHours"))
                .isEqualByComparingTo("8");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[1].occupiedHours"))
                .isEqualByComparingTo("2");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[1].remainingHours"))
                .isEqualByComparingTo("6");
        // Las horas se publican sin los ceros que deja NUMERIC(10,4) al rehidratar: 8, no 8.0000.
        assertThat(numeroEn(timeline, "$.resources[0].capacity[1].availableHours").scale())
                .isLessThanOrEqualTo(0);
    }

    /**
     * El fin de semana dentro de la ventana.
     *
     * <p>Es el caso que obliga a recorrer la ventana entera y no solo los dias con trabajo: un sabado
     * no tiene tramos, pero si una fila con jornada cero. Sin ella el frontend tendria que rellenar el
     * hueco del eje por su cuenta, que es justo lo que la fase le ahorra.
     */
    @Test
    @DisplayName("Un dia no laborable de la ventana sale con jornada cero")
    void unDiaNoLaborableSaleConJornadaCero() throws Exception {
        String planId = guardarPlan(CRUZA_EL_FIN_DE_SEMANA);
        String timeline = timelineDe(planId);

        // Ocho horas el viernes y las cuatro que faltan el lunes: el sabado y el domingo quedan en
        // medio, y los dos aparecen con jornada cero en lugar de desaparecer.
        assertThat(fechasDeCapacidad(timeline)).containsExactly(
                LocalDate.parse(VIERNES),
                LocalDate.parse("2026-10-10"),
                LocalDate.parse("2026-10-11"),
                LocalDate.parse("2026-10-12"));
        assertThat(numeroEn(timeline, "$.resources[0].capacity[0].availableHours"))
                .isEqualByComparingTo("8");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[0].remainingHours"))
                .isEqualByComparingTo("0");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[1].availableHours"))
                .isEqualByComparingTo("0");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[1].occupiedHours"))
                .isEqualByComparingTo("0");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[2].availableHours"))
                .isEqualByComparingTo("0");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[3].occupiedHours"))
                .isEqualByComparingTo("4");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[3].remainingHours"))
                .isEqualByComparingTo("4");
    }

    @Test
    @DisplayName("Cada tramo del timeline apunta a algo que existe en las otras lecturas del plan")
    void cadaTramoApuntaAAlgoQueExiste() throws Exception {
        String planId = guardarPlan(ESCENARIO);

        String timeline = timelineDe(planId);
        String entrada = leer("/api/planning/{planId}/input", planId);
        String bloques = leer("/api/planning/{planId}/blocks", planId);
        String plan = leer("/api/planning/{planId}", planId);

        // Todo elemento que el timeline pinta entro al motor y esta en la foto.
        List<String> declarados = new ArrayList<>(idsEn(entrada, "$.incidents"));
        declarados.addAll(idsEn(entrada, "$.requirements"));
        assertThat(itemsEn(timeline)).extracting(item -> item.get("workItemId"))
                .isSubsetOf(declarados);

        // Y todo tramo del timeline es uno de los bloques guardados, con el mismo inicio y el mismo
        // fin: el timeline no añade agenda, solo la proyecta. La pareja elemento mas inicio es ademas
        // el identificador del bloque, que no tiene uno propio.
        List<String> tramosGuardados = bloquesEn(bloques).stream()
                .map(bloque -> bloque.get("workItemId") + "@" + bloque.get("start"))
                .toList();
        assertThat(itemsEn(timeline))
                .extracting(item -> item.get("workItemId") + "@" + item.get("startsAt"))
                .containsExactlyInAnyOrderElementsOf(tramosGuardados);

        // Las asignaciones son las del plan, sin duplicarse por tramo: el requerimiento de cuatro horas
        // tiene una sola asignacion aunque ocupe dos dias. Se comparan enteras y no por identificador,
        // porque lo que se afirma es que la lista no se recorta ni se reordena al proyectarla.
        assertThat(allocationsEn(timeline)).isEqualTo(allocationsEn(plan, "$.allocations"));
        assertThat(allocationsEn(timeline)).extracting(asignacion -> asignacion.get("workItemId"))
                .isSubsetOf(declarados);
    }

    @Test
    @DisplayName("Un plan inexistente responde 404 con el mismo codigo que las otras lecturas")
    void unPlanInexistenteResponde404() throws Exception {
        mockMvc.perform(get("/api/planning/{planId}/timeline", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));

        mockMvc.perform(get("/api/planning/{planId}/timeline", "no-es-un-uuid"))
                .andExpect(status().isBadRequest());
    }

    /**
     * Un plan calculado desde GLPI se lee igual que uno escrito a mano.
     *
     * <p>Los dos caminos acaban en las mismas tablas, asi que el timeline no puede distinguirlos. Se
     * comprueba con el mismo escenario por los dos lados para que la igualdad sea del resultado y no
     * del texto: mismos tramos, misma capacidad, mismos identificadores.
     */
    @Test
    @DisplayName("Un plan traido de GLPI se lee por el timeline como cualquier otro")
    void unPlanDeGlpiSeLeeIgual() throws Exception {
        declarar("501", "6");
        declarar("502", "4");
        glpiResponde();
        String planId = planificarDesdeGlpi();

        String timeline = timelineDe(planId);

        assertThat(fechasDeCapacidad(timeline))
                .containsExactly(LocalDate.parse(LUNES), LocalDate.parse(MARTES));
        assertThat(numeroEn(timeline, "$.resources[0].capacity[0].occupiedHours"))
                .isEqualByComparingTo("8");
        assertThat(numeroEn(timeline, "$.resources[0].capacity[1].remainingHours"))
                .isEqualByComparingTo("6");
        assertThat(itemsEn(timeline)).extracting(item -> item.get("workItemId"))
                .containsExactly("501", "502", "502");

        // Y las cuatro lecturas anteriores del plan siguen respondiendo lo mismo que respondian.
        mockMvc.perform(get("/api/planning/{planId}", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.blocks.length()").value(3));
        mockMvc.perform(get("/api/planning/{planId}/blocks", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3));
        mockMvc.perform(get("/api/planning/{planId}/context", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value(planId));
        mockMvc.perform(get("/api/planning/{planId}/input", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source").value("GLPI"));
    }

    /**
     * La reproducibilidad, que es la razon de ser de la fase.
     *
     * <p>El escenario se planifica desde GLPI, donde las horas <em>si</em> vienen de la planificacion
     * declarada, y despues se cambia la declaracion. El plan guardado tiene que seguir contando lo que
     * entro al motor. Un segundo plan del mismo ticket, calculado despues del cambio, si trae las horas
     * nuevas: los dos numeros conviven porque cada plan guarda su propia foto.
     *
     * <p>Sin esta prueba la reproducibilidad seria una promesa sin comprobar: es lo unico que distingue
     * leer la foto de leer la declaracion de hoy.
     */
    @Test
    @DisplayName("Cambiar la declaracion despues no cambia el timeline de un plan ya guardado")
    void cambiarLaDeclaracionNoCambiaElTimeline() throws Exception {
        declarar("501", "6");
        declarar("502", "4");
        glpiResponde();
        String planGuardado = planificarDesdeGlpi();

        String antes = timelineDe(planGuardado);
        assertThat(numeroEn(antes, "$.items[0].estimatedHours")).isEqualByComparingTo("6");

        // El desarrollador vuelve a estimar el incidente: pasa de seis horas a dos.
        metadataService.update("501",
                new PlanningMetadataUpdateRequest(new BigDecimal("2"), LocalDate.parse(LUNES), "ana"));

        // Un plan nuevo del mismo ticket si trae las dos horas: el cambio es real y surte efecto.
        String planNuevo = planificarDesdeGlpi();
        String despuesDelCambio = timelineDe(planNuevo);
        assertThat(numeroEn(despuesDelCambio, "$.items[0].estimatedHours"))
                .isEqualByComparingTo("2");
        assertThat(numeroEn(despuesDelCambio, "$.resources[0].capacity[0].occupiedHours"))
                .isEqualByComparingTo("6");

        // Y el plan viejo no se entera: sigue con sus seis horas y su jornada llena.
        String despues = timelineDe(planGuardado);
        assertThat(numeroEn(despues, "$.items[0].estimatedHours")).isEqualByComparingTo("6");
        assertThat(numeroEn(despues, "$.resources[0].capacity[0].occupiedHours"))
                .isEqualByComparingTo("8");
        // La respuesta entera es la misma, byte a byte: ningun valor depende del reloj.
        assertThat(despues).isEqualTo(antes);
    }

    private String guardarPlan(String escenario) throws Exception {
        String body = mockMvc.perform(
                        post("/api/planning/plan").contentType(APPLICATION_JSON).content(escenario))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return JsonPath.read(body, "$.planId");
    }

    private void declarar(String workItemId, String horas) {
        metadataService.create(new PlanningMetadataRequest(workItemId, new BigDecimal(horas),
                LocalDate.parse(LUNES), "ana"));
    }

    /**
     * Los dos tickets del escenario, sin prioridad.
     *
     * <p>Sin prioridad la severidad traducida es nula y el incidente entra por el umbral de horas, que
     * es el mismo camino del escenario escrito a mano. La prueba compara entonces dos entradas distintas
     * con el mismo resultado, que es lo que sostiene la capa anticorrupcion.
     */
    private void glpiResponde() {
        when(glpiPlanningSource.findUser("dev-1"))
                .thenReturn(Optional.of(new GlpiUser(7, "ana", "Perez", "Ana")));
        when(glpiPlanningSource.activeTicketsOf("7")).thenReturn(List.of(
                new GlpiTicket(501, "Falla en produccion", 1, GlpiTicket.TYPE_INCIDENT, null, null,
                        null, 21600L, null, "2026-10-05 09:00:00"),
                new GlpiTicket(502, "Ajuste de reporte", 1, GlpiTicket.TYPE_REQUEST, null, null,
                        null, 14400L, "2026-10-05 17:00:00", "2026-10-01 08:00:00")));
    }

    private String planificarDesdeGlpi() throws Exception {
        String body = mockMvc.perform(post("/api/planning/from-glpi")
                        .contentType(APPLICATION_JSON).content("{\"developerId\": \"dev-1\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return JsonPath.read(body, "$.planId");
    }

    private String timelineDe(String planId) throws Exception {
        return leer("/api/planning/{planId}/timeline", planId);
    }

    private String leer(String ruta, String planId) throws Exception {
        return mockMvc.perform(get(ruta, planId))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    /**
     * Los tramos agrupados por una de sus dimensiones.
     *
     * <p>La agrupacion se escribe aqui y no en produccion a proposito: el contrato ya trae el atributo
     * en cada tramo, asi que agrupar es un {@code groupingBy} sobre la respuesta. Un endpoint por cada
     * forma de agrupar seria multiplicar la superficie sin añadir informacion.
     *
     * <p>La clave de un atributo nulo es la cadena {@code "null"} y no un nulo: lo que se comprueba es
     * que los tramos sin severidad quedan juntos y aparte, no como se escribe esa ausencia.
     */
    private static Map<String, List<String>> agrupar(String timeline, String dimension) {
        return itemsEn(timeline).stream()
                .collect(Collectors.groupingBy(item -> String.valueOf(item.get(dimension)),
                        Collectors.mapping(item -> (String) item.get("workItemId"),
                                Collectors.toList())));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> itemsEn(String timeline) {
        return JsonPath.parse(timeline).read("$.items", List.class);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> bloquesEn(String bloques) {
        return JsonPath.parse(bloques).read("$", List.class);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> allocationsEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta, List.class);
    }

    private static List<Map<String, Object>> allocationsEn(String timeline) {
        return allocationsEn(timeline, "$.allocations");
    }

    private static List<String> desarrolladoresDeRecursos(String timeline) {
        return JsonPath.parse(timeline).read("$.resources[*].developerId", List.class);
    }

    private static List<LocalDate> fechasDeCapacidad(String timeline) {
        return JsonPath.parse(timeline).read("$.resources[0].capacity[*].date", List.class).stream()
                .map(fecha -> LocalDate.parse(fecha.toString()))
                .toList();
    }

    private static List<String> idsEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta + "[*].id", List.class);
    }

    /** Un numero de la respuesta, leido como BigDecimal para poder compararlo por valor. */
    private static BigDecimal numeroEn(String respuesta, String ruta) {
        return new BigDecimal(JsonPath.parse(respuesta).read(ruta).toString());
    }

    private static String textoEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta, String.class);
    }
}
