package co.com.coltefinanciera.gestiondemanda.controller;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataHistoryJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataJpaRepository;

/**
 * Pruebas HTTP de la planificacion declarada.
 *
 * <p>Levantan el contexto entero, base de datos incluida, porque lo que se comprueba es el recorrido
 * completo: que lo declarado quede guardado, que se pueda volver a pedir y que el historial crezca
 * entre llamadas. Un doble en el repositorio probaria el mapeo HTTP y nada mas.
 *
 * <p><strong>Las fechas compromiso de estas pruebas estan lejos de hoy a proposito</strong>, en el
 * año 2000 y en el 2099. El indicador de vencimiento se calcula con el reloj real, y una fecha
 * cercana haria que la prueba cambiara de resultado con el paso del tiempo: la de 2099 nunca esta
 * vencida y la del 2000 siempre lo esta, se ejecute cuando se ejecute.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PlanningMetadataEndpointsTest {

    private static final String RUTA = "/api/planning-metadata";

    /** Una estimacion sin fecha compromiso: el estado minimo que el POST admite. */
    private static final String DECLARACION = """
            {"workItemId": "67501", "estimatedHours": 8, "changedBy": "dev-ana"}
            """;

    /** La misma estimacion, ahora con un compromiso lejano y firmado por quien lo compromete. */
    private static final String MODIFICACION = """
            {"estimatedHours": 8, "committedDate": "2099-12-31", "changedBy": "gestor-luis"}
            """;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private PlanningMetadataJpaRepository rows;

    @Autowired
    private PlanningMetadataHistoryJpaRepository historyRows;

    @BeforeEach
    void limpiar() {
        historyRows.deleteAll();
        rows.deleteAll();
    }

    @Test
    @DisplayName("POST declara y devuelve 201 con el estado ya sellado")
    void postDeclaraYDevuelve201() throws Exception {
        mockMvc.perform(post(RUTA).contentType(APPLICATION_JSON).content(DECLARACION))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.workItemId").value("67501"))
                .andExpect(jsonPath("$.estimatedHours").value(8.0))
                .andExpect(jsonPath("$.estimatedBy").value("dev-ana"))
                .andExpect(jsonPath("$.estimatedAt").isNotEmpty())
                .andExpect(jsonPath("$.committedDate").value(nullValue()))
                .andExpect(jsonPath("$.committedBy").value(nullValue()))
                .andExpect(jsonPath("$.commitmentOverdue").value(false))
                .andExpect(jsonPath("$.source").value("HTTP"));
    }

    @Test
    @DisplayName("El estado declarado se puede volver a pedir")
    void elEstadoDeclaradoSePuedeVolverAPedir() throws Exception {
        declarar();

        mockMvc.perform(get(RUTA + "/{workItemId}", "67501"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.workItemId").value("67501"))
                .andExpect(jsonPath("$.estimatedBy").value("dev-ana"));
    }

    @Test
    @DisplayName("El historial crece entre llamadas y conserva el orden")
    void elHistorialCreceEntreLlamadasYConservaElOrden() throws Exception {
        declarar();

        mockMvc.perform(put(RUTA + "/{workItemId}", "67501")
                        .contentType(APPLICATION_JSON).content(MODIFICACION))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.committedDate").value("2099-12-31"))
                .andExpect(jsonPath("$.committedBy").value("gestor-luis"))
                // La estimacion no cambio: conserva su autor de la declaracion anterior.
                .andExpect(jsonPath("$.estimatedBy").value("dev-ana"))
                .andExpect(jsonPath("$.commitmentOverdue").value(false));

        mockMvc.perform(get(RUTA + "/{workItemId}/history", "67501"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.workItemId").value("67501"))
                .andExpect(jsonPath("$.changes.length()").value(2))
                .andExpect(jsonPath("$.changes[0].field").value("ESTIMATED_HOURS"))
                .andExpect(jsonPath("$.changes[0].previousValue").value(nullValue()))
                .andExpect(jsonPath("$.changes[0].newValue").value("8.0000"))
                .andExpect(jsonPath("$.changes[0].changedBy").value("dev-ana"))
                .andExpect(jsonPath("$.changes[1].field").value("COMMITTED_DATE"))
                .andExpect(jsonPath("$.changes[1].previousValue").value(nullValue()))
                .andExpect(jsonPath("$.changes[1].newValue").value("2099-12-31"))
                .andExpect(jsonPath("$.changes[1].changedBy").value("gestor-luis"));
    }

    @Test
    @DisplayName("Retirar la estimacion responde 200 y la deja en nulo")
    void retirarLaEstimacionResponde200YLaDejaEnNulo() throws Exception {
        declarar();

        mockMvc.perform(put(RUTA + "/{workItemId}", "67501")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {"estimatedHours": null, "changedBy": "dev-ana"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estimatedHours").value(nullValue()))
                // El autor sobrevive al valor: dice quien la retiro.
                .andExpect(jsonPath("$.estimatedBy").value("dev-ana"));

        mockMvc.perform(get(RUTA + "/{workItemId}/history", "67501"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.changes.length()").value(2))
                .andExpect(jsonPath("$.changes[1].previousValue").value("8.0000"))
                .andExpect(jsonPath("$.changes[1].newValue").value(nullValue()));
    }

    @Test
    @DisplayName("Un compromiso ya pasado vuelve marcado como vencido")
    void unCompromisoYaPasadoVuelveMarcadoComoVencido() throws Exception {
        mockMvc.perform(post(RUTA).contentType(APPLICATION_JSON)
                        .content("""
                                {"workItemId": "67502", "committedDate": "2000-01-01", "changedBy": "gestor-luis"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.committedDate").value("2000-01-01"))
                .andExpect(jsonPath("$.commitmentOverdue").value(true));
    }

    @Test
    @DisplayName("Declarar dos veces el mismo elemento responde 409")
    void declararDosVecesElMismoElementoResponde409() throws Exception {
        declarar();

        mockMvc.perform(post(RUTA).contentType(APPLICATION_JSON).content(DECLARACION))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.error").value("PLANNING_METADATA_ALREADY_EXISTS"));
    }

    @Test
    @DisplayName("Declarar sin estimacion ni compromiso responde 400")
    void declararSinEstimacionNiCompromisoResponde400() throws Exception {
        mockMvc.perform(post(RUTA).contentType(APPLICATION_JSON)
                        .content("""
                                {"workItemId": "67503", "changedBy": "dev-ana"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("VALIDATION_ERROR"));
    }

    @Test
    @DisplayName("Modificar sin decir quien responde 400")
    void modificarSinDecirQuienResponde400() throws Exception {
        declarar();

        mockMvc.perform(put(RUTA + "/{workItemId}", "67501")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {"estimatedHours": 8}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("VALIDATION_ERROR"));
    }

    @Test
    @DisplayName("Pedir un elemento sin planificacion responde 404")
    void pedirUnElementoSinPlanificacionResponde404() throws Exception {
        mockMvc.perform(get(RUTA + "/{workItemId}", "99999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLANNING_METADATA_NOT_FOUND"));
    }

    @Test
    @DisplayName("Pedir el historial de un elemento sin planificacion responde 404")
    void pedirElHistorialDeUnElementoSinPlanificacionResponde404() throws Exception {
        mockMvc.perform(get(RUTA + "/{workItemId}/history", "99999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLANNING_METADATA_NOT_FOUND"));
    }

    @Test
    @DisplayName("Modificar un elemento sin planificacion responde 404")
    void modificarUnElementoSinPlanificacionResponde404() throws Exception {
        mockMvc.perform(put(RUTA + "/{workItemId}", "99999")
                        .contentType(APPLICATION_JSON).content(MODIFICACION))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("PLANNING_METADATA_NOT_FOUND"));
    }

    private void declarar() throws Exception {
        mockMvc.perform(post(RUTA).contentType(APPLICATION_JSON).content(DECLARACION))
                .andExpect(status().isCreated());
    }
}
