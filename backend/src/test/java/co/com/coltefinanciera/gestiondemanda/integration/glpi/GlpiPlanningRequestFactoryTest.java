package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;
import co.com.coltefinanciera.gestiondemanda.domain.model.Incident;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningRequest;
import co.com.coltefinanciera.gestiondemanda.domain.model.Requirement;
import co.com.coltefinanciera.gestiondemanda.domain.repository.InMemoryPlanningMetadataRepository;
import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiInvalidDataException;

/**
 * Construccion de la {@link PlanningRequest} a partir de los datos de GLPI.
 *
 * <p>Es la prueba del contrato de la capa anticorrupcion: lo que sale es un objeto del dominio, con
 * tipos del dominio, y el motor lo recibe sin poder saber de donde vino.
 *
 * <p><strong>La prueba tiene dos fuentes y las distingue.</strong> Los tickets llegan por parametro,
 * como siempre, y de ellos sale la fecha operativa del requerimiento desde la Fase 66b
 * —{@code internal_time_to_resolve}, o {@code time_to_resolve} si no hay—. Las horas se declaran en el
 * repositorio de planificacion antes de construir. Cuando un ticket trae las dos cosas y no coinciden,
 * lo que entra al motor dice cual de las dos gano: las horas de la declaracion y la fecha de GLPI, y
 * esa es la afirmacion que sostiene el corte.
 */
class GlpiPlanningRequestFactoryTest {

    private static final ZoneId BOGOTA = ZoneId.of("America/Bogota");

    private static final Instant AHORA = Instant.parse("2026-10-06T00:00:00Z");

    private final GlpiTicketMapper mapper = new GlpiTicketMapper(
            Clock.fixed(AHORA, BOGOTA), GlpiContract.REST_V1);

    private final InMemoryPlanningMetadataRepository metadata =
            new InMemoryPlanningMetadataRepository();

    private final GlpiPlanningRequestFactory factory = new GlpiPlanningRequestFactory(
            mapper, new GlpiTicketValidator(mapper), GlpiContract.REST_V1, metadata);

    private static final GlpiUser USER =
            new GlpiUser(7, "jdoe", "Doe", "Jane");

    private static PlanningRules rules() {
        return PlanningRules.defaults();
    }

    private static GlpiTicket incident(int id, Integer status, long actiontime) {
        return new GlpiTicket(id, "Incidencia " + id, status, GlpiTicket.TYPE_INCIDENT, 5, null, null,
                actiontime, null, "2026-10-05 09:00:00");
    }

    private static GlpiTicket request(int id, Integer status, long actiontime, String deadline) {
        return new GlpiTicket(id, "Peticion " + id, status, GlpiTicket.TYPE_REQUEST, 3, null, null,
                actiontime, deadline, "2026-10-01 08:00:00");
    }

    /** Una peticion con sus dos fechas de GLPI, para distinguir la de OLA de la de SLA. */
    private static GlpiTicket requestWithOla(int id, String deadline, String internalDeadline) {
        return new GlpiTicket(id, "Peticion " + id, 1, GlpiTicket.TYPE_REQUEST, 3, null, null,
                14400L, deadline, internalDeadline, "2026-10-01 08:00:00");
    }

    /**
     * Declara la planificacion de un ticket, por el camino del dominio.
     *
     * <p>Los valores que se pasan no tienen por que coincidir con los del ticket, y en las pruebas
     * de la sustitucion no coinciden a proposito: es la unica forma de que el numero que entra al
     * motor diga de donde salio.
     */
    private void declarar(int ticketId, String horas, String fecha) {
        metadata.create(PlanningMetadata.declared(String.valueOf(ticketId),
                horas == null ? null : new BigDecimal(horas),
                fecha == null ? null : LocalDate.parse(fecha),
                "ana", AHORA, InputSource.HTTP), List.of());
    }

    /** Declara la planificacion de los tickets que la prueba necesita planificables. */
    private void declararTodo(int... ticketIds) {
        for (int id : ticketIds) {
            declarar(id, "2", "2026-10-20");
        }
    }

    @Test
    @DisplayName("Construye una peticion del dominio con el desarrollador traducido")
    void construyeLaPeticionDelDominio() {
        declararTodo(1, 2);

        GlpiPlanningRequestFactory.Result result = factory.build("jdoe", USER,
                List.of(incident(1, 1, 21600L), request(2, 1, 14400L, "2026-10-20 17:00:00")),
                rules());

        PlanningRequest request = result.request();

        assertThat(request.developer().id()).isEqualTo("jdoe");
        assertThat(request.developer().name()).isEqualTo("Jane Doe");
        assertThat(request.rules()).isEqualTo(rules());
        assertThat(result.discarded()).isEmpty();
    }

