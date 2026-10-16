package co.com.coltefinanciera.gestiondemanda.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;

import jakarta.persistence.EntityManager;

import co.com.coltefinanciera.gestiondemanda.domain.PlanningEngine;
import co.com.coltefinanciera.gestiondemanda.domain.enums.AppliedRule;
import co.com.coltefinanciera.gestiondemanda.domain.enums.DisplacementPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;
import co.com.coltefinanciera.gestiondemanda.domain.idempotency.InMemoryRescheduleLedger;
import co.com.coltefinanciera.gestiondemanda.domain.model.BusinessHours;
import co.com.coltefinanciera.gestiondemanda.domain.model.Developer;
import co.com.coltefinanciera.gestiondemanda.domain.model.Incident;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanReference;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningConflict;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningContextSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningInputSnapshot;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningRequest;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningResult;
import co.com.coltefinanciera.gestiondemanda.domain.model.Requirement;
import co.com.coltefinanciera.gestiondemanda.domain.model.RescheduleEvent;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkAllocation;
import co.com.coltefinanciera.gestiondemanda.domain.model.WorkBlock;
import co.com.coltefinanciera.gestiondemanda.domain.rules.IncidentPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;
import co.com.coltefinanciera.gestiondemanda.domain.rules.WorkingCalendar;

/**
 * Pruebas del repositorio de planes.
 *
 * <p>Lo que se comprueba no es que Hibernate guarde, sino que lo guardado vuelve igual. Un plan es
 * la evidencia de una decision: si al releerlo cambia una fecha, un tipo o una regla, la evidencia
 * deja de servir.
 *
 * <p>Las horas se comparan con {@code isEqualByComparingTo} y nunca con {@code equals}:
 * {@code NUMERIC(10,4)} devuelve {@code 8.0000}, que no es igual a {@code 8} para
 * {@link BigDecimal}. Es la convencion de la casa y aqui importa mas que en ningun sitio, porque el
 * valor viene de la base de datos.
 */
@DataJpaTest
@Import(JpaPlanSnapshotRepository.class)
class JpaPlanSnapshotRepositoryTest {

    private static final Instant CREADO_EN = Instant.parse("2026-10-05T08:00:00Z");
    private static final LocalDate LUNES = LocalDate.of(2026, 10, 5);

    /** Zona del calculo. No es UTC a proposito: una zona distinta de la del sistema se nota. */
    private static final ZoneId ZONA = ZoneId.of("America/Bogota");

    /** Reloj fijo: la reproduccion de un plan exige que el instante no se mueva entre las dos corridas. */
    private static final Clock CLOCK = Clock.fixed(CREADO_EN, ZONA);

    @Autowired
    private JpaPlanSnapshotRepository repository;

    @Autowired
    private EntityManager entityManager;

    /**
     * Acceso directo a la tabla de planes.
     *
     * <p>Existe para poder fabricar un plan sin entrada, que es lo que dejo la fase anterior y lo que
     * no se puede producir por el camino normal: {@code save} siempre escribe las dos.
     */
    @Autowired
    private PlanSnapshotJpaRepository planRows;

    @Test
    @DisplayName("Un plan guardado se relee entero")
    void unPlanGuardadoSeReleeEntero() {
        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());

        assertThat(guardado.id()).isNotNull();
        assertThat(repository.exists(guardado.id())).isTrue();

        // La lectura va contra la base de datos, no contra el objeto que se acaba de guardar: los
        // agregados se arman con consultas, asi que vaciar la sesion no cambia el resultado.
        entityManager.clear();
        PlanSnapshot releido = repository.findById(guardado.id()).orElseThrow();

