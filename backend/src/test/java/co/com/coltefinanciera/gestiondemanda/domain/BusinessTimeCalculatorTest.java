package co.com.coltefinanciera.gestiondemanda.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.model.BusinessHours;
import co.com.coltefinanciera.gestiondemanda.domain.rules.BusinessTimeCalculator;
import co.com.coltefinanciera.gestiondemanda.domain.rules.BusinessTimeCalculator.BusinessSegment;
import co.com.coltefinanciera.gestiondemanda.domain.rules.WorkingCalendar;

/**
 * Pruebas del calculo de tiempo habil.
 *
 * <p>El calendario es el oficial: de lunes a viernes, de 07:00 a 17:30, sin festivos. Los casos
 * estan escritos con horas y fechas literales a proposito: son la unica forma de verificar que el
 * resultado coincide con lo que el negocio espera leer.
 */
class BusinessTimeCalculatorTest {

    private static final LocalTime APERTURA = LocalTime.of(7, 0);
    private static final LocalTime CIERRE = LocalTime.of(17, 30);

    private static final LocalDate VIERNES = LocalDate.of(2026, 10, 9);
    private static final LocalDate SABADO = LocalDate.of(2026, 10, 10);
    private static final LocalDate LUNES = LocalDate.of(2026, 10, 12);
    private static final LocalDate MARTES = LocalDate.of(2026, 10, 13);

    private static final WorkingCalendar OFICINA = WorkingCalendar.standard();
    private static final BusinessTimeCalculator CALCULATOR = new BusinessTimeCalculator(OFICINA, ZoneOffset.UTC);

    @Test
    @DisplayName("Ejemplo 1 - OLA de 4 horas pedida un viernes a las 16:30: una hora el viernes, tres el lunes")
    void ejemplo1ViernesTardeReparteLaOlaEntreViernesYLunes() {
        List<BusinessSegment> tramos = CALCULATOR.segments(instante(VIERNES, LocalTime.of(16, 30)), new BigDecimal("4"));

        assertThat(tramos).hasSize(2);

        BusinessSegment viernes = tramos.get(0);
        assertThat(viernes.date()).isEqualTo(VIERNES);
        assertThat(viernes.start().toLocalTime()).isEqualTo(LocalTime.of(16, 30));
        assertThat(viernes.end().toLocalTime()).isEqualTo(CIERRE);
        assertThat(viernes.hours()).isEqualByComparingTo("1");

        BusinessSegment lunes = tramos.get(1);
        assertThat(lunes.date()).isEqualTo(LUNES);
        assertThat(lunes.start().toLocalTime()).isEqualTo(APERTURA);
        assertThat(lunes.end().toLocalTime()).isEqualTo(LocalTime.of(10, 0));
        assertThat(lunes.hours()).isEqualByComparingTo("3");

        // El fin de semana no aparece: no consume OLA porque no es tiempo habil.
        assertThat(tramos).noneMatch(tramo -> tramo.date().equals(SABADO));
    }

    @Test
    @DisplayName("El vencimiento de la OLA cae en tiempo habil, no en horas de reloj")
    void elVencimientoDeLaOlaCaeEnTiempoHabil() {
        Instant vencimiento =
                CALCULATOR.dueAt(instante(VIERNES, LocalTime.of(16, 30)), new BigDecimal("4"));

        assertThat(vencimiento).isEqualTo(instante(LUNES, LocalTime.of(10, 0)));
    }

    @Test
    @DisplayName("Ejemplo 2 - Un incidente recibido en fin de semana empieza en la siguiente jornada")
    void ejemplo2IncidenteFueraDeHorarioEmpiezaEnLaSiguienteJornada() {
        List<BusinessSegment> tramos = CALCULATOR.segments(instante(SABADO, LocalTime.of(10, 0)), new BigDecimal("2"));

        assertThat(tramos).singleElement().satisfies(tramo -> {
            assertThat(tramo.date()).isEqualTo(LUNES);
            assertThat(tramo.start().toLocalTime()).isEqualTo(APERTURA);
            assertThat(tramo.end().toLocalTime()).isEqualTo(LocalTime.of(9, 0));
        });
    }

