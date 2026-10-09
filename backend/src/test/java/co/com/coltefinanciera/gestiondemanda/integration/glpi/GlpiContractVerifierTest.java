package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.exception.GlpiInvalidDataException;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiContractVerifier.Report;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiContractVerifier.Verdict;

/**
 * Comparacion del contrato asumido contra una respuesta observada.
 *
 * <p>Es la prueba del mecanismo que reduce el riesgo 43. Todas las respuestas de aqui son texto
 * escrito a mano con la forma que GLPI documenta: no hay instancia detras, y esa es la condicion para
 * que el mecanismo sirva — tiene que poder decir en que se diferencia un contrato <em>antes</em> de
 * tener el sistema ajeno delante, y despues, contra una captura guardada.
 *
 * <p>Los tres veredictos se prueban porque son tres decisiones distintas: {@code INCOMPATIBLE} manda a
 * cambiar el adaptador, {@code DEGRADED} a revisar por que se entro por un camino de respaldo, y
 * {@code COMPATIBLE} a seguir. Un campo desconocido no es ninguna de las tres cosas graves: es lo que
 * GLPI trae de mas, y se registra sin bajar el veredicto.
 *
 * <p>Lo que aqui no se prueba es la politica de descarte ticket a ticket —tipo desconocido, estado
 * desconocido, fecha ilegible—: eso vive en {@link GlpiTicketValidator} y se prueba alli. Esta clase
 * mira la forma de la respuesta; aquella mira el significado del ticket.
 */
class GlpiContractVerifierTest {

    /** Un ticket completo, con los campos que el contrato declara y sus tipos. */
    private static final String COMPLETO = """
            {"id": 501, "name": "Falla en produccion", "type": 1, "status": 2, "priority": 5,
             "impact": 4, "urgency": 3, "actiontime": 21600, "date": "2026-10-05 09:00:00",
             "time_to_resolve": "2026-10-06 17:00:00", "users_id_assign": 7}
            """;

    @Test
    @DisplayName("Una respuesta con todo lo declarado es compatible")
    void unaRespuestaCompletaEsCompatible() {
        Report report = GlpiContractVerifier.verify(COMPLETO);

        assertThat(report.verdict()).isEqualTo(Verdict.COMPATIBLE);
        assertThat(report.compatible()).isTrue();
        assertThat(report.tickets()).isEqualTo(1);
        assertThat(report.missingRequired()).isEmpty();
        assertThat(report.typeMismatches()).isEmpty();
        assertThat(report.unknownFields()).isEmpty();
        assertThat(report.outOfRangeValues()).isEmpty();
        assertThat(report.unreadableDates()).isEmpty();
    }

    @Test
    @DisplayName("Sin un campo obligatorio el contrato es incompatible y el informe dice cual")
    void unCampoObligatorioAusenteEsIncompatible() {
        Report report = GlpiContractVerifier.verify(COMPLETO.replace("\"actiontime\": 21600,", ""));

        assertThat(report.verdict()).isEqualTo(Verdict.INCOMPATIBLE);
        assertThat(report.missingRequired()).containsExactly("actiontime");
    }

    @Test
    @DisplayName("Un campo obligatorio con otro tipo es incompatible, no una degradacion")
    void unTipoIncompatibleEsIncompatible() {
        Report report = GlpiContractVerifier.verify(COMPLETO.replace("21600", "\"21600\""));

        assertThat(report.verdict()).isEqualTo(Verdict.INCOMPATIBLE);
        assertThat(report.missingRequired()).isEmpty();
        assertThat(report.typeMismatches())
                .hasSize(1)
                .allSatisfy(finding -> assertThat(finding).contains("actiontime", "integer", "STRING"));
    }

    @Test
    @DisplayName("Una prioridad fuera de la escala degrada el contrato sin romperlo")
    void unaPrioridadFueraDeEscalaDegrada() {
        Report report = GlpiContractVerifier.verify(COMPLETO.replace("\"priority\": 5", "\"priority\": 9"));

        assertThat(report.verdict()).isEqualTo(Verdict.DEGRADED);
        assertThat(report.missingRequired()).isEmpty();
        assertThat(report.typeMismatches()).isEmpty();
        assertThat(report.outOfRangeValues())
                .hasSize(1)
                .allSatisfy(finding -> assertThat(finding).contains("priority=9", "1..5"));
    }

    @Test
    @DisplayName("Una fecha ilegible degrada el contrato y el informe la muestra")
    void unaFechaIlegibleDegrada() {
        Report report = GlpiContractVerifier.verify(
                COMPLETO.replace("2026-10-05 09:00:00", "05/10/2026"));

        assertThat(report.verdict()).isEqualTo(Verdict.DEGRADED);
        assertThat(report.unreadableDates())
                .hasSize(1)
                .allSatisfy(finding -> assertThat(finding).contains("date='05/10/2026'"));
    }

    @Test
    @DisplayName("Un campo que el contrato no declara se registra sin bajar el veredicto")
    void unCampoDesconocidoSeRegistraSinDegradar() {
        Report report = GlpiContractVerifier.verify(COMPLETO.replace(
                "\"users_id_assign\": 7", "\"users_id_assign\": 7, \"date_creation\": \"2026-10-01 08:00:00\""));

        assertThat(report.verdict()).isEqualTo(Verdict.COMPATIBLE);
        assertThat(report.unknownFields()).containsExactly("date_creation");
    }

    @Test
    @DisplayName("El informe declara con que adaptador y con que contrato se comparo")
    void elInformeDeclaraLasVersiones() {
        Report report = GlpiContractVerifier.verify(COMPLETO);

        assertThat(report.adapterVersion()).isEqualTo("glpi-rest-2");
        assertThat(report.contractVersion()).isEqualTo("glpi-contract-1");
    }

    @Test
    @DisplayName("Un arreglo de tickets se verifica entero y el mismo defecto se cuenta una vez")
    void unArregloSeVerificaEntero() {
        String sinHoras = COMPLETO.replace("\"id\": 501", "\"id\": 502")
                .replace("\"actiontime\": 21600,", "");

        Report report = GlpiContractVerifier.verify("[" + COMPLETO + "," + sinHoras + "]");

        assertThat(report.tickets()).isEqualTo(2);
        assertThat(report.verdict()).isEqualTo(Verdict.INCOMPATIBLE);
        assertThat(report.missingRequired()).containsExactly("actiontime");
    }

    @Test
    @DisplayName("Un cuerpo que no es JSON es un fallo de datos, no un contrato incompatible")
    void unCuerpoIlegibleEsUnFalloDeDatos() {
        assertThatThrownBy(() -> GlpiContractVerifier.verify("no es json"))
                .isInstanceOf(GlpiInvalidDataException.class)
                .hasMessageContaining("no se puede leer como JSON");

        assertThatThrownBy(() -> GlpiContractVerifier.verify("  "))
                .isInstanceOf(GlpiInvalidDataException.class)
                .hasMessageContaining("No hay respuesta");
    }
}
