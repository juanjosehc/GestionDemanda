package co.com.coltefinanciera.gestiondemanda.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.enums.AlertSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.OperationalAlertType;
import co.com.coltefinanciera.gestiondemanda.dto.OperationalAlert;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningOperationalMetricsResponse;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiDiscardReason;

/**
 * Pruebas de la proyeccion de alertas, sin Spring y sin base de datos.
 *
 * <p><strong>Por que esta prueba existe aparte de la del endpoint.</strong> El reparto no es de gusto:
 * la prueba de endpoint solo puede contener lo que el camino real puede producir, y hay un estado que
 * el camino real <em>no puede</em> producir. El motor nunca sobrepasa la jornada —{@code CapacityBook}
 * solo ocupa dentro de las franjas del calendario—, asi que una capacidad restante negativa no se
 * alcanza ni pidiendo un plan ni manipulando bloques. Aqui, donde la fotografia se escribe en vez de
 * producirse, si se puede. La alerta se prueba donde es construible, y en el endpoint se prueba que
 * <em>no</em> dispara sobre datos reales, que es la mitad que protege contra el falso positivo.
 *
 * <p><strong>Las fotografias se arman a mano y son aritmeticamente coherentes</strong> salvo donde se
 * dice lo contrario: los campos que la proyeccion no lee —{@code total}, {@code plannable}, la ventana
 * y los planes guardados— quedan en cero a proposito, porque nada de lo que se afirma aqui depende de
 * ellos.
 */
class OperationalAlertServiceTest {

    private static final Instant SELLO = Instant.parse("2026-10-08T12:00:00Z");
    private static final LocalDate LUNES = LocalDate.parse("2026-10-05");
    private static final LocalDate MARTES = LocalDate.parse("2026-10-06");

    @Test
    @DisplayName("Sin nada que alertar la lista sale vacia, y sigue fechada")
    void sinNadaQueAlertarLaListaSaleVacia() {
        PlanningOperationalMetricsResponse foto = foto(0, 0, 0, 0, 0);

        assertThat(OperationalAlertService.project(foto).alerts()).isEmpty();
        // La fecha no es un adorno: sin ella, «no hay nada que mirar» y «no se ha mirado» se
        // escribirian igual.
        assertThat(OperationalAlertService.project(foto).generatedAt()).isEqualTo(SELLO);
    }

    @Test
    @DisplayName("Una sola fila sin estimar es aviso, y arrastra consigo el incompleto")
    void unaSolaFilaSinEstimarEsAviso() {
        // Una fila con compromiso y sin estimacion: la carencia, y el incompleto que la contiene. No
        // se puede disparar una sin la otra, y eso no es un defecto del catalogo: `incomplete` es la
        // union de las dos carencias, asi que toda carencia esta dentro.
        PlanningOperationalMetricsResponse foto = foto(1, 0, 1, 0, 0);

        OperationalAlert estimacion = alerta(foto, OperationalAlertType.SIN_ESTIMACION);

        assertThat(estimacion.severity()).isEqualTo(AlertSeverity.WARNING);
        assertThat(estimacion.count()).isEqualTo(1);
        assertThat(estimacion.detailUrl())
                .isEqualTo("/api/planning/metrics/declared/SIN_ESTIMACION");

        // Y el incompleto es INFO aunque acompañe a un aviso: su oficio es decir cuanto falta, no
        // reclamar; reclamar ya lo hace la carencia que lo contiene.
        OperationalAlert incompleta = alerta(foto, OperationalAlertType.METADATA_INCOMPLETA);

        assertThat(incompleta.severity()).isEqualTo(AlertSeverity.INFO);
        assertThat(incompleta.count()).isEqualTo(1);
    }

    @Test
    @DisplayName("Una sola fila sin comprometer es aviso, con su propio desglose")
    void unaSolaFilaSinComprometerEsAviso() {
        PlanningOperationalMetricsResponse foto = foto(0, 1, 1, 0, 0);

        OperationalAlert compromiso = alerta(foto, OperationalAlertType.SIN_COMPROMISO);

        assertThat(compromiso.severity()).isEqualTo(AlertSeverity.WARNING);
        assertThat(compromiso.count()).isEqualTo(1);
        assertThat(compromiso.detailUrl())
                .isEqualTo("/api/planning/metrics/declared/SIN_COMPROMISO");
        assertThat(alerta(foto, OperationalAlertType.METADATA_INCOMPLETA).count()).isEqualTo(1);
    }

    @Test
    @DisplayName("Los retirados no alertan por si solos: no hay a quien reclamarle")
    void losRetiradosNoAlertanPorSiSolos() {
        // Dos filas declaradas y despues retiradas: la tabla no esta vacia, pero no hay carencia que
        // reclamar ni trabajo que planificar. El unico contador que se mueve es el de retiradas, y no
        // tiene alerta.
        PlanningOperationalMetricsResponse foto = foto(0, 0, 0, 2, 0);

        assertThat(OperationalAlertService.project(foto).alerts()).isEmpty();
    }

