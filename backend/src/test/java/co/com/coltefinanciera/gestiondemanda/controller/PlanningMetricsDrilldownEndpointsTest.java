package co.com.coltefinanciera.gestiondemanda.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

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
import co.com.coltefinanciera.gestiondemanda.persistence.PlanSnapshotJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningConflictJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataHistoryJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.RescheduleClaimJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.WorkBlockJpaRepository;
import co.com.coltefinanciera.gestiondemanda.service.PlanningMetadataService;

/**
 * Pruebas de los dos desgloses de la fotografia: {@code GET /api/planning/metrics/declared/{gap}} y
 * {@code GET /api/planning/metrics/displaced}.
 *
 * <p>Se prueba un desglose, asi que la prueba es de cuadre: el escenario se guarda por el camino real
 * —{@code POST /plan} y {@code POST /api/planning-metadata}— y despues se comprueba que el numero de
 * elementos del detalle sea el numero que la fotografia ya publicaba. <strong>El numero se lee del
 * endpoint, no se escribe a mano.</strong> Escribirlo convertiria la prueba en una copia del escenario
 * y dejaria de comprobar lo unico que importa: que la cifra y su lista salen del mismo predicado y no
 * pueden separarse. Es la misma forma que usa la prueba de capacidad de {@code
 * PlanningMetricsEndpointsTest} con el timeline.
 *
 * <p><strong>Sin dobles de servicio.</strong> Un doble probaria el mapeo y no la lectura, y lo que hay
 * que probar aqui es que la lista sea la de la base. El unico doble es la puerta a GLPI, que no se toca
 * en esta fase.
 *
 * <p>El escenario es el de {@code PlanningMetricsEndpointsTest}: un incidente de seis horas sobre una
 * jornada de ocho obliga a desplazar un requerimiento de cuatro pactado para ese mismo dia.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PlanningMetricsDrilldownEndpointsTest {

    private static final String LUNES = "2026-10-05";
    private static final String MARTES = "2026-10-06";

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

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private PlanningMetadataService metadataService;

    @Autowired
    private RescheduleClaimJpaRepository claims;

    @Autowired
    private PlanningMetadataJpaRepository metadataRows;

    @Autowired
    private PlanningMetadataHistoryJpaRepository metadataHistory;

    @Autowired
    private PlanSnapshotJpaRepository planRows;

    @Autowired
    private WorkBlockJpaRepository blockRows;

    @Autowired
    private PlanningConflictJpaRepository conflictRows;

    @MockitoBean
    private GlpiPlanningSource glpiPlanningSource;

    @BeforeEach
    void limpiar() {
        claims.deleteAll();
        metadataHistory.deleteAll();
        metadataRows.deleteAll();
        conflictRows.deleteAll();
        blockRows.deleteAll();
        planRows.deleteAll();
    }

    /**
     * El cuadre que sostiene la fase, en su forma mas simple.
     *
     * <p>Cuatro filas declaradas, tres de ellas sin estimacion. La tarjeta dice tres y el detalle tiene
     * que tener tres: no dos, no cuatro. Y se compara contra la fotografia y no contra un tres escrito
     * a mano, porque lo que hay que demostrar es que las dos lecturas coinciden, no que el escenario
     * tenga el tamaño que su autor creia.
     */
    @Test
    @DisplayName("El detalle de sin estimacion trae tantas filas como dice la tarjeta")
    void elDetalleDeSinEstimacionTraeTantasFilasComoDiceLaTarjeta() throws Exception {
        declarar("A", null, LocalDate.parse(LUNES));
        declarar("B", null, LocalDate.parse(MARTES));
        declarar("C", null, LocalDate.parse(LUNES));
        declarar("D", new BigDecimal("4"), LocalDate.parse(MARTES));

        String detalle = leer("/api/planning/metrics/declared/SIN_ESTIMACION");
        String foto = leerMetricas();

        assertThat(cuantosEn(detalle, "$.items.length()"))
                .isEqualTo(cuantosEn(foto, "$.declared.withoutEstimation.count"))
                .isEqualTo(3);

        // Y el detalle devuelve la carencia por la que se pregunto, para que la respuesta se pueda
        // leer sin su peticion.
        assertThat(textoEn(detalle, "$.gap")).isEqualTo("SIN_ESTIMACION");
    }

    /**
     * Lo que la fila si dice.
     *
     * <p>Una fila declarada se explica con lo que hay declarado: el elemento, la fecha compromiso, quien
     * la declaro y cuando. La trazabilidad no es decorado —es lo unico que permite reclamarle a
     * alguien— asi que se afirma que viaja, y con ella los dos textos de procedencia que el bloque de la
     * fotografia ya publica.
     */
    @Test
    @DisplayName("Cada fila trae el elemento y lo que si esta declarado, con su procedencia")
    void cadaFilaTraeElElementoYLoQueSiEstaDeclarado() throws Exception {
        declarar("A", null, LocalDate.parse(LUNES));

        String detalle = leer("/api/planning/metrics/declared/SIN_ESTIMACION");

        assertThat(textoEn(detalle, "$.items[0].workItemId")).isEqualTo("A");
        assertThat(textoEn(detalle, "$.items[0].committedDate")).isEqualTo(LUNES);
        assertThat(textoEn(detalle, "$.items[0].committedBy")).isEqualTo("ana");
        assertThat(textoEn(detalle, "$.items[0].committedAt")).isNotEmpty();

        mockMvc.perform(get("/api/planning/metrics/declared/SIN_ESTIMACION"))
                .andExpect(jsonPath("$.items[0].estimatedHours").doesNotExist())
                // La fila es la de la declaracion, con su propia procedencia: de donde vino el dato
                // declarado, que no es lo mismo que de donde sale esta lista.
                .andExpect(jsonPath("$.items[0].source").value("HTTP"))
                // Los dos textos son los del bloque declarado de la fotografia, no literales nuevos: si
                // el origen cambiara, tendria que cambiar en los dos sitios a la vez.
                .andExpect(jsonPath("$.source").value("planning_metadata"))
                .andExpect(jsonPath("$.scope").isNotEmpty())
                .andExpect(jsonPath("$.code").value("SIN_ESTIMACION_DECLARADA"))
                .andExpect(jsonPath("$.generatedAt").isNotEmpty());
    }

    /**
     * La carencia compuesta incluye las dos simples y las retiradas.
     *
     * <p>Es la parte del algebra que se equivoca sola: {@code metadata incompleta} es la <em>union</em>
     * —todo lo que le falta al menos un valor— y no la interseccion, asi que la fila a la que le faltan
     * los dos cuenta una vez y no dos. Las cuatro situaciones se producen por el camino real, incluida
     * la retirada, que es un estado legitimo de la actualizacion.
     */
    @Test
    @DisplayName("Metadata incompleta es la union: incluye las de un valor y las retiradas")
    void metadataIncompletaEsLaUnion() throws Exception {
        declarar("X", new BigDecimal("8"), null);
        declarar("Y", null, LocalDate.parse(LUNES));
        declarar("Z", new BigDecimal("2"), LocalDate.parse(LUNES));
        retirarTodo("Z");
        declarar("OK", new BigDecimal("4"), LocalDate.parse(MARTES));

        String detalle = leer("/api/planning/metrics/declared/METADATA_INCOMPLETA");
        String foto = leerMetricas();

        // X, Y y Z: las tres, y ni la completa ni la retirada contada dos veces.
        assertThat(JsonPath.parse(detalle).read("$.items[*].workItemId", List.class))
                .containsExactly("X", "Y", "Z");

        assertThat(cuantosEn(detalle, "$.items.length()"))
                .isEqualTo(cuantosEn(foto, "$.declared.incomplete"))
                .isEqualTo(3);

        // Y no tiene codigo, porque no es un descarte: es la union de los dos que si lo tienen. La
        // fotografia tampoco se lo inventa, asi que inventarlo aqui publicaria un codigo inexistente.
        mockMvc.perform(get("/api/planning/metrics/declared/METADATA_INCOMPLETA"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").doesNotExist());
    }

    /**
     * Una carencia sin elementos no es un error.
     *
     * <p>Es el estado normal de un tablero sano: nadie ha dejado nada a medias y la lista esta vacia. Un
     * {@code 404} obligaria a la interfaz a tratar la buena noticia como un fallo, y un error obligaria
     * a inventarse un mensaje.
     */
    @Test
    @DisplayName("Una carencia sin elementos devuelve una lista vacia y no un error")
    void unaCarenciaSinElementosDevuelveUnaListaVacia() throws Exception {
        declarar("OK", new BigDecimal("4"), LocalDate.parse(MARTES));

        mockMvc.perform(get("/api/planning/metrics/declared/SIN_ESTIMACION"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.gap").value("SIN_ESTIMACION"))
                .andExpect(jsonPath("$.items.length()").value(0));

        mockMvc.perform(get("/api/planning/metrics/declared/SIN_COMPROMISO"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));

        // Y con la tabla entera vacia, que es el caso de un arranque en limpio.
        metadataRows.deleteAll();
        mockMvc.perform(get("/api/planning/metrics/declared/METADATA_INCOMPLETA"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    /**
     * Una carencia que no existe es un parametro mal formado, y se responde como tal.
     *
     * <p>No lleva manejo propio: el valor se convierte al enum antes de entrar al metodo, y lo que no
     * convierte sale por el mismo camino que cualquier parametro invalido de la aplicacion. Escribir un
     * {@code 400} a mano daria dos formas de decir lo mismo.
     */
    @Test
    @DisplayName("Una carencia desconocida responde 400 con el codigo de parametro invalido")
    void unaCarenciaDesconocidaResponde400() throws Exception {
        mockMvc.perform(get("/api/planning/metrics/declared/no-existe"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_PARAMETER"));

        // La ruta nueva tampoco se come a las de siempre: un plan que no existe sigue siendo un 404.
        mockMvc.perform(get("/api/planning/{planId}", "0f0b7c1e-0000-0000-0000-000000000000"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));
    }

    /**
     * Una fila desplazada dice quien, donde y por que.
     *
     * <p>El porque no se re-deriva aqui: es el mismo texto que publica la lectura del plan, derivado de
     * la regla aplicada. Un hecho escrito en dos sitios acaba escrito de dos formas, asi que se afirma
     * que el motivo viaja y que es legible, y se comprueba contra el plan que lo origino.
     */
    @Test
    @DisplayName("Los desplazamientos traen el elemento, el desarrollador, el plan y su causa")
    void losDesplazamientosTraenElElementoElDesarrolladorYLaCausa() throws Exception {
        String planId = guardarPlan(ESCENARIO);

        String detalle = leer("/api/planning/metrics/displaced");
        String plan = leer("/api/planning/{planId}", planId);

        assertThat(textoEn(detalle, "$.items[0].workItemId")).isEqualTo("REQ-1");
        assertThat(textoEn(detalle, "$.items[0].developerId")).isEqualTo("dev-1");
        assertThat(textoEn(detalle, "$.items[0].planId")).isEqualTo(planId);
        assertThat(textoEn(detalle, "$.items[0].calculatedAt")).isNotEmpty();

        // El motivo y las fechas son los del plan guardado, no unos derivados aparte.
        assertThat(JsonPath.parse(detalle).read("$.items[0].events[*].reason", List.class))
                .isEqualTo(JsonPath.parse(plan).read("$.rescheduleEvents[*].reason", List.class));
        assertThat(JsonPath.parse(detalle).read("$.items[0].events[*].incidentId", List.class))
                .containsOnly("INC-1");
        assertThat(JsonPath.parse(detalle).read("$.items[0].events[0].originalDate", String.class))
                .isEqualTo(LUNES);
        assertThat(textoEn(detalle, "$.items[0].events[0].reason")).isNotBlank();

        // Y la procedencia es la del bloque vigente, que es de donde sale la cifra.
        assertThat(textoEn(detalle, "$.source")).isEqualTo("plan_snapshot.created_at + work_block"
                + " + planning_context");
        assertThat(textoEn(detalle, "$.scope")).isNotEmpty();
    }

    /**
     * Un elemento desplazado en varios tramos sigue siendo una sola fila.
     *
     * <p>Es la diferencia entre elementos y tramos, que es exactamente lo que la tarjeta anuncia: el
     * requerimiento ocupa dos jornadas de agenda y se movio una vez. Si el detalle listara tramos, el
     * enlace de la tarjeta llevaria a una lista mas larga que el numero al que se llego por ella —y la
     * lista seria la que miente, porque el elemento es uno.
     */
    @Test
    @DisplayName("Un elemento con varios tramos desplazados aparece una sola vez")
    void unElementoConVariosTramosDesplazadosApareceUnaSolaVez() throws Exception {
        String planId = guardarPlan(ESCENARIO);

        String timeline = leer("/api/planning/{planId}/timeline", planId);
        List<String> estados = JsonPath.parse(timeline).read("$.items[*].planningStatus");
        List<String> elementos = JsonPath.parse(timeline).read("$.items[*].workItemId");

        long tramosDesplazados = 0;
        for (int i = 0; i < estados.size(); i++) {
            if ("DESPLAZADO".equals(estados.get(i)) && "REQ-1".equals(elementos.get(i))) {
                tramosDesplazados++;
            }
        }

        // El escenario deja dos tramos del mismo requerimiento: el caso que la prueba necesita.
        assertThat(tramosDesplazados).isEqualTo(2);

        String detalle = leer("/api/planning/metrics/displaced");

        assertThat(JsonPath.parse(detalle).read("$.items[*].workItemId", List.class))
                .containsExactly("REQ-1");
        // Y todos los eventos de la fila son suyos: la agrupacion no mezcla elementos.
        assertThat(JsonPath.parse(detalle).read("$.items[0].events[*].requirementId", List.class))
                .isNotEmpty()
                .containsOnly("REQ-1");
    }

    /**
     * El cuadre de los desplazados, contra la fotografia.
     *
     * <p>Misma forma que el cuadre declarado: el numero de filas se compara con el contador que la
     * tarjeta publica, leido en la misma prueba. Las dos lecturas salen del mismo timeline, asi que no
     * pueden discrepar ni hoy ni el dia que alguien añada un estado nuevo.
     */
    @Test
    @DisplayName("Las filas de desplazados cuadran con el contador de la tarjeta")
    void lasFilasDeDesplazadosCuadranConElContadorDeLaTarjeta() throws Exception {
        String planId = guardarPlan(ESCENARIO);

        String detalle = leer("/api/planning/metrics/displaced");
        String foto = leerMetricas();

        assertThat(cuantosEn(detalle, "$.items.length()"))
                .isEqualTo(cuantosEn(foto, "$.current.displacedRequirements"))
                .isEqualTo(1);
        // Y la fila dice de que plan salio, que es lo que permite volver a el y comprobarla. El
        // identificador se compara con el que devolvio el POST, no con un literal.
        assertThat(textoEn(detalle, "$.items[0].planId")).isEqualTo(planId);
        assertThat(textoEn(foto, "$.current.byDeveloper[0].planId")).isEqualTo(planId);
    }

    /**
     * Sin planes vigentes no hay nada desplazado, y no es un fallo.
     *
     * <p>Es el arranque en limpio: la tabla de planes vacia. La lista sale vacia en vez de reventar por
     * un nulo, que es lo que pasaria si el detalle diera por hecho que hay algo que recorrer.
     */
    @Test
    @DisplayName("Sin planes vigentes la lista de desplazados esta vacia y no falla")
    void sinPlanesVigentesLaListaDeDesplazadosEstaVacia() throws Exception {
        mockMvc.perform(get("/api/planning/metrics/displaced"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0))
                .andExpect(jsonPath("$.source").isNotEmpty())
                .andExpect(jsonPath("$.generatedAt").isNotEmpty());

        // Y un plan sin agenda tampoco desplaza nada: no hay tramos que marcar.
        guardarPlan(SOLO_REGLAS);
        mockMvc.perform(get("/api/planning/metrics/displaced"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    /**
     * Los desgloses no escriben nada, y dos llamadas devuelven lo mismo salvo la fecha.
     *
     * <p>Es la otra mitad del principio de la fase —leer lo persistido y no reconstruir estado— y se
     * comprueba contando antes y despues. Un desglose que escribiera seria una fuga silenciosa: no
     * fallaria ninguna prueba de contenido y la base creceria sola. La estabilidad es lo que hace que el
     * detalle sea una lectura y no un calculo con su propio criterio.
     */
    @Test
    @DisplayName("Los desgloses no escriben nada y son estables salvo la fecha")
    void losDesglosesNoEscribenNadaYsonEstables() throws Exception {
        guardarPlan(ESCENARIO);
        declarar("A", null, LocalDate.parse(LUNES));

        long planesAntes = planRows.count();
        long bloquesAntes = blockRows.count();
        long metadataAntes = metadataRows.count();
        long conflictosAntes = conflictRows.count();

        String declaradoPrimero = leer("/api/planning/metrics/declared/SIN_ESTIMACION");
        String desplazadoPrimero = leer("/api/planning/metrics/displaced");

        assertThat(planRows.count()).isEqualTo(planesAntes);
        assertThat(blockRows.count()).isEqualTo(bloquesAntes);
        assertThat(metadataRows.count()).isEqualTo(metadataAntes);
        assertThat(conflictRows.count()).isEqualTo(conflictosAntes);

        assertThat(sinFecha(leer("/api/planning/metrics/declared/SIN_ESTIMACION")))
                .isEqualTo(sinFecha(declaradoPrimero));
        assertThat(sinFecha(leer("/api/planning/metrics/displaced")))
                .isEqualTo(sinFecha(desplazadoPrimero));
    }

    private String guardarPlan(String escenario) throws Exception {
        String body = mockMvc.perform(
                        post("/api/planning/plan").contentType(APPLICATION_JSON).content(escenario))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return JsonPath.read(body, "$.planId");
    }

    private void declarar(String workItemId, BigDecimal horas, LocalDate compromiso) {
        metadataService.create(new PlanningMetadataRequest(workItemId, horas, compromiso, "ana"));
    }

    /** Retira las dos declaraciones, que es el unico camino por el que se llega al estado vacio. */
    private void retirarTodo(String workItemId) {
        metadataService.update(workItemId, new PlanningMetadataUpdateRequest(null, null, "ana"));
    }

    private String leerMetricas() throws Exception {
        return mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private String leer(String ruta) throws Exception {
        return mockMvc.perform(get(ruta))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private String leer(String ruta, String planId) throws Exception {
        return mockMvc.perform(get(ruta, planId))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    /** La respuesta sin su fecha, para poder comparar dos llamadas enteras. */
    private static String sinFecha(String respuesta) {
        return respuesta.replaceAll("\"generatedAt\":\"[^\"]*\"", "\"generatedAt\":\"\"");
    }

    /** Un contador de la respuesta, que se compara por cantidad y no por valor. */
    private static long cuantosEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta, Long.class);
    }

    private static String textoEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta, String.class);
    }
}
