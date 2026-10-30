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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

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
import co.com.coltefinanciera.gestiondemanda.persistence.PlanSnapshotJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataHistoryJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.RescheduleClaimJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.WorkBlockJpaRepository;
import co.com.coltefinanciera.gestiondemanda.service.PlanningMetadataService;

/**
 * Pruebas de {@code GET /api/planning/metrics}.
 *
 * <p>Lo que se comprueba es una fotografia de lectura, asi que la prueba es de lectura: el escenario
 * se guarda por el camino real —{@code POST /plan} y {@code POST /api/planning-metadata}— y despues
 * se mira que los numeros que salen sean los que ya estaban escritos. Un doble en el servicio probaria
 * el mapeo y no la lectura.
 *
 * <p><strong>La prueba que de verdad sostiene la fase es la de la capacidad</strong> ({@link
 * #lasMetricasDeCapacidadSonLasMismasQueLasDelTimeline}). Las metricas no re-derivan la capacidad:
 * leen la proyeccion del timeline de cada plan vigente. Esa prueba suma lo que devuelve
 * {@code /{planId}/timeline} y lo compara con lo que devuelven las metricas, asi que si el timeline
 * cambiara de criterio la prueba lo sigue y las dos respuestas no pueden separarse en silencio.
 *
 * <p>El escenario es el de {@code PlanningTimelineEndpointsTest}: un incidente de seis horas sobre una
 * jornada de ocho obliga a desplazar un requerimiento de cuatro pactado para ese mismo dia. Deja ocho
 * horas ocupadas el lunes, dos el martes, y un requerimiento desplazado.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PlanningMetricsEndpointsTest {

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

    @Test
    @DisplayName("Sin nada guardado la fotografia sale en cero y sin desarrolladores")
    void sinNadaGuardadoLaFotografiaSaleEnCero() throws Exception {
        mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.declared.total").value(0))
                .andExpect(jsonPath("$.declared.plannable").value(0))
                .andExpect(jsonPath("$.declared.withoutEstimation.count").value(0))
                .andExpect(jsonPath("$.plans.generated").value(0))
                .andExpect(jsonPath("$.current.byDeveloper.length()").value(0))
                // Sin planes vigentes no hay ventana que abarcar, y se dice con nulo en vez de
                // inventar el horizonte configurado, cuya fecha de inicio no se guarda.
                .andExpect(jsonPath("$.current.from").doesNotExist())
                .andExpect(jsonPath("$.current.to").doesNotExist());
    }

    /**
     * La convivencia de rutas, que es lo que la fase introduce en la superficie HTTP.
     *
     * <p>La segunda mitad es la que importa. Que {@code /metrics} responda no demuestra gran cosa; lo
     * que hay que demostrar es que la ruta nueva <em>no se comio</em> el caso malo: un identificador
     * que no es un UUID bajo {@code /{planId}} tiene que seguir siendo un {@code 400}, y no acabar
     * respondiendo la fotografia porque el patron literal gano donde no debia.
     */
    @Test
    @DisplayName("El segmento literal metrics gana al patron con variable, y no se come el caso malo")
    void elSegmentoLiteralMetricsGanaAlPatronConVariable() throws Exception {
        mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.declared").exists());

        mockMvc.perform(get("/api/planning/{planId}", "no-es-un-uuid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_PARAMETER"));

        // Y un identificador bien formado que no existe sigue dando 404, no la fotografia.
        mockMvc.perform(get("/api/planning/{planId}", "0f0b7c1e-0000-0000-0000-000000000000"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));
    }

    /**
     * Lo estimado y lo que no, que es toda la carencia que le queda a la declaracion.
     *
     * <p>Una fila historica con fecha y sin horas —B— cuenta como falta de estimacion, que es
     * exactamente lo que es. D es una declaracion retirada por el camino real: se declaro y despues se
     * actualizo en nulo, y desde la Fase 77 eso es lo mismo que no tener horas.
     */
    @Test
    @DisplayName("Las cuentas declaradas separan lo estimado de lo que no")
    void lasCuentasDeclaradasSeparanLoEstimadoDeLoQueNo() throws Exception {
        declarar("A", new BigDecimal("8"), null);
        declarar("B", null, LocalDate.parse(LUNES));
        declarar("C", new BigDecimal("4"), LocalDate.parse(MARTES));
        declarar("D", new BigDecimal("2"), LocalDate.parse(LUNES));
        retirarTodo("D");

        mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.declared.total").value(4))
                // A y C tienen horas: dos de cuatro, que es lo que dice el denominador.
                .andExpect(jsonPath("$.declared.plannable").value(2))
                .andExpect(jsonPath("$.declared.withoutEstimation.count").value(2));
    }

    /**
     * La identidad que cierra la aritmetica del bloque, leida del JSON.
     *
     * <p>Se afirma sobre la respuesta y no sobre el dominio a proposito: lo que tiene que cuadrar es lo
     * que se publica.
     */
    @Test
    @DisplayName("Las cuentas declaradas cierran su aritmetica")
    void lasCuentasDeclaradasCierranSuAritmetica() throws Exception {
        declarar("A", new BigDecimal("8"), null);
        declarar("B", null, LocalDate.parse(LUNES));
        declarar("C", new BigDecimal("4"), LocalDate.parse(MARTES));
        declarar("D", new BigDecimal("2"), LocalDate.parse(LUNES));
        retirarTodo("D");

        String foto = leerMetricas();

        // El denominador cierra con sus dos mitades y no hay una tercera.
        assertThat(cuantosEn(foto, "$.declared.withoutEstimation.count")
                + cuantosEn(foto, "$.declared.plannable")).isEqualTo(cuantosEn(foto, "$.declared.total"));
    }

    /**
     * El codigo viaja como valor del enum, no como texto copiado.
     *
     * <p>Es lo que impide que un descarte y una metrica nombren la misma carencia de dos formas. La
     * prueba afirma la cadena tal como sale en el JSON, que es el nombre del enum.
     */
    @Test
    @DisplayName("El codigo de la carencia es el ya definido")
    void elCodigoDeLaCarenciaEsElYaDefinido() throws Exception {
        declarar("A", new BigDecimal("8"), null);
        declarar("B", null, LocalDate.parse(LUNES));

        mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.declared.withoutEstimation.code")
                        .value("SIN_ESTIMACION_DECLARADA"));
    }

    /**
     * La vigencia, vista desde el endpoint.
     *
     * <p>Dos planes del mismo desarrollador no se suman: se cuenta el ultimo. Si se sumaran, la
     * jornada del lunes apareceria contada dos veces y la capacidad disponible saldria al doble, que es
     * exactamente el error que la fase quiere no cometer.
     */
    @Test
    @DisplayName("Dos planes del mismo desarrollador solo cuentan el vigente")
    void dosPlanesDelMismoDesarrolladorSoloCuentanElVigente() throws Exception {
        guardarPlan(SOLO_REGLAS);
        guardarPlan(ESCENARIO);

        mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                // Los dos planes estan guardados: el bloque de planes cuenta ejecuciones.
                .andExpect(jsonPath("$.plans.generated").value(2))
                // Y de ellos solo uno es el vigente, asi que hay un solo desarrollador.
                .andExpect(jsonPath("$.current.byDeveloper.length()").value(1))
                .andExpect(jsonPath("$.current.byDeveloper[0].developerId").value("dev-1"));

        String foto = leerMetricas();
        // La capacidad es la del segundo plan —el del escenario— y no la suma de los dos: ocho horas
        // el lunes y ocho el martes, no el doble.
        assertThat(numeroEn(foto, "$.current.capacity.availableHours"))
                .isEqualByComparingTo("16");
        assertThat(numeroEn(foto, "$.current.capacity.occupiedHours"))
                .isEqualByComparingTo("10");
        assertThat(numeroEn(foto, "$.current.capacity.remainingHours"))
                .isEqualByComparingTo("6");
        assertThat(textoEn(foto, "$.current.from")).isEqualTo(LUNES);
        assertThat(textoEn(foto, "$.current.to")).isEqualTo(MARTES);
    }

    /**
     * La prueba que sostiene la afirmacion «las metricas no recalculan la planificacion».
     *
     * <p>Se suman los arrays que devuelve {@code /{planId}/timeline} y se comparan con lo que devuelven
     * las metricas. Se suman los arrays y no constantes escritas a mano: si el timeline cambiara de
     * criterio, la prueba lo sigue y sigue afirmando que los dos numeros son el mismo. Escribir el
     * dieciseis a mano convertiria esta prueba en una copia del escenario, que es lo contrario de lo
     * que se quiere comprobar.
     */
    @Test
    @DisplayName("Las metricas de capacidad son las mismas que las del timeline")
    void lasMetricasDeCapacidadSonLasMismasQueLasDelTimeline() throws Exception {
        String planId = guardarPlan(ESCENARIO);

        String timeline = leer("/api/planning/{planId}/timeline", planId);
        String foto = leerMetricas();

        BigDecimal disponible = BigDecimal.ZERO;
        BigDecimal ocupada = BigDecimal.ZERO;
        BigDecimal restante = BigDecimal.ZERO;
        for (Object capacidad : JsonPath.parse(timeline).read("$.resources[0].capacity", List.class)) {
            @SuppressWarnings("unchecked")
            var dias = (Map<String, Object>) capacidad;
            disponible = disponible.add(new BigDecimal(dias.get("availableHours").toString()));
            ocupada = ocupada.add(new BigDecimal(dias.get("occupiedHours").toString()));
            restante = restante.add(new BigDecimal(dias.get("remainingHours").toString()));
        }

        assertThat(numeroEn(foto, "$.current.capacity.availableHours"))
                .isEqualByComparingTo(disponible);
        assertThat(numeroEn(foto, "$.current.capacity.occupiedHours"))
                .isEqualByComparingTo(ocupada);
        assertThat(numeroEn(foto, "$.current.capacity.remainingHours"))
                .isEqualByComparingTo(restante);

        // Y el detalle por desarrollador suma lo mismo que el total, que es la otra mitad de la
        // afirmacion: el bloque de arriba no es un numero aparte, es la suma de los de abajo.
        assertThat(numeroEn(foto, "$.current.byDeveloper[0].capacity.availableHours"))
                .isEqualByComparingTo(disponible);
        // Y el detalle dice de que plan salio, que es lo que permite volver al timeline a comprobarlo.
        assertThat(textoEn(foto, "$.current.byDeveloper[0].planId")).isEqualTo(planId);
    }

    /**
     * Los desplazamientos cuentan requerimientos, no tramos.
     *
     * <p>El requerimiento desplazado ocupa dos dias —dos tramos en la agenda— y se movio una vez. Se
     * afirma con el numero del escenario, que ademas coincide con el que declara el timeline: un tramo
     * marcado como planificado y dos como desplazados, un solo elemento.
     */
    @Test
    @DisplayName("Los desplazamientos cuentan requerimientos y no tramos")
    void losDesplazamientosCuentanRequerimientosYNoTramos() throws Exception {
        String planId = guardarPlan(ESCENARIO);
        String timeline = leer("/api/planning/{planId}/timeline", planId);

        // El escenario deja tres tramos: uno del incidente y dos del requerimiento desplazado. Los
        // estados se leen del timeline y se cruzan aqui con sus elementos, que es lo que la metrica
        // tiene que estar contando.
        assertThat(JsonPath.parse(timeline).read("$.items.length()", Integer.class)).isEqualTo(3);
        List<String> estados = JsonPath.parse(timeline).read("$.items[*].planningStatus");
        List<String> elementos = JsonPath.parse(timeline).read("$.items[*].workItemId");

        List<String> desplazados = new ArrayList<>();
        for (int i = 0; i < estados.size(); i++) {
            if ("DESPLAZADO".equals(estados.get(i))) {
                desplazados.add(elementos.get(i));
            }
        }

        // Dos tramos, un solo elemento: el requerimiento ocupa dos dias y se movio una vez.
        assertThat(desplazados).hasSize(2).containsOnly("REQ-1");

        mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.current.displacedRequirements").value(1))
                .andExpect(jsonPath("$.current.byDeveloper[0].displacedRequirements").value(1));
    }

    /**
     * Un plan sin agenda.
     *
     * <p>El desarrollador existe y sale en el detalle —tiene plan vigente—, pero no tiene ventana ni
     * capacidad. Es el mismo criterio que el timeline: sin tramos no hay fechas que abarcar, y se dice
     * con nulo en vez de inventar el horizonte.
     */
    @Test
    @DisplayName("Un plan sin agenda sale con ventana nula y capacidad cero")
    void unPlanSinAgendaSaleConVentanaNulaYCapacidadCero() throws Exception {
        guardarPlan(SOLO_REGLAS);

        mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.current.byDeveloper.length()").value(1))
                .andExpect(jsonPath("$.current.byDeveloper[0].developerId").value("dev-1"))
                .andExpect(jsonPath("$.current.byDeveloper[0].from").doesNotExist())
                .andExpect(jsonPath("$.current.byDeveloper[0].to").doesNotExist())
                .andExpect(jsonPath("$.current.from").doesNotExist())
                .andExpect(jsonPath("$.current.displacedRequirements").value(0));

        String foto = leerMetricas();
        assertThat(numeroEn(foto, "$.current.capacity.availableHours")).isZero();
        assertThat(numeroEn(foto, "$.current.capacity.occupiedHours")).isZero();
        assertThat(numeroEn(foto, "$.current.capacity.remainingHours")).isZero();
    }

    /**
     * La fotografia no escribe nada.
     *
     * <p>Es la mitad del principio de la fase —trabajar solo sobre lo persistido— y se comprueba
     * contando antes y despues. Un endpoint de lectura que creara filas seria una fuga silenciosa: no
     * fallaria ninguna prueba de contenido y la base creceria sola.
     *
     * <p>La segunda mitad comprueba que la respuesta es estable salvo su fecha. {@code generatedAt} es
     * lo unico que puede cambiar entre dos llamadas sin que nadie haya declarado ni planificado nada.
     */
    @Test
    @DisplayName("El endpoint no escribe nada y dos llamadas devuelven lo mismo salvo la fecha")
    void elEndpointNoEscribeNada() throws Exception {
        guardarPlan(ESCENARIO);
        declarar("A", new BigDecimal("8"), LocalDate.parse(LUNES));

        long planesAntes = planRows.count();
        long bloquesAntes = blockRows.count();
        long metadataAntes = metadataRows.count();
        long conflictosAntes = conflictRows.count();

        String primera = leerMetricas();
        String segunda = leerMetricas();

        assertThat(planRows.count()).isEqualTo(planesAntes);
        assertThat(blockRows.count()).isEqualTo(bloquesAntes);
        assertThat(metadataRows.count()).isEqualTo(metadataAntes);
        assertThat(conflictRows.count()).isEqualTo(conflictosAntes);

        // Se quita la fecha —lo unico que depende del reloj— y el resto tiene que coincidir entero.
        assertThat(sinFecha(segunda)).isEqualTo(sinFecha(primera));
    }

    /**
     * El total de planes cuenta ejecuciones, no planes distintos.
     *
     * <p>Guardar un plan no es idempotente: cada peticion inserta un identificador nuevo. El numero
     * dice cuanto se ha planificado, que es informacion util, y no cuantos planes distintos hay. Se
     * fija con un numero para que la limitacion quede dicha y no solo documentada.
     */
    @Test
    @DisplayName("El total de planes cuenta ejecuciones")
    void elTotalDePlanesCuentaEjecuciones() throws Exception {
        guardarPlan(ESCENARIO);
        guardarPlan(ESCENARIO);

        mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.plans.generated").value(2))
                // Y los dos son del mismo desarrollador, asi que el detalle sigue trayendo uno.
                .andExpect(jsonPath("$.current.byDeveloper.length()").value(1));
    }

    /**
     * La trazabilidad viaja en la respuesta.
     *
     * <p>Cada bloque declara de donde sale y sobre que se conto, para que quien lea un numero dentro de
     * seis meses no tenga que venir a leer el codigo. Se afirman las dos cadenas tal como salen.
     */
    @Test
    @DisplayName("Cada bloque declara su fuente y su ambito")
    void cadaBloqueDeclaraSuFuenteYSuAmbito() throws Exception {
        mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.declared.source").value("planning_metadata"))
                .andExpect(jsonPath("$.declared.scope").isNotEmpty())
                .andExpect(jsonPath("$.plans.source").value("plan_snapshot"))
                .andExpect(jsonPath("$.plans.scope").isNotEmpty())
                .andExpect(jsonPath("$.current.source").isNotEmpty())
                .andExpect(jsonPath("$.current.scope").isNotEmpty())
                .andExpect(jsonPath("$.generatedAt").isNotEmpty());
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

    private String leer(String ruta, String planId) throws Exception {
        return mockMvc.perform(get(ruta, planId))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    /** La respuesta sin su fecha, para poder comparar dos llamadas enteras. */
    private static String sinFecha(String foto) {
        return foto.replaceAll("\"generatedAt\":\"[^\"]*\"", "\"generatedAt\":\"\"");
    }

    /** Un numero de la respuesta, leido como BigDecimal para poder compararlo por valor. */
    private static BigDecimal numeroEn(String respuesta, String ruta) {
        return new BigDecimal(JsonPath.parse(respuesta).read(ruta).toString());
    }

    /** Un contador de la respuesta, que se compara por cantidad y no por valor. */
    private static long cuantosEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta, Long.class);
    }

    private static String textoEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta, String.class);
    }
}
