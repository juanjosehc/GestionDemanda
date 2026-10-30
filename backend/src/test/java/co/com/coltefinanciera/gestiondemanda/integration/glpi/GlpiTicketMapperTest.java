package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;
import co.com.coltefinanciera.gestiondemanda.domain.model.Incident;
import co.com.coltefinanciera.gestiondemanda.domain.model.Requirement;

/**
 * Traduccion de un ticket de GLPI a los objetos del dominio.
 *
 * <p>No hay ninguna instancia de GLPI detras: los tickets se construyen a mano con la forma que
 * GLPI documenta. Es lo que se quiere probar —la traduccion— y no la red.
 *
 * <p><strong>Las horas y la fecha compromiso entran como parametro.</strong> Desde la decision 124.2
 * no se deducen del ticket: las declara el negocio, y quien las trae hasta aqui es la factoria. Los
 * valores que se pasan en estas pruebas no coinciden con los del ticket a proposito, para que se vea
 * que el que sale es el que entro.
 */
class GlpiTicketMapperTest {

    private static final ZoneId BOGOTA = ZoneId.of("America/Bogota");

    private static final BigDecimal HORAS = new BigDecimal("2.5");

    private static final LocalDate COMPROMISO = LocalDate.of(2026, 11, 30);

    private final GlpiTicketMapper mapper = new GlpiTicketMapper(
            Clock.fixed(Instant.parse("2026-10-06T00:00:00Z"), BOGOTA), GlpiContract.REST_V1);

    /** Un ticket con los campos que la traduccion lee, y nada mas. */
    private static GlpiTicket ticket(int id, int type, Integer status, Integer priority,
            Long actiontime, String date, String timeToResolve) {

        return new GlpiTicket(id, "Ticket " + id, status, type, priority, null, null,
                actiontime, timeToResolve, date);
    }

    private static GlpiTicket incident(int id, Integer status, Long actiontime, String date) {
        return ticket(id, GlpiTicket.TYPE_INCIDENT, status, 3, actiontime, date, null);
    }

    private static GlpiTicket request(int id, Integer status, Long actiontime, String timeToResolve) {
        return ticket(id, GlpiTicket.TYPE_REQUEST, status, 3, actiontime, "2026-10-01 08:00:00",
                timeToResolve);
    }

    @Nested
    @DisplayName("Mapeo GLPI -> Incident")
    class MapeoIncidente {

        @Test
        void traduceLosCamposDeLaIncidencia() {
            Incident incident = mapper.toIncident(
                    ticket(42, GlpiTicket.TYPE_INCIDENT, 1, 5, 21600L, "2026-10-05 09:00:00", null),
                    HORAS).orElseThrow();

            assertThat(incident.id()).isEqualTo("42");
            assertThat(incident.title()).isEqualTo("Ticket 42");
            assertThat(incident.estimatedHours()).isEqualByComparingTo(HORAS);
            assertThat(incident.reportedAt()).isEqualTo(Instant.parse("2026-10-05T14:00:00Z"));
            assertThat(incident.status()).isEqualTo(IncidentStatus.ABIERTO);
            assertThat(incident.severity()).isEqualTo(IncidentSeverity.ALTO);
        }

        @Test
        void losEstadosVivosDeGlpiCaenEnEnAtencion() {
            assertThat(mapper.toIncident(incident(1, 2, 3600L, "2026-10-05 09:00:00"), HORAS)
                    .orElseThrow().status()).isEqualTo(IncidentStatus.EN_ATENCION);
            assertThat(mapper.toIncident(incident(2, 3, 3600L, "2026-10-05 09:00:00"), HORAS)
                    .orElseThrow().status()).isEqualTo(IncidentStatus.EN_ATENCION);
            assertThat(mapper.toIncident(incident(3, 4, 3600L, "2026-10-05 09:00:00"), HORAS)
                    .orElseThrow().status()).isEqualTo(IncidentStatus.EN_ATENCION);
        }

        @Test
        void losEstadosCerradosDeGlpiCaenEnResuelto() {
            assertThat(mapper.toIncident(incident(1, 5, 3600L, "2026-10-05 09:00:00"), HORAS)
                    .orElseThrow().status()).isEqualTo(IncidentStatus.RESUELTO);
            assertThat(mapper.toIncident(incident(2, 6, 3600L, "2026-10-05 09:00:00"), HORAS)
                    .orElseThrow().status()).isEqualTo(IncidentStatus.RESUELTO);
        }

