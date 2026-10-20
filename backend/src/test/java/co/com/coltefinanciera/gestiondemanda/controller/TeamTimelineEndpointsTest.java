package co.com.coltefinanciera.gestiondemanda.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;

import co.com.coltefinanciera.gestiondemanda.persistence.RescheduleClaimJpaRepository;

/**
 * Pruebas de la lectura de equipo: {@code GET /api/planning/team/timeline}.
 *
 * <p>Levantan el contexto entero, como las demas pruebas de endpoint: lo que se comprueba es el
 * recorrido completo —que dos planes vigentes de dos personas se lean juntos, y que la ventana que
 * resulta sea la del equipo y no la de ninguno de los dos—.
 *
 * <p><strong>Los identificadores son propios de esta clase.</strong> El contexto de Spring y su base de
 * datos se comparten con las demas pruebas, y {@code findLatestPerDeveloper} mira <em>todos</em> los
 * planes guardados: con los identificadores de otra prueba, lo que esta respuesta devuelva dependeria de
 * en que orden hayan corrido las clases. Por el mismo motivo no se afirma ningun total global —ni
 * cuantos recursos hay, ni donde empieza la ventana—, solo lo que se puede predicar de estas tres
 * personas.
 *
 * <p><strong>Las fechas son las del escenario de las demas pruebas</strong> —el lunes 5 de octubre de
 * 2026 y su semana—, para que el calendario congelado y la jornada sean los mismos y una diferencia en
 * los numeros signifique algo.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TeamTimelineEndpointsTest {

    /** Una persona con trabajo repartido: un incidente de 6 h y un requerimiento de 4 h el lunes. */
    private static final String EQUIPO_UNO = """
            {
              "developer": {"id": "equipo-1", "name": "Ana"},
              "incidents": [
                {
                  "id": "EQ1-INC",
                  "title": "Falla en produccion",
                  "estimatedHours": 6,
                  "reportedAt": "2026-10-05T09:00:00Z",
                  "status": "ABIERTO"
                }
              ],
              "requirements": [
                {
                  "id": "EQ1-REQ",
                  "title": "Ajuste de reporte",
                  "estimatedHours": 4,
                  "plannedDate": "2026-10-05",
                  "status": "PLANIFICADO"
                }
              ]
            }
            """;

    /**
     * Otra persona, con trabajo <strong>dos dias despues</strong>.
     *
     * <p>Es lo que hace medible la ventana de equipo: su plan solo tiene tramos el miercoles, asi que si
     * la respuesta se compusiera concatenando las lecturas de cada plan, su fila tendria un solo dia de
     * capacidad. Con la ventana comun tiene los que haya entre el lunes y su miercoles.
     */
    private static final String EQUIPO_DOS = """
            {
              "developer": {"id": "equipo-2", "name": "Beto"},
              "incidents": [],
              "requirements": [
                {
                  "id": "EQ2-REQ",
                  "title": "Reporte nuevo",
                  "estimatedHours": 4,
                  "plannedDate": "2026-10-07",
                  "status": "PLANIFICADO"
                }
              ]
            }
            """;

    /** Una persona con plan vigente y <strong>sin ningun tramo</strong>: la fila vacia. */
    private static final String EQUIPO_TRES = """
            {
              "developer": {"id": "equipo-3", "name": "Caro"},
              "incidents": [],
              "requirements": []
            }
            """;

    /** Una persona cuyo requerimiento del lunes <strong>se mueve al martes</strong>. */
    private static final String EQUIPO_DESPLAZADO = """
            {
              "developer": {"id": "equipo-4", "name": "Dora"},
              "incidents": [
                {
                  "id": "EQ4-INC",
                  "title": "Falla en produccion",
                  "estimatedHours": 6,
                  "reportedAt": "2026-10-05T09:00:00Z",
                  "status": "ABIERTO"
                }
              ],
              "requirements": [
                {
                  "id": "EQ4-REQ",
                  "title": "Ajuste de reporte",
                  "estimatedHours": 4,
                  "plannedDate": "2026-10-05",
                  "status": "PLANIFICADO"
                }
              ]
            }
            """;

    /**
     * Una persona con un requerimiento que <strong>no cabe</strong> en el horizonte declarado.
     *
     * <p>El horizonte se acorta a un dia y la jornada a seis horas: el requerimiento de dieciseis horas
     * no cierra dentro y el motor lo declara fuera con su motivo, en vez de colocarlo a medias.
     */
    private static final String EQUIPO_SIN_HUECO = """
            {
              "developer": {"id": "equipo-5", "name": "Elias"},
              "incidents": [],
              "requirements": [
                {
                  "id": "EQ5-REQ",
                  "title": "Migracion completa",
                  "estimatedHours": 16,
                  "plannedDate": "2026-10-05",
                  "status": "PLANIFICADO"
                }
              ],
              "rules": {
                "incidentThresholdHours": 4,
                "workingHoursPerDay": 6,
                "planningHorizonDays": 1
              }
            }
            """;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private RescheduleClaimJpaRepository claims;

    /**
     * El registro de idempotencia es global y compartido entre peticiones, que es su gracia. Estas
     * pruebas guardan tres veces el mismo escenario con incidente, asi que sin vaciarlo la segunda
     * encontraria el reclamo tomado y el tramo desplazado no se auditaria.
     */
    @BeforeEach
    void limpiarReclamos() {
        claims.deleteAll();
    }

    /**
     * La ruta literal no la captura {@code /{planId}/timeline}.
     *
     * <p>Es el riesgo real de esta fase: las dos rutas tienen dos segmentos y solo se distinguen en el
     * primero. Si el patron con variable ganara, {@code team} se leeria como un identificador de plan y
     * la respuesta seria un {@code 400} —o peor, un {@code 404} de plan inexistente— sin que nada
     * avisara de que la lectura nueva no existe.
     */
    @Test
    @DisplayName("GET /team/timeline responde 200 y no lo captura /{planId}/timeline")
    void laRutaLiteralNoLaCapturaElPatronConVariable() throws Exception {
        mockMvc.perform(get("/api/planning/team/timeline"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resources").isArray())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.plans").isArray())
                .andExpect(jsonPath("$.conflicts").isArray());
    }

    /**
     * La lectura de un plan sigue respondiendo: la ruta nueva no le robo el sitio.
     *
     * <p>La cara opuesta de la prueba anterior, y la que de verdad importa: una ruta literal mal
     * declarada rompe la que ya existia, no la que se acaba de añadir.
     */
    @Test
    @DisplayName("La lectura de un plan sigue resolviendo con su propio identificador")
    void laLecturaDeUnPlanSigueResolviendo() throws Exception {
        String planId = guardarPlan(EQUIPO_UNO);

        mockMvc.perform(get("/api/planning/{planId}/timeline", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value(planId))
                .andExpect(jsonPath("$.developerId").value("equipo-1"));
    }

    /**
     * Cada persona del equipo trae la ventana <strong>entera</strong>, no la suya.
     *
     * <p>Es la diferencia entre medir contra la ventana del equipo y concatenar lecturas, y la unica
     * forma de comprobarla es que alguien tenga capacidad en dias en los que no tiene ningun tramo.
     */
    @Test
    @DisplayName("Todas las filas cubren la ventana del equipo, tambien los dias sin trabajo")
    void todasLasFilasCubrenLaVentanaDelEquipo() throws Exception {
        guardarPlan(EQUIPO_UNO);
        guardarPlan(EQUIPO_DOS);

        Map<String, Object> respuesta = leer("/api/planning/team/timeline");

        int diasDeLaVentana = diasDeLaVentana(respuesta);

        assertThat(diasDeLaVentana).isGreaterThanOrEqualTo(3);

        for (String developerId : List.of("equipo-1", "equipo-2")) {
            Map<String, Object> recurso = recursoDe(respuesta, developerId);

            assertThat(capacidadDe(recurso))
                    .as("la fila de %s mide la ventana del equipo, no la de su plan", developerId)
                    .hasSize(diasDeLaVentana)
                    .anySatisfy(dia -> assertThat(ocupadoEn(dia)).isZero());
        }
    }

    /**
     * Una persona con plan vigente y sin tramos sigue teniendo fila.
     *
     * <p>Es lo que impide que la pantalla esconda a quien no tiene nada planificado, que es justo a quien
     * hay que mirar: sin tramos no se deduce su plan, y por eso la respuesta publica {@code plans}.
     */
    @Test
    @DisplayName("Una persona sin tramos sale con su plan vigente y la capacidad entera")
    void unaPersonaSinTramosSaleConSuPlanYSuCapacidad() throws Exception {
        String planId = guardarPlan(EQUIPO_TRES);

        Map<String, Object> respuesta = leer("/api/planning/team/timeline");
        Map<String, Object> recurso = recursoDe(respuesta, "equipo-3");

        assertThat(capacidadDe(recurso)).hasSize(diasDeLaVentana(respuesta));
        assertThat(itemsDe(respuesta, "equipo-3")).isEmpty();
        assertThat(planVigenteDe(respuesta, "equipo-3")).isEqualTo(planId);
    }

    /** Los tramos del equipo llevan a su plan, y el plan publica su propia ventana. */
    @Test
    @DisplayName("Los tramos traen su plan de origen y el plan su ventana")
    void losTramosTraenSuPlanDeOrigen() throws Exception {
        String planId = guardarPlan(EQUIPO_DOS);

        Map<String, Object> respuesta = leer("/api/planning/team/timeline");
        List<Map<String, Object>> items = itemsDe(respuesta, "equipo-2");

        assertThat(items).isNotEmpty();
        assertThat(items).allSatisfy(
                item -> assertThat(item.get("sourcePlanId")).isEqualTo(planId));
        assertThat(planVigenteDe(respuesta, "equipo-2")).isEqualTo(planId);

        // La ventana del plan es la de sus propios tramos, y con un requerimiento de cuatro horas
        // cabe entero en su miercoles.
        Map<String, Object> plan = planDe(respuesta, "equipo-2");
        assertThat(plan.get("from")).isEqualTo("2026-10-07");
        assertThat(plan.get("to")).isEqualTo("2026-10-07");
    }

    /**
     * La ventana es exactamente el sobre de los tramos que se publican.
     *
     * <p>Es el invariante que ata las dos mitades de la respuesta: si alguien calculara la ventana
     * mirando un solo plan —el ultimo leido, el primero, el de mas tramos—, las columnas de la pantalla
     * dejarian de contener barras y nada mas mirar el JSON lo delataria. Se comprueba sin saber cuantos
     * planes hay guardados, que es lo unico que esta clase puede afirmar.
     */
    @Test
    @DisplayName("La ventana comun es el sobre de los tramos publicados, sin sobras ni recortes")
    void laVentanaEsElSobreDeLosTramos() throws Exception {
        guardarPlan(EQUIPO_UNO);
        guardarPlan(EQUIPO_DOS);

        Map<String, Object> respuesta = leer("/api/planning/team/timeline");

        List<LocalDate> dias = todasLasFechas(respuesta);

        assertThat(dias).isNotEmpty();
        assertThat(respuesta.get("from")).isEqualTo(dias.get(0).toString());
        assertThat(respuesta.get("to")).isEqualTo(dias.get(dias.size() - 1).toString());
    }

    @SuppressWarnings("unchecked")
    private static List<LocalDate> todasLasFechas(Map<String, Object> respuesta) {
        return ((List<Map<String, Object>>) respuesta.get("items")).stream()
                .map(item -> LocalDate.parse(String.valueOf(item.get("startsAt")).substring(0, 10)))
                .sorted()
                .toList();
    }

    // --- la causa del desplazamiento -------------------------------------------------------------

    /**
     * Un tramo desplazado lleva consigo su causa: de donde a donde, por que regla y por culpa de que.
     *
     * <p>Es la trazabilidad que el plan ya guardaba —los eventos de reprogramacion y su regla— puesta al
     * lado del tramo, para no tener que pedir el plan entero ni las renegociaciones solo para saber por
     * que una barra esta donde esta.
     *
     * <p><strong>El motivo no se compara contra un texto escrito aqui.</strong> Se compara contra el que
     * publica la lectura de renegociaciones, que es la otra salida del mismo dato: si las dos
     * traducciones de la regla se separaran, esta prueba cae y ninguna otra lo notaria.
     */
    @Test
    @DisplayName("El tramo desplazado trae su causa, con el mismo motivo que la renegociacion")
    void elTramoDesplazadoTraeSuCausaAuditada() throws Exception {
        guardarPlan(EQUIPO_DESPLAZADO);

        Map<String, Object> respuesta = leer("/api/planning/team/timeline");
        Map<String, Object> tramo = tramoDe(respuesta, "equipo-4", "EQ4-REQ");

        assertThat(tramo.get("planningStatus")).isEqualTo("DESPLAZADO");

        Map<String, Object> causa = causaDe(tramo);
        assertThat(causa.get("originalDate")).isEqualTo("2026-10-05");
        assertThat(causa.get("newDate")).isEqualTo("2026-10-06");
        assertThat(causa.get("appliedRule")).isEqualTo("UMBRAL_INCIDENTE_EXCEDIDO");
        assertThat(causa.get("incidentId")).isEqualTo("EQ4-INC");
        // El incidente no declaro severidad, y el evento guardo ese nulo: rellenarlo con una severidad
        // de hoy seria contar un hecho que no ocurrio cuando el requerimiento se movio.
        assertThat(causa.get("incidentSeverity")).isNull();
        assertThat(causa.get("reason")).isEqualTo(motivoAuditado("EQ4-REQ"));

        // Y el incidente que la provoco no se movio: viaja sin causa.
        assertThat(tramoDe(respuesta, "equipo-4", "EQ4-INC").get("displacement")).isNull();
    }

    /**
     * El trabajo que el motor no pudo ubicar viaja con el motivo que el mismo redacto.
     *
     * <p>Es lo que separa «no hay tramo porque no se puede planificar» de «no hay tramo porque no cupo».
     * Las dos se ven igual en la rejilla —una celda vacia— y se arreglan distinto, asi que el motivo
     * tiene que venir de donde se calculo en vez de reconstruirse en la vista.
     */
    @Test
    @DisplayName("El trabajo que no cupo sale con su motivo y con su dueno")
    void elTrabajoQueNoCupoViajaConSuMotivo() throws Exception {
        guardarPlan(EQUIPO_SIN_HUECO);

        Map<String, Object> respuesta = leer("/api/planning/team/timeline");

        assertThat(itemsDe(respuesta, "equipo-5")).isEmpty();
        assertThat(conflictosDe(respuesta, "equipo-5"))
                .singleElement()
                .satisfies(conflicto -> {
                    assertThat(conflicto.get("workItemId")).isEqualTo("EQ5-REQ");
                    assertThat(conflicto.get("workItemType")).isEqualTo("REQUERIMIENTO");
                    assertThat(conflicto.get("reason"))
                            .isEqualTo("Sin capacidad en el horizonte de 1 dias");
                });
    }

    // --- ayudantes -------------------------------------------------------------------------------

    private String guardarPlan(String escenario) throws Exception {
        String body = mockMvc.perform(
                        post("/api/planning/plan").contentType(APPLICATION_JSON).content(escenario))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        return JsonPath.read(body, "$.planId");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> leer(String ruta) throws Exception {
        String body = mockMvc.perform(get(ruta))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        return JsonPath.parse(body).read("$", Map.class);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> recursosDe(Map<String, Object> respuesta) {
        return (List<Map<String, Object>>) respuesta.get("resources");
    }

    private static Map<String, Object> recursoDe(Map<String, Object> respuesta, String developerId) {
        return recursosDe(respuesta).stream()
                .filter(recurso -> developerId.equals(recurso.get("developerId")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no hay fila para " + developerId));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> capacidadDe(Map<String, Object> recurso) {
        return (List<Map<String, Object>>) recurso.get("capacity");
    }

    private static double ocupadoEn(Map<String, Object> dia) {
        return ((Number) dia.get("occupiedHours")).doubleValue();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> itemsDe(Map<String, Object> respuesta, String developerId) {
        return ((List<Map<String, Object>>) respuesta.get("items")).stream()
                .filter(item -> developerId.equals(item.get("developerId")))
                .toList();
    }

    private static Map<String, Object> planDe(Map<String, Object> respuesta, String developerId) {
        return planesDe(respuesta).stream()
                .filter(plan -> developerId.equals(plan.get("developerId")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no hay plan vigente para " + developerId));
    }

    private static String planVigenteDe(Map<String, Object> respuesta, String developerId) {
        return String.valueOf(planDe(respuesta, developerId).get("planId"));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> planesDe(Map<String, Object> respuesta) {
        return (List<Map<String, Object>>) respuesta.get("plans");
    }

    /** Cuantos dias abarca la ventana publicada, o cero si no hay ninguna. */
    private static int diasDeLaVentana(Map<String, Object> respuesta) {
        Object from = respuesta.get("from");
        Object to = respuesta.get("to");

        if (from == null || to == null) {
            return 0;
        }

        return (int) (ChronoUnit.DAYS.between(
                LocalDate.parse(String.valueOf(from)), LocalDate.parse(String.valueOf(to))) + 1);
    }

    /** El tramo de un elemento en la fila de una persona, que tiene que existir. */
    private static Map<String, Object> tramoDe(
            Map<String, Object> respuesta, String developerId, String workItemId) {
        return itemsDe(respuesta, developerId).stream()
                .filter(item -> workItemId.equals(item.get("workItemId")))
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        "no hay tramo de " + workItemId + " para " + developerId));
    }

    /** La causa del desplazamiento de un tramo, que no puede faltar. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> causaDe(Map<String, Object> tramo) {
        Object causa = tramo.get("displacement");

        assertThat(causa).as("un tramo desplazado tiene que traer su causa").isNotNull();

        return (Map<String, Object>) causa;
    }

    /** El motivo que la renegociacion publica para un requerimiento, para no escribirlo dos veces. */
    @SuppressWarnings("unchecked")
    private String motivoAuditado(String workItemId) throws Exception {
        List<Map<String, Object>> items =
                (List<Map<String, Object>>) leer("/api/renegotiations").get("items");

        Map<String, Object> item = items.stream()
                .filter(fila -> workItemId.equals(fila.get("workItemId")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no hay renegociacion para " + workItemId));

        List<Map<String, Object>> events = (List<Map<String, Object>>) item.get("events");

        return String.valueOf(events.getFirst().get("reason"));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> conflictosDe(
            Map<String, Object> respuesta, String developerId) {
        return ((List<Map<String, Object>>) respuesta.get("conflicts")).stream()
                .filter(conflicto -> developerId.equals(conflicto.get("developerId")))
                .toList();
    }
}
