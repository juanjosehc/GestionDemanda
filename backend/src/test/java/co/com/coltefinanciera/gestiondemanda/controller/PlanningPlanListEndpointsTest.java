package co.com.coltefinanciera.gestiondemanda.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;

import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningSource;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanSnapshotJpaRepository;

/**
 * Pruebas de {@code GET /api/planning/plans/{developerId}}.
 *
 * <p>Es la primera lectura de esta API que devuelve <em>una coleccion de planes</em> y no un plan: las
 * demas o son de uno concreto o son agregados. Lo que hay que demostrar es que la coleccion esta bien
 * formada —ordenada, acotada a su tecnico, completa— y que leerla no cambia nada.
 *
 * <p><strong>Los escenarios estan vacios a proposito.</strong> Lo que se prueba es el listado, que lee
 * la tabla de planes y nada mas, asi que lo que se escribe es la fila del plan y nada mas. Un escenario
 * con trabajo obligaria al motor a auditar desplazamientos, y el registro de idempotencia es global y
 * compartido con el resto de la suite: ensuciarlo desde aqui haria fallar a otras clases por una razon
 * que no tiene nada que ver con lo que se esta midiendo (riesgo 177). Con la agenda vacia no hay
 * desplazamiento que reclamar y la prueba se queda con lo suyo.
 *
 * <p><strong>Aqui no se borra nada, y por eso cada prueba estrena su tecnico.</strong> El contexto de
 * Spring es uno para todas las clases de {@code controller/*Test}, asi que un {@code deleteAll()} desde
 * esta clase se llevaria por delante filas que otra prueba acaba de escribir —las tablas hijas no
 * tienen clave foranea que lo impida— y romperia sus conteos. Pero tampoco se puede compartir un
 * tecnico entre las pruebas de esta clase: sin borrar y sin transaccion que revierta, los planes de una
 * se sumarian a los de la siguiente y las cuentas dirian seis donde se guardaron tres. Cada prueba usa
 * un identificador que no aparece en ningun otro sitio, y con eso la lista que lee es exactamente la
 * que acaba de escribir.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PlanningPlanListEndpointsTest {

    private static final String RUTA = "/api/planning/plans";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private PlanSnapshotJpaRepository planRows;

    /** La fuente de GLPI, doblada: listar planes no tiene por que preguntarle nada a nadie. */
    @MockitoBean
    private GlpiPlanningSource glpiPlanningSource;

    @Test
    @DisplayName("Un tecnico sin planes devuelve una lista vacia, y no un 404")
    void unTecnicoSinPlanesDevuelveUnaListaVaciaYNoUn404() throws Exception {
        // «No tiene planes» y «no existe» son la misma respuesta a proposito: esta capa no tiene
        // padron de tecnicos —el que hay vive en otra ruta y se resuelve contra GLPI—, asi que
        // distinguirlos obligaria a que una lectura local dependiera de la integracion.
        mockMvc.perform(get(RUTA + "/{developerId}", "dev-cmp-nadie"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.developerId").value("dev-cmp-nadie"))
                .andExpect(jsonPath("$.plans.length()").value(0))
                .andExpect(jsonPath("$.scope").isNotEmpty());
    }

    @Test
    @DisplayName("Los planes salen del mas antiguo al mas reciente")
    void losPlanesSalenDelMasAntiguoAlMasReciente() throws Exception {
        String tecnico = "dev-cmp-orden";

        String primero = guardarPlan(tecnico);
        String segundo = guardarPlan(tecnico);
        String tercero = guardarPlan(tecnico);

        assertThat(leerIdentificadores(tecnico)).containsExactly(primero, segundo, tercero);
    }

    /**
     * La comprobacion cruzada, que es la que de verdad sostiene el orden.
     *
     * <p>Que la lista salga en el orden en que se guardaron ya lo dice la prueba de arriba. Lo que hay
     * que demostrar es que ese orden <em>es</em> el del tiempo y no el del azar: y eso se ve preguntando
     * por otra puerta. {@code /metrics} publica el plan vigente de cada tecnico eligiendolo por su
     * sello, sin saber nada de esta ruta, asi que si el ultimo de la lista y el vigente de las metricas
     * coinciden, las dos lecturas estan diciendo lo mismo por caminos que no se conocen.
     */
    @Test
    @DisplayName("El ultimo de la lista es el plan que las metricas publican como vigente")
    void elUltimoDeLaListaEsElVigenteDeLasMetricas() throws Exception {
        String tecnico = "dev-cmp-vigente";

        guardarPlan(tecnico);
        guardarPlan(tecnico);
        String ultimo = guardarPlan(tecnico);

        List<String> identificadores = leerIdentificadores(tecnico);
        assertThat(identificadores).hasSize(3).doesNotHaveDuplicates();
        assertThat(identificadores.getLast()).isEqualTo(ultimo);
        // Y la lista y las metricas coinciden, que es la mitad que no depende de mi cuenta.
        assertThat(vigenteDeLasMetricas(tecnico)).isEqualTo(ultimo);
    }

    @Test
    @DisplayName("La lista de un tecnico no mezcla los planes de otro")
    void laListaDeUnTecnicoNoMezclaLosPlanesDeOtro() throws Exception {
        String tecnico = "dev-cmp-suyo";
        String otro = "dev-cmp-ajeno";

        String suyo = guardarPlan(tecnico);
        guardarPlan(otro);
        guardarPlan(otro);

        assertThat(leerIdentificadores(tecnico)).containsExactly(suyo);
        assertThat(leerIdentificadores(otro)).hasSize(2).doesNotContain(suyo);
    }

    /**
     * La convivencia de rutas, que es lo que esta fase estrena en la superficie HTTP.
     *
     * <p>El listado vive en {@code /plans/{developerId}} y el plan en {@code /{planId}} y
     * {@code /{planId}/...}, asi que lo que hay que demostrar es que ninguna de las dos se come a la
     * otra: la ruta nueva responde para un tecnico corriente, y las de un plan siguen contestando lo de
     * antes —{@code 400} a un segmento que no es un UUID, {@code 404} a un UUID que no existe—.
     *
     * <p>La ultima mitad anota el unico choque posible entre las dos, medido y no supuesto: un
     * identificador que se llame como una de las cuatro sub-rutas de un plan —{@code blocks},
     * {@code context}, {@code input}, {@code timeline}— lo lee el patron del plan y contesta que no es
     * un UUID. Ningun inicio de sesion de GLPI se llama asi, y se deja escrito porque es lo que pasa,
     * no porque se prometa.
     */
    @Test
    @DisplayName("La ruta nueva convive con las del plan sin comerse sus casos malos")
    void laRutaNuevaConviveConLasDelPlan() throws Exception {
        mockMvc.perform(get(RUTA + "/{developerId}", "dev-cmp-rutas"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.developerId").value("dev-cmp-rutas"));

        mockMvc.perform(get("/api/planning/{planId}", "no-es-un-uuid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_PARAMETER"));

        mockMvc.perform(get("/api/planning/{planId}", "0f0b7c1e-0000-0000-0000-000000000000"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLAN_NOT_FOUND"));

        mockMvc.perform(get(RUTA + "/{developerId}", "blocks"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_PARAMETER"));
    }

    /**
     * La mitad del principio de la fase —trabajar solo sobre lo persistido— vista desde aqui.
     *
     * <p>Se cuenta antes y despues, y se contrasta por dos puertas: la tabla, que dice cuantas filas
     * hay, y {@code plans.generated} de las metricas, que es el numero que la casa publica. Un listado
     * que guardara algo seria una fuga silenciosa: no fallaria ninguna prueba de contenido y la base
     * creceria cada vez que alguien abre la pantalla, que es justo lo que se le pide a un endpoint de
     * escritura y no a este.
     */
    @Test
    @DisplayName("Listar no guarda nada ni ejecuta el motor")
    void listarNoGuardaNadaNiEjecutaElMotor() throws Exception {
        String tecnico = "dev-cmp-escritura";
        guardarPlan(tecnico);

        long filasAntes = planRows.count();
        long generadosAntes = numeroEn(leerMetricas(), "$.plans.generated");

        leerLista(tecnico);
        leerLista(tecnico);

        assertThat(planRows.count()).isEqualTo(filasAntes);
        assertThat(numeroEn(leerMetricas(), "$.plans.generated")).isEqualTo(generadosAntes);
    }

    /**
     * La respuesta no lleva fecha de servidor, asi que dos llamadas tienen que salir identicas.
     *
     * <p>Es mas fuerte que comparar el contenido: lo que se afirma es que no hay <em>nada</em> en el
     * cuerpo que dependa del reloj o del orden en que se lea. Los sellos que viajan son los de los
     * planes, que ya estaban escritos.
     */
    @Test
    @DisplayName("Dos llamadas devuelven exactamente lo mismo")
    void dosLlamadasDevuelvenExactamenteLoMismo() throws Exception {
        String tecnico = "dev-cmp-estable";
        guardarPlan(tecnico);
        guardarPlan(tecnico);

        assertThat(leerLista(tecnico)).isEqualTo(leerLista(tecnico));
    }

    /**
     * Listar planes no pregunta a GLPI.
     *
     * <p>Es la frontera de la fase, y se comprueba en vez de afirmarse: la fuente esta doblada y se
     * exige que nadie la haya tocado. Si manana alguien «enriqueciera» el listado resolviendo el nombre
     * del tecnico contra el catalogo, esta prueba lo diria —y seria un cambio de naturaleza: una
     * lectura local pasaria a depender de la integracion, que es lo que el brief prohibe.
     */
    @Test
    @DisplayName("Listar planes no consulta la fuente de GLPI")
    void listarPlanesNoConsultaLaFuenteDeGlpi() throws Exception {
        String tecnico = "dev-cmp-glpi";
        guardarPlan(tecnico);

        leerLista(tecnico);

        verifyNoInteractions(glpiPlanningSource);
    }

    // --- El escenario y las lecturas -----------------------------------------------------------------

    /**
     * Un escenario sin trabajo, para el tecnico que se pida.
     *
     * <p>La agenda vacia es lo que hace que esta prueba no toque el registro de idempotencia: sin
     * incidente y requerimiento que se estorben, el motor no audita ningun desplazamiento.
     */
    private static String escenarioDe(String developerId) {
        return """
                {
                  "developer": {"id": "%s", "name": "Ana"},
                  "incidents": [],
                  "requirements": [],
                  "rules": {
                    "incidentThresholdHours": 9,
                    "workingHoursPerDay": 6,
                    "planningHorizonDays": 3
                  }
                }
                """.formatted(developerId);
    }

    /** Guarda un plan por el camino real y devuelve su identificador. */
    private String guardarPlan(String developerId) throws Exception {
        String body = mockMvc.perform(post("/api/planning/plan")
                        .contentType(APPLICATION_JSON)
                        .content(escenarioDe(developerId)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return JsonPath.read(body, "$.planId");
    }

    private String leerLista(String developerId) throws Exception {
        return mockMvc.perform(get(RUTA + "/{developerId}", developerId))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private List<String> leerIdentificadores(String developerId) throws Exception {
        return JsonPath.parse(leerLista(developerId)).read("$.plans[*].planId");
    }

    private String leerMetricas() throws Exception {
        return mockMvc.perform(get("/api/planning/metrics"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    /**
     * El plan que las metricas publican como vigente de un tecnico.
     *
     * <p>Se busca por identificador en lugar de por posicion: el detalle viene ordenado por
     * desarrollador —que no es el orden en que se guardaron—, y dar por hecho lo contrario seria
     * apoyar esta prueba en algo que no promete nadie.
     */
    private String vigenteDeLasMetricas(String developerId) throws Exception {
        String foto = leerMetricas();
        List<String> tecnicos = JsonPath.parse(foto).read("$.current.byDeveloper[*].developerId");
        List<String> planes = JsonPath.parse(foto).read("$.current.byDeveloper[*].planId");

        int posicion = tecnicos.indexOf(developerId);
        assertThat(posicion).as("el tecnico %s tiene plan vigente en las metricas", developerId)
                .isNotNegative();
        return planes.get(posicion);
    }

    private static long numeroEn(String respuesta, String ruta) {
        return JsonPath.parse(respuesta).read(ruta, Long.class);
    }
}