    @Test
    @DisplayName("Separa incidencias de requerimientos por el tipo del ticket")
    void separaPorTipoDeTicket() {
        declararTodo(1, 2, 3);

        PlanningRequest request = factory.build("jdoe", USER,
                List.of(incident(1, 1, 21600L), request(2, 1, 14400L, "2026-10-20 17:00:00"),
                        incident(3, 2, 3600L)),
                rules()).request();

        assertThat(request.incidents()).extracting(Incident::id)
                .containsExactly("1", "3");
        assertThat(request.requirements()).extracting(Requirement::id)
                .containsExactly("2");
    }

    @Test
    @DisplayName("Los objetos que salen son del dominio, con sus enums y sus unidades")
    void losObjetosSonDelDominio() {
        declarar(1, "6", "2026-10-20");
        declarar(2, "4", "2026-10-20");

        PlanningRequest request = factory.build("jdoe", USER,
                List.of(incident(1, 1, 21600L), request(2, 5, 14400L, "2026-10-20 17:00:00")),
                rules()).request();

        Incident incident = request.incidents().get(0);
        assertThat(incident.status()).isEqualTo(IncidentStatus.ABIERTO);
        assertThat(incident.severity()).isEqualTo(IncidentSeverity.ALTO);
        assertThat(incident.estimatedHours()).isEqualByComparingTo(new BigDecimal("6"));

        Requirement requirement = request.requirements().get(0);
        assertThat(requirement.status()).isEqualTo(RequirementStatus.FINALIZADO);
        assertThat(requirement.plannedDate()).isEqualTo(LocalDate.of(2026, 10, 20));
        assertThat(requirement.estimatedHours()).isEqualByComparingTo(new BigDecimal("4"));
    }

    @Test
    @DisplayName("Conserva el orden en que GLPI devolvio los tickets")
    void conservaElOrdenDeGlpi() {
        declararTodo(30, 10, 20);

        PlanningRequest request = factory.build("jdoe", USER,
                List.of(incident(30, 1, 3600L), incident(10, 1, 3600L), incident(20, 1, 3600L)),
                rules()).request();

        assertThat(request.incidents()).extracting(Incident::id)
                .containsExactly("30", "10", "20");
    }

    @Test
    @DisplayName("Un ticket sin planificacion declarada se descarta por la estimacion")
    void unTicketSinDeclaracionSeDescarta() {
        declararTodo(1);
        GlpiTicket sinDeclaracion = new GlpiTicket(99, "Sin declaracion", 1,
                GlpiTicket.TYPE_INCIDENT, 3, null, null, 3600L, null, "2026-10-05 09:00:00");

        GlpiPlanningRequestFactory.Result result = factory.build("jdoe", USER,
                List.of(incident(1, 1, 21600L), sinDeclaracion), rules());

        assertThat(result.request().incidents()).extracting(Incident::id).containsExactly("1");
        assertThat(result.discarded()).extracting(GlpiDiscardedItem::ticketId)
                .containsOnly("99");
        // Es una incidencia: no se le exige fecha. Lo que falta son las horas declaradas.
        assertThat(result.discarded()).extracting(GlpiDiscardedItem::code)
                .containsExactly(GlpiDiscardReason.SIN_ESTIMACION_DECLARADA);
    }

    @Test
    @DisplayName("Una agenda vacia produce una peticion valida sin descartes")
    void unaAgendaVaciaEsUnaPeticionValida() {
        GlpiPlanningRequestFactory.Result result =
                factory.build("jdoe", USER, List.of(), rules());

        assertThat(result.request().incidents()).isEmpty();
        assertThat(result.request().requirements()).isEmpty();
        assertThat(result.discarded()).isEmpty();
    }

    @Test
    @DisplayName("Un usuario sin nombre utilizable es un fallo de datos, no un ticket descartado")
    void unUsuarioSinNombreEsUnFalloDeDatos() {
        GlpiUser anonimo = new GlpiUser(7, null, null, null);

        assertThatThrownBy(() -> factory.build("jdoe", anonimo, List.of(), rules()))
                .isInstanceOf(GlpiInvalidDataException.class)
                .hasMessageContaining("no tiene nombre ni login utilizables");
    }

    @Test
    @DisplayName("El nombre del desarrollador se compone con lo que GLPI tenga")
    void componeElNombreConLoQueHaya() {
        assertThat(factory.build("x", new GlpiUser(1, "jdoe", null, null), List.of(), rules())
                .request().developer().name()).isEqualTo("jdoe");
        assertThat(factory.build("x", new GlpiUser(1, "jdoe", "Doe", null), List.of(), rules())
                .request().developer().name()).isEqualTo("Doe");
        assertThat(factory.build("x", new GlpiUser(1, "jdoe", null, "Jane"), List.of(), rules())
                .request().developer().name()).isEqualTo("Jane");
    }

