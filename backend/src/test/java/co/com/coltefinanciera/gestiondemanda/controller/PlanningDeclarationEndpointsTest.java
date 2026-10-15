package co.com.coltefinanciera.gestiondemanda.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataRequest;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningSource;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicket;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiUser;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanSnapshotJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataHistoryJpaRepository;
import co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataJpaRepository;
import co.com.coltefinanciera.gestiondemanda.service.PlanningMetadataService;

/**
 * Pruebas de {@code GET /api/planning-metadata/declarations/{developerId}}.
 *
 * <p>El puerto de GLPI se sustituye por un doble, asi que lo que se comprueba es la lectura completa:
 * traer los tickets, clasificarlos y responder. Es la prueba que sostiene la afirmacion de que la
 * pantalla de declaracion se puede construir solo con esto.
 *
 * <p><strong>Los estados que salen de aqui son los del plan, y se comprueba en los dos sentidos.</strong>
 * Un ticket que esta respuesta marca {@code PLANIFICABLE} es uno que {@code POST /from-glpi} meteria
 * al motor, y uno marcado {@code SIN_ESTIMACION} es uno que descartaria con ese mismo codigo. La
 * prueba de que la clasificacion no esta escrita dos veces no es un comentario: es que las dos rutas
 * dan el mismo veredicto sobre el mismo ticket.
 *
 * <p><strong>Leer no escribe.</strong> Se comprueba sobre la base de datos: despues de consultar, no
 * hay ningun plan guardado y las declaraciones son las mismas que antes. Es la razon de que este
 * endpoint exista en vez de reutilizar el de planificacion, y por eso se prueba.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PlanningDeclarationEndpointsTest {

    private static final String RUTA = "/api/planning-metadata/declarations";

    private static final String DEVELOPER = "dev-1";

    private static final String FECHA_COMPROMISO = "2026-10-20";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private PlanningMetadataService metadataService;

    @Autowired
    private PlanningMetadataJpaRepository metadataRows;

    @Autowired
    private PlanningMetadataHistoryJpaRepository metadataHistory;

    @Autowired
    private PlanSnapshotJpaRepository plans;

    @MockitoBean
    private GlpiPlanningSource glpiPlanningSource;

    @BeforeEach
    void limpiar() {
        plans.deleteAll();
        metadataHistory.deleteAll();
        metadataRows.deleteAll();
    }

    // --- El escenario -----------------------------------------------------------------------

    private static GlpiTicket incidencia(int id) {
        return new GlpiTicket(id, "Falla en produccion " + id, 1, GlpiTicket.TYPE_INCIDENT, 4, null,
                null, 21600L, null, "2026-10-05 09:00:00");
    }

    private static GlpiTicket peticion(int id) {
        return new GlpiTicket(id, "Ajuste de reporte " + id, 1, GlpiTicket.TYPE_REQUEST, 3, null,
                null, 14400L, null, "2026-10-01 08:00:00");
    }

    /** Un ticket con un tipo que el contrato no declara: no se puede traducir. */
    private static GlpiTicket intraducible(int id) {
        return new GlpiTicket(id, "Ticket raro", 1, 99, 3, null, null, 3600L, null,
                "2026-10-05 09:00:00");
    }

    /** Declara la planificacion de un ticket; con nulo en un lado, declara solo el otro. */
    private void declarar(String workItemId, String horas, String fecha) {
        metadataService.create(new PlanningMetadataRequest(workItemId,
                horas == null ? null : new BigDecimal(horas),
                fecha == null ? null : LocalDate.parse(fecha), "ana"));
    }

    private void glpiResponde(GlpiTicket... tickets) {
        when(glpiPlanningSource.findUser(DEVELOPER))
                .thenReturn(Optional.of(new GlpiUser(7, "ana", "Perez", "Ana")));
        // Activos y no todos: lo resuelto y lo cerrado no se declara, asi que esta lectura no los pide.
        // El corte lo hace la busqueda del adaptador, y su prueba es la que lo fija.
        when(glpiPlanningSource.activeTicketsOf("7")).thenReturn(List.of(tickets));
    }

    // --- Los cinco estados, por HTTP ---------------------------------------------------------

    @Test
    @DisplayName("Un ticket con las dos cosas declaradas sale planificable y con su declaracion")
    void planificable() throws Exception {
        declarar("501", "6", FECHA_COMPROMISO);
        glpiResponde(incidencia(501));

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.developer.id").value(DEVELOPER))
                .andExpect(jsonPath("$.developer.name").value("Ana Perez"))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].workItemId").value("501"))
                .andExpect(jsonPath("$.items[0].type").value("INCIDENTE"))
                .andExpect(jsonPath("$.items[0].status").value("ABIERTO"))
                .andExpect(jsonPath("$.items[0].priority").value(4))
                .andExpect(jsonPath("$.items[0].createdAt").isNotEmpty())
                .andExpect(jsonPath("$.items[0].title").value("Falla en produccion 501"))
                .andExpect(jsonPath("$.items[0].declarationStatus").value("PLANIFICABLE"))
                .andExpect(jsonPath("$.items[0].discards.length()").value(0))
                // La declaracion viaja con el mismo contrato que su propio endpoint: quien vaya a
                // modificarla no necesita una segunda lectura.
                .andExpect(jsonPath("$.items[0].declaration.estimatedHours").value(6.0))
                .andExpect(jsonPath("$.items[0].declaration.committedDate").value(FECHA_COMPROMISO))
                .andExpect(jsonPath("$.items[0].declaration.estimatedBy").value("ana"))
                .andExpect(jsonPath("$.items[0].declaration.commitmentOverdue").value(false));
    }

    @Test
    @DisplayName("Sin horas declaradas el ticket dice que le falta la estimacion")
    void sinEstimacion() throws Exception {
        declarar("501", null, FECHA_COMPROMISO);
        glpiResponde(incidencia(501));

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].declarationStatus").value("SIN_ESTIMACION"))
                .andExpect(jsonPath("$.items[0].discards.length()").value(1))
                .andExpect(jsonPath("$.items[0].discards[0].code")
                        .value("SIN_ESTIMACION_DECLARADA"))
                .andExpect(jsonPath("$.items[0].discards[0].reason")
                        .value("la planificacion declarada no tiene estimacion"));
    }

    @Test
    @DisplayName("Sin fecha compromiso el ticket dice que le falta el compromiso")
    void sinCompromiso() throws Exception {
        declarar("501", "6", null);
        glpiResponde(incidencia(501));

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].declarationStatus").value("SIN_COMPROMISO"))
                .andExpect(jsonPath("$.items[0].discards[0].code")
                        .value("SIN_COMPROMISO_DECLARADO"));
    }

    @Test
    @DisplayName("Sin declaracion el ticket trae los dos descartes y no trae declaracion")
    void sinDeclaracion() throws Exception {
        glpiResponde(peticion(502));

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].declarationStatus").value("SIN_DECLARACION"))
                .andExpect(jsonPath("$.items[0].discards.length()").value(2))
                .andExpect(jsonPath("$.items[0].discards[0].code")
                        .value("SIN_ESTIMACION_DECLARADA"))
                .andExpect(jsonPath("$.items[0].discards[1].code")
                        .value("SIN_COMPROMISO_DECLARADO"))
                // No hay fila, y la respuesta lo dice con un nulo en vez de inventar un objeto vacio.
                .andExpect(jsonPath("$.items[0].declaration").doesNotExist());
    }

    @Test
    @DisplayName("Un ticket que GLPI entrega mal queda intraducible y el tipo va en nulo")
    void intraducible() throws Exception {
        glpiResponde(intraducible(503));

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].declarationStatus").value("NO_TRADUCIBLE"))
                .andExpect(jsonPath("$.items[0].discards[0].code").value("TIPO_DESCONOCIDO"))
                .andExpect(jsonPath("$.items[0].type").doesNotExist())
                .andExpect(jsonPath("$.items[0].status").doesNotExist());
    }

    @Test
    @DisplayName("Los cinco estados conviven en una misma respuesta, en el orden de GLPI")
    void mezclaDeEstados() throws Exception {
        declarar("501", "6", FECHA_COMPROMISO);
        declarar("502", null, FECHA_COMPROMISO);
        declarar("503", "6", null);
        glpiResponde(incidencia(501), incidencia(502), peticion(503), peticion(504),
                intraducible(505));

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(5))
                .andExpect(jsonPath("$.items[0].declarationStatus").value("PLANIFICABLE"))
                .andExpect(jsonPath("$.items[1].declarationStatus").value("SIN_ESTIMACION"))
                .andExpect(jsonPath("$.items[2].declarationStatus").value("SIN_COMPROMISO"))
                .andExpect(jsonPath("$.items[3].declarationStatus").value("SIN_DECLARACION"))
                .andExpect(jsonPath("$.items[4].declarationStatus").value("NO_TRADUCIBLE"))
                // El orden es el que devolvio GLPI: esta capa no reordena.
                .andExpect(jsonPath("$.items[0].workItemId").value("501"))
                .andExpect(jsonPath("$.items[1].workItemId").value("502"))
                .andExpect(jsonPath("$.items[2].workItemId").value("503"))
                .andExpect(jsonPath("$.items[3].workItemId").value("504"))
                .andExpect(jsonPath("$.items[4].workItemId").value("505"));
    }

    @Test
    @DisplayName("Un tecnico sin tickets responde 200 con la lista vacia, no un error")
    void tecnicoSinTickets() throws Exception {
        glpiResponde();

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    @Test
    @DisplayName("Una agenda grande llega entera, con cada ticket en su estado")
    void tecnicoConMuchosTickets() throws Exception {
        IntStream.rangeClosed(1, 60).forEach(id -> declarar(String.valueOf(600 + id), "6",
                FECHA_COMPROMISO));
        glpiResponde(IntStream.rangeClosed(1, 60).mapToObj(id -> incidencia(600 + id))
                .toArray(GlpiTicket[]::new));

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(60))
                // Ni uno solo se queda por el camino, y ninguno sale sin clasificar.
                .andExpect(jsonPath("$.items[?(@.declarationStatus != 'PLANIFICABLE')]").isEmpty());
    }

    @Test
    @DisplayName("Un tecnico que no esta en GLPI responde 404, no una lista vacia")
    void tecnicoInexistente() throws Exception {
        when(glpiPlanningSource.findUser("fantasma")).thenReturn(Optional.empty());

        mockMvc.perform(get(RUTA + "/{developerId}", "fantasma"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("DEVELOPER_NOT_FOUND"));
    }

    @Test
    @DisplayName("Consultar las declaraciones no crea ningun plan")
    void consultarNoPlanifica() throws Exception {
        declarar("501", "6", FECHA_COMPROMISO);
        glpiResponde(incidencia(501), peticion(502));
        long filas = metadataRows.count();
        long historia = metadataHistory.count();

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2));

        // El motor no se ejecuto: no hay plan guardado, que es lo que se habria llevado por delante
        // reutilizar el endpoint que si planifica.
        assertThat(plans.count()).isZero();
        // Y lo declarado sigue exactamente como estaba: leer no toca el estado ni su historia.
        assertThat(metadataRows.count()).isEqualTo(filas);
        assertThat(metadataHistory.count()).isEqualTo(historia);
    }

    @Test
    @DisplayName("La respuesta declara de donde sale cada dato")
    void laRespuestaDeclaraSuProcedencia() throws Exception {
        glpiResponde(incidencia(501));

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source.glpi").isNotEmpty())
                .andExpect(jsonPath("$.source.declaration").isNotEmpty());
    }

    @Test
    @DisplayName("Los tickets se piden activos: esta lectura no toca la de todos, que es la que planifica")
    void losTicketsSePidenActivos() throws Exception {
        glpiResponde(incidencia(501));

        mockMvc.perform(get(RUTA + "/{developerId}", DEVELOPER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1));

        // Es lo que hace que un tecnico con mil doscientos sesenta y seis tickets cerrados deje de
        // tener mil doscientos sesenta y seis: esta lectura no llega a pedirlos. `ticketsOf` es la del
        // plan, y esa sigue viendo el historico entero.
        verify(glpiPlanningSource).activeTicketsOf("7");
        verify(glpiPlanningSource, never()).ticketsOf(anyString());
    }

    @Test
    @DisplayName("El tecnico se puede pedir por su numero de GLPI, no solo por su login")
    void elTecnicoSePuedePedirPorSuNumero() throws Exception {
        declarar("501", "6", FECHA_COMPROMISO);
        // Se teclea el numero, y el numero es lo que GLPI entiende por /User/7: la resolucion del
        // identificador la hace el adaptador, y aqui solo se comprueba que la ruta lo admite.
        when(glpiPlanningSource.findUser("7"))
                .thenReturn(Optional.of(new GlpiUser(7, "ana", "Perez", "Ana")));
        when(glpiPlanningSource.activeTicketsOf("7")).thenReturn(List.of(incidencia(501)));

        mockMvc.perform(get(RUTA + "/{developerId}", "7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.developer.id").value("7"))
                .andExpect(jsonPath("$.developer.name").value("Ana Perez"))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].declarationStatus").value("PLANIFICABLE"));
    }
}