        @Test
        void unaPeticionNoProduceIncidencia() {
            assertThat(mapper.toIncident(request(9, 1, 3600L, "2026-10-20 17:00:00"), HORAS))
                    .isEmpty();
        }

        @Test
        void laFechaDeReporteIlegibleNoProduceIncidencia() {
            assertThat(mapper.toIncident(incident(1, 1, 3600L, "05/10/2026"), HORAS)).isEmpty();
        }
    }

    @Nested
    @DisplayName("Mapeo GLPI -> Requirement")
    class MapeoRequerimiento {

        @Test
        void traduceLosCamposDelRequerimiento() {
            Requirement requirement = mapper.toRequirement(
                    request(77, 1, 14400L, "2026-10-20 17:00:00"), HORAS, COMPROMISO)
                    .orElseThrow();

            assertThat(requirement.id()).isEqualTo("77");
            assertThat(requirement.title()).isEqualTo("Ticket 77");
            assertThat(requirement.estimatedHours()).isEqualByComparingTo(HORAS);
            assertThat(requirement.plannedDate()).isEqualTo(COMPROMISO);
            assertThat(requirement.status()).isEqualTo(RequirementStatus.PLANIFICADO);
        }

        @Test
        void unaPeticionNuevaEsPlanificableYNoEnEjecucion() {
            assertThat(mapper.toRequirement(request(1, 1, 3600L, "2026-10-20 17:00:00"), HORAS,
                    COMPROMISO).orElseThrow().isPlannable()).isTrue();
        }

        @Test
        void losEstadosVivosDeGlpiCaenEnEnEjecucion() {
            assertThat(mapper.toRequirement(request(1, 2, 3600L, "2026-10-20 17:00:00"), HORAS,
                    COMPROMISO).orElseThrow().status()).isEqualTo(RequirementStatus.EN_EJECUCION);
            assertThat(mapper.toRequirement(request(2, 4, 3600L, "2026-10-20 17:00:00"), HORAS,
                    COMPROMISO).orElseThrow().status()).isEqualTo(RequirementStatus.EN_EJECUCION);
        }

        @Test
        void losEstadosCerradosDeGlpiCaenEnFinalizado() {
            assertThat(mapper.toRequirement(request(1, 5, 3600L, "2026-10-20 17:00:00"), HORAS,
                    COMPROMISO).orElseThrow().status()).isEqualTo(RequirementStatus.FINALIZADO);
            assertThat(mapper.toRequirement(request(2, 6, 3600L, "2026-10-20 17:00:00"), HORAS,
                    COMPROMISO).orElseThrow().status()).isEqualTo(RequirementStatus.FINALIZADO);
        }

        @Test
        void unaIncidenciaNoProduceRequerimiento() {
            assertThat(mapper.toRequirement(incident(9, 1, 3600L, "2026-10-05 09:00:00"), HORAS,
                    COMPROMISO)).isEmpty();
        }

        /**
         * Un {@code time_to_resolve} ilegible ya no impide traducir la peticion.
         *
         * <p>La fecha compromiso del dominio es la declarada, asi que el SLA de GLPI no participa en
         * la traduccion y su ausencia no puede vaciar el resultado.
         */
        @Test
        void unSlaIlegibleNoImpideTraducirLaPeticion() {
            assertThat(mapper.toRequirement(request(1, 1, 3600L, "no es fecha"), HORAS, COMPROMISO)
                    .orElseThrow().plannedDate()).isEqualTo(COMPROMISO);
        }

        @Test
        void elMismoCodigoDeGlpiCaeEnEstadosDistintosSegunElTipo() {
            GlpiTicket cerrado = ticket(5, GlpiTicket.TYPE_REQUEST, 5, 3, 3600L,
                    "2026-10-01 08:00:00", "2026-10-20 17:00:00");
            GlpiTicket cerradoIncidente = ticket(5, GlpiTicket.TYPE_INCIDENT, 5, 3, 3600L,
                    "2026-10-05 09:00:00", null);

            assertThat(mapper.toRequirement(cerrado, HORAS, COMPROMISO).orElseThrow().status())
                    .isEqualTo(RequirementStatus.FINALIZADO);
            assertThat(mapper.toIncident(cerradoIncidente, HORAS).orElseThrow().status())
                    .isEqualTo(IncidentStatus.RESUELTO);
        }
    }

