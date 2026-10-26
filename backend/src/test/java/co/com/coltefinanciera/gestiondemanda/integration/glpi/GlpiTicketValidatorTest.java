package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;

/**
 * Datos incompletos: que se descarta y que se tolera.
 *
 * <p>La prueba documenta la politica entera, y la politica son dos puertas. La primera mira el
 * ticket: sin identificador, con un tipo o un estado que el contrato no declara, o con una fecha de
 * creacion ilegible, se descarta y se dice por que; sin prioridad, no. La segunda junta las dos
 * fuentes de la Fase 66b: sin estimacion declarada y sin fecha operativa en GLPI no hay elemento
 * planificable, y se informa de todo lo que falta.
 *
 * <p>Las dos puertas viven en la misma clase y se aplican en ese orden. Lo que se prueba aqui es
 * cada una por separado, que es como se puede saber cual de las dos descarto un ticket.
 */
class GlpiTicketValidatorTest {

    private static final Instant AHORA = Instant.parse("2026-10-06T00:00:00Z");

    private final GlpiTicketValidator validator = new GlpiTicketValidator(
            new GlpiTicketMapper(Clock.fixed(AHORA, ZoneId.of("America/Bogota")),
                    GlpiContract.REST_V1));

    private static GlpiTicket ticket(Integer id, Integer type, Integer status, Long actiontime,
            String date, String timeToResolve) {

        return new GlpiTicket(id, "Ticket", status, type, 3, null, null, actiontime, timeToResolve,
                date);
    }

    private static GlpiTicket validIncident() {
        return ticket(1, GlpiTicket.TYPE_INCIDENT, 1, 3600L, "2026-10-05 09:00:00", null);
    }

    private static GlpiTicket validRequest() {
        return ticket(1, GlpiTicket.TYPE_REQUEST, 1, 3600L, "2026-10-05 09:00:00",
                "2026-10-20 17:00:00");
    }

    /**
     * La planificacion declarada de un elemento de trabajo.
     *
     * <p>Se construye con el propio dominio y no a mano: {@link PlanningMetadata} exige autor en todo
     * valor declarado, y escribirlo aqui a mano seria probar una forma del registro que el dominio no
     * admite.
     */
    private static PlanningMetadata declarada(BigDecimal horas, LocalDate fecha) {
        return PlanningMetadata.declared("1", horas, fecha, "ana", AHORA, InputSource.HTTP);
    }

    /** El ticket se descarta por un defecto de GLPI, con el codigo y el texto esperados. */
    private void assertRechaza(GlpiTicket ticket, GlpiDiscardReason code, String fragmento) {
        assertThat(validator.rejection(ticket)).hasValueSatisfying(discarded -> {
            assertThat(discarded.code()).isEqualTo(code);
            assertThat(discarded.reason()).contains(fragmento);
        });
    }

    @Test
    @DisplayName("Un ticket completo no tiene motivo de descarte")
    void unTicketCompletoSeAcepta() {
        assertThat(validator.rejection(validIncident())).isEmpty();
        assertThat(validator.rejection(validRequest())).isEmpty();
    }

    @Test
    @DisplayName("Sin identificador no se puede traducir")
    void sinIdentificadorSeDescarta() {
        assertRechaza(ticket(null, GlpiTicket.TYPE_INCIDENT, 1, 3600L, "2026-10-05 09:00:00", null),
                GlpiDiscardReason.SIN_IDENTIFICADOR_TICKET, "sin identificador de ticket");
    }

    @Test
    @DisplayName("Un tipo de ticket desconocido se descarta y el motivo dice cual llego")
    void tipoDesconocidoSeDescarta() {
        assertRechaza(ticket(1, 3, 1, 3600L, "2026-10-05 09:00:00", null),
                GlpiDiscardReason.TIPO_DESCONOCIDO, "tipo de ticket desconocido: 3");
        assertRechaza(ticket(1, null, 1, 3600L, "2026-10-05 09:00:00", null),
                GlpiDiscardReason.TIPO_DESCONOCIDO, "tipo de ticket desconocido");
    }

    @Test
    @DisplayName("Un estado desconocido se descarta")
    void estadoDesconocidoSeDescarta() {
        assertRechaza(ticket(1, GlpiTicket.TYPE_INCIDENT, 99, 3600L, "2026-10-05 09:00:00", null),
                GlpiDiscardReason.ESTADO_DESCONOCIDO, "estado de incidencia desconocido: 99");
        assertRechaza(ticket(1, GlpiTicket.TYPE_REQUEST, 7, 3600L, "2026-10-05 09:00:00",
                "2026-10-20 17:00:00"), GlpiDiscardReason.ESTADO_DESCONOCIDO,
                "estado de peticion desconocido: 7");
        assertRechaza(ticket(1, GlpiTicket.TYPE_INCIDENT, null, 3600L, "2026-10-05 09:00:00", null),
                GlpiDiscardReason.ESTADO_DESCONOCIDO, "estado de incidencia desconocido");
    }

