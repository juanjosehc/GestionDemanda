package co.com.coltefinanciera.gestiondemanda.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import co.com.coltefinanciera.gestiondemanda.domain.enums.DeclaredGap;
import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.enums.PlanningMetadataField;
import co.com.coltefinanciera.gestiondemanda.domain.model.DeclaredPlanningMetrics;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadataChange;

/**
 * Pruebas del repositorio de la planificacion declarada.
 *
 * <p>Lo que se comprueba no es que Hibernate guarde, sino que lo guardado vuelve igual y que el
 * historial no se toca. La planificacion es la promesa que el negocio hace sobre el trabajo: si al
 * releerla cambia un valor o un autor, la promesa deja de poder atribuirse a nadie.
 *
 * <p>Las horas se comparan con {@code isEqualByComparingTo} y nunca con {@code equals}:
 * {@code NUMERIC(10,4)} devuelve {@code 8.0000}, que no es igual a {@code 8} para
 * {@link BigDecimal}.
 *
 * <p><strong>La transaccion de prueba va desactivada</strong>, como en {@code JpaRescheduleLedgerTest}
 * y por una razon parecida: aqui se comprueba que declarar dos veces el mismo elemento choca con la
 * clave primaria, y eso solo ocurre de verdad si cada declaracion corre en su propia transaccion,
 * que es lo que pasa en produccion. Con la transaccion de prueba activa, la segunda declaracion
 * encontraria la primera entidad ya cargada en la misma sesion y fallaria por otro motivo, mas
 * benigno y menos cierto. Desactivarla obliga a limpiar las tablas antes de cada prueba, porque ya
 * no hay nada que revierta al terminar.
 */
