package co.com.coltefinanciera.gestiondemanda.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;

/**
 * Pruebas de la configuracion de planificacion.
 *
 * <p>Lo que se comprueba es la jornada con la que arranca la aplicacion sin configuracion adicional:
 * lunes a viernes, 07:00-17:30. Es el valor que el motor usa en produccion, y por eso no puede
 * quedar sin una prueba que lo fije.
 */
class PlanningPropertiesTest {

    @Test
    @DisplayName("Sin calendario declarado, la jornada es la oficial: 07:00-17:30 y 10,5 horas")
    void sinCalendarioLaJornadaEsLaOficial() {
        PlanningRules rules = new PlanningProperties(new BigDecimal("4"), new BigDecimal("10.5"), 10, null, null)
                .toRules();

        assertThat(rules.workingHoursPerDay()).isEqualByComparingTo("10.5");
        assertThat(rules.workingCalendar().businessHours().start()).isEqualTo(LocalTime.of(7, 0));
        assertThat(rules.workingCalendar().businessHours().end()).isEqualTo(LocalTime.of(17, 30));
        assertThat(rules.workingCalendar().weekend())
                .containsExactlyInAnyOrder(DayOfWeek.SATURDAY, DayOfWeek.SUNDAY);
    }

    @Test
    @DisplayName("Un bloque de calendario declarado manda sobre la duracion suelta")
    void elBloqueDeclaradoMandaSobreLaDuracion() {
        PlanningProperties.CalendarProperties calendario = new PlanningProperties.CalendarProperties(
                LocalTime.of(8, 0), LocalTime.of(12, 0), null, null);

        PlanningRules rules = new PlanningProperties(new BigDecimal("4"), new BigDecimal("10.5"), 10, Map.of(), calendario)
                .toRules();

        assertThat(rules.workingHoursPerDay()).isEqualByComparingTo("4");
        assertThat(rules.workingCalendar().businessHours().start()).isEqualTo(LocalTime.of(8, 0));
        assertThat(rules.workingCalendar().businessHours().end()).isEqualTo(LocalTime.of(12, 0));
    }
}
