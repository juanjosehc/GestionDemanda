package co.com.coltefinanciera.gestiondemanda.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.domain.enums.PlanningMetadataField;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadataChange;
import co.com.coltefinanciera.gestiondemanda.domain.repository.InMemoryPlanningMetadataRepository;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataRequest;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataUpdateRequest;
import co.com.coltefinanciera.gestiondemanda.exception.PlanningMetadataAlreadyExistsException;
import co.com.coltefinanciera.gestiondemanda.exception.PlanningMetadataNotFoundException;

/**
 * Pruebas de la planificacion declarada: los casos limite del modelo y la integridad de su auditoria.
 *
 * <p>Es una prueba unitaria, con el puerto en memoria y sin Spring, porque lo que se comprueba son
 * reglas —que se sella, que se conserva, que se registra— y no el recorrido de una peticion. Que el
 * estado se guarde de verdad lo prueba el repositorio, y que la respuesta salga por HTTP lo prueban
 * los endpoints.
 *
 * <p><strong>El reloj se mueve, y tiene que moverse.</strong> Con un reloj fijo, «conservar el sello
 * de un campo que no cambio» y «renovarlo» darian el mismo instante y la prueba no distinguiria una
 * cosa de la otra; y el indicador de vencimiento solo se puede comprobar honestamente si el «hoy» no
 * depende del dia en que se ejecute la suite.
 *
 * <p><strong>Sobre el historial vacio.</strong> Un elemento declarado nunca lo tiene: la primera
 * declaracion tambien se registra. La unica forma de que quedara vacio seria crear un elemento sin
 * declarar nada, y el dominio lo rechaza. La prueba lo comprueba en vez de darlo por supuesto,
 * porque es la garantia que sostiene todo lo demas: un historial que puede estar vacio no puede
 * afirmar que conserva la historia completa.
 */
class PlanningMetadataServiceTest {

    private static final String ITEM = "67501";
    private static final Instant AHORA = Instant.parse("2026-10-06T15:00:00Z");

    private InMemoryPlanningMetadataRepository repository;
    private RelojMovil reloj;
    private PlanningMetadataService service;

    @BeforeEach
    void crearServicio() {
        repository = new InMemoryPlanningMetadataRepository();
        reloj = new RelojMovil();
        service = new PlanningMetadataService(repository, reloj);
    }

    @Test
    @DisplayName("Un elemento sin planificacion declarada responde que no existe")
    void unElementoSinPlanificacionRespondeQueNoExiste() {
        assertThatThrownBy(() -> service.find(ITEM))
                .isInstanceOf(PlanningMetadataNotFoundException.class);
    }

    @Test
    @DisplayName("Pedir el historial de un elemento sin planificacion tampoco lo encuentra")
    void pedirElHistorialDeUnElementoSinPlanificacionTampocoLoEncuentra() {
        assertThatThrownBy(() -> service.history(ITEM))
                .isInstanceOf(PlanningMetadataNotFoundException.class);
    }

    @Test
    @DisplayName("Declarar sin valores no crea un recurso con el historial vacio")
    void declararSinValoresNoCreaUnRecursoConElHistorialVacio() {
        assertThatThrownBy(() -> service.create(alta(null, null, "dev-ana")))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(repository.findByWorkItemId(ITEM)).isEmpty();
    }

    @Test
    @DisplayName("La primera declaracion entra al historial con valor anterior nulo")
    void laPrimeraDeclaracionEntraAlHistorialConValorAnteriorNulo() {
        PlanningMetadataResponse respuesta = service.create(alta("8", "2026-10-20", "dev-ana"));

        assertThat(respuesta.estimatedHours()).isEqualByComparingTo("8");
        assertThat(respuesta.committedDate()).isEqualTo(LocalDate.of(2026, 10, 20));
        assertThat(respuesta.estimatedAt()).isEqualTo(AHORA);
        assertThat(respuesta.committedAt()).isEqualTo(AHORA);

        assertThat(repository.findHistory(ITEM))
                .extracting(PlanningMetadataChange::field,
                        PlanningMetadataChange::previousValue,
                        PlanningMetadataChange::newValue,
                        PlanningMetadataChange::changedBy,
                        PlanningMetadataChange::changedAt)
                .containsExactly(
                        tuple(PlanningMetadataField.ESTIMATED_HOURS, null, "8.0000", "dev-ana", AHORA),
                        tuple(PlanningMetadataField.COMMITTED_DATE, null, "2026-10-20", "dev-ana", AHORA));
    }

