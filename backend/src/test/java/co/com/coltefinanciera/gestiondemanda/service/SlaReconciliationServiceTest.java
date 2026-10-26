package co.com.coltefinanciera.gestiondemanda.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.enums.AppliedRule;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.model.Renegotiation;
import co.com.coltefinanciera.gestiondemanda.domain.model.RenegotiationChange;
import co.com.coltefinanciera.gestiondemanda.domain.repository.InMemoryRenegotiationRepository;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningSimulationResponse.RescheduleEventView;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiContract;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicket;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicketMapper;

/**
 * Las cinco condiciones de la conciliacion automatica, una por una y con sus limites.
 *
 * <p>Es una prueba unitaria con el puerto en memoria: lo que se comprueba es la regla, no el
 * recorrido HTTP. Que el acuerdo se guarde de verdad lo prueba el repositorio JPA, y que la
 * conciliacion se dispare al planificar lo prueba el endpoint de {@code from-glpi}.
 *
 * <p><strong>El caso que mas importa es el que NO concilia.</strong> Casi todo ticket de GLPI trae un
 * TTR —el vencimiento del SLA—, y la diferencia entre «tiene TTR» y «alguien renegocio» es toda la
 * fase. Las pruebas de TTR viejo, de acuerdo manual y de ticket cerrado existen para que esa
 * diferencia no se pierda en una refactorizacion.
 */
class SlaReconciliationServiceTest {

    private static final String ITEM = "67501";
    private static final String OTRO = "67502";

    private static final Instant DESPLAZAMIENTO = Instant.parse("2026-10-05T09:00:00Z");
    private static final Instant SEGUNDO_DESPLAZAMIENTO = Instant.parse("2026-10-06T10:00:00Z");
    private static final Instant AHORA = Instant.parse("2026-10-06T15:00:00Z");

    private static final LocalDate ORIGINAL = LocalDate.of(2026, 10, 10);
    private static final LocalDate ORIGINAL_ANTIGUO = LocalDate.of(2026, 10, 1);
    private static final LocalDate REAGENDADO = LocalDate.of(2026, 10, 12);
    private static final LocalDate TTR = LocalDate.of(2026, 10, 20);

    private InMemoryRenegotiationRepository repository;
    private MovableClock clock;
    private SlaReconciliationService service;

    @BeforeEach
    void setUp() {
        repository = new InMemoryRenegotiationRepository();
        clock = new MovableClock(AHORA);
        service = new SlaReconciliationService(
                repository,
                new GlpiTicketMapper(clock, GlpiContract.REST_V1),
                clock);
    }

