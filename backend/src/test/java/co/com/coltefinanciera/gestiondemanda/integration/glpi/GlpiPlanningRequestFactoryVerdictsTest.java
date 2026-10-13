package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;
import co.com.coltefinanciera.gestiondemanda.domain.repository.PlanningMetadataRepository;
import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;

/**
 * La clasificacion que comparten el plan y la lectura de declaraciones.
 *
 * <p>Es la prueba de la regla que sostiene todo esto: <strong>hay una sola clasificacion</strong>. Lo
 * que se comprueba aqui no es solo que cada estado salga bien, sino que {@link
 * GlpiPlanningRequestFactory#verdicts} y {@link GlpiPlanningRequestFactory#build} dicen lo mismo,
 * porque son el mismo recorrido. Si algun dia alguien escribiera una segunda version de las reglas
 * para la pantalla, la prueba de consistencia de abajo es la que tendria que fallar.
 *
 * <p>El repositorio se sustituye por un doble y no se usa el de verdad: ademas de las declaraciones,
 * lo que hay que poder afirmar es <em>cuantas veces se pregunta</em> por ellas, y eso solo se cuenta
 * sobre un doble.
 */
class GlpiPlanningRequestFactoryVerdictsTest {

    private static final ZoneId BOGOTA = ZoneId.of("America/Bogota");

    private static final Instant AHORA = Instant.parse("2026-10-06T00:00:00Z");

    private static final GlpiUser USER = new GlpiUser(7, "jdoe", "Doe", "Jane");

    private final GlpiTicketMapper mapper =
            new GlpiTicketMapper(Clock.fixed(AHORA, BOGOTA), GlpiContract.REST_V1);

    private final GlpiTicketValidator validator = new GlpiTicketValidator(mapper);

    private final PlanningMetadataRepository declarations = mock(PlanningMetadataRepository.class);

    private final GlpiPlanningRequestFactory factory = new GlpiPlanningRequestFactory(
            mapper, validator, GlpiContract.REST_V1, declarations);

    @BeforeEach
    void sinDeclaraciones() {
        when(declarations.findByWorkItemIdIn(any())).thenReturn(List.of());
    }

    // --- El escenario -----------------------------------------------------------------------

    private static GlpiTicket incidencia(int id) {
        return new GlpiTicket(id, "Incidencia " + id, 1, GlpiTicket.TYPE_INCIDENT, 5, null, null,
                21600L, null, "2026-10-05 09:00:00");
    }

    /** Declara lo que se le pase: horas, fecha, o las dos. */
    private static PlanningMetadata declaracion(int ticketId, String horas, String fecha) {
        return PlanningMetadata.declared(String.valueOf(ticketId),
                horas == null ? null : new BigDecimal(horas),
                fecha == null ? null : LocalDate.parse(fecha),
                "ana", AHORA, InputSource.HTTP);
    }

    /** Deja el doble devolviendo estas declaraciones para la consulta por lote. */
    private void declaradas(PlanningMetadata... filas) {
        when(declarations.findByWorkItemIdIn(any())).thenReturn(List.of(filas));
    }

    // --- Los cinco estados ------------------------------------------------------------------

    @Test
    @DisplayName("Con estimacion y compromiso el ticket es planificable y no arrastra descartes")
    void planificable() {
        declaradas(declaracion(1, "6", "2026-10-20"));

        GlpiPlanningRequestFactory.Verdict verdict = factory.verdicts(List.of(incidencia(1))).get(0);

        assertThat(verdict.status()).isEqualTo(DeclarationStatus.PLANIFICABLE);
        assertThat(verdict.discards()).isEmpty();
        assertThat(verdict.incident()).isNotNull();
        assertThat(verdict.requirement()).isNull();
        assertThat(verdict.reading().type()).isEqualTo(
                co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType.INCIDENTE);
        assertThat(verdict.reading().status()).isEqualTo(IncidentStatus.ABIERTO.name());
        assertThat(verdict.reading().createdAt()).isNotNull();
    }

