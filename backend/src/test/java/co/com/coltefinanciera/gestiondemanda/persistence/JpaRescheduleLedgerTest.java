package co.com.coltefinanciera.gestiondemanda.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Pruebas del registro de idempotencia persistente.
 *
 * <p>La transaccion de prueba va desactivada a proposito. Con ella, el reclamo duplicado reventaria
 * dentro de la misma transaccion que lo creo y la sesion de Hibernate quedaria inservible para el
 * resto del metodo; y ademas no es lo que pasa en produccion, donde cada reclamo corre en su propia
 * transaccion. Desactivarla prueba el comportamiento real, no una version acomodada de el.
 *
 * <p>Por lo mismo hay que limpiar la tabla antes de cada prueba: sin la transaccion que revierte
 * todo al final, los reclamos de una prueba los veria la siguiente.
 */
@DataJpaTest
@Import({JpaRescheduleLedger.class, JpaRescheduleLedgerTest.RelojDelSistema.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class JpaRescheduleLedgerTest {

    @Autowired
    private JpaRescheduleLedger ledger;

    @Autowired
    private RescheduleClaimJpaRepository claims;

    @Autowired
    private Clock clock;

    @BeforeEach
    void limpiar() {
        claims.deleteAll();
    }

    @Test
    @DisplayName("El primer reclamo se concede y el segundo se niega")
    void elPrimerReclamoSeConcedeYElSegundoSeNiega() {
        assertThat(ledger.claim("INC-1", "REQ-1")).isTrue();
        assertThat(ledger.claim("INC-1", "REQ-1")).isFalse();
    }

    @Test
    @DisplayName("contains refleja lo reclamado sin reclamarlo")
    void containsReflejaLoReclamadoSinReclamarlo() {
        assertThat(ledger.contains("INC-1", "REQ-1")).isFalse();

        ledger.claim("INC-1", "REQ-1");

        assertThat(ledger.contains("INC-1", "REQ-1")).isTrue();
        // Consultar no consume el reclamo: sigue estando disponible para quien lo pida.
        assertThat(ledger.contains("INC-1", "REQ-1")).isTrue();
    }

    @Test
    @DisplayName("El mismo incidente puede desplazar requerimientos distintos")
    void elMismoIncidentePuedeDesplazarRequerimientosDistintos() {
        assertThat(ledger.claim("INC-1", "REQ-A")).isTrue();
        assertThat(ledger.claim("INC-1", "REQ-B")).isTrue();
        assertThat(ledger.claim("INC-1", "REQ-A")).isFalse();
    }

    @Test
    @DisplayName("El requerimiento se reclama por pareja, no por requerimiento solo")
    void elRequerimientoSeReclamaPorPareja() {
        // El mismo requerimiento desplazado por otro incidente es otro desplazamiento.
        assertThat(ledger.claim("INC-1", "REQ-1")).isTrue();
        assertThat(ledger.claim("INC-2", "REQ-1")).isTrue();
    }

    @Test
    @DisplayName("Los desplazamientos sin incidente causante se reclaman entre si")
    void losDesplazamientosSinIncidenteCausanteSeReclamanEntreSi() {
        // Un requerimiento desplazado por saturacion del calendario no tiene incidente detras. Ese
        // hueco no puede quedar sin reclamar: dos ejecuciones del mismo escenario repetirian la
        // auditoria. De ahi el centinela: el nulo se guarda como un valor mas.
        assertThat(ledger.claim(null, "REQ-1")).isTrue();
        assertThat(ledger.claim(null, "REQ-1")).isFalse();
        assertThat(ledger.contains("", "REQ-1")).isTrue();
    }

    @Test
    @DisplayName("La idempotencia sobrevive al reinicio de la aplicacion")
    void laIdempotenciaSobreviveAlReinicioDeLaAplicacion() {
        // Esto es lo que la implementacion en memoria no podia prometer, y la razon de ser de la
        // fase: un reinicio reabria el registro y el mismo incidente volvia a desplazar el mismo
        // requerimiento, duplicando la auditoria.
        assertThat(ledger.claim("INC-1", "REQ-1")).isTrue();

        // Una instancia nueva sobre la misma base de datos es lo que hay despues de un reinicio:
        // memoria nueva, datos viejos.
        JpaRescheduleLedger trasElReinicio = new JpaRescheduleLedger(claims, clock);

        assertThat(trasElReinicio.contains("INC-1", "REQ-1")).isTrue();
        assertThat(trasElReinicio.claim("INC-1", "REQ-1")).isFalse();
    }

    @TestConfiguration
    static class RelojDelSistema {

        @Bean
        Clock clock() {
            return Clock.systemUTC();
        }
    }
}