    @Test
    @DisplayName("Una estimacion sin fecha compromiso es un estado valido")
    void unaEstimacionSinFechaCompromisoEsUnEstadoValido() {
        PlanningMetadataResponse respuesta = service.create(alta("8", null, "dev-ana"));

        assertThat(respuesta.estimatedHours()).isEqualByComparingTo("8");
        assertThat(respuesta.estimatedBy()).isEqualTo("dev-ana");
        assertThat(respuesta.committedDate()).isNull();
        assertThat(respuesta.committedBy()).isNull();
        assertThat(respuesta.commitmentOverdue()).isFalse();
        assertThat(repository.findHistory(ITEM)).hasSize(1);
    }

    @Test
    @DisplayName("Cambiar la estimacion deja el valor anterior y el nuevo en el historial")
    void cambiarLaEstimacionDejaElValorAnteriorYElNuevo() {
        service.create(alta("8", null, "dev-ana"));
        reloj.avanzarA(AHORA.plus(Duration.ofHours(1)));

        PlanningMetadataResponse respuesta = service.update(ITEM, cambio("12", null, "dev-ana"));

        assertThat(respuesta.estimatedHours()).isEqualByComparingTo("12");
        assertThat(repository.findHistory(ITEM))
                .extracting(PlanningMetadataChange::previousValue,
                        PlanningMetadataChange::newValue,
                        PlanningMetadataChange::changedAt)
                .containsExactly(
                        tuple(null, "8.0000", AHORA),
                        tuple("8.0000", "12.0000", AHORA.plus(Duration.ofHours(1))));
    }

    @Test
    @DisplayName("Cambiar el compromiso conserva el sello de la estimacion")
    void cambiarElCompromisoConservaElSelloDeLaEstimacion() {
        service.create(alta("8", "2026-10-20", "dev-ana"));
        reloj.avanzarA(AHORA.plus(Duration.ofDays(3)));

        PlanningMetadataResponse respuesta = service.update(ITEM, cambio("8", "2026-11-01", "gestor-luis"));

        assertThat(respuesta.estimatedBy()).isEqualTo("dev-ana");
        assertThat(respuesta.estimatedAt()).isEqualTo(AHORA);
        assertThat(respuesta.committedBy()).isEqualTo("gestor-luis");
        assertThat(respuesta.committedAt()).isEqualTo(AHORA.plus(Duration.ofDays(3)));
        assertThat(respuesta.committedDate()).isEqualTo(LocalDate.of(2026, 11, 1));
        assertThat(repository.findHistory(ITEM)).hasSize(3);
    }

    @Test
    @DisplayName("Un compromiso de ayer se acepta y sale marcado como vencido")
    void unCompromisoDeAyerSeAceptaYSaleMarcado() {
        PlanningMetadataResponse respuesta = service.create(alta("8", "2026-10-05", "dev-ana"));

        assertThat(respuesta.committedDate()).isEqualTo(LocalDate.of(2026, 10, 5));
        assertThat(respuesta.commitmentOverdue()).isTrue();
    }

    @Test
    @DisplayName("Un compromiso de hoy todavia no esta vencido")
    void unCompromisoDeHoyTodaviaNoEstaVencido() {
        PlanningMetadataResponse respuesta = service.create(alta("8", "2026-10-06", "dev-ana"));

        assertThat(respuesta.commitmentOverdue()).isFalse();
    }

    @Test
    @DisplayName("Dos modificaciones consecutivas dejan dos entradas en orden")
    void dosModificacionesConsecutivasDejanDosEntradasEnOrden() {
        service.create(alta("8", null, "dev-ana"));
        reloj.avanzarA(AHORA.plus(Duration.ofHours(1)));
        service.update(ITEM, cambio("10", null, "dev-ana"));
        reloj.avanzarA(AHORA.plus(Duration.ofHours(2)));
        service.update(ITEM, cambio("12", null, "dev-ana"));

        assertThat(repository.findHistory(ITEM))
                .extracting(PlanningMetadataChange::previousValue,
                        PlanningMetadataChange::newValue,
                        PlanningMetadataChange::changedAt)
                .containsExactly(
                        tuple(null, "8.0000", AHORA),
                        tuple("8.0000", "10.0000", AHORA.plus(Duration.ofHours(1))),
                        tuple("10.0000", "12.0000", AHORA.plus(Duration.ofHours(2))));
    }