    @Test
    @DisplayName("Con compromiso y sin horas le falta la estimacion, que la debe el desarrollador")
    void sinEstimacion() {
        declaradas(declaracion(1, null, "2026-10-20"));

        GlpiPlanningRequestFactory.Verdict verdict = factory.verdicts(List.of(incidencia(1))).get(0);

        assertThat(verdict.status()).isEqualTo(DeclarationStatus.SIN_ESTIMACION);
        assertThat(verdict.discards()).singleElement()
                .extracting(GlpiDiscardedItem::code)
                .isEqualTo(GlpiDiscardReason.SIN_ESTIMACION_DECLARADA);
    }

    @Test
    @DisplayName("Con horas y sin compromiso le falta la fecha, que la debe el gestor")
    void sinCompromiso() {
        declaradas(declaracion(1, "6", null));

        GlpiPlanningRequestFactory.Verdict verdict = factory.verdicts(List.of(incidencia(1))).get(0);

        assertThat(verdict.status()).isEqualTo(DeclarationStatus.SIN_COMPROMISO);
        assertThat(verdict.discards()).singleElement()
                .extracting(GlpiDiscardedItem::code)
                .isEqualTo(GlpiDiscardReason.SIN_COMPROMISO_DECLARADO);
    }

    @Test
    @DisplayName("Sin declaracion ninguna le faltan las dos cosas, y se informan las dos")
    void sinDeclaracion() {
        GlpiPlanningRequestFactory.Verdict verdict = factory.verdicts(List.of(incidencia(1))).get(0);

        assertThat(verdict.status()).isEqualTo(DeclarationStatus.SIN_DECLARACION);
        assertThat(verdict.discards())
                .extracting(GlpiDiscardedItem::code)
                .containsExactly(GlpiDiscardReason.SIN_ESTIMACION_DECLARADA,
                        GlpiDiscardReason.SIN_COMPROMISO_DECLARADO);
        // El texto distingue «nadie declaro» de «alguien retiro lo que habia», que el codigo junta.
        assertThat(verdict.discards()).allSatisfy(discard ->
                assertThat(discard.reason()).isEqualTo("no hay planificacion declarada para este elemento"));
    }

    @Test
    @DisplayName("Un tipo que el contrato no conoce queda intraducible, y dice con que lo hizo")
    void tipoDesconocido() {
        GlpiTicket raro = new GlpiTicket(9, "Ticket raro", 1, 99, 5, null, null, 3600L, null,
                "2026-10-05 09:00:00");

        GlpiPlanningRequestFactory.Verdict verdict = factory.verdicts(List.of(raro)).get(0);

        assertThat(verdict.status()).isEqualTo(DeclarationStatus.NO_TRADUCIBLE);
        assertThat(verdict.discards()).singleElement()
                .extracting(GlpiDiscardedItem::code)
                .isEqualTo(GlpiDiscardReason.TIPO_DESCONOCIDO);
        // No se sabe que es, asi que no se sabe su estado: los dos nulos son la respuesta honesta.
        assertThat(verdict.reading().type()).isNull();
        assertThat(verdict.reading().status()).isNull();
    }

    @Test
    @DisplayName("Un ticket sin identificador no llega ni a preguntar por su declaracion")
    void sinIdentificador() {
        GlpiTicket anonimo = new GlpiTicket(null, "Sin id", 1, GlpiTicket.TYPE_INCIDENT, 5, null,
                null, 3600L, null, "2026-10-05 09:00:00");

        GlpiPlanningRequestFactory.Verdict verdict = factory.verdicts(List.of(anonimo)).get(0);

        assertThat(verdict.status()).isEqualTo(DeclarationStatus.NO_TRADUCIBLE);
        assertThat(verdict.discards()).singleElement()
                .extracting(GlpiDiscardedItem::code)
                .isEqualTo(GlpiDiscardReason.SIN_IDENTIFICADOR_TICKET);
        // El hueco se escribe: la misma convencion que usa la respuesta del plan.
        assertThat(verdict.discards()).singleElement()
                .extracting(GlpiDiscardedItem::ticketId)
                .isEqualTo(GlpiDiscardedItem.SIN_IDENTIFICADOR);
    }