    @Test
    @DisplayName("Una fecha ilegible se descarta y el motivo la muestra")
    void fechaIlegibleSeDescarta() {
        assertRechaza(ticket(1, GlpiTicket.TYPE_INCIDENT, 1, 3600L, null, null),
                GlpiDiscardReason.FECHA_CREACION_ILEGIBLE, "fecha de creacion ausente o ilegible");
        assertRechaza(ticket(1, GlpiTicket.TYPE_INCIDENT, 1, 3600L, "05/10/2026", null),
                GlpiDiscardReason.FECHA_CREACION_ILEGIBLE,
                "fecha de creacion ausente o ilegible: '05/10/2026'");
    }

    /**
     * El {@code actiontime} dejo de descartar, y esta es la prueba de que dejo de hacerlo.
     *
     * <p>Antes de la decision 124.2 este ticket se descartaba por "sin horas estimadas". Ya no: las
     * horas del motor salen de la planificacion declarada, asi que un {@code actiontime} ausente o
     * cero es un dato de GLPI que no afecta a la planificacion. Descartar por el seria sacar trabajo
     * del plan por un defecto que no lo impide.
     */
    @Test
    @DisplayName("Sin actiontime el ticket ya no se descarta: las horas ya no salen de GLPI")
    void sinActiontimeYaNoSeDescarta() {
        assertThat(validator.rejection(
                ticket(1, GlpiTicket.TYPE_INCIDENT, 1, null, "2026-10-05 09:00:00", null))).isEmpty();
        assertThat(validator.rejection(
                ticket(1, GlpiTicket.TYPE_INCIDENT, 1, 0L, "2026-10-05 09:00:00", null))).isEmpty();
        assertThat(validator.rejection(
                ticket(1, GlpiTicket.TYPE_INCIDENT, 1, -30L, "2026-10-05 09:00:00", null))).isEmpty();
    }

    /**
     * El {@code time_to_resolve} dejo de descartar, por el mismo motivo y con la misma prueba.
     *
     * <p>Una peticion sin SLA legible ya no se pierde: la fecha compromiso del dominio es la que
     * declara el gestor de demanda, y la de GLPI es un dato de diagnostico.
     */
    @Test
    @DisplayName("Una peticion sin time_to_resolve ya no se descarta: la fecha ya no sale de GLPI")
    void sinTimeToResolveYaNoSeDescarta() {
        assertThat(validator.rejection(ticket(1, GlpiTicket.TYPE_REQUEST, 1, 3600L,
                "2026-10-05 09:00:00", null))).isEmpty();
        assertThat(validator.rejection(ticket(1, GlpiTicket.TYPE_REQUEST, 1, 3600L,
                "2026-10-05 09:00:00", "no es fecha"))).isEmpty();
    }

    @Test
    @DisplayName("Sin prioridad el ticket se conserva: la severidad nula es un caso previsto")
    void sinPrioridadNoSeDescarta() {
        GlpiTicket sinPrioridad = new GlpiTicket(1, "Ticket", 1, GlpiTicket.TYPE_INCIDENT,
                null, null, null, 3600L, null, "2026-10-05 09:00:00");

        assertThat(validator.rejection(sinPrioridad)).isEmpty();
    }

    @Test
    @DisplayName("El motivo se decide por el defecto mas basico primero")
    void elOrdenDeLosMotivosEsElDeclarado() {
        assertRechaza(ticket(null, 3, 99, null, null, null),
                GlpiDiscardReason.SIN_IDENTIFICADOR_TICKET, "sin identificador de ticket");
    }

    /** Una peticion con SLA y OLA, que es el caso completo. */
    private static GlpiTicket peticion(String timeToResolve, String internalTimeToResolve) {
        return new GlpiTicket(1, "Ticket", 1, GlpiTicket.TYPE_REQUEST, 3, null, null, 3600L,
                timeToResolve, internalTimeToResolve, "2026-10-05 09:00:00");
    }

    @Test
    @DisplayName("Con estimacion declarada y fecha en GLPI no falta nada")
    void conLaEstimacionYLaFechaDeGlpiNoFaltaNada() {
        assertThat(validator.missingInputs(validIncident(),
                declarada(new BigDecimal("6"), LocalDate.of(2026, 10, 20)))).isEmpty();
        assertThat(validator.missingInputs(validRequest(),
                declarada(new BigDecimal("6"), LocalDate.of(2026, 10, 20)))).isEmpty();
        // La declaracion lleva una fecha que ya no se usa; lo que cuenta es la de GLPI.
        assertThat(validator.missingInputs(validRequest(), declarada(new BigDecimal("6"), null)))
                .isEmpty();
    }

