package co.com.coltefinanciera.gestiondemanda.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

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
 * Pruebas del motor de planificacion.
 *
 * <p>No levantan contexto de Spring: el dominio se instancia con {@code new}. El reloj es fijo,
 * de modo que las marcas de tiempo de auditoria son verificables.
 */
class PlanningEngineTest {

    private static final LocalDate LUNES = LocalDate.of(2026, 10, 5);
    private static final LocalDate VIERNES = LocalDate.of(2026, 10, 9);
    private static final LocalDate SABADO = LocalDate.of(2026, 10, 10);
    private static final LocalDate LUNES_SIGUIENTE = LocalDate.of(2026, 10, 12);
    private static final LocalDate MARTES_SIGUIENTE = LocalDate.of(2026, 10, 13);
    private static final Instant INSTANTE_FIJO = Instant.parse("2026-10-05T08:00:00Z");
    private static final Clock CLOCK = Clock.fixed(INSTANTE_FIJO, ZoneOffset.UTC);

    /** El viernes 9 a las 08:00: la entrega es hoy y ya no queda ventana hacia atras. */
    private static final Instant VIERNES_INSTANTE = Instant.parse("2026-10-09T08:00:00Z");

    private static final Developer DEVELOPER = new Developer("dev-1", "Ana");

    /**
     * Jornada de los escenarios de este archivo: 09:00-17:00, ocho horas.
     *
     * <p>Es un fixture, no la jornada oficial (07:00-17:30). Los escenarios estan calculados sobre
     * un dia de ocho horas —un incidente de seis deja dos libres— y fijarla aqui los hace
     * independientes de la jornada que se configure. Que el motor use la oficial se comprueba en
     * {@link #laJornadaOficialEsLaQueAplicaElMotor()}.
     */
    private static final BusinessHours JORNADA_DE_PRUEBA =
            new BusinessHours(LocalTime.of(9, 0), LocalTime.of(17, 0));

    private static final WorkingCalendar CALENDARIO_DE_PRUEBA =
            new WorkingCalendar(JORNADA_DE_PRUEBA, WorkingCalendar.DEFAULT_WEEKEND, Set.of());

    private static final PlanningRules RULES = new PlanningRules(
            new BigDecimal("4"), JORNADA_DE_PRUEBA.duration(), 10, null, CALENDARIO_DE_PRUEBA);

    /** Mismo calendario que {@link #RULES}, con el lunes siguiente declarado festivo. */
    private static final PlanningRules RULES_CON_FESTIVO = new PlanningRules(
            PlanningRules.DEFAULT_INCIDENT_THRESHOLD_HOURS,
            PlanningRules.DEFAULT_WORKING_HOURS_PER_DAY,
            PlanningRules.DEFAULT_PLANNING_HORIZON_DAYS,
            null,
            new WorkingCalendar(
                    CALENDARIO_DE_PRUEBA.businessHours(),
                    WorkingCalendar.DEFAULT_WEEKEND,
                    Set.of(LUNES_SIGUIENTE)));

    private PlanningEngine engine;

    @BeforeEach
    void setUp() {
        engine = new PlanningEngine(new InMemoryRescheduleLedger(), CLOCK);
    }

    @Test
    @DisplayName("Un incidente por debajo del umbral no desplaza nada")
    void incidentePorDebajoDelUmbralNoDesplazaNada() {
        Incident menor = incident("INC-1", "2", "2026-10-05T09:00:00Z");
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(menor), List.of(requerimiento));