@DataJpaTest
@Import(JpaPlanningMetadataRepository.class)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class JpaPlanningMetadataRepositoryTest {

    private static final String ITEM = "67501";
    private static final Instant CUANDO = Instant.parse("2026-10-06T08:00:00Z");
    private static final LocalDate COMPROMISO = LocalDate.of(2026, 10, 20);

    @Autowired
    private JpaPlanningMetadataRepository repository;

    @Autowired
    private PlanningMetadataJpaRepository rows;

    @Autowired
    private PlanningMetadataHistoryJpaRepository historyRows;

    @BeforeEach
    void limpiar() {
        historyRows.deleteAll();
        rows.deleteAll();
    }

    @Test
    @DisplayName("El estado declarado vuelve igual de la base de datos")
    void elEstadoDeclaradoVuelveIgual() {
        repository.create(conAmbos(), List.of(
                cambio(PlanningMetadataField.ESTIMATED_HOURS, null, "8.0000", "dev-ana"),
                cambio(PlanningMetadataField.COMMITTED_DATE, null, "2026-10-20", "gestor-luis")));

        PlanningMetadata vuelto = repository.findByWorkItemId(ITEM).orElseThrow();

        assertThat(vuelto.workItemId()).isEqualTo(ITEM);
        assertThat(vuelto.estimatedHours()).isEqualByComparingTo("8");
        assertThat(vuelto.committedDate()).isEqualTo(COMPROMISO);
        assertThat(vuelto.estimatedBy()).isEqualTo("dev-ana");
        assertThat(vuelto.committedBy()).isEqualTo("gestor-luis");
        assertThat(vuelto.estimatedAt()).isEqualTo(CUANDO);
        assertThat(vuelto.committedAt()).isEqualTo(CUANDO);
        assertThat(vuelto.source()).isEqualTo(InputSource.HTTP);
    }

    @Test
    @DisplayName("Un estado sin ningun valor vuelve con los nulos intactos")
    void unEstadoSinNingunValorVuelveConLosNulosIntactos() {
        repository.create(PlanningMetadata.undeclared(ITEM, InputSource.HTTP), List.of());

        PlanningMetadata vuelto = repository.findByWorkItemId(ITEM).orElseThrow();

        assertThat(vuelto.estimatedHours()).isNull();
        assertThat(vuelto.committedDate()).isNull();
        assertThat(vuelto.estimatedBy()).isNull();
        assertThat(vuelto.committedBy()).isNull();
        assertThat(vuelto.estimatedAt()).isNull();
        assertThat(vuelto.committedAt()).isNull();
        assertThat(vuelto.source()).isEqualTo(InputSource.HTTP);
    }

    @Test
    @DisplayName("El historial vuelve en el orden en que se registro, aunque comparta instante")
    void elHistorialVuelveEnOrdenAunqueCompartaInstante() {
        repository.create(conAmbos(), List.of());

        repository.update(conAmbos(), List.of(
                cambio(PlanningMetadataField.ESTIMATED_HOURS, "8.0000", "10.0000", "dev-ana"),
                cambio(PlanningMetadataField.COMMITTED_DATE, "2026-10-20", "2026-10-25", "gestor-luis")));

        // Las dos filas llevan el mismo instante a proposito: el orden solo puede venir del
        // identificador generado, que es lo que se quiere comprobar.
        assertThat(repository.findHistory(ITEM))
                .extracting(PlanningMetadataChange::field,
                        PlanningMetadataChange::previousValue,
                        PlanningMetadataChange::newValue)
                .containsExactly(
                        tuple(PlanningMetadataField.ESTIMATED_HOURS, "8.0000", "10.0000"),
                        tuple(PlanningMetadataField.COMMITTED_DATE, "2026-10-20", "2026-10-25"));
    }

    @Test
    @DisplayName("Actualizar el estado añade al historial sin reescribir lo ya escrito")
    void actualizarElEstadoAñadeSinReescribir() {
        repository.create(conAmbos(), List.of(
                cambio(PlanningMetadataField.ESTIMATED_HOURS, null, "8.0000", "dev-ana")));

        repository.update(conAmbos(), List.of(
                cambio(PlanningMetadataField.ESTIMATED_HOURS, "8.0000", "10.0000", "dev-ana")));

        List<PlanningMetadataChange> historial = repository.findHistory(ITEM);

        assertThat(historial).hasSize(2);
        assertThat(historial.get(0).previousValue()).isNull();
        assertThat(historial.get(0).newValue()).isEqualTo("8.0000");
        assertThat(historial.get(0).changedAt()).isEqualTo(CUANDO);
        assertThat(historial.get(1).previousValue()).isEqualTo("8.0000");
        assertThat(historial.get(1).newValue()).isEqualTo("10.0000");
    }

    @Test
    @DisplayName("El historial de un elemento no mezcla el de otro")
    void elHistorialDeUnElementoNoMezclaElDeOtro() {
        repository.create(conAmbos(), List.of(
                cambio(PlanningMetadataField.ESTIMATED_HOURS, null, "8.0000", "dev-ana")));
        repository.create(PlanningMetadata.undeclared("67502", InputSource.GLPI), List.of(
                new PlanningMetadataChange("67502", PlanningMetadataField.COMMITTED_DATE,
                        null, "2026-11-01", "gestor-luis", CUANDO)));

        assertThat(repository.findHistory(ITEM)).hasSize(1);
        assertThat(repository.findHistory("67502"))
                .extracting(PlanningMetadataChange::newValue)
                .containsExactly("2026-11-01");
    }

    @Test
    @DisplayName("Declarar dos veces el mismo elemento choca con la clave primaria")
    void declararDosVecesElMismoElementoChocaConLaClave() {
        repository.create(conAmbos(), List.of());

        assertThatThrownBy(() -> repository.create(conAmbos(), List.of()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * La lectura por lote, que es la que hace la capa anticorrupcion al traducir una agenda.
     *
     * <p>Se pregunta por tres identificadores y solo dos tienen fila: el tercero no aparece, y no
     * aparece con nulo sino ausente. Es la unica forma en que el llamador puede distinguir «no
     * declaro» de «declaro vacio», que son estados distintos del negocio.
     */
    @Test
    @DisplayName("La lectura por lote devuelve los declarados y solo esos, sin mezclar elementos")
    void laLecturaPorLoteDevuelveSoloLosDeclarados() {
        repository.create(conAmbos(), List.of());
        repository.create(PlanningMetadata.undeclared("67502", InputSource.GLPI), List.of());

        List<PlanningMetadata> declarados =
                repository.findByWorkItemIdIn(List.of(ITEM, "67502", "67599"));

        assertThat(declarados).extracting(PlanningMetadata::workItemId)
                .containsExactlyInAnyOrder(ITEM, "67502");
        assertThat(declarados).filteredOn(uno -> uno.workItemId().equals(ITEM))
                .singleElement()
                .satisfies(uno -> {
                    assertThat(uno.estimatedHours()).isEqualByComparingTo("8");
                    assertThat(uno.committedDate()).isEqualTo(COMPROMISO);
                });
        assertThat(declarados).filteredOn(uno -> uno.workItemId().equals("67502"))
                .singleElement()
                .satisfies(uno -> {
                    assertThat(uno.estimatedHours()).isNull();
                    assertThat(uno.committedDate()).isNull();
                });
    }

    @Test
    @DisplayName("La lectura por lote de una lista vacia devuelve vacio sin preguntar")
    void laLecturaPorLoteVaciaDevuelveVacio() {
        repository.create(conAmbos(), List.of());

        assertThat(repository.findByWorkItemIdIn(List.of())).isEmpty();
    }

    /**
     * El estado declarado, contado por estimacion.
     *
     * <p>Desde la Fase 77 esta es la unica carencia que la declaracion puede tener: la fecha de
     * compromiso la publica GLPI y no se declara. Una fila historica con fecha y sin horas —la que
     * dejo una declaracion anterior— cuenta como falta de estimacion, que es exactamente lo que es.
     */
    @Test
    @DisplayName("El estado declarado se cuenta por estimacion")
    void elEstadoDeclaradoSeCuentaPorEstimacion() {
        repository.create(soloEstimacion("A"), List.of());
        repository.create(soloCompromiso("B"), List.of());
        repository.create(PlanningMetadata.undeclared("C", InputSource.HTTP), List.of());
        repository.create(conAmbos("D"), List.of());

        DeclaredPlanningMetrics contado = repository.declaredMetrics();

        assertThat(contado.total()).isEqualTo(4);
        assertThat(contado.withoutEstimation()).isEqualTo(2);
        // Y lo derivado cierra con lo contado: dos con horas, dos sin ellas.
        assertThat(contado.plannable()).isEqualTo(2);
    }

    @Test
    @DisplayName("Sin nada declarado los contadores son cero, no un error")
    void sinNadaDeclaradoLosContadoresSonCero() {
        DeclaredPlanningMetrics contado = repository.declaredMetrics();

        assertThat(contado.total()).isZero();
        assertThat(contado.plannable()).isZero();
        assertThat(contado.withoutEstimation()).isZero();
    }

    /**
     * El listado de la carencia, contra la base y contra su propio contador.
     *
     * <p>Es la prueba que sostiene la forma del desglose: la lista y el numero salen del mismo
     * predicado escrito dos veces por Spring Data, y lo que aqui se comprueba es que las dos escrituras
     * digan lo mismo. Se compara la lista con el contador —leido de {@code declaredMetrics}, no escrito
     * a mano— y ademas se comprueba el orden, que es lo que hace que dos listados iguales se puedan
     * comparar.
     */
    @Test
    @DisplayName("El listado de la carencia cuadra con su contador y va ordenado")
    void elListadoDeLaCarenciaCuadraConSuContador() {
        repository.create(soloEstimacion("67501"), List.of());
        repository.create(soloCompromiso("67502"), List.of());
        repository.create(PlanningMetadata.undeclared("67503", InputSource.HTTP), List.of());
        repository.create(conAmbos("67504"), List.of());
        repository.create(soloEstimacion("67505"), List.of());

        DeclaredPlanningMetrics contado = repository.declaredMetrics();

        assertThat(idsDe(DeclaredGap.SIN_ESTIMACION))
                .containsExactly("67502", "67503")
                .hasSize((int) contado.withoutEstimation());
    }

    /** Una carencia que no tiene filas devuelve una lista vacia, que es el caso de un tablero sano. */
    @Test
    @DisplayName("Una carencia sin filas devuelve una lista vacia")
    void unaCarenciaSinFilasDevuelveUnaListaVacia() {
        repository.create(conAmbos(), List.of());

        assertThat(repository.findByDeclaredGap(DeclaredGap.SIN_ESTIMACION)).isEmpty();
    }

    private List<String> idsDe(DeclaredGap gap) {
        return repository.findByDeclaredGap(gap).stream().map(PlanningMetadata::workItemId).toList();
    }

    /** El estado declarado con los dos valores, que es el punto de partida de casi todas las pruebas. */
    private static PlanningMetadata conAmbos() {
        return conAmbos(ITEM);
    }

    private static PlanningMetadata conAmbos(String workItemId) {
        return new PlanningMetadata(workItemId, new BigDecimal("8"), COMPROMISO,
                "dev-ana", "gestor-luis", CUANDO, CUANDO, InputSource.HTTP);
    }

    /** Estimacion sin fecha compromiso: el desarrollador hizo su parte y el gestor no la suya. */
    private static PlanningMetadata soloEstimacion(String workItemId) {
        return new PlanningMetadata(workItemId, new BigDecimal("8"), null,
                "dev-ana", null, CUANDO, null, InputSource.HTTP);
    }

    /** Fecha compromiso sin estimacion: el gestor hizo su parte y el desarrollador no la suya. */
    private static PlanningMetadata soloCompromiso(String workItemId) {
        return new PlanningMetadata(workItemId, null, COMPROMISO,
                null, "gestor-luis", null, CUANDO, InputSource.HTTP);
    }

    private static PlanningMetadataChange cambio(
            PlanningMetadataField field, String previousValue, String newValue, String changedBy) {

        return new PlanningMetadataChange(ITEM, field, previousValue, newValue, changedBy, CUANDO);
    }
}
