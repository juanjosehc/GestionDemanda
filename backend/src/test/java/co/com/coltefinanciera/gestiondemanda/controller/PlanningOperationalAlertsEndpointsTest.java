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
import java.util.Map;
import java.util.UUID;

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
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningConflictJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningContextJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanSnapshotJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataHistoryJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.RescheduleClaimJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.WorkBlockJpaRepository;
import co.com.coltefinanciera.gestiondemanda.service.PlanningMetadataService;

/**
 * Pruebas de {@code GET /api/planning/alerts}.
 *
 * <p>Mismo patron que sus dos gemelos: el estado se produce por el camino real —{@code POST /plan} y
 * {@code POST /api/planning-metadata}— y despues se mira que las alertas digan lo que ya estaba
 * escrito. <strong>El numero esperado se lee de {@code /metrics}, nunca se escribe a mano</strong>: si
 * se escribiera, la prueba afirmaria que la alerta coincide con una copia del escenario, que es lo
 * contrario de lo que hay que comprobar. Lo que se comprueba es que la alerta y la metrica son el
 * mismo numero.
 *
 * <p><strong>Lo que esta prueba no puede contener, y por que.</strong> El motor nunca sobrepasa la
 * jornada —{@code CapacityBook} solo ocupa dentro de las franjas del calendario—, asi que la alerta de
 * capacidad negativa no se alcanza por aqui. Se prueba en {@code OperationalAlertServiceTest}, donde
 * la fotografia se escribe en vez de producirse, y aqui se prueba la mitad que protege contra el falso
 * positivo: que sobre datos reales <em>no</em> se dispara.
 *
 * <p><strong>La prueba que fija la decision de agregacion es
 * {@link #laAgotadaMideElPlanYNoElDia}.</strong> El escenario conocido deja el lunes exactamente lleno
 * —cero restante en el calendario— y el plan entero con seis horas de holgura. La alerta mira el plan,
 * no el dia, y por eso no sale. Si alguien cambiara la alerta a contar por dia, esa prueba cae; y de
 * paso explica por que contar por dia daria un falso positivo por cada sabado y domingo de la ventana.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PlanningOperationalAlertsEndpointsTest {

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

    /**
     * Un dia entero de trabajo y nada mas: un incidente de ocho horas sobre una jornada de ocho, sin
     * requerimientos. La ventana del plan son las fechas de sus propios tramos, asi que es un solo dia
     * —ocho disponibles, ocho ocupadas, cero restantes— y el plan entero queda exactamente lleno.
     *
     * <p>Es el unico escenario de esta prueba que dispara la alerta de capacidad agotada, y esta
     * construido para eso: es el estado en el que el siguiente requerimiento desplaza a otro.
     */
    private static final String DIA_LLENO = """
            {
              "developer": {"id": "dev-1", "name": "Ana"},
              "incidents": [
                {
                  "id": "INC-1",
                  "title": "Falla en produccion",
                  "estimatedHours": 8,
                  "reportedAt": "2026-10-05T09:00:00Z",
                  "status": "ABIERTO"
                }
              ],
              "requirements": [],
              "rules": {
                "incidentThresholdHours": 4,
                "workingHoursPerDay": 8,
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
    private PlanningContextJpaRepository contextRows;

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

    @Test
    @DisplayName("Sin nada declarado ni planificado no hay alertas, y la lista sale fechada")
    void sinNadaQueAlertarLaListaSaleVacia() throws Exception {
        mockMvc.perform(get("/api/planning/alerts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alerts.length()").value(0))
                // Una lista vacia tambien tiene que poder fecharse: sin la fecha, «no hay nada que
                // mirar» y «no se ha mirado» se leerian igual.
                .andExpect(jsonPath("$.generatedAt").isNotEmpty());
    }

    /**
     * La unica alerta declarada, enlazando con su desglose.
     *
     * <p>Desde la Fase 77 una declaracion solo puede carecer de horas: la fecha compromiso la publica
     * GLPI, asi que no hay una segunda mitad que contar. La fila retirada sigue contando como carencia,
     * porque retirar la estimacion es exactamente eso.
     */
    @Test
    @DisplayName("La carencia declarada alerta con el numero de la fotografia, y enlaza con su desglose")
    void laCarenciaDeclaradaAlertaConElNumeroDeLaFotografia() throws Exception {
        declarar("A", new BigDecimal("8"), null);
        declarar("B", null, LocalDate.parse(LUNES));
        declarar("C", new BigDecimal("4"), LocalDate.parse(MARTES));
        declarar("D", new BigDecimal("2"), LocalDate.parse(LUNES));
        retirarTodo("D");

        String foto = leerMetricas();
        String alertas = leerAlertas();

        assertThat(cuenta(alertas, "SIN_ESTIMACION"))
                .isEqualTo(cuantosEn(foto, "$.declared.withoutEstimation.count"))
                .isPositive();

        // Y el detalle enlazado: la ruta publicada se recorre y tiene que traer tantos elementos como
        // dice el contador de la alerta. Es lo que convierte el literal en un hecho verificado.
        String detalle = leer(rutaDe(alertas, "SIN_ESTIMACION"));

        assertThat(cuantosElementos(detalle)).isEqualTo(cuenta(alertas, "SIN_ESTIMACION"));
    }

    @Test
    @DisplayName("Un plan exactamente lleno dispara la agotada, que no tiene listado propio")
    void unPlanExactamenteLlenoDisparaLaAgotada() throws Exception {
        guardarPlan(DIA_LLENO);

        String foto = leerMetricas();
        String alertas = leerAlertas();

        // El numero esperado sale de la fotografia: cuantos desarrolladores vigentes estan en cero.
        long llenos = desarrolladoresEnCero(foto);

        assertThat(llenos).isPositive();
        assertThat(tipos(alertas)).containsExactly("CAPACIDAD_AGOTADA");
        assertThat(cuenta(alertas, "CAPACIDAD_AGOTADA")).isEqualTo(llenos);
        assertThat(alerta(alertas, "CAPACIDAD_AGOTADA").get("severity")).isEqualTo("WARNING");

        // El detalle nulo se afirma sobre el cuerpo crudo, no con jsonPath: para jsonPath un campo
        // nulo y un campo ausente son lo mismo, y lo que hay que fijar es que el campo viaja, para que
        // el esquema sea el mismo en las seis alertas.
        assertThat(alertas).contains("\"detailUrl\":null");
        assertThat(alertas).doesNotContain("/api/planning/metrics/");
    }

    /**
     * La decision de agregacion, fijada desde el lado de las alertas.
     *
     * <p>El escenario conocido deja el lunes exactamente lleno: cero restante en el calendario del plan.
     * El plan entero, sin embargo, tiene seis horas de holgura el martes. La alerta mira el plan —la
     * misma cifra que publica {@code /metrics} y que el tablero ya colorea— y por eso no se dispara.
     */
    @Test
    @DisplayName("La agotada mide el plan y no el dia: un lunes lleno con holgura el martes no alerta")
    void laAgotadaMideElPlanYNoElDia() throws Exception {
        String planId = guardarPlan(ESCENARIO);

        String timeline = leer("/api/planning/{planId}/timeline", planId);
        String foto = leerMetricas();
        String alertas = leerAlertas();

        // El primer dia de la ventana es el lunes, y esta exactamente lleno.
        assertThat(new BigDecimal(JsonPath.parse(timeline)
                .read("$.resources[0].capacity[0].remainingHours").toString()))
                .isEqualByComparingTo("0");
        assertThat(textoEn(foto, "$.current.from")).isEqualTo(LUNES);

        // El plan entero no lo esta: le quedan seis horas.
        assertThat(numeroEn(foto, "$.current.capacity.remainingHours")).isEqualByComparingTo("6");

        assertThat(tipos(alertas)).doesNotContain("CAPACIDAD_AGOTADA");
    }

    /**
     * La invariante del motor, fijada desde el lado de las alertas.
     *
     * <p>Es la mitad que protege contra el falso positivo: la alerta existe, pero sobre datos que el
     * motor produce no puede sonar. Su prueba de verdad —donde si se dispara— esta en la proyeccion, con
     * una fotografia escrita a mano.
     */
    @Test
    @DisplayName("La negativa no se dispara sobre datos reales: el motor nunca sobrepasa la jornada")
    void laNegativaNoSeDisparaSobreDatosReales() throws Exception {
        guardarPlan(ESCENARIO);
        guardarPlan(DIA_LLENO);

        assertThat(tipos(leerAlertas())).doesNotContain("CAPACIDAD_NEGATIVA");
    }

    @Test
    @DisplayName("Los desplazados alertan con el numero de la fotografia, y enlazan con su desglose")
    void losDesplazadosAlertanConElNumeroDeLaFotografia() throws Exception {
        guardarPlan(ESCENARIO);

        String foto = leerMetricas();
        String alertas = leerAlertas();

        assertThat(cuenta(alertas, "REQUERIMIENTOS_DESPLAZADOS"))
                .isEqualTo(cuantosEn(foto, "$.current.displacedRequirements"))
                .isPositive();

        String detalle = leer(rutaDe(alertas, "REQUERIMIENTOS_DESPLAZADOS"));

        assertThat(cuantosElementos(detalle)).isEqualTo(cuenta(alertas, "REQUERIMIENTOS_DESPLAZADOS"));
    }

    /**
     * La convivencia de rutas, que es lo que esta fase introduce en la superficie HTTP.
     *
     * <p>La segunda mitad es la que importa: que {@code /alerts} responda no demuestra gran cosa; lo que
     * hay que demostrar es que la ruta nueva <em>no se comio</em> el caso malo ni la lectura del plan.
     */
    @Test
    @DisplayName("El segmento literal alerts gana al patron con variable, y el plan se sigue leyendo")
    void elSegmentoLiteralAlertsGanaAlPatronConVariable() throws Exception {
        mockMvc.perform(get("/api/planning/alerts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alerts").exists());

        mockMvc.perform(get("/api/planning/{planId}", "no-es-un-uuid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_PARAMETER"));

        mockMvc.perform(get("/api/planning/{planId}", "0f0b7c1e-0000-0000-0000-000000000000"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));

        String planId = guardarPlan(SOLO_REGLAS);

        mockMvc.perform(get("/api/planning/{planId}", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alerts").doesNotExist());
    }

    /**
     * La trazabilidad del brief: de donde sale, con que condicion y sobre que universo.
     *
     * <p>Los textos no se escriben aqui: se comparan con los que publica {@code /metrics} para el bloque
     * del que sale el numero. Es lo que impide que una alerta y la metrica de la que sale nombren el
     * mismo origen de dos formas.
     */
    @Test
    @DisplayName("Cada alerta dice de donde sale con las palabras de la fotografia")
    void cadaAlertaDiceDeDondeSaleConLasPalabrasDeLaFotografia() throws Exception {
        declarar("A", null, LocalDate.parse(LUNES));
        guardarPlan(ESCENARIO);

        String foto = leerMetricas();
        String alertas = leerAlertas();

        assertThat(alerta(alertas, "SIN_ESTIMACION").get("source"))
                .isEqualTo(textoEn(foto, "$.declared.source"));
        assertThat(alerta(alertas, "SIN_ESTIMACION").get("scope"))
                .isEqualTo(textoEn(foto, "$.declared.scope"));

        assertThat(alerta(alertas, "REQUERIMIENTOS_DESPLAZADOS").get("source"))
                .isEqualTo(textoEn(foto, "$.current.source"));
        assertThat(alerta(alertas, "REQUERIMIENTOS_DESPLAZADOS").get("scope"))
                .isEqualTo(textoEn(foto, "$.current.scope"));

        // La condicion es lo que responde «que consulta la genera» sin abrir la documentacion.
        for (Map<String, Object> alerta : alertas(alertas)) {
            assertThat(alerta.get("condition")).asString().isNotBlank();
        }

        // Y la fecha es una sola: la de la fotografia, repetida en cada alerta y en la respuesta.
        Object sello = JsonPath.parse(alertas).read("$.generatedAt");

        assertThat(alertas(alertas))
                .isNotEmpty()
                .allSatisfy(alerta -> assertThat(alerta.get("generatedAt")).isEqualTo(sello));
    }

    /**
     * El orden de salida: de mas grave a menos, y dentro de cada nivel por el orden del catalogo.
     *
     * <p>Aqui solo se pueden fijar los niveles que el camino real produce —no hay ninguna alerta
     * critica alcanzable—, asi que el orden completo, con las cuatro a la vez, lo fija
     * {@code OperationalAlertServiceTest}. Lo que se fija aqui es que el nivel manda sobre el orden de
     * declaracion: el desplazamiento es el primero del catalogo y sale primero.
     */
    @Test
    @DisplayName("La salida va de mas grave a menos, y el nivel manda sobre el orden del catalogo")
    void laSalidaVaDeMasGraveAMenos() throws Exception {
        declarar("A", new BigDecimal("8"), null);
        declarar("B", null, LocalDate.parse(LUNES));
        guardarPlan(ESCENARIO);

        assertThat(tipos(leerAlertas())).containsExactly(
                "REQUERIMIENTOS_DESPLAZADOS",
                "SIN_ESTIMACION");
    }

    @Test
    @DisplayName("Dos llamadas seguidas dicen lo mismo: la capa de alertas no escribe nada")
    void dosLlamadasSeguidasDicenLoMismo() throws Exception {
        declarar("A", new BigDecimal("8"), null);
        guardarPlan(ESCENARIO);

        assertThat(sinFecha(leerAlertas())).isEqualTo(sinFecha(leerAlertas()));
        // Y el plan sigue en pie: pedir alertas no ha tocado nada.
        assertThat(cuantosEn(leerMetricas(), "$.plans.generated")).isEqualTo(1);
    }

    /**
     * La fotografia rota: un plan vigente al que le falta su contexto.
     *
     * <p>Se fabrica borrando la fila de contexto del plan, que es la unica forma de construir un estado
     * que la aplicacion no produce —{@code save} escribe los tres en una transaccion—. Lo que se fija
     * es la decision, no el estado: un {@code 404} sale sin recortarlo, porque una lista de alertas
     * calculada sobre una fotografia incompleta diria que no hay problemas donde no se ha mirado.
     */
    @Test
    @DisplayName("Un plan vigente roto tumba las alertas, y no las deja mintiendo en vacio")
    void unPlanVigenteRotoTumbaLasAlertas() throws Exception {
        String planId = guardarPlan(ESCENARIO);

        contextRows.deleteById(UUID.fromString(planId));

        mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));

        mockMvc.perform(get("/api/planning/alerts"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));
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

    private void retirarTodo(String workItemId) {
        metadataService.update(workItemId, new PlanningMetadataUpdateRequest(null, null, "ana"));
    }

    private String leerMetricas() throws Exception {
        return mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private String leerAlertas() throws Exception {
        return mockMvc.perform(get("/api/planning/alerts"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private String leer(String ruta) throws Exception {
        return mockMvc.perform(get(ruta)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private String leer(String ruta, String planId) throws Exception {
        return mockMvc.perform(get(ruta, planId)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private static String sinFecha(String respuesta) {
        return respuesta.replaceAll("\"generatedAt\":\"[^\"]*\"", "\"generatedAt\":\"\"");
    }

    private static List<Map<String, Object>> alertas(String respuesta) {
        return JsonPath.parse(respuesta).read("$.alerts", List.class);
    }

    private static List<String> tipos(String respuesta) {
        return alertas(respuesta).stream().map(alerta -> (String) alerta.get("type")).toList();
    }

    private static Map<String, Object> alerta(String respuesta, String tipo) {
        return alertas(respuesta).stream()
                .filter(alerta -> tipo.equals(alerta.get("type")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No se disparo " + tipo));
    }

    private static long cuenta(String respuesta, String tipo) {
        return ((Number) alerta(respuesta, tipo).get("count")).longValue();
    }

    /** La ruta que la propia alerta publica, para recorrerla en vez de escribirla otra vez. */
    private static String rutaDe(String respuesta, String tipo) {
        return alerta(respuesta, tipo).get("detailUrl").toString();
    }

    private static long cuantosElementos(String respuesta) {
        return JsonPath.parse(respuesta).read("$.items", List.class).size();
    }

    /** Cuantos desarrolladores vigentes tienen la capacidad restante exactamente en cero. */
    private static long desarrolladoresEnCero(String foto) {
        List<Map<String, Object>> desarrolladores =
                JsonPath.parse(foto).read("$.current.byDeveloper", List.class);

        return desarrolladores.stream()
                .filter(desarrollador -> new BigDecimal(
                        ((Map<?, ?>) desarrollador.get("capacity")).get("remainingHours").toString())
                        .signum() == 0)
                .count();
    }

    private static BigDecimal numeroEn(String respuesta, String ruta) {
        return new BigDecimal(JsonPath.parse(respuesta).read(ruta).toString());
    }

    private static long cuantosEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta, Long.class);
    }

    private static String textoEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta, String.class);
    }
}