        assertThat(result.rescheduleEvents()).isEmpty();
        assertThat(result.conflicts()).isEmpty();
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(LUNES);
    }

    @Test
    @DisplayName("Un incidente que supera el umbral desplaza la entrega del requerimiento")
    void incidenteQueSuperaElUmbralDesplazaElRequerimiento() {
        Incident grave = incident("INC-1", "6", "2026-10-05T09:00:00Z");
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(grave), List.of(requerimiento));

        // Seis horas dejan dos libres el lunes: el requerimiento las aprovecha y cierra el martes.
        assertThat(bloquesDe(result, "REQ-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(
                        tuple(LUNES.atTime(15, 0), LUNES.atTime(17, 0)),
                        tuple(LUNES.plusDays(1).atTime(9, 0), LUNES.plusDays(1).atTime(11, 0)));
        assertThat(result.rescheduleEvents()).singleElement().satisfies(event -> {
            assertThat(event.timestamp()).isEqualTo(INSTANTE_FIJO);
            assertThat(event.incidentId()).isEqualTo("INC-1");
            assertThat(event.requirementId()).isEqualTo("REQ-1");
            assertThat(event.originalDate()).isEqualTo(LUNES);
            assertThat(event.rescheduledDate()).isEqualTo(LUNES.plusDays(1));
            assertThat(event.appliedRule()).isEqualTo(AppliedRule.UMBRAL_INCIDENTE_EXCEDIDO);
        });
    }

    @Test
    @DisplayName("Varios requerimientos se replanifican en cadena sobre los dias siguientes")
    void multiplesRequerimientosSeReplanificanEnCadena() {
        Incident grave = incident("INC-1", "6", "2026-10-05T09:00:00Z");
        List<Requirement> requerimientos = List.of(
                requirement("REQ-A", "2", LUNES, RequirementStatus.PLANIFICADO),
                requirement("REQ-B", "4", LUNES, RequirementStatus.PLANIFICADO),
                requirement("REQ-C", "6", LUNES, RequirementStatus.PLANIFICADO));

        PlanningResult result = plan(List.of(grave), requerimientos);

        assertThat(fechaDe(result, "REQ-A")).isEqualTo(LUNES);
        assertThat(fechaDe(result, "REQ-B")).isEqualTo(LUNES.plusDays(1));
        // Las cuatro horas que deja el martes no bastan para el tercero: empieza ahi y cierra el miercoles.
        assertThat(fechaDe(result, "REQ-C")).isEqualTo(LUNES.plusDays(1));
        assertThat(bloquesDe(result, "REQ-C")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(
                        tuple(LUNES.plusDays(1).atTime(13, 0), LUNES.plusDays(1).atTime(17, 0)),
                        tuple(LUNES.plusDays(2).atTime(9, 0), LUNES.plusDays(2).atTime(11, 0)));
        assertThat(result.rescheduleEvents()).hasSize(2);
    }

    @Test
    @DisplayName("Un requerimiento ya renegociado no se vuelve a desplazar")
    void requerimientoYaRenegociadoNoSeVuelveADesplazar() {
        Incident grave = incident("INC-1", "8", "2026-10-05T09:00:00Z");
        Requirement yaRenegociado =
                requirement("REQ-1", "4", LUNES, RequirementStatus.PENDIENTE_DE_RENEGOCIACION);

        PlanningResult result = plan(List.of(grave), List.of(yaRenegociado));

        assertThat(result.rescheduleEvents()).isEmpty();
        assertThat(result.allocations()).noneMatch(a -> a.workItemId().equals("REQ-1"));
    }

    @Test
    @DisplayName("Reprocesar el mismo escenario republica el mismo evento, no uno nuevo")
    void reprocesarElMismoEscenarioRepublicaElMismoEvento() {
        Incident grave = incident("INC-1", "6", "2026-10-05T09:00:00Z");
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult first = plan(List.of(grave), List.of(requerimiento));
        PlanningResult second = plan(List.of(grave), List.of(requerimiento));

        // Cada plan guarda solo sus propios eventos, asi que la segunda corrida tiene que volver a
        // publicar el desplazamiento: si no, desaparece del plan nuevo y la conciliacion del TTR se
        // queda sin nada que leer. Lo que no se duplica es la auditoria, y por eso la marca es la
        // misma: es el instante en que el desplazamiento ocurrio, no el de esta corrida.
        assertThat(second.rescheduleEvents()).singleElement()
                .isEqualTo(first.rescheduleEvents().getFirst());
        assertThat(second.rescheduleEvents().getFirst().timestamp()).isEqualTo(INSTANTE_FIJO);
        assertThat(second.allocations()).isEqualTo(first.allocations());
    }

    @Test
    @DisplayName("Varios incidentes simultaneos consumen la jornada y desbordan al dia siguiente")
    void multiplesIncidentesSimultaneosConsumenLaJornada() {
        List<Incident> incidentes = List.of(
                incident("INC-1", "5", "2026-10-05T09:00:00Z"),
                incident("INC-2", "5", "2026-10-05T10:00:00Z"));
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(incidentes, List.of(requerimiento));

        // 5 + 5 horas sobre una jornada de 8: el segundo incidente vierte 2 horas al martes.
        assertThat(fechaDe(result, "INC-1")).isEqualTo(LUNES);
        assertThat(fechaDe(result, "INC-2")).isEqualTo(LUNES);
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(LUNES.plusDays(1));
        assertThat(result.rescheduleEvents()).singleElement()
                .satisfies(event -> assertThat(event.incidentId()).isEqualTo("INC-1"));
    }

    @Test
    @DisplayName("Un incidente reportado fuera de jornada no consume el dia del reporte")
    void unIncidenteReportadoFueraDeJornadaNoConsumeElDiaDelReporte() {
        Incident grave = incident("INC-1", "6", "2026-10-05T17:30:00Z");
        Requirement jornadaCompleta = requirement("REQ-1", "8", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(grave), List.of(jornadaCompleta));

        // A las 17:30 la jornada ya cerro: el incidente arranca el martes y el lunes queda intacto.
        assertThat(bloquesDe(result, "INC-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(
                        tuple(LUNES.plusDays(1).atTime(9, 0), LUNES.plusDays(1).atTime(15, 0)));
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(LUNES);
        assertThat(result.rescheduleEvents()).isEmpty();
    }

    @Test
    @DisplayName("Un trabajo mayor que la jornada no cabe y se reporta como conflicto")
    void trabajoMayorQueLaJornadaSeReportaComoConflicto() {
        Requirement imposible = requirement("REQ-1", "100", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(), List.of(imposible));

        assertThat(result.allocations()).isEmpty();
        assertThat(result.rescheduleEvents()).isEmpty();
        assertThat(result.conflicts()).singleElement().satisfies(conflict -> {
            assertThat(conflict.workItemId()).isEqualTo("REQ-1");
            assertThat(conflict.workItemType()).isEqualTo(WorkItemType.REQUERIMIENTO);
        });
    }

    @Test
    @DisplayName("Desplazado sin incidente causante se audita como capacidad diaria excedida")
    void desplazamientoSinIncidenteCausanteSeAuditaComoCapacidadExcedida() {
        Requirement primero = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);
        Requirement segundo = requirement("REQ-2", "6", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(), List.of(primero, segundo));

        // El segundo aprovecha las cuatro horas que dejo el primero y cierra el martes.
        assertThat(bloquesDe(result, "REQ-2")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(
                        tuple(LUNES.atTime(13, 0), LUNES.atTime(17, 0)),
                        tuple(LUNES.plusDays(1).atTime(9, 0), LUNES.plusDays(1).atTime(11, 0)));
        assertThat(result.rescheduleEvents()).singleElement().satisfies(event -> {
            assertThat(event.incidentId()).isNull();
            assertThat(event.appliedRule()).isEqualTo(AppliedRule.CAPACIDAD_DIARIA_EXCEDIDA);
        });
    }

    @Test
    @DisplayName("Un incidente resuelto no consume capacidad")
    void incidenteResueltoNoConsumeCapacidad() {
        Incident resuelto = new Incident(
                "INC-1", "Incidente cerrado", new BigDecimal("6"), Instant.parse("2026-10-05T09:00:00Z"),
                IncidentStatus.RESUELTO);
        Requirement requerimiento = requirement("REQ-1", "8", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(resuelto), List.of(requerimiento));

        assertThat(result.allocations()).noneMatch(a -> a.workItemId().equals("INC-1"));
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(LUNES);
        assertThat(result.rescheduleEvents()).isEmpty();
    }

    // -----------------------------------------------------------------------
    // Priorizacion por severidad
    //
    // Escenario comun: jornada de 8 h y un requerimiento pactado para el lunes.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Caso 1 - Incidente ALTO: replanificacion inmediata aunque hubiera capacidad")
    void caso1IncidenteAltoReplanificaDeInmediato() {
        Incident alto = incident("INC-1", "4", "2026-10-05T09:00:00Z", IncidentSeverity.ALTO);
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(alto), List.of(requerimiento));

        // Cuatro horas sobre una jornada de ocho dejan hueco de sobra: el desplazamiento no lo
        // provoca la falta de capacidad, lo provoca la prioridad.
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(LUNES.plusDays(1));
        assertThat(result.rescheduleEvents()).singleElement().satisfies(event -> {
            assertThat(event.incidentId()).isEqualTo("INC-1");
            assertThat(event.appliedRule()).isEqualTo(AppliedRule.REPLANIFICACION_INMEDIATA);
            assertThat(event.severity()).isEqualTo(IncidentSeverity.ALTO);
        });
    }

    @Test
    @DisplayName("Caso 2 - Incidente MEDIO con capacidad suficiente no desplaza nada")
    void caso2IncidenteMedioConCapacidadSuficienteNoDesplaza() {
        Incident medio = incident("INC-1", "4", "2026-10-05T09:00:00Z", IncidentSeverity.MEDIO);
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(medio), List.of(requerimiento));

        assertThat(result.rescheduleEvents()).isEmpty();
        assertThat(result.conflicts()).isEmpty();
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(LUNES);
    }

    @Test
    @DisplayName("Caso 3 - Incidente MEDIO sin capacidad desplaza el requerimiento")
    void caso3IncidenteMedioSinCapacidadDesplaza() {
        Incident medio = incident("INC-1", "6", "2026-10-05T09:00:00Z", IncidentSeverity.MEDIO);
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(medio), List.of(requerimiento));

        // 6 h dejan 2 h libres: el requerimiento las usa y cierra el martes.
        assertThat(bloquesDe(result, "REQ-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(
                        tuple(LUNES.atTime(15, 0), LUNES.atTime(17, 0)),
                        tuple(LUNES.plusDays(1).atTime(9, 0), LUNES.plusDays(1).atTime(11, 0)));
        assertThat(result.rescheduleEvents()).singleElement().satisfies(event -> {
            assertThat(event.appliedRule()).isEqualTo(AppliedRule.CAPACIDAD_COMPROMETIDA);
            assertThat(event.severity()).isEqualTo(IncidentSeverity.MEDIO);
        });
    }

    @Test
    @DisplayName("Caso 4 - Incidente BAJO convive con el requerimiento en vez de desplazarlo")
    void caso4IncidenteBajoConviveConElRequerimiento() {
        Incident bajo = incident("INC-1", "6", "2026-10-05T09:00:00Z", IncidentSeverity.BAJO);
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(bajo), List.of(requerimiento));

        // El requerimiento conserva su fecha aunque las 6 h del incidente no quepan en las 4 h que
        // le quedarian libres: el que cede es el incidente, que desborda al martes. Con el
        // comportamiento de MEDIO, este mismo escenario desplazaria al requerimiento.
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(LUNES);
        assertThat(result.rescheduleEvents()).isEmpty();
        assertThat(fechaDe(result, "INC-1")).isEqualTo(LUNES);
    }

    @Test
    @DisplayName("Caso 5 - Incidente BAJO que satura el dia desplaza de forma controlada")
    void caso5IncidenteBajoSaturadoDesplazaDeFormaControlada() {
        Incident bajo = incident("INC-1", "12", "2026-10-05T09:00:00Z", IncidentSeverity.BAJO);
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(bajo), List.of(requerimiento));

        // Doce horas no caben en una jornada de ocho: el incidente ya no puede convivir con nada.
        assertThat(result.rescheduleEvents()).singleElement().satisfies(event -> {
            assertThat(event.appliedRule()).isEqualTo(AppliedRule.SATURACION);
            assertThat(event.severity()).isEqualTo(IncidentSeverity.BAJO);
        });
        // El desplazamiento es el minimo: un dia, lo justo para dejar sitio al incidente.
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(LUNES.plusDays(1));
    }

    @Test
    @DisplayName("Caso 6 - Cambiar la OLA cambia el plan sin tocar el motor")
    void caso6CambiarLaOlaCambiaElPlanSinTocarElMotor() {
        Incident bajo = incident("INC-1", "6", "2026-10-05T09:00:00Z", IncidentSeverity.BAJO);
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        // OLA vigente: BAJO convive.
        PlanningResult vigente = plan(List.of(bajo), List.of(requerimiento), RULES);
        assertThat(vigente.rescheduleEvents()).isEmpty();
        assertThat(fechaDe(vigente, "REQ-1")).isEqualTo(LUNES);

        // OLA actualizada: BAJO pasa a competir por capacidad. Mismo escenario, otro plan.
        PlanningRules olaActualizada = new PlanningRules(
                new BigDecimal("4"),
                new BigDecimal("8"),
                10,
                Map.of(
                        IncidentSeverity.BAJO,
                        new IncidentPolicy(
                                IncidentSeverity.BAJO, 30, new BigDecimal("16"), DisplacementPolicy.POR_CAPACIDAD)));

        PlanningResult actualizado = plan(List.of(bajo), List.of(requerimiento), olaActualizada);

        assertThat(fechaDe(actualizado, "REQ-1")).isEqualTo(LUNES);
        assertThat(bloquesDe(actualizado, "REQ-1")).hasSize(2);
        assertThat(actualizado.rescheduleEvents()).singleElement().satisfies(event -> {
            assertThat(event.appliedRule()).isEqualTo(AppliedRule.CAPACIDAD_COMPROMETIDA);
            assertThat(event.severity()).isEqualTo(IncidentSeverity.BAJO);
        });

        // Los objetivos de la OLA tambien viajan: la severidad no cambio, el acuerdo si.
        assertThat(olaActualizada.policyFor(IncidentSeverity.BAJO).targetResolutionHours())
                .isEqualByComparingTo("16");
        assertThat(olaActualizada.policyFor(IncidentSeverity.BAJO).targetOwnershipMinutes()).isEqualTo(30);
    }

    @Test
    @DisplayName("La OLA por defecto declara los objetivos acordados con el negocio")
    void olaPorDefectoDeclaraLosObjetivosAcordados() {
        PlanningRules defaults = PlanningRules.defaults();

        assertThat(defaults.policyFor(IncidentSeverity.ALTO).targetResolutionHours()).isEqualByComparingTo("4");
        assertThat(defaults.policyFor(IncidentSeverity.MEDIO).targetResolutionHours()).isEqualByComparingTo("8");
        assertThat(defaults.policyFor(IncidentSeverity.BAJO).targetResolutionHours()).isEqualByComparingTo("12");

        for (IncidentSeverity severity : IncidentSeverity.values()) {
            assertThat(defaults.policyFor(severity).targetOwnershipMinutes()).isEqualTo(15);
        }

        assertThat(defaults.policyFor(IncidentSeverity.ALTO).displacementPolicy())
                .isEqualTo(DisplacementPolicy.INMEDIATA);
        assertThat(defaults.policyFor(IncidentSeverity.MEDIO).displacementPolicy())
                .isEqualTo(DisplacementPolicy.POR_CAPACIDAD);
        assertThat(defaults.policyFor(IncidentSeverity.BAJO).displacementPolicy())
                .isEqualTo(DisplacementPolicy.POR_SATURACION);
    }

    @Test
    @DisplayName("Un incidente sin severidad conserva el umbral: la migracion no cambia el plan")
    void incidenteSinSeveridadConservaElComportamientoHistorico() {
        Incident sinSeveridad = incident("INC-1", "6", "2026-10-05T09:00:00Z");
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(sinSeveridad), List.of(requerimiento));

        assertThat(result.rescheduleEvents()).singleElement().satisfies(event -> {
            assertThat(event.appliedRule()).isEqualTo(AppliedRule.UMBRAL_INCIDENTE_EXCEDIDO);
            assertThat(event.severity()).isNull();
        });
    }

    // -----------------------------------------------------------------------
    // Calendario laboral
    //
    // Escenario comun: un incidente ALTO de jornada completa el viernes, y un
    // requerimiento pactado ese mismo dia que ya no tiene hueco.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Un requerimiento desplazado un viernes aterriza el lunes, no el sabado")
    void unRequerimientoDesplazadoUnViernesAterrizaElLunes() {
        Incident alto = incident("INC-1", "8", "2026-10-09T09:00:00Z", IncidentSeverity.ALTO);
        Requirement requerimiento = requirement("REQ-1", "4", VIERNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = planFrom(VIERNES_INSTANTE, List.of(alto), List.of(requerimiento));

        // El sabado y el domingo no son laborables: el primer dia con hueco esta tres dias despues.
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(LUNES_SIGUIENTE);
        assertThat(result.conflicts()).isEmpty();
    }

    @Test
    @DisplayName("Un festivo tampoco es dia laborable")
    void unFestivoTampocoEsDiaLaborable() {
        Incident alto = incident("INC-1", "8", "2026-10-09T09:00:00Z", IncidentSeverity.ALTO);
        Requirement requerimiento = requirement("REQ-1", "4", VIERNES, RequirementStatus.PLANIFICADO);

        PlanningResult result =
                planFrom(VIERNES_INSTANTE, List.of(alto), List.of(requerimiento), RULES_CON_FESTIVO);

        // Con el lunes festivo, el hueco se corre al martes: un dia mas, ni uno menos.
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(MARTES_SIGUIENTE);
    }

    @Test
    @DisplayName("La capacidad diaria sale del calendario, no de un valor declarado aparte")
    void laCapacidadDiariaSaleDelCalendario() {
        // Bloque de 07:00 a 11:00: cuatro horas de jornada, no las diez y media de la oficial.
        PlanningRules mediaJornada = new PlanningRules(new BigDecimal("4"), new BigDecimal("4"), 10);
        List<Requirement> requerimientos = List.of(
                requirement("REQ-A", "4", LUNES, RequirementStatus.PLANIFICADO),
                requirement("REQ-B", "4", LUNES, RequirementStatus.PLANIFICADO));

        PlanningResult result = plan(List.of(), requerimientos, mediaJornada);

        assertThat(mediaJornada.workingHoursPerDay()).isEqualByComparingTo("4");
        assertThat(mediaJornada.workingCalendar().businessHours().end()).isEqualTo(LocalTime.of(11, 0));
        // Con la jornada estandar los dos cabrian el lunes; con cuatro horas, el segundo espera.
        assertThat(fechaDe(result, "REQ-A")).isEqualTo(LUNES);
        assertThat(fechaDe(result, "REQ-B")).isEqualTo(LUNES.plusDays(1));
    }

    @Test
    @DisplayName("Un incidente reportado en fin de semana se ubica el lunes, no el sabado")
    void unIncidenteReportadoEnFinDeSemanaSeUbicaElLunes() {
        Incident sabado = incident("INC-1", "6", "2026-10-10T10:00:00Z", IncidentSeverity.BAJO);

        PlanningResult result = plan(List.of(sabado), List.of());

        assertThat(SABADO.getDayOfWeek()).isEqualTo(DayOfWeek.SATURDAY);
        assertThat(fechaDe(result, "INC-1")).isEqualTo(LUNES_SIGUIENTE);
    }

    // -----------------------------------------------------------------------
    // Capacidad horaria
    //
    // Escenario comun: jornada de 09:00 a 17:00. El plan ya no reparte dias, reparte franjas.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Caso limite 1 - Un incidente ALTO al final del viernes reserva solo lo que consume")
    void limite1IncidenteAltoAlFinalDelViernesReservaCapacidadParcial() {
        Incident alto = incident("INC-1", "4", "2026-10-09T16:30:00Z", IncidentSeverity.ALTO);
        Requirement requerimiento = requirement("REQ-1", "4", VIERNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(alto), List.of(requerimiento));

        // Media hora del viernes y tres y media del lunes: lo que dura el incidente, ni un minuto mas.
        assertThat(bloquesDe(result, "INC-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(
                        tuple(VIERNES.atTime(16, 30), VIERNES.atTime(17, 0)),
                        tuple(LUNES_SIGUIENTE.atTime(9, 0), LUNES_SIGUIENTE.atTime(12, 30)));
        assertThat(horasDe(result, "INC-1")).isEqualByComparingTo("4");

        // La manana del viernes nunca fue del incidente: el requerimiento la conserva entera.
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(VIERNES);
        assertThat(result.rescheduleEvents()).isEmpty();
    }

    @Test
    @DisplayName("Caso limite 2 - Dos incidentes el mismo dia ocupan bloques consecutivos")
    void limite2DosIncidentesElMismoDiaOcupanBloquesConsecutivos() {
        Incident primero = incident("INC-1", "2", "2026-10-05T09:00:00Z", IncidentSeverity.MEDIO);
        Incident segundo = incident("INC-2", "3", "2026-10-05T10:00:00Z", IncidentSeverity.MEDIO);

        PlanningResult result = plan(List.of(primero, segundo), List.of());

        assertThat(bloquesDe(result, "INC-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(tuple(LUNES.atTime(9, 0), LUNES.atTime(11, 0)));
        // El segundo no arranca a las 10:00: la jornada ya esta ocupada hasta las 11:00.
        assertThat(bloquesDe(result, "INC-2")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(tuple(LUNES.atTime(11, 0), LUNES.atTime(14, 0)));
    }

    @Test
    @DisplayName("Caso limite 3 - El requerimiento usa la capacidad que deja el incidente")
    void limite3ElRequerimientoUsaLaCapacidadRemanente() {
        Incident medio = incident("INC-1", "4", "2026-10-05T09:00:00Z", IncidentSeverity.MEDIO);
        Requirement requerimiento = requirement("REQ-1", "6", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(medio), List.of(requerimiento));

        // Cuatro horas de incidente dejan otras cuatro: el requerimiento no espera al martes para
        // empezar, empieza donde puede.
        assertThat(bloquesDe(result, "REQ-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(
                        tuple(LUNES.atTime(13, 0), LUNES.atTime(17, 0)),
                        tuple(LUNES.plusDays(1).atTime(9, 0), LUNES.plusDays(1).atTime(11, 0)));
    }

    @Test
    @DisplayName("Caso limite 4 - Un festivo intermedio no consume capacidad")
    void limite4UnFestivoIntermedioNoConsumeCapacidad() {
        Incident medio = incident("INC-1", "6", "2026-10-09T14:00:00Z", IncidentSeverity.MEDIO);

        PlanningResult result = plan(List.of(medio), List.of(), RULES_CON_FESTIVO);

        // Del viernes al lunes festivo: el trabajo lo salta sin gastarlo.
        assertThat(bloquesDe(result, "INC-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(
                        tuple(VIERNES.atTime(14, 0), VIERNES.atTime(17, 0)),
                        tuple(MARTES_SIGUIENTE.atTime(9, 0), MARTES_SIGUIENTE.atTime(12, 0)));
        assertThat(bloquesDe(result, "INC-1")).noneMatch(block -> block.date().equals(LUNES_SIGUIENTE));
    }

    @Test
    @DisplayName("Caso limite 5 - Un requerimiento de varios dias se reparte por jornadas")
    void limite5UnRequerimientoDeVariosDiasSeReparte() {
        Requirement veinte = requirement("REQ-1", "20", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(), List.of(veinte));

        assertThat(bloquesDe(result, "REQ-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(
                        tuple(LUNES.atTime(9, 0), LUNES.atTime(17, 0)),
                        tuple(LUNES.plusDays(1).atTime(9, 0), LUNES.plusDays(1).atTime(17, 0)),
                        tuple(LUNES.plusDays(2).atTime(9, 0), LUNES.plusDays(2).atTime(13, 0)));
        assertThat(horasDe(result, "REQ-1")).isEqualByComparingTo("20");
        assertThat(result.conflicts()).isEmpty();
    }

    @Test
    @DisplayName("Entregar antes de la fecha no cuenta como desplazamiento")
    void entregarAntesDeLaFechaNoSeAuditaComoDesplazamiento() {
        // Seis horas dejan dos libres el viernes, que no alcanzan para las seis del requerimiento.
        // Con la entrega como ancla, el trabajo se cierra el jueves: antes, no despues. Adelantarse
        // no incumple el compromiso, asi que no hay nada que auditar ni renegociar.
        Incident viernes = incident("INC-1", "6", "2026-10-09T09:00:00Z");
        Requirement seis = requirement("REQ-1", "6", VIERNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(viernes), List.of(seis));

        assertThat(bloquesDe(result, "REQ-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(tuple(VIERNES.minusDays(1).atTime(9, 0), VIERNES.minusDays(1).atTime(15, 0)));
        assertThat(result.rescheduleEvents()).isEmpty();
    }

    @Test
    @DisplayName("Un requerimiento de dos jornadas termina en su fecha de entrega, no empieza en ella")
    void unRequerimientoDeDosJornadasTerminaEnSuFechaDeEntrega() {
        // Dieciseis horas con entrega el martes y el reloj parado el lunes: el trabajo cabe, pero
        // solo empezando el lunes. La fecha pactada es la entrega, no el arranque.
        Requirement dieciseis = requirement("REQ-1", "16", LUNES.plusDays(1), RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(), List.of(dieciseis));

        assertThat(bloquesDe(result, "REQ-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(
                        tuple(LUNES.atTime(9, 0), LUNES.atTime(17, 0)),
                        tuple(LUNES.plusDays(1).atTime(9, 0), LUNES.plusDays(1).atTime(17, 0)));
        assertThat(result.rescheduleEvents()).isEmpty();
        assertThat(result.conflicts()).isEmpty();
    }

    @Test
    @DisplayName("Caso limite 6 - La auditoria cuenta la misma historia que la agenda")
    void limite6LaAuditoriaCuentaLaMismaHistoriaQueLaAgenda() {
        Incident grave = incident("INC-1", "6", "2026-10-05T09:00:00Z");
        Requirement requerimiento = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(grave), List.of(requerimiento));

        // La fecha auditada es la de entrega, y coincide con el ultimo bloque: el evento y la agenda
        // no pueden divergir porque salen del mismo reparto.
        assertThat(result.rescheduleEvents()).singleElement().satisfies(event -> {
            assertThat(event.originalDate()).isEqualTo(LUNES);
            assertThat(event.rescheduledDate()).isEqualTo(bloquesDe(result, "REQ-1").getLast().date());
            assertThat(event.appliedRule()).isEqualTo(AppliedRule.UMBRAL_INCIDENTE_EXCEDIDO);
        });

        // Y reprocesar el mismo escenario republica ese mismo evento: la auditoria sigue siendo una
        // sola, pero el desplazamiento no se pierde al recalcular.
        assertThat(plan(List.of(grave), List.of(requerimiento)).rescheduleEvents())
                .singleElement()
                .isEqualTo(result.rescheduleEvents().getFirst());
    }

    @Test
    @DisplayName("La reserva de prioridad de un incidente ALTO no alcanza a los dias siguientes")
    void laReservaDePrioridadNoAlcanzaALosDiasSiguientes() {
        Incident alto = incident("INC-1", "4", "2026-10-05T09:00:00Z", IncidentSeverity.ALTO);
        Requirement lunes = requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO);
        Requirement martes = requirement("REQ-2", "4", LUNES.plusDays(1), RequirementStatus.PLANIFICADO);

        PlanningResult result = plan(List.of(alto), List.of(lunes, martes));

        // El lunes es del incidente y el requerimiento de ese dia cede; el martes no es suyo.
        assertThat(fechaDe(result, "REQ-1")).isEqualTo(LUNES.plusDays(1));
        assertThat(fechaDe(result, "REQ-2")).isEqualTo(LUNES.plusDays(1));
        assertThat(bloquesDe(result, "REQ-2")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(tuple(LUNES.plusDays(1).atTime(13, 0), LUNES.plusDays(1).atTime(17, 0)));
    }

    @Test
    @DisplayName("La jornada oficial es lunes a viernes, de 07:00 a 17:30")
    void laJornadaOficialEsLaQueAplicaElMotor() {
        PlanningRules oficiales = PlanningRules.defaults();

        assertThat(oficiales.workingHoursPerDay()).isEqualByComparingTo("10.5");
        assertThat(oficiales.workingCalendar().businessHours().start()).isEqualTo(LocalTime.of(7, 0));
        assertThat(oficiales.workingCalendar().businessHours().end()).isEqualTo(LocalTime.of(17, 30));

        PlanningResult result = plan(
                List.of(),
                List.of(requirement("REQ-1", "4", LUNES, RequirementStatus.PLANIFICADO)),
                oficiales);

        // El primer bloque del dia empieza a las 07:00, no a las 09:00 del fixture.
        assertThat(bloquesDe(result, "REQ-1")).extracting(WorkBlock::start, WorkBlock::end)
                .containsExactly(tuple(LUNES.atTime(7, 0), LUNES.atTime(11, 0)));
    }

    private PlanningResult plan(List<Incident> incidents, List<Requirement> requirements) {
        return plan(incidents, requirements, RULES);
    }

    private PlanningResult plan(
            List<Incident> incidents, List<Requirement> requirements, PlanningRules rules) {
        return engine.plan(new PlanningRequest(DEVELOPER, incidents, requirements, rules));
    }

    /**
     * Planifica con el reloj detenido en {@code at}.
     *
     * <p>La entrega se busca hacia atras, pero nunca antes de hoy: adelantar el reloj al dia de la
     * entrega deja la ventana sin dias anteriores y obliga al motor a la caida hacia delante, que es
     * lo que estas pruebas del calendario quieren medir.
     */
    private PlanningResult planFrom(
            Instant at, List<Incident> incidents, List<Requirement> requirements) {
        return planFrom(at, incidents, requirements, RULES);
    }

    private PlanningResult planFrom(
            Instant at, List<Incident> incidents, List<Requirement> requirements, PlanningRules rules) {
        PlanningEngine fromAt =
                new PlanningEngine(new InMemoryRescheduleLedger(), Clock.fixed(at, ZoneOffset.UTC));
        return fromAt.plan(new PlanningRequest(DEVELOPER, incidents, requirements, rules));
    }

    private static Incident incident(String id, String hours, String reportedAt) {
        return Incident.open(id, "Incidente " + id, new BigDecimal(hours), Instant.parse(reportedAt));
    }

    private static Incident incident(String id, String hours, String reportedAt, IncidentSeverity severity) {
        return Incident.open(id, "Incidente " + id, new BigDecimal(hours), Instant.parse(reportedAt), severity);
    }

    private static Requirement requirement(String id, String hours, LocalDate plannedDate, RequirementStatus status) {
        return new Requirement(id, "Requerimiento " + id, new BigDecimal(hours), plannedDate, status);
    }

    private static LocalDate fechaDe(PlanningResult result, String workItemId) {
        return result.allocations().stream()
                .filter(allocation -> allocation.workItemId().equals(workItemId))
                .map(WorkAllocation::date)
                .findFirst()
                .orElse(null);
    }

    /** Tramos concretos de agenda de un elemento, en orden. */
    private static List<WorkBlock> bloquesDe(PlanningResult result, String workItemId) {
        return result.blocks().stream()
                .filter(block -> block.workItemId().equals(workItemId))
                .toList();
    }

    /** Jornada total que la agenda le imputa a un elemento: lo que de verdad se le cobro. */
    private static BigDecimal horasDe(PlanningResult result, String workItemId) {
        return bloquesDe(result, workItemId).stream()
                .map(WorkBlock::hours)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