    @Test
    @DisplayName("Una fila con los dos valores retirados es la misma falta que no tener fila")
    void declaracionRetirada() {
        declaradas(declaracion(1, "6", "2026-10-20").declaredWith(null, null, "ana", AHORA));

        GlpiPlanningRequestFactory.Verdict verdict = factory.verdicts(List.of(incidencia(1))).get(0);

        assertThat(verdict.status()).isEqualTo(DeclarationStatus.SIN_DECLARACION);
        // Pero el texto si distingue los dos casos: aqui alguien paso y retiro lo que habia.
        assertThat(verdict.discards()).allSatisfy(discard ->
                assertThat(discard.reason()).startsWith("la planificacion declarada"));
    }

    // --- Las dos afirmaciones que sostienen el diseño ----------------------------------------

    @Test
    @DisplayName("La clasificacion se pregunta una sola vez, por muchos tickets que haya")
    void sinConsultasPorTicket() {
        declaradas(declaracion(1, "6", "2026-10-20"));

        factory.verdicts(IntStream.rangeClosed(1, 40).mapToObj(
                GlpiPlanningRequestFactoryVerdictsTest::incidencia).toList());

        // Una consulta por lote, y ninguna por elemento: es la diferencia entre una lectura y cuarenta.
        verify(declarations, times(1)).findByWorkItemIdIn(any());
        verify(declarations, never()).findByWorkItemId(anyString());
    }

    @Test
    @DisplayName("El plan y la lectura de declaraciones son el mismo recorrido, no dos")
    void elPlanYLaLecturaDicenLoMismo() {
        // Un ticket de cada cosa, para que la comparacion cubra los cinco estados de una vez.
        GlpiTicket planificable = incidencia(1);
        GlpiTicket sinEstimacion = incidencia(2);
        GlpiTicket sinCompromiso = incidencia(3);
        GlpiTicket sinDeclaracion = incidencia(4);
        GlpiTicket intraducible = new GlpiTicket(5, "Ticket raro", 1, 99, 5, null, null, 3600L, null,
                "2026-10-05 09:00:00");
        List<GlpiTicket> tickets = List.of(planificable, sinEstimacion, sinCompromiso,
                sinDeclaracion, intraducible);

        declaradas(declaracion(1, "6", "2026-10-20"), declaracion(2, null, "2026-10-20"),
                declaracion(3, "6", null));

        List<GlpiPlanningRequestFactory.Verdict> verdicts = factory.verdicts(tickets);
        GlpiPlanningRequestFactory.Result plan = factory.build("jdoe", USER, tickets,
                PlanningRules.defaults());

        // Lo que entra al motor es exactamente lo que la lectura marca planificable...
        assertThat(verdicts.stream()
                .filter(verdict -> verdict.status() == DeclarationStatus.PLANIFICABLE)
                .map(verdict -> verdict.ticket().id())
                .toList())
                .containsExactlyInAnyOrderElementsOf(plan.request().incidents().stream()
                        .map(incidencia -> Integer.valueOf(incidencia.id()))
                        .toList());
        // ...y lo que se descarta es exactamente la union de los descartes que la lectura informa.
        assertThat(plan.discarded()).containsExactlyInAnyOrderElementsOf(verdicts.stream()
                .flatMap(verdict -> verdict.discards().stream())
                .toList());

        // Y los codigos no son una traduccion de las reglas: son los que el validador produjo.
        for (GlpiPlanningRequestFactory.Verdict verdict : verdicts) {
            List<GlpiDiscardedItem> esperados = validator.rejection(verdict.ticket())
                    .map(List::of)
                    .orElseGet(() -> validator.missingDeclaration(verdict.ticket(),
                            verdict.declaration()));
            assertThat(verdict.discards()).containsExactlyElementsOf(esperados);
        }
    }
}