    @Test
    @DisplayName("Los requerimientos desplazados son un aviso, con el numero de la fotografia")
    void losDesplazadosSonUnAviso() {
        PlanningOperationalMetricsResponse foto = foto(0, 0, 0, 0, 3);

        OperationalAlert desplazados = alerta(foto, OperationalAlertType.REQUERIMIENTOS_DESPLAZADOS);

        assertThat(desplazados.severity()).isEqualTo(AlertSeverity.WARNING);
        assertThat(desplazados.count()).isEqualTo(3);
        assertThat(desplazados.detailUrl()).isEqualTo("/api/planning/metrics/displaced");
    }

    @Test
    @DisplayName("Un plan vigente exactamente lleno es un aviso, y no tiene listado propio")
    void unPlanVigenteExactamenteLlenoEsUnAviso() {
        PlanningOperationalMetricsResponse foto = foto(0, 0, 0, 0, 0, "0");

        OperationalAlert agotada = alerta(foto, OperationalAlertType.CAPACIDAD_AGOTADA);

        assertThat(agotada.severity()).isEqualTo(AlertSeverity.WARNING);
        assertThat(agotada.count()).isEqualTo(1);
        // Su detalle es el calendario del plan, que ya existe: esta fase no construye listados nuevos.
        assertThat(agotada.detailUrl()).isNull();
    }

    @Test
    @DisplayName("Un plan vigente pasado de jornada es lo unico critico, y el motor no puede producirlo")
    void unPlanPasadoDeJornadaEsLoUnicoCritico() {
        // Sintetica, y hay que decirlo: el motor nunca sobrepasa la jornada, asi que este estado no se
        // alcanza pidiendo un plan. Es exactamente el estado que la alerta existe para ver, y por eso
        // se prueba aqui: se verifica la proyeccion, no la alcanzabilidad.
        PlanningOperationalMetricsResponse foto = foto(0, 0, 0, 0, 0, "-2");

        OperationalAlert negativa = alerta(foto, OperationalAlertType.CAPACIDAD_NEGATIVA);

        assertThat(negativa.severity()).isEqualTo(AlertSeverity.CRITICAL);
        assertThat(negativa.count()).isEqualTo(1);
        assertThat(negativa.detailUrl()).isNull();
        // Y no se confunde con la de al lado: un restante negativo no es un restante agotado.
        assertThat(tipos(foto)).doesNotContain(OperationalAlertType.CAPACIDAD_AGOTADA);
    }

    @Test
    @DisplayName("Agotado y negativo son excluyentes: un desarrollador cae en una o en ninguna")
    void agotadoYNegativoSonExcluyentes() {
        // Tres desarrolladores: uno justo, uno pasado y uno con holgura. Los dos contadores suman dos,
        // que es lo que impide contarlos dos veces.
        PlanningOperationalMetricsResponse foto = foto(0, 0, 0, 0, 0, "0", "-2", "4");

        assertThat(alerta(foto, OperationalAlertType.CAPACIDAD_AGOTADA).count()).isEqualTo(1);
        assertThat(alerta(foto, OperationalAlertType.CAPACIDAD_NEGATIVA).count()).isEqualTo(1);
    }

    @Test
    @DisplayName("Un contador en cero no produce alerta")
    void unContadorEnCeroNoProduceAlerta() {
        // La regla «solo se lista lo que se cumple», en las seis: con la fotografia en cero no hay
        // ninguna, y con una sola declarada solo salen las que esa declaracion produce.
        PlanningOperationalMetricsResponse sola = foto(0, 0, 0, 0, 0, "8", "8");

        assertThat(OperationalAlertService.project(sola).alerts()).isEmpty();

        PlanningOperationalMetricsResponse una = foto(1, 0, 1, 0, 0, "8", "8");

        assertThat(tipos(una)).containsExactly(
                OperationalAlertType.SIN_ESTIMACION,
                OperationalAlertType.METADATA_INCOMPLETA);
    }

    @Test
    @DisplayName("La salida va de mas grave a menos, y dentro de cada nivel por el orden del catalogo")
    void laSalidaVaDeMasGraveAMenos() {
        // Las seis condiciones a la vez.
        PlanningOperationalMetricsResponse foto = foto(1, 1, 2, 0, 3, "0", "-2", "5");

        assertThat(tipos(foto)).containsExactly(
                OperationalAlertType.CAPACIDAD_NEGATIVA,
                OperationalAlertType.REQUERIMIENTOS_DESPLAZADOS,
                OperationalAlertType.CAPACIDAD_AGOTADA,
                OperationalAlertType.SIN_ESTIMACION,
                OperationalAlertType.SIN_COMPROMISO,
                OperationalAlertType.METADATA_INCOMPLETA);
    }

