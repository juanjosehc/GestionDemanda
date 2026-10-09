package co.com.coltefinanciera.gestiondemanda.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;
import co.com.coltefinanciera.gestiondemanda.domain.model.TimeSlot;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkBlock;
import co.com.coltefinanciera.gestiondemanda.domain.rules.CapacityBook;
import co.com.coltefinanciera.gestiondemanda.domain.rules.WorkingCalendar;

/**
 * Pruebas del modelo de capacidad.
 *
 * <p>Lo que se comprueba aqui es que una jornada dejo de ser un numero de horas: es una agenda de
 * franjas, y una jornada ocupada por los extremos sigue ofreciendo el tramo del medio.
 */
class CapacityBookTest {

    private static final LocalDate LUNES = LocalDate.of(2026, 10, 5);
    private static final LocalDate SABADO = LocalDate.of(2026, 10, 10);
    private static final WorkingCalendar OFICINA = WorkingCalendar.standard();
    private static final String DEVELOPER = "dev-1";

    private CapacityBook book;

    @BeforeEach
    void setUp() {
        book = new CapacityBook(OFICINA, ZoneOffset.UTC);
    }

    @Test
    @DisplayName("Una jornada ocupada por los extremos ofrece el tramo del medio")
    void unaJornadaOcupadaPorLosExtremosOfreceElTramoDelMedio() {
        book.claim("INC-1", WorkItemType.INCIDENTE, DEVELOPER, instante(9), new BigDecimal("2"), null);
        book.claim("INC-2", WorkItemType.INCIDENTE, DEVELOPER, instante(14), new BigDecimal("3"), null);

        // 09:00-11:00 ocupado, 11:00-14:00 libre, 14:00-17:00 ocupado.
        assertThat(book.freeSlots(LUNES))
                .containsExactly(new TimeSlot(LocalTime.of(11, 0), LocalTime.of(14, 0)));

        // Y ese hueco se sigue ofreciendo al trabajo siguiente.
        List<WorkBlock> tercero =
                book.claim("REQ-1", WorkItemType.REQUERIMIENTO, DEVELOPER, instante(9), new BigDecimal("3"), null);

        assertThat(tercero).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(tuple(LUNES.atTime(11, 0), LUNES.atTime(14, 0)));
        assertThat(book.freeSlots(LUNES)).isEmpty();
    }

    @Test
    @DisplayName("La reserva de prioridad cierra la jornada desde el punto reclamado")
    void laReservaDePrioridadCierraLaJornadaDesdeElPuntoReclamado() {
        book.claim("INC-1", WorkItemType.INCIDENTE, DEVELOPER, instante(9), new BigDecimal("4"), null);
        book.reserveRestOfDay(LUNES, LocalTime.of(13, 0));

        assertThat(book.freeSlots(LUNES)).isEmpty();
    }

    @Test
    @DisplayName("Un dia no laborable no ofrece capacidad")
    void unDiaNoLaborableNoOfreceCapacidad() {
        assertThat(SABADO.getDayOfWeek().getValue()).isEqualTo(6);
        assertThat(book.freeSlots(SABADO)).isEmpty();
    }

    @Test
    @DisplayName("Un trabajo que no cabe en el horizonte no consume nada")
    void unTrabajoQueNoCabeEnElHorizonteNoConsumeNada() {
        List<WorkBlock> bloques = book.claim(
                "REQ-1", WorkItemType.REQUERIMIENTO, DEVELOPER,
                instante(9), new BigDecimal("100"), LUNES.plusDays(2));

        assertThat(bloques).isEmpty();
        assertThat(book.freeSlots(LUNES))
                .containsExactly(new TimeSlot(LocalTime.of(9, 0), LocalTime.of(17, 0)));
    }

    private static Instant instante(int hora) {
        return LUNES.atTime(hora, 0).toInstant(ZoneOffset.UTC);
    }
}