        assertThat(releido.id()).isEqualTo(guardado.id());
        assertThat(releido.developerId()).isEqualTo("dev-1");
        assertThat(releido.createdAt()).isEqualTo(CREADO_EN);
        // Nada se pierde por el camino: las cuatro listas del resultado vuelven con su tamano.
        assertThat(releido.result().allocations()).hasSize(2);
        assertThat(releido.result().blocks()).hasSize(2);
        assertThat(releido.result().rescheduleEvents()).hasSize(1);
        assertThat(releido.result().conflicts()).hasSize(1);
    }

    @Test
    @DisplayName("Las asignaciones vuelven con su tipo, su fecha y sus horas")
    void lasAsignacionesVuelvenConSuTipoSuFechaYSusHoras() {
        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        List<WorkAllocation> allocations = repository.findById(guardado.id()).orElseThrow()
                .result().allocations();

        assertThat(allocations)
                .extracting(
                        WorkAllocation::workItemId,
                        WorkAllocation::workItemType,
                        WorkAllocation::developerId,
                        WorkAllocation::date)
                .containsExactly(
                        tuple("INC-1", WorkItemType.INCIDENTE, "dev-1", LUNES),
                        tuple("REQ-1", WorkItemType.REQUERIMIENTO, "dev-1", LUNES.plusDays(1)));
        assertThat(allocations).extracting(WorkAllocation::hours)
                .allSatisfy(hours -> assertThat(hours).isEqualByComparingTo("4.0000"));
    }

    @Test
    @DisplayName("Los bloques vuelven con sus horas de inicio y fin y su duracion")
    void losBloquesVuelvenConSusHorasDeInicioYFinYSuDuracion() {
        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        List<WorkBlock> blocks = repository.findById(guardado.id()).orElseThrow().result().blocks();

        assertThat(blocks)
                .extracting(
                        WorkBlock::workItemId,
                        WorkBlock::workItemType,
                        WorkBlock::start,
                        WorkBlock::end)
                .containsExactly(
                        tuple(
                                "INC-1",
                                WorkItemType.INCIDENTE,
                                LUNES.atTime(9, 0),
                                LUNES.atTime(13, 0)),
                        tuple(
                                "REQ-1",
                                WorkItemType.REQUERIMIENTO,
                                LUNES.plusDays(1).atTime(9, 0),
                                LUNES.plusDays(1).atTime(13, 0)));
        assertThat(blocks).extracting(WorkBlock::hours)
                .allSatisfy(hours -> assertThat(hours).isEqualByComparingTo("4.0000"));
    }

    @Test
    @DisplayName("Un desplazamiento vuelve con su regla, su severidad y su incidente causante")
    void unDesplazamientoVuelveConSuReglaSuSeveridadYSuIncidenteCausante() {
        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        List<RescheduleEvent> events = repository.findById(guardado.id()).orElseThrow()
                .result().rescheduleEvents();

        assertThat(events).singleElement().satisfies(event -> {
            assertThat(event.timestamp()).isEqualTo(CREADO_EN);
            assertThat(event.incidentId()).isEqualTo("INC-1");
            assertThat(event.requirementId()).isEqualTo("REQ-1");
            assertThat(event.originalDate()).isEqualTo(LUNES);
            assertThat(event.rescheduledDate()).isEqualTo(LUNES.plusDays(1));
            assertThat(event.appliedRule()).isEqualTo(AppliedRule.CAPACIDAD_COMPROMETIDA);
            assertThat(event.severity()).isEqualTo(IncidentSeverity.ALTO);
        });
    }

    @Test
    @DisplayName("Un desplazamiento sin incidente causante vuelve sin el, no con un nulo disfrazado")
    void unDesplazamientoSinIncidenteCausanteVuelveSinEl() {
        // Los dos campos nulos del evento son columnas anulables de verdad. Guardarlos como cadena
        // vacia o como centinela haria que la lectura devolviera algo que el dominio nunca produjo.
        PlanningResult resultado = new PlanningResult(
                List.of(),
                List.of(),
                List.of(new RescheduleEvent(
                        CREADO_EN, null, "REQ-1", LUNES, LUNES.plusDays(1), AppliedRule.SATURACION, null)),
                List.of());

        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultado, contexto(), entrada());
        entityManager.clear();

        RescheduleEvent event = repository.findById(guardado.id()).orElseThrow()
                .result().rescheduleEvents().getFirst();

        assertThat(event.incidentId()).isNull();
        assertThat(event.severity()).isNull();
    }

    @Test
    @DisplayName("Los conflictos vuelven con su motivo")
    void losConflictosVuelvenConSuMotivo() {
        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        List<PlanningConflict> conflicts = repository.findById(guardado.id()).orElseThrow()
                .result().conflicts();

        assertThat(conflicts)
                .extracting(
                        PlanningConflict::workItemId,
                        PlanningConflict::workItemType,
                        PlanningConflict::reason)
                .containsExactly(tuple(
                        "REQ-9",
                        WorkItemType.REQUERIMIENTO,
                        "Sin capacidad en el horizonte de 10 dias"));
    }

    @Test
    @DisplayName("Los bloques de un plan no se mezclan con los de otro")
    void losBloquesDeUnPlanNoSeMezclanConLosDeOtro() {
        PlanSnapshot primero = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        PlanSnapshot segundo = repository.save("dev-2", CREADO_EN, otroResultado(), contexto(), entrada());

        assertThat(repository.findBlocks(primero.id()))
                .extracting(WorkBlock::workItemId)
                .containsExactly("INC-1", "REQ-1");
        assertThat(repository.findBlocks(segundo.id()))
                .extracting(WorkBlock::workItemId)
                .containsExactly("INC-7");
    }

    @Test
    @DisplayName("Los bloques vuelven con sus horas tal como se guardaron")
    void losBloquesVuelvenConSusHorasTalComoSeGuardaron() {
        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        assertThat(repository.findBlocks(guardado.id())).extracting(WorkBlock::hours)
                .allSatisfy(hours -> assertThat(hours).isEqualByComparingTo("4.0000"));
    }

    @Test
    @DisplayName("Un plan inexistente no se encuentra y no tiene bloques")
    void unPlanInexistenteNoSeEncuentraYNoTieneBloques() {
        UUID desconocido = UUID.randomUUID();

        assertThat(repository.exists(desconocido)).isFalse();
        assertThat(repository.findById(desconocido)).isEmpty();
        assertThat(repository.findBlocks(desconocido)).isEmpty();
    }

    @Test
    @DisplayName("El contexto de la ejecucion se guarda con el plan y vuelve entero")
    void elContextoDeLaEjecucionSeGuardaConElPlanYVuelveEntero() {
        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        PlanningContextSnapshot releido = repository.findContext(guardado.id()).orElseThrow();

        assertThat(releido.engineVersion()).isEqualTo(PlanningContextSnapshot.ENGINE_VERSION);
        assertThat(releido.calculatedAt()).isEqualTo(CREADO_EN);
        assertThat(releido.zoneId()).isEqualTo("America/Bogota");
        assertThat(releido.severities())
                .containsExactlyInAnyOrder(IncidentSeverity.ALTO, IncidentSeverity.BAJO);
    }

    @Test
    @DisplayName("Con el contexto guardado se reconstruyen las reglas que uso el motor")
    void conElContextoGuardadoSeReconstruyenLasReglasQueUsoElMotor() {
        // Es la prueba que justifica la fase: lo que se guarda no es un resumen para leer, es
        // suficiente para volver a armar el objeto de dominio que el motor recibio.
        PlanningRules originales = reglasDePrueba();
        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        PlanningRules reconstruidas = repository.findContext(guardado.id()).orElseThrow().rules();

        assertThat(reconstruidas.incidentThresholdHours())
                .isEqualByComparingTo(originales.incidentThresholdHours());
        assertThat(reconstruidas.planningHorizonDays()).isEqualTo(originales.planningHorizonDays());
        // La jornada no tiene columna propia: se deriva del bloque del calendario, y tiene que dar
        // lo mismo que declaro el motor.
        assertThat(reconstruidas.workingHoursPerDay())
                .isEqualByComparingTo(originales.workingHoursPerDay());
        assertThat(reconstruidas.workingCalendar()).isEqualTo(originales.workingCalendar());

        // La OLA se compara campo a campo y no con equals del registro: NUMERIC(10,4) devuelve
        // 2.0000, que no es igual a 2 para BigDecimal, y el registro entero fallaria por eso y no
        // por un dato perdido.
        for (IncidentSeverity severity : IncidentSeverity.values()) {
            IncidentPolicy original = originales.policyFor(severity);
            IncidentPolicy reconstruida = reconstruidas.policyFor(severity);

            assertThat(reconstruida.targetOwnershipMinutes()).isEqualTo(original.targetOwnershipMinutes());
            assertThat(reconstruida.targetResolutionHours())
                    .isEqualByComparingTo(original.targetResolutionHours());
            assertThat(reconstruida.displacementPolicy()).isEqualTo(original.displacementPolicy());
        }
    }

    @Test
    @DisplayName("El calendario vuelve con su jornada, su fin de semana y sus festivos")
    void elCalendarioVuelveConSuJornadaSuFinDeSemanaYSusFestivos() {
        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        WorkingCalendar calendario = repository.findContext(guardado.id()).orElseThrow()
                .rules().workingCalendar();

        assertThat(calendario.businessHours()).isEqualTo(new BusinessHours(
                LocalTime.of(8, 0), LocalTime.of(16, 30)));
        assertThat(calendario.weekend()).containsExactlyInAnyOrder(
                DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY);
        assertThat(calendario.holidays()).containsExactlyInAnyOrder(
                LocalDate.of(2026, 10, 12), LocalDate.of(2026, 11, 2));
        assertThat(calendario.isWorkingDay(LocalDate.of(2026, 10, 12))).isFalse();
    }

    @Test
    @DisplayName("Un contexto sin severidades ni festivos vuelve vacio, no con centinelas")
    void unContextoSinSeveridadesNiFestivosVuelveVacio() {
        // Los conjuntos vacios se guardan como cadena vacia, que es el unico valor que representa la
        // ausencia. Un centinela como "NINGUNA" haria que la lectura devolviera una severidad que el
        // dominio nunca produjo.
        PlanningContextSnapshot minimo = PlanningContextSnapshot.of(
                PlanningRules.defaults(), Set.of(), CREADO_EN, ZONA);

        PlanSnapshot guardado = repository.save("dev-1", CREADO_EN, resultadoCompleto(), minimo, entrada());
        entityManager.clear();

        PlanningContextSnapshot releido = repository.findContext(guardado.id()).orElseThrow();

        assertThat(releido.severities()).isEmpty();
        assertThat(releido.rules().workingCalendar().holidays()).isEmpty();
        assertThat(releido.rules().workingCalendar().weekend()).isEqualTo(WorkingCalendar.DEFAULT_WEEKEND);
    }

    @Test
    @DisplayName("El contexto de un plan no se mezcla con el de otro")
    void elContextoDeUnPlanNoSeMezclaConElDeOtro() {
        PlanSnapshot primero = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        PlanSnapshot segundo = repository.save(
                "dev-2", CREADO_EN, otroResultado(), PlanningContextSnapshot.of(
                        PlanningRules.defaults(), Set.of(IncidentSeverity.MEDIO), CREADO_EN, ZoneId.of("UTC")), entrada());

        assertThat(repository.findContext(primero.id()).orElseThrow().zoneId()).isEqualTo("America/Bogota");
        assertThat(repository.findContext(segundo.id()).orElseThrow().zoneId()).isEqualTo("UTC");
        assertThat(repository.findContext(segundo.id()).orElseThrow().rules().planningHorizonDays())
                .isEqualTo(PlanningRules.DEFAULT_PLANNING_HORIZON_DAYS);
    }

    @Test
    @DisplayName("Un plan inexistente no tiene contexto")
    void unPlanInexistenteNoTieneContexto() {
        assertThat(repository.findContext(UUID.randomUUID())).isEmpty();
    }

    @Test
    @DisplayName("La entrada de la ejecucion se guarda con el plan y vuelve entera")
    void laEntradaDeLaEjecucionSeGuardaConElPlanYVuelveEntera() {
        PlanSnapshot guardado = repository.save(
                "dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        PlanningInputSnapshot releida = repository.findInput(guardado.id()).orElseThrow();

        assertThat(releida.developerId()).isEqualTo("dev-1");
        assertThat(releida.incidents()).hasSize(2);
        assertThat(releida.requirements()).hasSize(2);
    }

    @Test
    @DisplayName("Los incidentes vuelven con lo que el motor lee, y sin titulo")
    void losIncidentesVuelvenConLoQueElMotorLeeYSinTitulo() {
        PlanSnapshot guardado = repository.save(
                "dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        List<Incident> incidents = repository.findInput(guardado.id()).orElseThrow().incidents();

        assertThat(incidents).extracting(Incident::id).containsExactly("INC-1", "INC-9");
        assertThat(incidents.getFirst()).satisfies(incidente -> {
            assertThat(incidente.estimatedHours()).isEqualByComparingTo("6");
            assertThat(incidente.reportedAt()).isEqualTo(CREADO_EN);
            assertThat(incidente.status()).isEqualTo(IncidentStatus.ABIERTO);
            assertThat(incidente.severity()).isEqualTo(IncidentSeverity.ALTO);
            // El titulo no se guarda porque el motor no lo lee, y vuelve nulo en lugar de con un
            // texto de relleno: lo que no se guardo no se puede inventar al releer.
            assertThat(incidente.title()).isNull();
        });
    }

    @Test
    @DisplayName("Los requerimientos vuelven con lo que el motor lee, y sin titulo")
    void losRequerimientosVuelvenConLoQueElMotorLeeYSinTitulo() {
        PlanSnapshot guardado = repository.save(
                "dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        List<Requirement> requirements = repository.findInput(guardado.id()).orElseThrow().requirements();

        assertThat(requirements).extracting(Requirement::id).containsExactly("REQ-1", "REQ-8");
        assertThat(requirements.getFirst()).satisfies(requerimiento -> {
            assertThat(requerimiento.estimatedHours()).isEqualByComparingTo("4");
            assertThat(requerimiento.plannedDate()).isEqualTo(LUNES);
            assertThat(requerimiento.status()).isEqualTo(RequirementStatus.PLANIFICADO);
            assertThat(requerimiento.title()).isNull();
        });
    }

    @Test
    @DisplayName("La entrada guarda tambien lo que el motor descarto")
    void laEntradaGuardaTambienLoQueElMotorDescarto() {
        // La foto es de lo que entro, no de lo que se uso. Un incidente resuelto y un requerimiento
        // finalizado no influyen en el calculo, pero estaban en la entrada, y guardarlos es lo que
        // permite distinguir "no influyo" de "no llego".
        PlanSnapshot guardado = repository.save(
                "dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        entityManager.clear();

        PlanningInputSnapshot releida = repository.findInput(guardado.id()).orElseThrow();

        assertThat(releida.incidents())
                .filteredOn(incidente -> !incidente.consumesCapacity())
                .extracting(Incident::id)
                .containsExactly("INC-9");
        assertThat(releida.requirements())
                .filteredOn(requerimiento -> !requerimiento.isPlannable())
                .extracting(Requirement::id)
                .containsExactly("REQ-8");
    }

    @Test
    @DisplayName("Con la entrada y el contexto guardados se vuelve a obtener el mismo plan")
    void conLaEntradaYElContextoGuardadosSeVuelveAObtenerElMismoPlan() {
        // La prueba que justifica la fase entera. Se calcula un plan, se guarda con su entrada y su
        // contexto, se suelta el resultado, y se vuelve a calcular con lo unico que sobrevive en la
        // base de datos. Si los tres no bastaran para reproducirlo, aqui se veria.
        PlanningRules reglas = reglasDePrueba();
        PlanningRequest original = peticion(reglas);
        PlanningResult calculado = motor().plan(original);

        assertThat(calculado.blocks()).isNotEmpty();
        assertThat(calculado.rescheduleEvents()).isNotEmpty();

        PlanSnapshot guardado = repository.save(
                "dev-1", CREADO_EN, calculado, contexto(), PlanningInputSnapshot.of(original));
        entityManager.clear();

        PlanningInputSnapshot entradaReleida = repository.findInput(guardado.id()).orElseThrow();
        PlanningRules reglasReleidas = repository.findContext(guardado.id()).orElseThrow().rules();

        // El nombre del desarrollador no hizo falta: el original decia "Ana" y lo reconstruido dice
        // "dev-1", porque el motor solo lee el id. Es la razon de no guardarlo, comprobada en lugar
        // de afirmada.
        assertThat(original.developer().name()).isEqualTo("Ana");
        assertThat(entradaReleida.toRequest(reglasReleidas).developer().name()).isEqualTo("dev-1");

        PlanningResult recalculado = motor().plan(entradaReleida.toRequest(reglasReleidas));

        assertThat(recalculado.allocations()).hasSameSizeAs(calculado.allocations());
        assertThat(recalculado.blocks()).hasSameSizeAs(calculado.blocks());
        assertThat(recalculado.rescheduleEvents()).hasSameSizeAs(calculado.rescheduleEvents());

        assertThat(recalculado.blocks()).zipSatisfy(calculado.blocks(), (nuevo, viejo) -> {
            assertThat(nuevo.workItemId()).isEqualTo(viejo.workItemId());
            assertThat(nuevo.start()).isEqualTo(viejo.start());
            assertThat(nuevo.end()).isEqualTo(viejo.end());
            // Las horas se comparan por valor: la ida y vuelta por NUMERIC(10,4) devuelve 6.0000
            // donde el motor produjo 6, y para BigDecimal esos dos numeros no son iguales.
            assertThat(nuevo.hours()).isEqualByComparingTo(viejo.hours());
        });

        assertThat(recalculado.rescheduleEvents()).zipSatisfy(calculado.rescheduleEvents(), (nuevo, viejo) -> {
            assertThat(nuevo.requirementId()).isEqualTo(viejo.requirementId());
            assertThat(nuevo.incidentId()).isEqualTo(viejo.incidentId());
            assertThat(nuevo.originalDate()).isEqualTo(viejo.originalDate());
            assertThat(nuevo.rescheduledDate()).isEqualTo(viejo.rescheduledDate());
            assertThat(nuevo.appliedRule()).isEqualTo(viejo.appliedRule());
            assertThat(nuevo.severity()).isEqualTo(viejo.severity());
        });
    }

    @Test
    @DisplayName("El contexto guarda las reglas y la entrada los datos: cada uno lo suyo")
    void elContextoGuardaLasReglasYLaEntradaLosDatos() {
        // Mismas reglas y distinta entrada: el contexto coincide y la entrada no. Si la entrada
        // viviera dentro del contexto —o al reves— una de las dos mitades de esta prueba fallaria.
        PlanSnapshot primero = repository.save(
                "dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        PlanSnapshot segundo = repository.save(
                "dev-2", CREADO_EN, otroResultado(), contexto(), otraEntrada());

        PlanningRules reglasPrimero = repository.findContext(primero.id()).orElseThrow().rules();
        PlanningRules reglasSegundo = repository.findContext(segundo.id()).orElseThrow().rules();

        assertThat(reglasSegundo.incidentThresholdHours())
                .isEqualByComparingTo(reglasPrimero.incidentThresholdHours());
        assertThat(reglasSegundo.planningHorizonDays()).isEqualTo(reglasPrimero.planningHorizonDays());

        assertThat(repository.findInput(primero.id()).orElseThrow().incidents())
                .extracting(Incident::id)
                .containsExactly("INC-1", "INC-9");
        assertThat(repository.findInput(segundo.id()).orElseThrow().developerId()).isEqualTo("dev-2");
        assertThat(repository.findInput(segundo.id()).orElseThrow().incidents())
                .extracting(Incident::id)
                .containsExactly("INC-7");
    }

    @Test
    @DisplayName("La entrada de un plan no se mezcla con la de otro")
    void laEntradaDeUnPlanNoSeMezclaConLaDeOtro() {
        PlanSnapshot primero = repository.save(
                "dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        PlanSnapshot segundo = repository.save(
                "dev-2", CREADO_EN, otroResultado(), contexto(), otraEntrada());

        assertThat(repository.findInput(primero.id()).orElseThrow().requirements())
                .extracting(Requirement::id)
                .containsExactly("REQ-1", "REQ-8");
        assertThat(repository.findInput(segundo.id()).orElseThrow().requirements()).isEmpty();
    }

    @Test
    @DisplayName("Un plan sin entrada registrada no tiene entrada, no una entrada vacia")
    void unPlanSinEntradaRegistradaNoTieneEntradaNoUnaEntradaVacia() {
        // Un plan calculado antes de que existiera esta tabla: su fila esta y no hay entrada. Es la
        // diferencia que sostiene la integridad historica, porque una entrada en blanco afirmaria que
        // el motor recibio una agenda vacia, y eso no consta.
        UUID antiguo = UUID.randomUUID();
        planRows.save(PlanSnapshotEntity.of(antiguo, "dev-1", CREADO_EN));
        // El flush explicito hace falta aqui y no en las demas: la escritura queda pendiente en la
        // sesion hasta que la empuja una consulta, y esta prueba no hace ninguna despues. Sin el,
        // vaciar la sesion descartaria la fila y la prueba comprobaria lo contrario de lo que dice.
        entityManager.flush();
        entityManager.clear();

        assertThat(repository.exists(antiguo)).isTrue();
        assertThat(repository.findInput(antiguo)).isEmpty();
    }

    @Test
    @DisplayName("Un escenario vacio si guarda su entrada, y se distingue de un plan sin ella")
    void unEscenarioVacioSiGuardaSuEntrada() {
        // La otra cara de la prueba anterior: aqui el motor si recibio una agenda, y estaba vacia.
        PlanningInputSnapshot vacia = new PlanningInputSnapshot("dev-1", List.of(), List.of());
        PlanSnapshot guardado = repository.save(
                "dev-1",
                CREADO_EN,
                new PlanningResult(List.of(), List.of(), List.of(), List.of()),
                contexto(),
                vacia);
        // Mismo motivo que en la prueba anterior: sin hijos que escribir no hay consulta posterior
        // que empuje la fila de entrada, y vaciar la sesion sin flush la descartaria.
        entityManager.flush();
        entityManager.clear();

        PlanningInputSnapshot releida = repository.findInput(guardado.id()).orElseThrow();

        assertThat(releida.incidents()).isEmpty();
        assertThat(releida.requirements()).isEmpty();
        assertThat(releida.developerId()).isEqualTo("dev-1");
    }

    @Test
    @DisplayName("Un plan inexistente no tiene entrada")
    void unPlanInexistenteNoTieneEntrada() {
        assertThat(repository.findInput(UUID.randomUUID())).isEmpty();
    }

    /**
     * La vigencia, que es lo que decide con que plan se cuenta la capacidad.
     *
     * <p>Un desarrollador acumula planes —cada vez que se planifica se guarda uno—, y sumarlos todos
     * contaria su jornada tantas veces como veces se haya planificado. Lo que se quiere saber es con
     * que plan se trabaja hoy, y eso es el ultimo que se guardo.
     *
     * <p>El sello se fija a mano, y por eso esta prueba vive aqui y no en la del endpoint: {@code save}
     * lo recibe como parametro, asi que la vigencia se puede afirmar sin depender del reloj.
     */
    @Test
    @DisplayName("El plan vigente de un desarrollador es el ultimo que se guardo")
    void elPlanVigenteEsElUltimoQueSeGuardo() {
        PlanSnapshot viejo = repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        PlanSnapshot nuevo = repository.save(
                "dev-1", CREADO_EN.plusSeconds(3600), otroResultado(), contexto(), entrada());

        assertThat(repository.findLatestPerDeveloper())
                .extracting(PlanReference::planId)
                .containsExactly(nuevo.id());
        // Y el viejo sigue guardado: deja de ser el vigente, no desaparece. La auditoria y la
        // reproducibilidad cuentan con el.
        assertThat(repository.exists(viejo.id())).isTrue();
        assertThat(repository.count()).isEqualTo(2);
    }

    /**
     * El empate de sello, que es el caso raro y el que decide si la respuesta es estable.
     *
     * <p>Dos planes guardados en el mismo instante no tienen un «mas reciente» que valga, y el
     * desempate cae en el identificador, que es aleatorio. Lo que se afirma no es cual gana —no hay
     * nada que afirmar— sino que gane siempre el mismo: dos llamadas devuelven la misma referencia.
     * Un desempate que cambiara entre llamadas haria que la capacidad de un desarrollador bailara sin
     * que nadie hubiera planificado nada.
     */
    @Test
    @DisplayName("Dos planes con el mismo sello dejan un solo vigente, y siempre el mismo")
    void dosPlanesConElMismoSelloDejanUnSoloVigente() {
        repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        repository.save("dev-1", CREADO_EN, otroResultado(), contexto(), entrada());

        List<PlanReference> primera = repository.findLatestPerDeveloper();
        List<PlanReference> segunda = repository.findLatestPerDeveloper();

        assertThat(primera).hasSize(1);
        assertThat(segunda).isEqualTo(primera);
    }

    @Test
    @DisplayName("Sale un vigente por desarrollador, ordenados por identificador")
    void saleUnVigentePorDesarrolladorOrdenado() {
        repository.save("dev-b", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        repository.save("dev-a", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        repository.save("dev-b", CREADO_EN.plusSeconds(60), otroResultado(), contexto(), entrada());

        // Tres planes y dos desarrolladores: el orden es por identificador y no el que devuelva el
        // mapa, para que dos llamadas devuelvan la misma lista y no solo el mismo contenido.
        assertThat(repository.findLatestPerDeveloper())
                .extracting(PlanReference::developerId)
                .containsExactly("dev-a", "dev-b");
        assertThat(repository.count()).isEqualTo(3);
    }

    @Test
    @DisplayName("Sin planes no hay ningun vigente y la cuenta es cero")
    void sinPlanesNoHayNingunVigente() {
        assertThat(repository.findLatestPerDeveloper()).isEmpty();
        assertThat(repository.count()).isZero();
    }

    /**
     * El historial de un desarrollador, que es la lectura que faltaba.
     *
     * <p>La vigencia de arriba contesta «con que plan se trabaja hoy» y tira el resto. Hay una pregunta
     * que necesita justo lo que tira —que cambio entre este plan y el anterior— y sin esta lectura «el
     * plan anterior de un tecnico» no es una cosa nombrable. Lo que se comprueba aqui es que la lista
     * este bien formada: ordenada por sello, con la suya sola y con los tres campos de cada fila.
     */
    @Test
    @DisplayName("El historial de un desarrollador sale del mas antiguo al mas reciente, y solo el suyo")
    void elHistorialDeUnDesarrolladorSaleDelMasAntiguoAlMasReciente() {
        // Se guardan al reves a proposito: si el orden lo pusiera el orden de guardado, esta prueba
        // pasaria por casualidad y no diria nada sobre el sello.
        PlanSnapshot tercero = repository.save(
                "dev-1", CREADO_EN.plusSeconds(7200), resultadoCompleto(), contexto(), entrada());
        PlanSnapshot primero = repository.save(
                "dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());
        // El de otro desarrollador se guarda en medio: es el que tiene que quedarse fuera.
        repository.save("dev-2", CREADO_EN.plusSeconds(60), otroResultado(), contexto(), entrada());
        PlanSnapshot segundo = repository.save(
                "dev-1", CREADO_EN.plusSeconds(3600), otroResultado(), contexto(), entrada());

        assertThat(repository.findByDeveloper("dev-1"))
                .extracting(PlanReference::planId)
                .containsExactly(primero.id(), segundo.id(), tercero.id());
        // Cada fila trae su tecnico, que es lo que permite saber que la lista es de alguien y no una
        // tabla de planes recortada.
        assertThat(repository.findByDeveloper("dev-1"))
                .extracting(PlanReference::developerId)
                .containsOnly("dev-1");
    }

    /**
     * Un tecnico sin planes no es un error.
     *
     * <p>Este puerto no sabe si un identificador corresponde a alguien —el padron de personas vive en
     * otra capa y se resuelve contra GLPI—, asi que lo unico que puede afirmar es «no tiene planes», y
     * lo afirma con una lista vacia. Devolver un {@code Optional} o fallar obligaria a quien llama a
     * decidir sobre algo que aqui no se sabe.
     */
    @Test
    @DisplayName("Un desarrollador sin planes tiene un historial vacio, no un error")
    void unDesarrolladorSinPlanesTieneUnHistorialVacio() {
        repository.save("dev-1", CREADO_EN, resultadoCompleto(), contexto(), entrada());

        // Las dos formas de no tener nada: un tecnico que existe en otra tabla y uno que no existe.
        assertThat(repository.findByDeveloper("dev-2")).isEmpty();
        assertThat(repository.findByDeveloper("nadie")).isEmpty();
    }

    /**
     * La entrada de las pruebas.
     *
     * <p>Lleva cuatro elementos y no dos a proposito: un incidente resuelto y un requerimiento
     * finalizado que el motor descarta. Son los que comprueban que la foto es de lo que entro.
     */
    private static PlanningInputSnapshot entrada() {
        return new PlanningInputSnapshot(
                "dev-1",
                List.of(
                        new Incident(
                                "INC-1",
                                "Falla en produccion",
                                new BigDecimal("6"),
                                CREADO_EN,
                                IncidentStatus.ABIERTO,
                                IncidentSeverity.ALTO),
                        new Incident(
                                "INC-9",
                                "Ya resuelto",
                                new BigDecimal("2"),
                                CREADO_EN,
                                IncidentStatus.RESUELTO,
                                null)),
                List.of(
                        new Requirement(
                                "REQ-1",
                                "Ajuste de reporte",
                                new BigDecimal("4"),
                                LUNES,
                                RequirementStatus.PLANIFICADO),
                        new Requirement(
                                "REQ-8",
                                "Ya entregado",
                                new BigDecimal("3"),
                                LUNES,
                                RequirementStatus.FINALIZADO)));
    }

    /** Entrada de otro plan: otro desarrollador, otro incidente y ningun requerimiento. */
    private static PlanningInputSnapshot otraEntrada() {
        return new PlanningInputSnapshot(
                "dev-2",
                List.of(new Incident(
                        "INC-7", null, new BigDecimal("1"), CREADO_EN, IncidentStatus.ABIERTO, null)),
                List.of());
    }

    /** La peticion que produjo {@link #entrada()}, con el nombre real del desarrollador. */
    private static PlanningRequest peticion(PlanningRules rules) {
        PlanningInputSnapshot foto = entrada();
        return new PlanningRequest(
                new Developer(foto.developerId(), "Ana"), foto.incidents(), foto.requirements(), rules);
    }

    /**
     * Un motor con reloj fijo y registro de idempotencia propio.
     *
     * <p>Cada llamada devuelve uno nuevo, y es deliberado: la reproduccion tiene que volver a auditar
     * el desplazamiento, y con el registro compartido la segunda corrida saldria sin eventos —que es
     * lo correcto en produccion y aqui taparia justo lo que se quiere comprobar.
     */
    private static PlanningEngine motor() {
        return new PlanningEngine(new InMemoryRescheduleLedger(), CLOCK);
    }

    /**
     * El contexto de las pruebas.
     *
     * <p>Declara una configuracion distinta de la estandar a proposito: con los valores por defecto,
     * una lectura que no guardara nada y devolviera {@code PlanningRules.defaults()} pasaria la
     * prueba. Con estos valores, no.
     */
    private static PlanningContextSnapshot contexto() {
        return PlanningContextSnapshot.of(
                reglasDePrueba(), Set.of(IncidentSeverity.ALTO, IncidentSeverity.BAJO), CREADO_EN, ZONA);
    }

    /**
     * Reglas con las que se calculo, distintas de las de por defecto en todos los campos.
     *
     * <p>Solo declara dos de las tres severidades: {@code MEDIO} queda sin declarar y tiene que
     * volver con su valor por defecto, que es el camino que recorre una configuracion parcial.
     */
    private static PlanningRules reglasDePrueba() {
        WorkingCalendar calendario = new WorkingCalendar(
                new BusinessHours(LocalTime.of(8, 0), LocalTime.of(16, 30)),
                Set.of(DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY),
                Set.of(LocalDate.of(2026, 10, 12), LocalDate.of(2026, 11, 2)));

        return new PlanningRules(
                new BigDecimal("6"),
                new BigDecimal("8.5"),
                15,
                Map.of(
                        IncidentSeverity.ALTO,
                        new IncidentPolicy(
                                IncidentSeverity.ALTO, 10, new BigDecimal("2"), DisplacementPolicy.POR_CAPACIDAD),
                        IncidentSeverity.BAJO,
                        new IncidentPolicy(
                                IncidentSeverity.BAJO, 30, new BigDecimal("20"), DisplacementPolicy.POR_SATURACION)),
                calendario);
    }

    private static PlanningResult resultadoCompleto() {
        return new PlanningResult(
                List.of(
                        new WorkAllocation("INC-1", WorkItemType.INCIDENTE, "dev-1", LUNES, new BigDecimal("4")),
                        new WorkAllocation(
                                "REQ-1",
                                WorkItemType.REQUERIMIENTO,
                                "dev-1",
                                LUNES.plusDays(1),
                                new BigDecimal("4"))),
                List.of(
                        new WorkBlock(
                                "INC-1",
                                WorkItemType.INCIDENTE,
                                "dev-1",
                                LUNES.atTime(9, 0),
                                LUNES.atTime(13, 0),
                                new BigDecimal("4")),
                        new WorkBlock(
                                "REQ-1",
                                WorkItemType.REQUERIMIENTO,
                                "dev-1",
                                LUNES.plusDays(1).atTime(9, 0),
                                LUNES.plusDays(1).atTime(13, 0),
                                new BigDecimal("4"))),
                List.of(new RescheduleEvent(
                        CREADO_EN,
                        "INC-1",
                        "REQ-1",
                        LUNES,
                        LUNES.plusDays(1),
                        AppliedRule.CAPACIDAD_COMPROMETIDA,
                        IncidentSeverity.ALTO)),
                List.of(new PlanningConflict(
                        "REQ-9",
                        WorkItemType.REQUERIMIENTO,
                        "Sin capacidad en el horizonte de 10 dias")));
    }

    private static PlanningResult otroResultado() {
        return new PlanningResult(
                List.of(),
                List.of(new WorkBlock(
                        "INC-7",
                        WorkItemType.INCIDENTE,
                        "dev-2",
                        LUNES.atTime(9, 0),
                        LUNES.atTime(10, 0),
                        new BigDecimal("1"))),
                List.of(),
                List.of());
    }
}