    /**
     * Los siete casos de validacion del brief, cada uno con su ticket.
     *
     * <p>Van juntos porque son la misma pregunta —que entra y que no— y separarlos obligaria a
     * repetir en cada uno el montaje de la declaracion, que es justo lo que se esta variando.
     */
    @Nested
    @DisplayName("La planificacion declarada decide que es planificable")
    class PlanificabilidadDeclarada {

        @Test
        @DisplayName("Con metadata completa el ticket entra al motor")
        void conMetadataCompletaEntra() {
            declarar(1, "8", "2026-10-20");

            GlpiPlanningRequestFactory.Result result = factory.build("jdoe", USER,
                    List.of(incident(1, 1, 3600L)), rules());

            assertThat(result.discarded()).isEmpty();
            assertThat(result.request().incidents()).extracting(Incident::id)
                    .containsExactly("1");
        }

        @Test
        @DisplayName("Sin metadata el ticket se descarta por la estimacion")
        void sinMetadataSeDescarta() {
            GlpiPlanningRequestFactory.Result result = factory.build("jdoe", USER,
                    List.of(incident(1, 1, 3600L)), rules());

            assertThat(result.request().incidents()).isEmpty();
            assertThat(result.discarded()).extracting(GlpiDiscardedItem::code)
                    .containsExactly(GlpiDiscardReason.SIN_ESTIMACION_DECLARADA);
            assertThat(result.discarded()).allSatisfy(item -> assertThat(item.reason())
                    .contains("no hay planificacion declarada"));
        }

        @Test
        @DisplayName("En una incidencia basta la estimacion: la fecha no la pone la declaracion")
        void soloConEstimacionBastaEnUnaIncidencia() {
            declarar(1, "8", null);

            GlpiPlanningRequestFactory.Result result = factory.build("jdoe", USER,
                    List.of(incident(1, 1, 3600L)), rules());

            assertThat(result.discarded()).isEmpty();
            assertThat(result.request().incidents()).extracting(Incident::id)
                    .containsExactly("1");
        }

        @Test
        @DisplayName("Una peticion con la estimacion declarada planifica con la fecha de GLPI")
        void peticionConEstimacionPlanificaConLaFechaDeGlpi() {
            declarar(2, "4", null);

            PlanningRequest request = factory.build("jdoe", USER,
                    List.of(request(2, 1, 14400L, "2026-10-20 17:00:00")), rules()).request();

            assertThat(request.requirements().get(0).plannedDate())
                    .isEqualTo(LocalDate.of(2026, 10, 20));
        }

        @Test
        @DisplayName("Una peticion sin ninguna fecha en GLPI se descarta, y el motivo nombra GLPI")
        void peticionSinFechasSeDescarta() {
            declarar(2, "4", "2026-10-20");

            GlpiPlanningRequestFactory.Result result = factory.build("jdoe", USER,
                    List.of(requestWithOla(2, null, null)), rules());

            assertThat(result.request().requirements()).isEmpty();
            assertThat(result.discarded()).extracting(GlpiDiscardedItem::code)
                    .containsExactly(GlpiDiscardReason.SIN_FECHA_EN_GLPI);
        }

        @Test
        @DisplayName("Con compromiso y sin estimacion el ticket se descarta por lo que falta")
        void soloConCompromisoSeDescarta() {
            declarar(1, null, "2026-10-20");

            GlpiPlanningRequestFactory.Result result = factory.build("jdoe", USER,
                    List.of(incident(1, 1, 3600L)), rules());

            assertThat(result.request().incidents()).isEmpty();
            assertThat(result.discarded()).extracting(GlpiDiscardedItem::code)
                    .containsExactly(GlpiDiscardReason.SIN_ESTIMACION_DECLARADA);
        }

        /**
         * Una fila con los dos valores retirados no es media planificacion, es ninguna.
         *
         * <p>El estado existe —alguien declaro y luego borro— y el elemento no es planificable. Es el
         * caso de la metadata eliminada, y la prueba lo distingue del de la metadata ausente por el
         * texto: aqui si hay fila que explicar.
         */
        @Test
        @DisplayName("Con la metadata vacia el ticket se descarta, y el texto dice que se declaro")
        void conMetadataVaciaSeDescarta() {
            metadata.create(PlanningMetadata.undeclared("1", InputSource.HTTP), List.of());

            GlpiPlanningRequestFactory.Result result = factory.build("jdoe", USER,
                    List.of(incident(1, 1, 3600L)), rules());

            assertThat(result.request().incidents()).isEmpty();
            assertThat(result.discarded()).extracting(GlpiDiscardedItem::code)
                    .containsExactly(GlpiDiscardReason.SIN_ESTIMACION_DECLARADA);
            assertThat(result.discarded()).allSatisfy(item -> assertThat(item.reason())
                    .contains("la planificacion declarada"));
        }

