package co.com.coltefinanciera.gestiondemanda.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.enums.AppliedRule;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RenegotiationStatus;
import co.com.coltefinanciera.gestiondemanda.domain.model.RenegotiationChange;
import co.com.coltefinanciera.gestiondemanda.domain.repository.InMemoryRenegotiationRepository;
import co.com.coltefinanciera.gestiondemanda.dto.DisplacedRequirementsResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningSimulationResponse;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationHistoryResponse;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationRequest;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationResponse;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationUpdateRequest;
import co.com.coltefinanciera.gestiondemanda.dto.RenegotiationsResponse;
import co.com.coltefinanciera.gestiondemanda.exception.RenegotiationAlreadyExistsException;
import co.com.coltefinanciera.gestiondemanda.exception.RenegotiationNotFoundException;

/**
 * Pruebas del modelo de renegociacion: los casos limite del acuerdo y la lectura consolidada.
 *
 * <p>Es una prueba unitaria, con el puerto en memoria y sin Spring, porque lo que se comprueba son
 * reglas —que se sella, que se conserva, que se deduce— y no el recorrido de una peticion. Que el
 * acuerdo se guarde de verdad lo prueba el repositorio, y que la respuesta salga por HTTP lo prueban
 * los endpoints.
 *
 * <p><strong>El desplazamiento se dobla, no se calcula.</strong> {@code PlanningMetricsService} se
 * sustituye por un doble que devuelve los desplazamientos que cada prueba necesita. Es deliberado: el
 * motor y su auditoria ya estan probados en {@code PlanningEngineTest} y en las pruebas del timeline,
 * y volver a montarlos aqui probaria dos veces lo mismo mientras escondia lo que si es nuevo —que el
 * estado se deduzca de los dos hechos y de ninguno mas—.
 *
 * <p><strong>El reloj se mueve, y tiene que moverse.</strong> «Cubierto» y «no cubierto» se deciden
 * comparando el sello del acuerdo con el del desplazamiento: con un reloj fijo los dos instantes
 * serian el mismo y la prueba no distinguiria una cosa de la otra, que es justo lo que hay que
 * distinguir.
 */
class RenegotiationServiceTest {

    private static final String ITEM = "67501";
    private static final String OTRO = "67502";
    private static final String DEVELOPER = "dev-ana";
    private static final UUID PLAN = UUID.fromString("11111111-1111-1111-1111-111111111111");

    private static final Instant AHORA = Instant.parse("2026-10-06T15:00:00Z");
    private static final Instant DESPLAZAMIENTO = Instant.parse("2026-10-05T09:00:00Z");
    private static final Instant OTRO_DESPLAZAMIENTO = Instant.parse("2026-10-04T09:00:00Z");

    private InMemoryRenegotiationRepository repository;
    private PlanningMetricsService metrics;
    private RelojMovil reloj;
    private RenegotiationService service;

    @BeforeEach
    void crearServicio() {
        repository = new InMemoryRenegotiationRepository();
        metrics = mock(PlanningMetricsService.class);
        reloj = new RelojMovil();
        service = new RenegotiationService(repository, metrics, reloj);
    }

    // ------------------------------------------------------------------
    // 1. La lectura vacia
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Sin nada desplazado la lectura viene vacia y con los tres numeros en cero")
    void sinNadaDesplazadoLaLecturaVieneVacia() {
        desplazados();

        RenegotiationsResponse respuesta = service.renegotiations();

        assertThat(respuesta.items()).isEmpty();
        assertThat(respuesta.summary().displaced()).isZero();
        assertThat(respuesta.summary().pending()).isZero();
        assertThat(respuesta.summary().agreed()).isZero();
        assertThat(respuesta.generatedAt()).isEqualTo(AHORA);
        assertThat(respuesta.source()).isEqualTo(RenegotiationsResponse.SOURCE);
        assertThat(respuesta.scope()).isEqualTo(RenegotiationsResponse.SCOPE);
    }