    @Test
    @DisplayName("Un incidente recibido de madrugada espera a la apertura, no consume la noche")
    void unIncidenteDeMadrugadaEsperaALaApertura() {
        List<BusinessSegment> tramos =
                CALCULATOR.segments(instante(VIERNES, LocalTime.of(3, 0)), new BigDecimal("2"));

        assertThat(tramos).singleElement().satisfies(tramo -> {
            assertThat(tramo.date()).isEqualTo(VIERNES);
            assertThat(tramo.start().toLocalTime()).isEqualTo(APERTURA);
            assertThat(tramo.end().toLocalTime()).isEqualTo(LocalTime.of(9, 0));
        });
    }

    @Test
    @DisplayName("Ejemplo 3 - Un festivo intermedio corre el vencimiento sin consumir OLA")
    void ejemplo3ElFestivoIntermedioNoConsumeOla() {
        WorkingCalendar conFestivo = new WorkingCalendar(
                OFICINA.businessHours(), WorkingCalendar.DEFAULT_WEEKEND, Set.of(LUNES));
        BusinessTimeCalculator calculator = new BusinessTimeCalculator(conFestivo, ZoneOffset.UTC);

        List<BusinessSegment> tramos =
                calculator.segments(instante(VIERNES, LocalTime.of(16, 30)), new BigDecimal("4"));

        assertThat(tramos).hasSize(2);
        assertThat(tramos.get(0).date()).isEqualTo(VIERNES);
        assertThat(tramos.get(0).hours()).isEqualByComparingTo("1");
        assertThat(tramos.get(1).date()).isEqualTo(MARTES);
        assertThat(tramos.get(1).end().toLocalTime()).isEqualTo(LocalTime.of(10, 0));

        assertThat(calculator.dueAt(instante(VIERNES, LocalTime.of(16, 30)), new BigDecimal("4")))
                .isEqualTo(instante(MARTES, LocalTime.of(10, 0)));
    }

    @Test
    @DisplayName("Una OLA de varios dias consume jornadas completas en vez de horas de reloj")
    void unaOlaDeVariosDiasConsumeJornadasCompletas() {
        List<BusinessSegment> tramos =
                CALCULATOR.segments(instante(LUNES, APERTURA), new BigDecimal("20"));

        assertThat(tramos).hasSize(2);
        assertThat(tramos.get(0).end().toLocalTime()).isEqualTo(CIERRE);
        assertThat(tramos.get(0).hours()).isEqualByComparingTo("10.5");
        // Las nueve horas y media que faltan caben el martes: no hace falta un tercer dia.
        assertThat(tramos.get(1).date()).isEqualTo(MARTES);
        assertThat(tramos.get(1).hours()).isEqualByComparingTo("9.5");
        assertThat(tramos.get(1).end().toLocalTime()).isEqualTo(LocalTime.of(16, 30));
    }

    @Test
    @DisplayName("La jornada puede ser mas corta que el dia natural")
    void laJornadaPuedeSerMasCortaQueElDiaNatural() {
        WorkingCalendar mediaJornada = new WorkingCalendar(
                BusinessHours.startingAt(APERTURA, new BigDecimal("4")), WorkingCalendar.DEFAULT_WEEKEND, Set.of());
        BusinessTimeCalculator calculator = new BusinessTimeCalculator(mediaJornada, ZoneOffset.UTC);

        List<BusinessSegment> tramos = calculator.segments(instante(LUNES, APERTURA), new BigDecimal("6"));

        assertThat(tramos).hasSize(2);
        assertThat(tramos.get(0).hours()).isEqualByComparingTo("4");
        assertThat(tramos.get(0).end().toLocalTime()).isEqualTo(LocalTime.of(11, 0));
        assertThat(tramos.get(1).hours()).isEqualByComparingTo("2");
    }

    @Test
    @DisplayName("Un calendario sin ningun dia laborable se rechaza al construirlo")
    void unCalendarioSinDiasLaborablesSeRechaza() {
        assertThatThrownBy(() -> new WorkingCalendar(OFICINA.businessHours(), EnumSet.allOf(DayOfWeek.class), Set.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("todos los dias");
    }

    private static Instant instante(LocalDate date, LocalTime time) {
        return date.atTime(time).toInstant(ZoneOffset.UTC);
    }
}