    @Test
    @DisplayName("Retirar la estimacion la deja en nulo y conserva el historial y el autor")
    void retirarLaEstimacionLaDejaEnNuloYConservaElHistorial() {
        service.create(alta("8", "2026-10-20", "dev-ana"));
        reloj.avanzarA(AHORA.plus(Duration.ofDays(1)));

        PlanningMetadataResponse respuesta = service.update(ITEM, cambio(null, "2026-10-20", "dev-ana"));

        assertThat(respuesta.estimatedHours()).isNull();
        assertThat(respuesta.estimatedBy()).isEqualTo("dev-ana");
        assertThat(respuesta.estimatedAt()).isEqualTo(AHORA.plus(Duration.ofDays(1)));
        assertThat(respuesta.committedDate()).isEqualTo(LocalDate.of(2026, 10, 20));

        // El borrado no borra: queda como el paso de 8.0000 a nada, con quien lo hizo y cuando.
        assertThat(repository.findHistory(ITEM))
                .extracting(PlanningMetadataChange::field,
                        PlanningMetadataChange::previousValue,
                        PlanningMetadataChange::newValue,
                        PlanningMetadataChange::changedBy)
                .containsExactly(
                        tuple(PlanningMetadataField.ESTIMATED_HOURS, null, "8.0000", "dev-ana"),
                        tuple(PlanningMetadataField.COMMITTED_DATE, null, "2026-10-20", "dev-ana"),
                        tuple(PlanningMetadataField.ESTIMATED_HOURS, "8.0000", null, "dev-ana"));
    }

    @Test
    @DisplayName("Retirar el compromiso lo deja en nulo sin tocar la estimacion")
    void retirarElCompromisoLoDejaEnNuloSinTocarLaEstimacion() {
        service.create(alta("8", "2026-10-20", "dev-ana"));
        reloj.avanzarA(AHORA.plus(Duration.ofDays(1)));

        PlanningMetadataResponse respuesta = service.update(ITEM, cambio("8", null, "gestor-luis"));

        assertThat(respuesta.committedDate()).isNull();
        assertThat(respuesta.committedBy()).isEqualTo("gestor-luis");
        assertThat(respuesta.committedAt()).isEqualTo(AHORA.plus(Duration.ofDays(1)));
        assertThat(respuesta.estimatedHours()).isEqualByComparingTo("8");
        assertThat(respuesta.estimatedAt()).isEqualTo(AHORA);
    }

    @Test
    @DisplayName("Reenviar el mismo valor no añade una fila al historial")
    void reenviarElMismoValorNoAñadeFila() {
        service.create(alta("8", "2026-10-20", "dev-ana"));
        reloj.avanzarA(AHORA.plus(Duration.ofDays(1)));

        // El mismo numero escrito de otra forma: la columna devuelve 8.0000 y la peticion trae 8.
        // Comparar por igualdad produciria un cambio fantasma.
        PlanningMetadataResponse respuesta = service.update(ITEM, cambio("8", "2026-10-20", "gestor-luis"));

        assertThat(repository.findHistory(ITEM)).hasSize(2);
        assertThat(respuesta.estimatedAt()).isEqualTo(AHORA);
        assertThat(respuesta.committedAt()).isEqualTo(AHORA);
        assertThat(respuesta.estimatedBy()).isEqualTo("dev-ana");
        assertThat(respuesta.committedBy()).isEqualTo("dev-ana");
    }

    @Test
    @DisplayName("Declarar dos veces el mismo elemento responde que ya existe")
    void declararDosVecesElMismoElementoRespondeQueYaExiste() {
        service.create(alta("8", null, "dev-ana"));

        assertThatThrownBy(() -> service.create(alta("8", null, "dev-ana")))
                .isInstanceOf(PlanningMetadataAlreadyExistsException.class);
    }

    @Test
    @DisplayName("Modificar un elemento sin planificacion responde que no existe")
    void modificarUnElementoSinPlanificacionRespondeQueNoExiste() {
        assertThatThrownBy(() -> service.update(ITEM, cambio("8", null, "dev-ana")))
                .isInstanceOf(PlanningMetadataNotFoundException.class);
    }

    private static PlanningMetadataRequest alta(String horas, String fecha, String changedBy) {
        return new PlanningMetadataRequest(ITEM, decimal(horas), fecha(fecha), changedBy);
    }

    private static PlanningMetadataUpdateRequest cambio(String horas, String fecha, String changedBy) {
        return new PlanningMetadataUpdateRequest(decimal(horas), fecha(fecha), changedBy);
    }

    private static BigDecimal decimal(String horas) {
        return horas == null ? null : new BigDecimal(horas);
    }

    private static LocalDate fecha(String fecha) {
        return fecha == null ? null : LocalDate.parse(fecha);
    }

    /**
     * Un reloj que se puede mover.
     *
     * <p>Hace falta para comprobar que un sello que no cambia <em>conserva</em> su instante en vez de
     * renovarse. Con un reloj fijo los dos valores serian el mismo y la prueba no distinguiria una
     * cosa de la otra, que es justo lo que hay que distinguir.
     */
    private static final class RelojMovil extends Clock {

        private Instant ahora = AHORA;

        void avanzarA(Instant instante) {
            this.ahora = instante;
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
            return ahora;
        }
    }
}