    @Test
    @DisplayName("Un acuerdo cuyo requerimiento ya no esta desplazado no aparece en la lectura")
    void unAcuerdoCuyoRequerimientoYaNoEstaDesplazadoNoAparece() {
        // El plan vigente ya no lo desplaza: alguien lo reprogramo, o el plan se rehizo sin el. El
        // acuerdo sigue guardado —es historia— pero no es una fila de esta lista, que es la lista de
        // lo que hay que renegociar hoy.
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));
        desplazados();

        assertThat(service.renegotiations().items()).isEmpty();
        // Y el acuerdo sigue estando: no se ha borrado nada por no salir en la lista.
        assertThat(repository.findByWorkItemId(ITEM)).isPresent();
    }

    // ------------------------------------------------------------------
    // 2. Pendiente de renegociacion
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Un desplazamiento sin acuerdo sale pendiente y con su causa")
    void unDesplazamientoSinAcuerdoSalePendiente() {
        desplazados(elemento(ITEM, desplazamiento(DESPLAZAMIENTO, "INC-7", ITEM, "2026-10-20", "2026-10-27")));

        RenegotiationsResponse.Item fila = unicaFila();

        assertThat(fila.status()).isEqualTo(RenegotiationStatus.PENDIENTE_DE_ACUERDO);
        assertThat(fila.renegotiation()).isNull();
        assertThat(fila.workItemId()).isEqualTo(ITEM);
        assertThat(fila.developerId()).isEqualTo(DEVELOPER);
        assertThat(fila.planId()).isEqualTo(PLAN);
        assertThat(service.renegotiations().summary().pending()).isEqualTo(1);
        assertThat(service.renegotiations().summary().agreed()).isZero();
    }

    // ------------------------------------------------------------------
    // 3. Renegociado
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Un acuerdo posterior al desplazamiento deja el elemento acordado")
    void unAcuerdoPosteriorAlDesplazamientoDejaElElementoAcordado() {
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));
        desplazados(elemento(ITEM, desplazamiento(DESPLAZAMIENTO, "INC-7", ITEM, "2026-10-20", "2026-10-27")));

        RenegotiationsResponse.Item fila = unicaFila();

        assertThat(fila.status()).isEqualTo(RenegotiationStatus.ACORDADA);
        assertThat(fila.renegotiation()).isNotNull();
        assertThat(fila.renegotiation().agreedDate()).isEqualTo(LocalDate.of(2026, 10, 30));
        assertThat(fila.renegotiation().agreedBy()).isEqualTo("gestor-luis");
        assertThat(fila.renegotiation().agreedAt()).isEqualTo(AHORA);
        assertThat(fila.renegotiation().source()).isEqualTo(InputSource.HTTP);
        assertThat(service.renegotiations().summary().agreed()).isEqualTo(1);
        assertThat(service.renegotiations().summary().pending()).isZero();
    }

    @Test
    @DisplayName("Renegociar no borra el desplazamiento: la fila sigue trayendo su causa")
    void renegociarNoBorraElDesplazamiento() {
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));
        desplazados(elemento(ITEM, desplazamiento(DESPLAZAMIENTO, "INC-7", ITEM, "2026-10-20", "2026-10-27")));

        RenegotiationsResponse.Item fila = unicaFila();

        // El hecho auditado por el motor sigue entero, con su incidente y sus dos fechas. Acordar una
        // fecha nueva no lo sustituye: se añade al lado.
        assertThat(fila.events()).hasSize(1);
        assertThat(fila.events().get(0).incidentId()).isEqualTo("INC-7");
        assertThat(fila.events().get(0).originalDate()).isEqualTo(LocalDate.of(2026, 10, 20));
        assertThat(fila.events().get(0).rescheduledDate()).isEqualTo(LocalDate.of(2026, 10, 27));
        assertThat(fila.events().get(0).timestamp()).isEqualTo(DESPLAZAMIENTO);
    }

    // ------------------------------------------------------------------
    // 4. El historial
    // ------------------------------------------------------------------

    @Test
    @DisplayName("El primer acuerdo entra al historial con la fecha anterior nula")
    void elPrimerAcuerdoEntraAlHistorialConFechaAnteriorNula() {
        RenegotiationResponse respuesta = service.create(alta(ITEM, "2026-10-30", "gestor-luis"));

        assertThat(respuesta.agreedDate()).isEqualTo(LocalDate.of(2026, 10, 30));
        assertThat(respuesta.agreedBy()).isEqualTo("gestor-luis");
        // El sello lo pone el servidor: la peticion no trae cuando se registro.
        assertThat(respuesta.agreedAt()).isEqualTo(AHORA);

        assertThat(repository.findHistory(ITEM))
                .extracting(RenegotiationChange::previousDate,
                        RenegotiationChange::newDate,
                        RenegotiationChange::changedBy,
                        RenegotiationChange::changedAt)
                .containsExactly(tuple(null, LocalDate.of(2026, 10, 30), "gestor-luis", AHORA));
    }

    @Test
    @DisplayName("Volver a acordar deja la fecha anterior y la nueva en el historial")
    void volverAAcordarDejaLaFechaAnteriorYLaNueva() {
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));
        reloj.avanzarA(AHORA.plus(Duration.ofDays(2)));

        RenegotiationResponse respuesta = service.update(
                ITEM, cambio("2026-11-15", "gestor-marta"));

        assertThat(respuesta.agreedDate()).isEqualTo(LocalDate.of(2026, 11, 15));
        assertThat(respuesta.agreedBy()).isEqualTo("gestor-marta");
        assertThat(respuesta.agreedAt()).isEqualTo(AHORA.plus(Duration.ofDays(2)));

        assertThat(repository.findHistory(ITEM))
                .extracting(RenegotiationChange::previousDate,
                        RenegotiationChange::newDate,
                        RenegotiationChange::changedBy)
                .containsExactly(
                        tuple(null, LocalDate.of(2026, 10, 30), "gestor-luis"),
                        tuple(LocalDate.of(2026, 10, 30), LocalDate.of(2026, 11, 15), "gestor-marta"));
    }

    @Test
    @DisplayName("Reenviar la misma fecha no añade una fila al historial ni mueve el sello")
    void reenviarLaMismaFechaNoAnadeFila() {
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));
        reloj.avanzarA(AHORA.plus(Duration.ofDays(2)));

        RenegotiationResponse respuesta = service.update(
                ITEM, cambio("2026-10-30", "gestor-marta"));

        assertThat(repository.findHistory(ITEM)).hasSize(1);
        // Si no hubo cambio, no hay cambio que atribuir: el acuerdo conserva autor y sello.
        assertThat(respuesta.agreedBy()).isEqualTo("gestor-luis");
        assertThat(respuesta.agreedAt()).isEqualTo(AHORA);
    }

    @Test
    @DisplayName("El historial de un requerimiento sin acuerdo es una lista vacia, no un 404")
    void elHistorialDeUnRequerimientoSinAcuerdoEsUnaListaVacia() {
        RenegotiationHistoryResponse respuesta = service.history(ITEM);

        assertThat(respuesta.workItemId()).isEqualTo(ITEM);
        assertThat(respuesta.changes()).isEmpty();
    }

    // ------------------------------------------------------------------
    // 5. La trazabilidad
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Una sola fila contesta las seis preguntas de la trazabilidad")
    void unaFilaContestaLasSeisPreguntasDeLaTrazabilidad() {
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));
        desplazados(elemento(ITEM, desplazamiento(DESPLAZAMIENTO, "INC-7", ITEM, "2026-10-20", "2026-10-27")));

        RenegotiationsResponse.Item fila = unicaFila();

        // Que requerimiento fue afectado.
        assertThat(fila.workItemId()).isEqualTo(ITEM);
        // Que incidente causo el desplazamiento.
        assertThat(fila.events().get(0).incidentId()).isEqualTo("INC-7");
        // Cual era la fecha original.
        assertThat(fila.events().get(0).originalDate()).isEqualTo(LocalDate.of(2026, 10, 20));
        // Cual es la nueva fecha acordada.
        assertThat(fila.renegotiation().agreedDate()).isEqualTo(LocalDate.of(2026, 10, 30));
        // Quien registro el acuerdo.
        assertThat(fila.renegotiation().agreedBy()).isEqualTo("gestor-luis");
        // Cuando se registro.
        assertThat(fila.renegotiation().agreedAt()).isEqualTo(AHORA);
    }

    // ------------------------------------------------------------------
    // 6. Multiples desplazamientos sobre el mismo requerimiento
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Un requerimiento movido dos veces es una sola fila con dos eventos")
    void unRequerimientoMovidoDosVecesEsUnaSolaFilaConDosEventos() {
        desplazados(
                elemento(ITEM,
                        desplazamiento(OTRO_DESPLAZAMIENTO, "INC-4", ITEM, "2026-10-15", "2026-10-20"),
                        desplazamiento(DESPLAZAMIENTO, "INC-7", ITEM, "2026-10-20", "2026-10-27")),
                elemento(OTRO, desplazamiento(DESPLAZAMIENTO, "INC-9", OTRO, "2026-10-18", "2026-10-25")));

        RenegotiationsResponse respuesta = service.renegotiations();

        // Dos requerimientos desplazados: el movido dos veces sigue siendo uno.
        assertThat(respuesta.items()).hasSize(2);
        assertThat(respuesta.summary().displaced()).isEqualTo(2);
        assertThat(respuesta.items().get(0).events()).hasSize(2);
        assertThat(respuesta.items().get(0).events())
                .extracting(PlanningSimulationResponse.RescheduleEventView::incidentId)
                .containsExactly("INC-4", "INC-7");
    }

    @Test
    @DisplayName("Dos desplazamientos y un acuerdo posterior dejan el elemento acordado")
    void dosDesplazamientosYUnAcuerdoPosteriorDejanElElementoAcordado() {
        service.create(alta(ITEM, "2026-11-10", "gestor-luis"));
        desplazados(elemento(ITEM,
                desplazamiento(OTRO_DESPLAZAMIENTO, "INC-4", ITEM, "2026-10-15", "2026-10-20"),
                desplazamiento(DESPLAZAMIENTO, "INC-7", ITEM, "2026-10-20", "2026-10-27")));

        // El acuerdo cubre los dos: es posterior al ultimo, y por tanto al primero tambien.
        assertThat(unicaFila().status()).isEqualTo(RenegotiationStatus.ACORDADA);
    }

    // ------------------------------------------------------------------
    // 7. Casos limite
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Un incidente posterior sobre un requerimiento ya renegociado lo reabre")
    void unIncidentePosteriorSobreUnRequerimientoYaRenegociadoLoReabre() {
        // Se acordo una fecha, y despues un incidente volvio a mover el requerimiento.
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));
        Instant posterior = AHORA.plus(Duration.ofDays(3));
        desplazados(elemento(ITEM,
                desplazamiento(DESPLAZAMIENTO, "INC-7", ITEM, "2026-10-20", "2026-10-27"),
                desplazamiento(posterior, "INC-12", ITEM, "2026-10-30", "2026-11-04")));

        RenegotiationsResponse.Item fila = unicaFila();

        // Vuelve a estar pendiente: hay que acordar otra vez.
        assertThat(fila.status()).isEqualTo(RenegotiationStatus.PENDIENTE_DE_ACUERDO);
        // Y el acuerdo anterior sigue visible, que es lo que deja ver que hubo uno y que se movio
        // despues. Esconderlo borraria la explicacion de por que la fecha ya no sirve.
        assertThat(fila.renegotiation()).isNotNull();
        assertThat(fila.renegotiation().agreedDate()).isEqualTo(LocalDate.of(2026, 10, 30));
        assertThat(service.renegotiations().summary().pending()).isEqualTo(1);
    }

    @Test
    @DisplayName("Un acuerdo del mismo instante que el desplazamiento lo cubre")
    void unAcuerdoDelMismoInstanteQueElDesplazamientoLoCubre() {
        // El orden entre dos hechos con el mismo sello no es deducible: suponer que el incidente llego
        // despues inventaria una renegociacion pendiente que nadie pidio.
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));
        desplazados(elemento(ITEM,
                desplazamiento(AHORA, "INC-7", ITEM, "2026-10-20", "2026-10-27")));

        assertThat(unicaFila().status()).isEqualTo(RenegotiationStatus.ACORDADA);
    }

    @Test
    @DisplayName("Varios incidentes simultaneos son una sola fila con un evento por incidente")
    void variosIncidentesSimultaneosSonUnaSolaFila() {
        desplazados(elemento(ITEM,
                desplazamiento(DESPLAZAMIENTO, "INC-7", ITEM, "2026-10-20", "2026-10-27"),
                desplazamiento(DESPLAZAMIENTO, "INC-8", ITEM, "2026-10-20", "2026-10-27")));

        RenegotiationsResponse respuesta = service.renegotiations();

        assertThat(respuesta.items()).hasSize(1);
        assertThat(respuesta.items().get(0).events()).hasSize(2);
        assertThat(respuesta.items().get(0).status()).isEqualTo(RenegotiationStatus.PENDIENTE_DE_ACUERDO);
    }

    @Test
    @DisplayName("Un elemento desplazado sin eventos auditados no se da por acordado")
    void unElementoDesplazadoSinEventosAuditadosNoSeDaPorAcordado() {
        // No ocurre —el timeline solo marca desplazado a quien tiene un evento que lo justifique— pero
        // si ocurriera, no hay sello con el que comparar y darlo por acordado esconderia una
        // renegociacion pendiente. La respuesta honesta es «pendiente».
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));
        desplazados(elemento(ITEM));

        assertThat(unicaFila().status()).isEqualTo(RenegotiationStatus.PENDIENTE_DE_ACUERDO);
    }

    @Test
    @DisplayName("La renegociacion repetida reemplaza la fecha y no crea un acuerdo nuevo")
    void laRenegociacionRepetidaReemplazaLaFechaYNoCreaUnAcuerdoNuevo() {
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));
        reloj.avanzarA(AHORA.plus(Duration.ofDays(2)));
        service.update(ITEM, cambio("2026-11-15", "gestor-marta"));
        desplazados(elemento(ITEM, desplazamiento(DESPLAZAMIENTO, "INC-7", ITEM, "2026-10-20", "2026-10-27")));

        RenegotiationsResponse.Item fila = unicaFila();

        // Un solo acuerdo, con la ultima fecha: volver a acordar no apila acuerdos.
        assertThat(fila.status()).isEqualTo(RenegotiationStatus.ACORDADA);
        assertThat(fila.renegotiation().agreedDate()).isEqualTo(LocalDate.of(2026, 11, 15));
        assertThat(service.renegotiations().summary().displaced()).isEqualTo(1);
        // Y las dos veces quedaron registradas.
        assertThat(repository.findHistory(ITEM)).hasSize(2);
    }

    @Test
    @DisplayName("Registrar dos veces el mismo elemento responde que ya existe")
    void registrarDosVecesElMismoElementoRespondeQueYaExiste() {
        service.create(alta(ITEM, "2026-10-30", "gestor-luis"));

        assertThatThrownBy(() -> service.create(alta(ITEM, "2026-11-15", "gestor-marta")))
                .isInstanceOf(RenegotiationAlreadyExistsException.class);

        // Y el acuerdo vigente no se toco: el conflicto lo resolvio el repositorio, no el servicio.
        assertThat(repository.findByWorkItemId(ITEM)).get()
                .extracting(uno -> uno.agreedDate())
                .isEqualTo(LocalDate.of(2026, 10, 30));
    }

    @Test
    @DisplayName("Modificar un requerimiento sin acuerdo responde que no existe")
    void modificarUnRequerimientoSinAcuerdoRespondeQueNoExiste() {
        assertThatThrownBy(() -> service.update(ITEM, cambio("2026-11-15", "gestor-marta")))
                .isInstanceOf(RenegotiationNotFoundException.class);
    }

    @Test
    @DisplayName("Consultar un requerimiento sin acuerdo responde que no existe")
    void consultarUnRequerimientoSinAcuerdoRespondeQueNoExiste() {
        assertThatThrownBy(() -> service.find(ITEM))
                .isInstanceOf(RenegotiationNotFoundException.class);
    }

    // ------------------------------------------------------------------
    // Apoyo
    // ------------------------------------------------------------------

    private RenegotiationsResponse.Item unicaFila() {
        List<RenegotiationsResponse.Item> items = service.renegotiations().items();
        assertThat(items).hasSize(1);
        return items.get(0);
    }

    private void desplazados(DisplacedRequirementsResponse.Element... elements) {
        when(metrics.displaced()).thenReturn(new DisplacedRequirementsResponse(
                "plan_snapshot", "scope de prueba", AHORA, List.of(elements)));
    }

    private static DisplacedRequirementsResponse.Element elemento(
            String workItemId, PlanningSimulationResponse.RescheduleEventView... events) {

        return new DisplacedRequirementsResponse.Element(
                DEVELOPER, PLAN, AHORA, workItemId, List.of(events));
    }

    private static PlanningSimulationResponse.RescheduleEventView desplazamiento(
            Instant cuando, String incidente, String requerimiento, String original, String movida) {

        return new PlanningSimulationResponse.RescheduleEventView(
                cuando, incidente, requerimiento,
                LocalDate.parse(original), LocalDate.parse(movida),
                AppliedRule.CAPACIDAD_COMPROMETIDA, IncidentSeverity.ALTO,
                "el incidente comprometio la capacidad de la jornada");
    }

    private static RenegotiationRequest alta(String workItemId, String fecha, String agreedBy) {
        return new RenegotiationRequest(workItemId, LocalDate.parse(fecha), agreedBy);
    }

    private static RenegotiationUpdateRequest cambio(String fecha, String agreedBy) {
        return new RenegotiationUpdateRequest(LocalDate.parse(fecha), agreedBy);
    }

    /**
     * Un reloj que se puede mover.
     *
     * <p>Hace falta para comprobar que un acuerdo que no cambia <em>conserva</em> su instante en vez
     * de renovarse, y para poner un acuerdo antes o despues de un desplazamiento sin depender del dia
     * en que se ejecute la suite.
     */
    private static final class RelojMovil extends Clock {

        private Instant ahora = AHORA;

        void avanzarA(Instant instante) {
            this.ahora = instante;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return ahora;
        }
    }
}