    /**
     * Las dos traducciones de GLPI que se conservan, y que ya no alimentan la peticion.
     *
     * <p>Siguen probadas porque siguen existiendo y siguen traduciendo: son el unico modo de
     * contrastar lo que GLPI registra con lo que el negocio declaro. Lo que se prueba aqui es la
     * traduccion, no que alguien la use —nadie la usa desde el camino de la planificacion—.
     */
    @Nested
    @DisplayName("Traducciones de GLPI conservadas para diagnostico")
    class TraduccionesDeDiagnostico {

        @Test
        @DisplayName("actiontime se sigue traduciendo a horas")
        void actiontimeSeTraduce() {
            assertThat(GlpiTicketMapper.estimatedHours(incident(1, 1, 5400L, "2026-10-05 09:00:00")))
                    .hasValueSatisfying(horas -> assertThat(horas)
                            .isEqualByComparingTo(new BigDecimal("1.5")));
            assertThat(GlpiTicketMapper.estimatedHours(incident(2, 1, 28800L, "2026-10-05 09:00:00")))
                    .hasValueSatisfying(horas -> assertThat(horas)
                            .isEqualByComparingTo(new BigDecimal("8")));
        }

        @Test
        @DisplayName("Un actiontime ausente, cero o negativo no traduce a horas")
        void actiontimeSinValorNoTraduce() {
            assertThat(GlpiTicketMapper.estimatedHours(incident(1, 1, null, "2026-10-05 09:00:00")))
                    .isEmpty();
            assertThat(GlpiTicketMapper.estimatedHours(incident(2, 1, 0L, "2026-10-05 09:00:00")))
                    .isEmpty();
            assertThat(GlpiTicketMapper.estimatedHours(incident(3, 1, -30L, "2026-10-05 09:00:00")))
                    .isEmpty();
        }

        @Test
        @DisplayName("time_to_resolve se sigue traduciendo a una fecha")
        void timeToResolveSeTraduce() {
            assertThat(mapper.timeToResolve(request(1, 1, 3600L, "2026-10-20 17:00:00")))
                    .contains(LocalDate.of(2026, 10, 20));
        }

        @Test
        @DisplayName("Un time_to_resolve ausente o ilegible no traduce a fecha")
        void timeToResolveSinValorNoTraduce() {
            assertThat(mapper.timeToResolve(request(1, 1, 3600L, null))).isEmpty();
            assertThat(mapper.timeToResolve(request(2, 1, 3600L, "no es fecha"))).isEmpty();
        }
    }

    @Nested
    @DisplayName("La fecha operativa de GLPI, con su hora")
    class FechaOperativaConHora {

        @Test
        @DisplayName("La hora que GLPI publica viaja junto al dia, y el dia no cambia")
        void laHoraViajaConElDia() {
            // El 66222 real: Internal TTR del 3 de diciembre a las 13:53:48. El motor sigue viendo el
            // dia 3; la rejilla necesita el instante para ubicarlo en el eje.
            GlpiTicket conOla = new GlpiTicket(66222, "Ticket 66222", 1, GlpiTicket.TYPE_REQUEST, 3,
                    null, null, 14400L, "2026-10-20 07:05:36", "2026-12-03 13:53:48",
                    "2026-10-01 08:00:00");

            assertThat(mapper.operationalDate(conOla)).hasValueSatisfying(operational -> {
                assertThat(operational.date()).isEqualTo(LocalDate.of(2026, 12, 3));
                assertThat(operational.time()).isEqualTo(LocalTime.of(13, 53, 48));
                assertThat(operational.source())
                        .isEqualTo(GlpiTicketMapper.OperationalDate.INTERNAL_TTR);
            });
        }

        @Test
        @DisplayName("Sin OLA, la hora del SLA es la que viaja")
        void sinOlaViajaLaHoraDelSla() {
            // La OLA falta y queda el respaldo: el ticket se ubica por el SLA, y su hora es la del
            // SLA. La fuente viaja al lado para que la pantalla pueda decirlo.
            GlpiTicket conSla = new GlpiTicket(68428, "Ticket 68428", 1, GlpiTicket.TYPE_REQUEST, 3,
                    null, null, 14400L, "2026-10-20 10:10:10", null, "2026-10-01 08:00:00");

            assertThat(mapper.operationalDate(conSla)).hasValueSatisfying(operational -> {
                assertThat(operational.date()).isEqualTo(LocalDate.of(2026, 10, 20));
                assertThat(operational.time()).isEqualTo(LocalTime.of(10, 10, 10));
                assertThat(operational.source()).isEqualTo(GlpiTicketMapper.OperationalDate.TTR);
            });
        }
    }
}