        @Test
        @DisplayName("Con tickets mezclados solo entran los completos y se conserva el orden")
        void conTicketsMezcladosSoloEntranLosCompletos() {
            declarar(1, "8", "2026-10-20");
            declarar(3, "8", null);
            declarar(4, "8", "2026-10-20");

            GlpiPlanningRequestFactory.Result result = factory.build("jdoe", USER,
                    List.of(incident(1, 1, 3600L), incident(2, 1, 3600L), incident(3, 1, 3600L),
                            incident(4, 1, 3600L)),
                    rules());

            assertThat(result.request().incidents()).extracting(Incident::id)
                    .containsExactly("1", "3", "4");
            // El 2 no tiene fila; el 3 solo tiene horas, y en una incidencia eso basta.
            assertThat(result.discarded()).extracting(GlpiDiscardedItem::ticketId)
                    .containsExactly("2");
        }
    }

    /**
     * Las dos sustituciones que el brief exige demostrar, mas la que cierra la regla por el otro
     * lado. Las tres se prueban igual: poniendo en el ticket un valor que no se usa y comprobando que
     * el que entra al motor es el declarado.
     */
    @Nested
    @DisplayName("Lo que GLPI registra ya no entra al motor")
    class SustitucionDeGlpi {

        @Test
        @DisplayName("Las horas del incidente son las declaradas, no su actiontime")
        void lasHorasSonLasDeclaradas() {
            // El ticket declara diez horas en GLPI; el desarrollador declaro cuatro.
            declarar(1, "4", "2026-10-20");

            PlanningRequest request = factory.build("jdoe", USER,
                    List.of(incident(1, 1, 36000L)), rules()).request();

            assertThat(request.incidents().get(0).estimatedHours())
                    .isEqualByComparingTo(new BigDecimal("4"));
        }

        @Test
        @DisplayName("La fecha del requerimiento es la de GLPI, no la declarada")
        void laFechaEsLaDeGlpi() {
            // La declaracion trae el veinte de octubre; el SLA de GLPI vence en diciembre.
            declarar(2, "4", "2026-10-20");

            PlanningRequest request = factory.build("jdoe", USER,
                    List.of(request(2, 1, 14400L, "2026-12-31 17:00:00")), rules()).request();

            assertThat(request.requirements().get(0).plannedDate())
                    .isEqualTo(LocalDate.of(2026, 12, 31));
        }

        @Test
        @DisplayName("Con OLA, la fecha del requerimiento es el Internal TTR")
        void elInternalTtrMandaSobreElTtr() {
            declarar(2, "4", "2026-10-20");

            PlanningRequest request = factory.build("jdoe", USER,
                    List.of(requestWithOla(2, "2026-10-20 17:00:00", "2026-11-19 17:30:00")),
                    rules()).request();

            assertThat(request.requirements().get(0).plannedDate())
                    .isEqualTo(LocalDate.of(2026, 11, 19));
        }

        @Test
        @DisplayName("Sin OLA, la fecha del requerimiento es el TTR")
        void sinOlaLaFechaEsElTtr() {
            declarar(2, "4", "2026-10-20");

            PlanningRequest request = factory.build("jdoe", USER,
                    List.of(requestWithOla(2, "2026-10-20 17:00:00", null)), rules()).request();

            assertThat(request.requirements().get(0).plannedDate())
                    .isEqualTo(LocalDate.of(2026, 10, 20));
        }

        /**
         * El otro lado de la misma regla: sin {@code actiontime} el ticket planifica igual.
         *
         * <p>Antes de esta fase un {@code actiontime} ausente era un descarte, y con el se perdia el
         * ticket entero. Ahora las horas salen de la declaracion, asi que el hueco de GLPI deja de
         * tener consecuencias: es la prueba de que el corte es real y no una segunda fuente que
         * convive con la primera.
         */
        @Test
        @DisplayName("Sin actiontime, con la planificacion declarada, el ticket planifica igual")
        void sinActiontimeConDeclaracionPlanifica() {
            declarar(1, "8", "2026-10-20");

            GlpiPlanningRequestFactory.Result result = factory.build("jdoe", USER,
                    List.of(new GlpiTicket(1, "Sin actiontime", 1, GlpiTicket.TYPE_INCIDENT, 5, null,
                            null, null, null, "2026-10-05 09:00:00")),
                    rules());

            assertThat(result.discarded()).isEmpty();
            assertThat(result.request().incidents().get(0).estimatedHours())
                    .isEqualByComparingTo(new BigDecimal("8"));
        }
    }
}