    /**
     * La fecha de la declaracion dejo de contar, y esta es la prueba.
     *
     * <p>Una peticion cuya declaracion trae fecha pero cuyo ticket no trae ninguna se descarta: la
     * fecha que ubica un requerimiento sale de GLPI desde la Fase 66b, y una fecha declarada por una
     * validacion no la sustituye.
     */
    @Test
    @DisplayName("Sin fecha en GLPI la declaracion no la suple")
    void sinFechaEnGlpiLaDeclaracionNoLaSuple() {
        GlpiTicket sinFechas = peticion(null, null);

        List<GlpiDiscardedItem> missing = validator.missingInputs(sinFechas,
                declarada(new BigDecimal("6"), LocalDate.of(2026, 10, 20)));

        assertThat(missing).extracting(GlpiDiscardedItem::code)
                .containsExactly(GlpiDiscardReason.SIN_FECHA_EN_GLPI);
        assertThat(missing.get(0).reason())
                .contains("internal_time_to_resolve", "time_to_resolve");
    }

    @Test
    @DisplayName("Una incidencia no necesita fecha: el motor la coloca por su creacion")
    void unaIncidenciaNoNecesitaFecha() {
        assertThat(validator.missingInputs(validIncident(), declarada(new BigDecimal("6"), null)))
                .isEmpty();
    }

    @Test
    @DisplayName("Sin planificacion declarada falta la estimacion, y tambien la fecha si GLPI no la trae")
    void sinDeclaracionFaltaLoQueFalte() {
        List<GlpiDiscardedItem> peticionSinNada = validator.missingInputs(peticion(null, null), null);

        assertThat(peticionSinNada).extracting(GlpiDiscardedItem::code).containsExactly(
                GlpiDiscardReason.SIN_ESTIMACION_DECLARADA,
                GlpiDiscardReason.SIN_FECHA_EN_GLPI);
        assertThat(peticionSinNada.get(0).reason())
                .isEqualTo("no hay planificacion declarada para este elemento");
    }

    @Test
    @DisplayName("Solo con la estimacion declarada falta la fecha, y el motivo nombra GLPI")
    void soloConLaEstimacionFaltaLaFecha() {
        List<GlpiDiscardedItem> missing = validator.missingInputs(peticion(null, null),
                declarada(new BigDecimal("6"), null));

        assertThat(missing).extracting(GlpiDiscardedItem::code)
                .containsExactly(GlpiDiscardReason.SIN_FECHA_EN_GLPI);
        assertThat(missing.get(0).reason())
                .isEqualTo("GLPI no trae ni internal_time_to_resolve ni time_to_resolve");
    }

    @Test
    @DisplayName("Solo con fecha en GLPI falta la estimacion")
    void soloConLaFechaFaltaLaEstimacion() {
        List<GlpiDiscardedItem> missing = validator.missingInputs(validRequest(), null);

        assertThat(missing).extracting(GlpiDiscardedItem::code)
                .containsExactly(GlpiDiscardReason.SIN_ESTIMACION_DECLARADA);
        assertThat(missing.get(0).reason())
                .isEqualTo("no hay planificacion declarada para este elemento");
    }

    /**
     * Una declaracion que existe y no declara nada es distinta de no haber declarado.
     *
     * <p>Para quien tiene que actuar son el mismo hecho —no hay nada que sirva— y el codigo es el
     * mismo; para quien diagnostica no lo son: aqui alguien paso por el elemento y retiro lo que
     * habia, y eso se lee en el texto. Es el caso de una estimacion que se declaro y luego se borro.
     */
    @Test
    @DisplayName("Una declaracion con la estimacion retirada falta, y el texto lo distingue")
    void unaDeclaracionVaciaFalta() {
        List<GlpiDiscardedItem> missing = validator.missingInputs(validRequest(),
                PlanningMetadata.undeclared("1", InputSource.HTTP));

        assertThat(missing).extracting(GlpiDiscardedItem::code)
                .containsExactly(GlpiDiscardReason.SIN_ESTIMACION_DECLARADA);
        assertThat(missing.get(0).reason())
                .isEqualTo("la planificacion declarada no tiene estimacion");
    }

    @Test
    @DisplayName("El descarte lleva el identificador del ticket para poder ir a mirarlo")
    void elDescarteLlevaElIdentificador() {
        GlpiTicket sinId = ticket(null, GlpiTicket.TYPE_INCIDENT, 1, 3600L, null, null);

        assertThat(validator.missingInputs(ticket(99, GlpiTicket.TYPE_INCIDENT, 1, 3600L,
                "2026-10-05 09:00:00", null), null)).extracting(GlpiDiscardedItem::ticketId)
                .containsOnly("99");
        assertThat(validator.rejection(sinId).orElseThrow().ticketId()).isEqualTo("(sin id)");
    }
}
