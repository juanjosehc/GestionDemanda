package co.com.coltefinanciera.gestiondemanda.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

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
 * Pruebas de los endpoints de planificacion.
 *
 * <p>Levantan el contexto entero, base de datos incluida: lo que se comprueba es justamente el
 * recorrido completo, que lo que el motor calculo termine guardado y que se pueda volver a pedir.
 * Un doble en el repositorio probaria el mapeo HTTP y nada mas.
 *
 * <p>El escenario es el que ya usa la prueba del motor: un incidente de seis horas sobre una jornada
 * de ocho obliga a desplazar un requerimiento de cuatro pactado para ese mismo dia.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PlanningEndpointsTest {

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

    /**
     * El mismo escenario sin trabajo, con las reglas sobrescritas en la peticion.
     *
     * <p>Aisla el contexto de la planificacion: lo que se comprueba es que lo guardado son las reglas
     * que el motor <em>recibio</em>, y con una agenda vacia no hay ningun calculo que pueda
     * confundirse con ellas.
     */
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
    private RescheduleClaimJpaRepository claims;

    /**
     * El registro de idempotencia es estado global y compartido entre peticiones, que es su gracia.
     * Para que una prueba no dependa de la anterior, se vacia antes de cada una.
     */
    @BeforeEach
    void limpiarReclamos() {
        claims.deleteAll();
    }

    @Test
    @DisplayName("POST /plan devuelve 201 con el identificador y el plan ya calculado")
    void planDevuelveElIdentificadorYElPlanYaCalculado() throws Exception {
        mockMvc.perform(post("/api/planning/plan").contentType(APPLICATION_JSON).content(ESCENARIO))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.planId").isNotEmpty())
                .andExpect(jsonPath("$.createdAt").isNotEmpty())
                // El incidente ocupa el lunes de 9 a 15 y el requerimiento cierra el martes: dos
                // bloques para el requerimiento, uno para el incidente.
                .andExpect(jsonPath("$.plan.blocks.length()").value(3))
                .andExpect(jsonPath("$.plan.allocations.length()").value(2))
                .andExpect(jsonPath("$.plan.rescheduleEvents.length()").value(1))
                .andExpect(jsonPath("$.plan.rescheduleEvents[0].requirementId").value("REQ-1"))
                .andExpect(jsonPath("$.plan.rescheduleEvents[0].appliedRule")
                        .value("UMBRAL_INCIDENTE_EXCEDIDO"));
    }

    @Test
    @DisplayName("GET /{planId} devuelve el plan guardado con la misma agenda")
    void getPlanDevuelveElPlanGuardadoConLaMismaAgenda() throws Exception {
        String planId = guardarPlan();

        mockMvc.perform(get("/api/planning/{planId}", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value(planId))
                .andExpect(jsonPath("$.developerId").value("dev-1"))
                .andExpect(jsonPath("$.allocations.length()").value(2))
                .andExpect(jsonPath("$.blocks.length()").value(3))
                .andExpect(jsonPath("$.rescheduleEvents.length()").value(1))
                .andExpect(jsonPath("$.conflicts.length()").value(0));
    }

    @Test
    @DisplayName("El plan releido trae las mismas fechas que calculo el motor")
    void elPlanReleidoTraeLasMismasFechasQueCalculoElMotor() throws Exception {
        String planId = guardarPlan();

        mockMvc.perform(get("/api/planning/{planId}", planId))
                .andExpect(status().isOk())
                // El requerimiento no cabe el lunes completo: dos horas el lunes y dos el martes.
                .andExpect(jsonPath("$.blocks[1].workItemId").value("REQ-1"))
                .andExpect(jsonPath("$.blocks[1].start").value("2026-10-05T15:00:00"))
                .andExpect(jsonPath("$.blocks[1].end").value("2026-10-05T17:00:00"))
                .andExpect(jsonPath("$.blocks[2].start").value("2026-10-06T09:00:00"))
                .andExpect(jsonPath("$.blocks[2].end").value("2026-10-06T11:00:00"))
                .andExpect(jsonPath("$.rescheduleEvents[0].originalDate").value("2026-10-05"))
                .andExpect(jsonPath("$.rescheduleEvents[0].rescheduledDate").value("2026-10-06"));
    }

    @Test
    @DisplayName("GET /{planId}/blocks devuelve solo los tramos de agenda")
    void getBlocksDevuelveSoloLosTramosDeAgenda() throws Exception {
        String planId = guardarPlan();

        mockMvc.perform(get("/api/planning/{planId}/blocks", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].workItemId").value("INC-1"))
                .andExpect(jsonPath("$[0].start").value("2026-10-05T09:00:00"))
                .andExpect(jsonPath("$[0].end").value("2026-10-05T15:00:00"))
                .andExpect(jsonPath("$[0].developerId").value("dev-1"));
    }

    @Test
    @DisplayName("Los bloques sueltos son los mismos que trae el plan entero")
    void losBloquesSueltosSonLosMismosQueTraeElPlanEntero() throws Exception {
        String planId = guardarPlan();

        String plan = mockMvc.perform(get("/api/planning/{planId}", planId))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        String blocks = mockMvc.perform(get("/api/planning/{planId}/blocks", planId))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        assertThat(bloquesEn(blocks, "$")).isEqualTo(bloquesEn(plan, "$.blocks"));
    }

    @Test
    @DisplayName("GET /{planId}/context devuelve las reglas con las que se calculo")
    void getContextDevuelveLasReglasConLasQueSeCalculo() throws Exception {
        String planId = guardarPlan();

        String contexto = mockMvc.perform(get("/api/planning/{planId}/context", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value(planId))
                .andExpect(jsonPath("$.engineVersion").isNotEmpty())
                .andExpect(jsonPath("$.calculatedAt").isNotEmpty())
                // La zona tal como la escribe ZoneId para el reloj del sistema: "Z", no "UTC". Se fija
                // el valor real y no el que uno esperaria leer, que es de lo que va esta prueba.
                .andExpect(jsonPath("$.zoneId").value("Z"))
                .andExpect(jsonPath("$.rules.planningHorizonDays").value(10))
                // Las tres severidades se guardan siempre, aunque el escenario no declare ninguna:
                // lo que se audita es el acuerdo vigente, no el trozo que se uso.
                .andExpect(jsonPath("$.rules.incidentPolicies.length()").value(3))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // Los numeros se leen como BigDecimal y se comparan con isEqualByComparingTo: la columna es
        // NUMERIC(10,4) y devuelve 4.0000, que para BigDecimal no es igual a 4.
        assertThat(numeroEn(contexto, "$.rules.incidentThresholdHours")).isEqualByComparingTo("4");
        assertThat(numeroEn(contexto, "$.rules.workingHoursPerDay")).isEqualByComparingTo("8");
        assertThat(horaEn(contexto, "$.rules.calendar.startTime")).isEqualTo(LocalTime.of(9, 0));
        assertThat(horaEn(contexto, "$.rules.calendar.endTime")).isEqualTo(LocalTime.of(17, 0));
    }

    @Test
    @DisplayName("El contexto guardado explica la regla que se aplico al desplazamiento")
    void elContextoGuardadoExplicaLaReglaQueSeAplico() throws Exception {
        // La integridad de la auditoria: el evento dice que se aplico UMBRAL_INCIDENTE_EXCEDIDO, que
        // no significa nada por si solo. El contexto dice contra que umbral se midio, y con eso la
        // afirmacion se puede comprobar en lugar de creer.
        String plan = mockMvc.perform(
                        post("/api/planning/plan").contentType(APPLICATION_JSON).content(ESCENARIO))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        String planId = JsonPath.read(plan, "$.planId");

        String contexto = mockMvc.perform(get("/api/planning/{planId}/context", planId))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        assertThat(JsonPath.parse(plan).read("$.plan.rescheduleEvents[0].appliedRule", String.class))
                .isEqualTo("UMBRAL_INCIDENTE_EXCEDIDO");
        // El incidente dura 6 h y el umbral guardado es 4: la regla se sostiene.
        assertThat(numeroEn(contexto, "$.rules.incidentThresholdHours")).isEqualByComparingTo("4");
    }

    @Test
    @DisplayName("El contexto guarda las reglas que recibio el motor, no las configuradas")
    void elContextoGuardaLasReglasQueRecibioElMotorNoLasConfiguradas() throws Exception {
        // La prueba que distingue guardar de verdad de guardar la configuracion: estas reglas solo
        // existen en la peticion. Si el contexto se armara desde las propiedades, saldrian las de
        // application-test.properties y esta prueba fallaria.
        String planId = JsonPath.read(
                mockMvc.perform(post("/api/planning/plan").contentType(APPLICATION_JSON).content(SOLO_REGLAS))
                        .andExpect(status().isCreated())
                        .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8),
                "$.planId");

        String contexto = mockMvc.perform(get("/api/planning/{planId}/context", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rules.planningHorizonDays").value(3))
                .andExpect(jsonPath("$.severities.length()").value(0))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        assertThat(numeroEn(contexto, "$.rules.incidentThresholdHours")).isEqualByComparingTo("9");
        // La jornada tampoco tiene columna: se deriva del calendario, y son las 6 h que se pidieron.
        assertThat(numeroEn(contexto, "$.rules.workingHoursPerDay")).isEqualByComparingTo("6");
        assertThat(horaEn(contexto, "$.rules.calendar.endTime")).isEqualTo(LocalTime.of(15, 0));
    }

    @Test
    @DisplayName("GET /{planId}/input devuelve los datos exactos que recibio el motor")
    void getInputDevuelveLosDatosExactosQueRecibioElMotor() throws Exception {
        String planId = guardarPlan();

        mockMvc.perform(get("/api/planning/{planId}/input", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value(planId))
                .andExpect(jsonPath("$.developerId").value("dev-1"))
                .andExpect(jsonPath("$.incidents.length()").value(1))
                .andExpect(jsonPath("$.incidents[0].id").value("INC-1"))
                .andExpect(jsonPath("$.incidents[0].reportedAt").value("2026-10-05T09:00:00Z"))
                .andExpect(jsonPath("$.incidents[0].status").value("ABIERTO"))
                .andExpect(jsonPath("$.incidents[0].severity").doesNotExist())
                .andExpect(jsonPath("$.requirements.length()").value(1))
                .andExpect(jsonPath("$.requirements[0].id").value("REQ-1"))
                .andExpect(jsonPath("$.requirements[0].plannedDate").value("2026-10-05"))
                .andExpect(jsonPath("$.requirements[0].status").value("PLANIFICADO"));
    }

    @Test
    @DisplayName("La entrada guardada no lleva titulos, y no es un olvido")
    void laEntradaGuardadaNoLlevaTitulos() throws Exception {
        // La peticion acepta title y la respuesta no lo devuelve. Es la decision de la fase: el motor
        // nunca lo lee, asi que no se guarda ni se expone. Se comprueba para que la asimetria quede
        // escrita y nadie la tome por un campo que se perdio por el camino.
        String planId = guardarPlan();

        mockMvc.perform(get("/api/planning/{planId}/input", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.incidents[0].title").doesNotExist())
                .andExpect(jsonPath("$.requirements[0].title").doesNotExist())
                .andExpect(jsonPath("$.developerName").doesNotExist());
    }

    @Test
    @DisplayName("La entrada guarda tambien lo que el motor descarto")
    void laEntradaGuardaTambienLoQueElMotorDescarto() throws Exception {
        // Un incidente ya resuelto no compite por la jornada y no aparece ni en los bloques ni en el
        // contexto. En la entrada si: la foto es de lo que se recibio, no de lo que se uso.
        String conResuelto = """
                {
                  "developer": {"id": "dev-1", "name": "Ana"},
                  "incidents": [
                    {
                      "id": "INC-1",
                      "estimatedHours": 6,
                      "reportedAt": "2026-10-05T09:00:00Z",
                      "status": "ABIERTO"
                    },
                    {
                      "id": "INC-VIEJO",
                      "estimatedHours": 2,
                      "reportedAt": "2026-10-01T09:00:00Z",
                      "status": "RESUELTO"
                    }
                  ],
                  "requirements": []
                }
                """;

        String plan = mockMvc.perform(
                        post("/api/planning/plan").contentType(APPLICATION_JSON).content(conResuelto))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        String planId = JsonPath.read(plan, "$.planId");

        mockMvc.perform(get("/api/planning/{planId}/input", planId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.incidents.length()").value(2))
                .andExpect(jsonPath("$.incidents[1].id").value("INC-VIEJO"))
                .andExpect(jsonPath("$.incidents[1].status").value("RESUELTO"));

        // Y el resuelto no llego al plan: ni bloque, ni asignacion.
        mockMvc.perform(get("/api/planning/{planId}", planId))
                .andExpect(jsonPath("$.blocks.length()").value(1))
                .andExpect(jsonPath("$.blocks[0].workItemId").value("INC-1"));
    }

    @Test
    @DisplayName("Un plan sin entrada registrada responde 404, no una entrada vacia")
    void unPlanSinEntradaRegistradaResponde404() throws Exception {
        // Los planes calculados antes de esta fase existen y no tienen entrada. Devolver una entrada
        // en blanco afirmaria que el motor recibio una agenda vacia, que es justo lo que no consta.
        UUID desconocido = UUID.randomUUID();

        mockMvc.perform(get("/api/planning/{planId}/input", desconocido))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));
    }

    @Test
    @DisplayName("Un plan inexistente responde 404 con codigo propio")
    void unPlanInexistenteResponde404() throws Exception {
        UUID desconocido = UUID.randomUUID();

        mockMvc.perform(get("/api/planning/{planId}", desconocido))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("No existe el plan " + desconocido));

        mockMvc.perform(get("/api/planning/{planId}/blocks", desconocido))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));

        mockMvc.perform(get("/api/planning/{planId}/context", desconocido))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));

        mockMvc.perform(get("/api/planning/{planId}/input", desconocido))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));
    }

    @Test
    @DisplayName("Un identificador que no es un UUID responde 400, no 500")
    void unIdentificadorQueNoEsUuidResponde400() throws Exception {
        mockMvc.perform(get("/api/planning/{planId}", "no-es-un-uuid"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("simulate sigue funcionando y no devuelve identificador de plan")
    void simulateSigueFuncionandoYNoDevuelveIdentificadorDePlan() throws Exception {
        mockMvc.perform(post("/api/planning/simulate").contentType(APPLICATION_JSON).content(ESCENARIO))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.developerId").value("dev-1"))
                .andExpect(jsonPath("$.blocks.length()").value(3))
                .andExpect(jsonPath("$.rescheduleEvents.length()").value(1))
                .andExpect(jsonPath("$.planId").doesNotExist());
    }

    @Test
    @DisplayName("Planificar dos veces el mismo escenario no audita el desplazamiento dos veces")
    void planificarDosVecesElMismoEscenarioNoAuditaDosVeces() throws Exception {
        // El riesgo que la fase cierra, visto desde fuera. La primera ejecucion desplaza el
        // requerimiento y lo audita; la segunda vuelve a desplazarlo, porque el plan se recalcula
        // entero, pero ya no lo audita: el hecho esta registrado y sigue estandolo aunque la
        // aplicacion se haya reiniciado entre las dos peticiones.
        String primero = mockMvc.perform(
                        post("/api/planning/plan").contentType(APPLICATION_JSON).content(ESCENARIO))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.plan.rescheduleEvents.length()").value(1))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        String segundo = mockMvc.perform(
                        post("/api/planning/plan").contentType(APPLICATION_JSON).content(ESCENARIO))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.plan.rescheduleEvents.length()").value(0))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // El desplazamiento si ocurrio las dos veces: lo que no se repite es la auditoria.
        assertThat(bloquesEn(segundo, "$.plan.blocks")).isEqualTo(bloquesEn(primero, "$.plan.blocks"));
    }

    private String guardarPlan() throws Exception {
        String body = mockMvc.perform(
                        post("/api/planning/plan").contentType(APPLICATION_JSON).content(ESCENARIO))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return JsonPath.read(body, "$.planId");
    }

    /**
     * Los bloques de una respuesta, en la ruta que les corresponde.
     *
     * <p>La ruta se pasa desde fuera porque las dos respuestas que devuelven un plan no tienen la
     * misma forma: {@code POST /plan} cuelga el resultado de {@code plan} y {@code GET /{planId}} lo
     * aplana. Es deliberado, y escribirlo aqui evita que la prueba lo de por supuesto.
     */
    private static List<?> bloquesEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta, List.class);
    }

    /** Un numero de la respuesta, leido como BigDecimal para poder compararlo por valor. */
    private static BigDecimal numeroEn(String respuesta, String ruta) {
        return new BigDecimal(JsonPath.parse(respuesta).read(ruta).toString());
    }

    /**
     * Una hora de la respuesta. Se parsea en vez de comparar la cadena porque Jackson puede escribir
     * {@code 09:00} o {@code 09:00:00} segun el formateador, y lo que importa es la hora, no su letra.
     */
    private static LocalTime horaEn(String respuesta, String ruta) {
        return LocalTime.parse(JsonPath.parse(respuesta).read(ruta, String.class));
    }
}
