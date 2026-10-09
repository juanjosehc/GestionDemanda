package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;

/**
 * Correspondencia entre la priorizacion de GLPI y la severidad del dominio.
 *
 * <p>Es la tabla que el documento de decisiones llevaba marcada como pendiente desde la primera fase,
 * y por eso se prueba valor por valor: si alguien cambia un limite, esta prueba dice cual.
 */
class GlpiPriorityMapperTest {

    /** El contrato en uso. La escala que se prueba aqui es la que el declara, no una constante. */
    private static final GlpiContract CONTRACT = GlpiContract.REST_V1;

    private static GlpiTicket ticketWith(Integer priority, Integer impact, Integer urgency) {
        return new GlpiTicket(1, "Ticket", 1, GlpiTicket.TYPE_INCIDENT, priority, impact, urgency,
                3600L, null, "2026-10-05 09:00:00", 7);
    }

    private static IncidentSeverity severityOf(Integer priority, Integer impact, Integer urgency) {
        return GlpiPriorityMapper.severityOf(ticketWith(priority, impact, urgency), CONTRACT);
    }

    @ParameterizedTest(name = "prioridad {0} -> {1}")
    @CsvSource({
            "5, ALTO",
            "4, ALTO",
            "3, MEDIO",
            "2, BAJO",
            "1, BAJO"
    })
    @DisplayName("La prioridad de GLPI se agrupa en las tres severidades del dominio")
    void traduceLaEscalaDeGlpi(int priority, IncidentSeverity expected) {
        assertThat(severityOf(priority, null, null)).isEqualTo(expected);
    }

    @Test
    @DisplayName("Sin prioridad, la severidad se deduce del mayor entre impacto y urgencia")
    void deduceDelImpactoYLaUrgenciaCuandoFaltaLaPrioridad() {
        assertThat(severityOf(null, 4, 1)).isEqualTo(IncidentSeverity.ALTO);
        assertThat(severityOf(null, 1, 3)).isEqualTo(IncidentSeverity.MEDIO);
        assertThat(severityOf(null, 2, null)).isEqualTo(IncidentSeverity.BAJO);
    }

    @Test
    @DisplayName("La prioridad manda sobre el impacto y la urgencia")
    void laPrioridadTienePrecedencia() {
        assertThat(severityOf(1, 5, 5)).isEqualTo(IncidentSeverity.BAJO);
    }

    @Test
    @DisplayName("Sin nada que traducir la severidad es nula, no un valor inventado")
    void sinDatosDevuelveNulo() {
        assertThat(severityOf(null, null, null)).isNull();
    }

    @Test
    @DisplayName("Un valor fuera de la escala 1-5 no se interpreta ni se recorta")
    void unValorFueraDeEscalaNoSeTraduce() {
        assertThat(severityOf(9, null, null)).isNull();
        assertThat(severityOf(0, null, null)).isNull();
        assertThat(severityOf(-1, null, null)).isNull();
    }

    @Test
    @DisplayName("Si la prioridad no sirve pero el impacto si, se usa el impacto")
    void caeAlImpactoCuandoLaPrioridadEstaFueraDeEscala() {
        assertThat(severityOf(9, 5, null)).isEqualTo(IncidentSeverity.ALTO);
    }
}