    @Test
    @DisplayName("concilia cuando el TTR es posterior a la fecha original del desplazamiento")
    void conciliaUnTtrPosterior() {
        List<String> reconciled = service.reconcile(
                List.of(ticket(ITEM, "2026-10-20 17:00:00")),
                List.of(desplazamiento(ITEM, DESPLAZAMIENTO, ORIGINAL)));

        assertThat(reconciled).containsExactly(ITEM);

        Renegotiation acuerdo = repository.findByWorkItemId(ITEM).orElseThrow();
        assertThat(acuerdo.agreedDate()).isEqualTo(TTR);
        assertThat(acuerdo.source()).isEqualTo(InputSource.GLPI);
        assertThat(acuerdo.agreedBy()).isEqualTo(SlaReconciliationService.ACTOR);
        assertThat(acuerdo.agreedReason()).isEqualTo(SlaReconciliationService.REASON);
        assertThat(acuerdo.agreedAt()).isEqualTo(AHORA);

        // La primera fila del historial lleva la fecha anterior en nulo: es el dato que dice que
        // el acuerdo nacio aqui y quien lo trajo.
        assertThat(repository.findHistory(ITEM))
                .extracting(RenegotiationChange::previousDate, RenegotiationChange::newDate,
                        RenegotiationChange::changedBy)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(null, TTR,
                        SlaReconciliationService.ACTOR));
    }

    @Test
    @DisplayName("no concilia un TTR anterior al desplazamiento: es el SLA historico, no un acuerdo")
    void noConciliaUnTtrAnteriorAlDesplazamiento() {
        List<String> reconciled = service.reconcile(
                List.of(ticket(ITEM, "2026-09-30 17:00:00")),
                List.of(desplazamiento(ITEM, DESPLAZAMIENTO, ORIGINAL)));

        assertThat(reconciled).isEmpty();
        assertThat(repository.findByWorkItemId(ITEM)).isEmpty();
        assertThat(repository.findHistory(ITEM)).isEmpty();
    }

    @Test
    @DisplayName("un TTR igual a la fecha original tampoco es una renegociacion")
    void noConciliaUnTtrIgualALaFechaOriginal() {
        List<String> reconciled = service.reconcile(
                List.of(ticket(ITEM, "2026-10-10 17:00:00")),
                List.of(desplazamiento(ITEM, DESPLAZAMIENTO, ORIGINAL)));

        assertThat(reconciled).isEmpty();
        assertThat(repository.findByWorkItemId(ITEM)).isEmpty();
    }

    @Test
    @DisplayName("sin TTR no hay nada que conciliar")
    void noConciliaSinTtr() {
        List<String> reconciled = service.reconcile(
                List.of(ticket(ITEM, null)),
                List.of(desplazamiento(ITEM, DESPLAZAMIENTO, ORIGINAL)));

        assertThat(reconciled).isEmpty();
        assertThat(repository.findByWorkItemId(ITEM)).isEmpty();
    }

    @Test
    @DisplayName("un acuerdo manual manda aunque el desplazamiento lo haya dejado pendiente")
    void noTocaUnAcuerdoManual() {
        // Registrado antes del desplazamiento: no lo cubre, la fila esta pendiente, pero es una
        // decision humana y la conciliacion no la sobrescribe.
        Instant manualAt = Instant.parse("2026-10-04T09:00:00Z");
        Renegotiation manual = new Renegotiation(
                ITEM, LocalDate.of(2026, 10, 15), "Ana", "acuerdo manual", manualAt,
                InputSource.HTTP);
        repository.create(manual, manual.changesFrom(null, "Ana", manualAt));

        List<String> reconciled = service.reconcile(
                List.of(ticket(ITEM, "2026-10-20 17:00:00")),
                List.of(desplazamiento(ITEM, DESPLAZAMIENTO, ORIGINAL)));

        assertThat(reconciled).isEmpty();
        Renegotiation vigente = repository.findByWorkItemId(ITEM).orElseThrow();
        assertThat(vigente.agreedDate()).isEqualTo(LocalDate.of(2026, 10, 15));
        assertThat(vigente.source()).isEqualTo(InputSource.HTTP);
        assertThat(vigente.agreedBy()).isEqualTo("Ana");
        assertThat(repository.findHistory(ITEM)).hasSize(1);
    }

    @Test
    @DisplayName("un solo acuerdo cubre los dos desplazamientos del mismo requerimiento")
    void unAcuerdoCubreVariosDesplazamientos() {
        List<RescheduleEventView> events = List.of(
                desplazamiento(ITEM, DESPLAZAMIENTO, ORIGINAL),
                desplazamiento(ITEM, SEGUNDO_DESPLAZAMIENTO, LocalDate.of(2026, 10, 12)));

        List<String> reconciled = service.reconcile(
                List.of(ticket(ITEM, "2026-10-20 17:00:00")), events);

        assertThat(reconciled).containsExactly(ITEM);
        assertThat(repository.findHistory(ITEM)).hasSize(1);

        Renegotiation acuerdo = repository.findByWorkItemId(ITEM).orElseThrow();
        assertThat(events).allMatch(event -> acuerdo.covers(event.timestamp()));
    }

    @Test
    @DisplayName("es idempotente: el mismo TTR dos veces no duplica el acuerdo ni el historial")
    void esIdempotente() {
        List<GlpiTicket> tickets = List.of(ticket(ITEM, "2026-10-20 17:00:00"));
        List<RescheduleEventView> events = List.of(desplazamiento(ITEM, DESPLAZAMIENTO, ORIGINAL));

        assertThat(service.reconcile(tickets, events)).containsExactly(ITEM);
        assertThat(service.reconcile(tickets, events)).isEmpty();

        assertThat(repository.findHistory(ITEM)).hasSize(1);
        assertThat(repository.findByWorkItemId(ITEM).orElseThrow().agreedDate()).isEqualTo(TTR);
    }

    @Test
    @DisplayName("un TTR nuevo tras un desplazamiento nuevo actualiza el acuerdo automatico")
    void actualizaElAcuerdoDeGlpiCuandoElTtrCambia() {
        assertThat(service.reconcile(
                List.of(ticket(ITEM, "2026-10-20 17:00:00")),
                List.of(desplazamiento(ITEM, DESPLAZAMIENTO, ORIGINAL)))).containsExactly(ITEM);

        // El requerimiento se mueve otra vez despues de que el acuerdo se registro, y GLPI publica
        // una fecha nueva: es otra renegociacion, no una repeticion.
        clock.set(Instant.parse("2026-10-07T09:00:00Z"));
        List<RescheduleEventView> events = List.of(
                desplazamiento(ITEM, DESPLAZAMIENTO, ORIGINAL),
                desplazamiento(ITEM, Instant.parse("2026-10-07T08:00:00Z"),
                        LocalDate.of(2026, 10, 12)));

        assertThat(service.reconcile(
                List.of(ticket(ITEM, "2026-10-25 17:00:00")), events)).containsExactly(ITEM);

        Renegotiation acuerdo = repository.findByWorkItemId(ITEM).orElseThrow();
        assertThat(acuerdo.agreedDate()).isEqualTo(LocalDate.of(2026, 10, 25));
        assertThat(acuerdo.source()).isEqualTo(InputSource.GLPI);
        assertThat(repository.findHistory(ITEM))
                .extracting(RenegotiationChange::previousDate, RenegotiationChange::newDate)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(null, TTR),
                        org.assertj.core.groups.Tuple.tuple(TTR, LocalDate.of(2026, 10, 25)));
    }

    @Test
    @DisplayName("un ticket que no esta en la lista activa no concilia: los cerrados no llegan aqui")
    void unTicketAusenteNoConcilia() {
        List<String> reconciled = service.reconcile(
                List.of(ticket(OTRO, "2026-10-20 17:00:00")),
                List.of(desplazamiento(ITEM, DESPLAZAMIENTO, ORIGINAL)));

        assertThat(reconciled).isEmpty();
        assertThat(repository.findByWorkItemId(ITEM)).isEmpty();
    }

    @Test
    @DisplayName("sin desplazamientos no se pregunta nada")
    void sinDesplazamientosNoConcilia() {
        assertThat(service.reconcile(
                List.of(ticket(ITEM, "2026-10-20 17:00:00")), List.of())).isEmpty();
        assertThat(repository.findByWorkItemId(ITEM)).isEmpty();
    }

    private static GlpiTicket ticket(String id, String timeToResolve) {
        return new GlpiTicket(Integer.valueOf(id), "Ticket " + id, 1, GlpiTicket.TYPE_REQUEST, 3,
                null, null, 3600L, timeToResolve, "2026-10-01 08:00:00");
    }

    private static RescheduleEventView desplazamiento(String item, Instant at, LocalDate original) {
        return new RescheduleEventView(
                at, "inc-1", item, original, REAGENDADO, AppliedRule.CAPACIDAD_COMPROMETIDA,
                IncidentSeverity.ALTO, "motivo del desplazamiento");
    }

    /** Un reloj que se puede mover: la conciliacion depende del instante en que se registra. */
    private static final class MovableClock extends Clock {

        private Instant now;

        private MovableClock(Instant now) {
            this.now = now;
        }

        private void set(Instant instant) {
            this.now = instant;
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
            return now;
        }
    }
}