    @Test
    @DisplayName("Cada alerta dice de donde sale, que se conto y sobre que universo")
    void cadaAlertaDiceDeDondeSale() {
        PlanningOperationalMetricsResponse foto = foto(1, 1, 2, 0, 3, "0", "-2");

        for (OperationalAlert alert : OperationalAlertService.project(foto).alerts()) {
            assertThat(alert.condition()).isNotBlank();
            assertThat(alert.source()).isNotBlank();
            assertThat(alert.scope()).isNotBlank();
            // Las tres declaradas salen de la tabla declarada. Las tres de plan, del plan vigente. La
            // procedencia se afirma contra las constantes del contrato, no contra literales nuevos.
            assertThat(alert.source()).isIn(
                    PlanningOperationalMetricsResponse.Declared.SOURCE,
                    PlanningOperationalMetricsResponse.Current.SOURCE);
            assertThat(alert.scope()).isIn(
                    PlanningOperationalMetricsResponse.Declared.SCOPE,
                    PlanningOperationalMetricsResponse.Current.SCOPE);
        }
    }

    @Test
    @DisplayName("La fecha de cada alerta es la de la fotografia: no hay una segunda lectura del reloj")
    void laFechaDeCadaAlertaEsLaDeLaFotografia() {
        PlanningOperationalMetricsResponse foto = foto(1, 1, 2, 0, 3, "0", "-2");

        assertThat(OperationalAlertService.project(foto).alerts())
                .isNotEmpty()
                .allSatisfy(alert -> assertThat(alert.generatedAt()).isEqualTo(SELLO));
    }

    @Test
    @DisplayName("La severidad es la del catalogo: ninguna alerta la trae de otro sitio")
    void laSeveridadEsLaDelCatalogo() {
        // Las seis a la vez, cada una comparada con lo que declara su tipo. Si alguien cambiara una
        // severidad en el enum, la prueba lo sigue; si alguien la escribiera a mano en el servicio,
        // discreparian.
        PlanningOperationalMetricsResponse foto = foto(1, 1, 2, 0, 3, "0", "-2", "5");

        assertThat(OperationalAlertService.project(foto).alerts())
                .isNotEmpty()
                .allSatisfy(alert -> assertThat(alert.severity()).isEqualTo(alert.type().severity()));
    }

    private static List<OperationalAlertType> tipos(PlanningOperationalMetricsResponse foto) {
        return OperationalAlertService.project(foto).alerts().stream()
                .map(OperationalAlert::type)
                .toList();
    }

    private static OperationalAlert alerta(
            PlanningOperationalMetricsResponse foto, OperationalAlertType tipo) {

        return OperationalAlertService.project(foto).alerts().stream()
                .filter(alert -> alert.type() == tipo)
                .findFirst()
                .orElseThrow(() -> new AssertionError("No se disparo " + tipo));
    }

    /**
     * Una fotografia armada a mano.
     *
     * <p>Los tres contadores declarados, las retiradas, los desplazamientos y el restante de capacidad
     * de cada desarrollador vigente, uno por cada valor de {@code restantes}. El disponible se fija en
     * ocho horas y el ocupado se deriva del restante, para que la capacidad de cada desarrollador siga
     * cuadrando aunque el estado sea imposible.
     */
    private static PlanningOperationalMetricsResponse foto(
            long sinEstimacion, long sinCompromiso, long incompleta, long retiradas,
            long desplazados, String... restantes) {

        List<PlanningOperationalMetricsResponse.DeveloperCurrent> desarrolladores = new ArrayList<>();

        for (int i = 0; i < restantes.length; i++) {
            BigDecimal remaining = new BigDecimal(restantes[i]);
            BigDecimal available = new BigDecimal("8");

            desarrolladores.add(new PlanningOperationalMetricsResponse.DeveloperCurrent(
                    "dev-" + (i + 1),
                    new UUID(0, i + 1),
                    SELLO.minusSeconds(60),
                    LUNES,
                    MARTES,
                    new PlanningOperationalMetricsResponse.Capacity(
                            available, available.subtract(remaining), remaining),
                    0));
        }

        return new PlanningOperationalMetricsResponse(
                SELLO,
                new PlanningOperationalMetricsResponse.Declared(
                        PlanningOperationalMetricsResponse.Declared.SOURCE,
                        PlanningOperationalMetricsResponse.Declared.SCOPE,
                        0,
                        0,
                        new PlanningOperationalMetricsResponse.DeclaredGap(
                                GlpiDiscardReason.SIN_ESTIMACION_DECLARADA, sinEstimacion),
                        new PlanningOperationalMetricsResponse.DeclaredGap(
                                GlpiDiscardReason.SIN_COMPROMISO_DECLARADO, sinCompromiso),
                        incompleta,
                        retiradas),
                new PlanningOperationalMetricsResponse.Plans(
                        PlanningOperationalMetricsResponse.Plans.SOURCE,
                        PlanningOperationalMetricsResponse.Plans.SCOPE,
                        0),
                new PlanningOperationalMetricsResponse.Current(
                        PlanningOperationalMetricsResponse.Current.SOURCE,
                        PlanningOperationalMetricsResponse.Current.SCOPE,
                        null,
                        null,
                        new PlanningOperationalMetricsResponse.Capacity(
                                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO),
                        desplazados,
                        desarrolladores));
    }
}
