package co.com.coltefinanciera.gestiondemanda.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.domain.enums.DeclaredGap;
import co.com.coltefinanciera.gestiondemanda.domain.enums.TimelineItemStatus;
import co.com.coltefinanciera.gestiondemanda.domain.model.DeclaredPlanningMetrics;
import co.com.coltefinanciera.gestiondemanda.domain.model.PlanReference;
import co.com.coltefinanciera.gestiondemanda.domain.repository.PlanSnapshotRepository;
import co.com.coltefinanciera.gestiondemanda.domain.repository.PlanningMetadataRepository;
import co.com.coltefinanciera.gestiondemanda.dto.DeclaredGapDetailResponse;
import co.com.coltefinanciera.gestiondemanda.dto.DisplacedRequirementsResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningOperationalMetricsResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningSimulationResponse;
import co.com.coltefinanciera.gestiondemanda.dto.TimelinePlanResponse;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiDiscardReason;

/**
 * La fotografia operativa de la planificacion.
 *
 * <p><strong>No recalcula nada.</strong> No ejecuta el motor, no genera planes y no consulta GLPI.
 * Todo sale de lo ya persistido: la planificacion declarada, las filas de los planes, y la agenda de
 * cada plan vigente. Su oficio es el mismo que el de {@link PlanningService}: traducir. Aqui traduce
 * lo guardado a numeros.
 *
 * <p><strong>La capacidad no se re-deriva: se lee del timeline.</strong> {@link #metrics} llama a
 * {@link PlanningService#timeline} por cada plan vigente y suma lo que esa proyeccion ya devuelve.
 * La alternativa —extraer el calculo de capacidad a un ayudante compartido— obligaria a sacar de
 * {@code PlanningService} tres metodos privados que sostienen el contrato del timeline, y el
 * servicio de metricas tendria que reproducir de todos modos el calculo de la ventana. A cambio de
 * no hacerlo, la garantia es la mas fuerte posible: <em>las metricas salen del mismo camino que
 * pinta la interfaz, asi que no pueden discrepar de ella</em>.
 *
 * <p><strong>Sin transaccion, y es deliberado.</strong> Envolver {@link #metrics} mantendria una
 * sesion abierta mientras se leen N planes y se serializa la respuesta, que es justo lo que
 * {@code JpaPlanSnapshotRepository} documenta que evita. Cada lectura abre y cierra la suya.
 *
 * <p><strong>Un plan vigente roto tumba la fotografia entera.</strong> Si a un plan le falta el
 * contexto o la entrada con los que se decidio, {@link PlanningService#timeline} responde que no
 * existe y ese {@code 404} sale de aqui sin recortarlo. Saltarse a ese desarrollador daria un total
 * incompleto en silencio, que es peor que un error: nadie sabria que falta. Hoy no puede pasar
 * —se guardan en la misma transaccion—, y si pasara, es lo que hay que ver.
 */
@Service
@RequiredArgsConstructor
public class PlanningMetricsService {

    private final PlanningService planningService;
    private final PlanSnapshotRepository planSnapshots;
    private final PlanningMetadataRepository metadata;
    private final Clock clock;

    /** La fotografia de ahora mismo. */
    public PlanningOperationalMetricsResponse metrics() {
        List<PlanningOperationalMetricsResponse.DeveloperCurrent> byDeveloper =
                planSnapshots.findLatestPerDeveloper().stream()
                        .map(this::currentOf)
                        .toList();

        return new PlanningOperationalMetricsResponse(
                Instant.now(clock),
                declaredOf(metadata.declaredMetrics()),
                plansOf(planSnapshots.count()),
                currentOf(byDeveloper));
    }

    /**
     * Lo declarado, contado, con los codigos que la capa anticorrupcion ya usa.
     *
     * <p>Los dos codigos se toman del enum y no se escriben aqui. Un descarte y una metrica que
     * nombran la misma carencia tienen que nombrarla igual, y la unica forma de garantizarlo es que
     * haya un solo sitio donde este escrito.
     */
    private static PlanningOperationalMetricsResponse.Declared declaredOf(
            DeclaredPlanningMetrics declared) {

        return new PlanningOperationalMetricsResponse.Declared(
                PlanningOperationalMetricsResponse.Declared.SOURCE,
                PlanningOperationalMetricsResponse.Declared.SCOPE,
                declared.total(),
                declared.plannable(),
                new PlanningOperationalMetricsResponse.DeclaredGap(
                        GlpiDiscardReason.SIN_ESTIMACION_DECLARADA, declared.withoutEstimation()));
    }

    private static PlanningOperationalMetricsResponse.Plans plansOf(long generated) {
        return new PlanningOperationalMetricsResponse.Plans(
                PlanningOperationalMetricsResponse.Plans.SOURCE,
                PlanningOperationalMetricsResponse.Plans.SCOPE,
                generated);
    }

    /**
     * El bloque de lo vigente: el detalle por desarrollador y la union de todos.
     *
     * <p>La ventana de arriba es la union de las ventanas, y sale de los propios planes en vez de
     * inventarse desde el horizonte configurado: el horizonte dice cuantos dias miro el motor, no
     * desde cuando, y esa fecha de inicio no se guarda.
     */
    private static PlanningOperationalMetricsResponse.Current currentOf(
            List<PlanningOperationalMetricsResponse.DeveloperCurrent> byDeveloper) {

        LocalDate from = byDeveloper.stream()
                .map(PlanningOperationalMetricsResponse.DeveloperCurrent::from)
                .filter(Objects::nonNull)
                .min(Comparator.naturalOrder())
                .orElse(null);
        LocalDate to = byDeveloper.stream()
                .map(PlanningOperationalMetricsResponse.DeveloperCurrent::to)
                .filter(Objects::nonNull)
                .max(Comparator.naturalOrder())
                .orElse(null);

        return new PlanningOperationalMetricsResponse.Current(
                PlanningOperationalMetricsResponse.Current.SOURCE,
                PlanningOperationalMetricsResponse.Current.SCOPE,
                from,
                to,
                sum(byDeveloper.stream()
                        .map(PlanningOperationalMetricsResponse.DeveloperCurrent::capacity)
                        .toList()),
                byDeveloper.stream()
                        .mapToLong(PlanningOperationalMetricsResponse.DeveloperCurrent::displacedRequirements)
                        .sum(),
                byDeveloper);
    }

    /** El plan vigente de un desarrollador, con su capacidad contada por el timeline. */
    private PlanningOperationalMetricsResponse.DeveloperCurrent currentOf(PlanReference reference) {
        TimelinePlanResponse timeline = planningService.timeline(reference.planId());

        return new PlanningOperationalMetricsResponse.DeveloperCurrent(
                reference.developerId(),
                reference.planId(),
                reference.createdAt(),
                timeline.from(),
                timeline.to(),
                sum(timeline.resources().stream()
                        .map(TimelinePlanResponse.TimelineResource::capacity)
                        .flatMap(List::stream)
                        .map(capacidad -> new PlanningOperationalMetricsResponse.Capacity(
                                capacidad.availableHours(),
                                capacidad.occupiedHours(),
                                capacidad.remainingHours()))
                        .toList()),
                displacedOf(timeline));
    }

    /**
     * Cuantos requerimientos distintos quedaron desplazados en un plan.
     *
     * <p>Se cuentan elementos y no tramos: un requerimiento que ocupa dos dias aparece dos veces en la
     * agenda y se movio una sola. El timeline marca cada tramo con su estado de planificacion, asi que
     * basta con agrupar los marcados como desplazados —que es ademas la misma definicion que usa la
     * interfaz para pintarlos de otro color.
     *
     * <p>La cuenta y el listado del detalle salen de {@link #displacedItems}, y no de dos recorridos
     * parecidos: asi la tarjeta y la pagina a la que lleva no pueden discrepar ni hoy ni el dia que
     * alguien añada un estado nuevo.
     */
    private static long displacedOf(TimelinePlanResponse timeline) {
        return displacedItems(timeline).size();
    }

    /**
     * Los tramos desplazados de un plan, agrupados por el elemento al que pertenecen.
     *
     * <p>El mapa conserva el orden de encuentro —{@code LinkedHashMap} y no un {@code groupingBy}
     * suelto—, asi que los elementos salen en el orden en que aparecen en la agenda: dos listados
     * iguales se pueden comparar, con los ojos o con una prueba.
     */
    private static Map<String, List<TimelinePlanResponse.TimelineItem>> displacedItems(
            TimelinePlanResponse timeline) {

        return timeline.items().stream()
                .filter(item -> item.planningStatus() == TimelineItemStatus.DESPLAZADO)
                .collect(Collectors.groupingBy(
                        TimelinePlanResponse.TimelineItem::workItemId,
                        LinkedHashMap::new,
                        Collectors.toList()));
    }

    /**
     * El desglose de una de las tres carencias declaradas: las filas que la tarjeta esta contando.
     *
     * <p>No recalcula la metrica, la abre. El contador y la lista salen del mismo predicado sobre la
     * misma tabla, asi que el numero de elementos es el numero de la tarjeta por construccion, no por
     * coincidencia. Los dos textos de procedencia se toman prestados de las constantes que la
     * fotografia ya publica: si el origen del bloque cambia, cambia en los dos sitios a la vez.
     */
    public DeclaredGapDetailResponse declaredGap(DeclaredGap gap) {
        // Una sola lectura del reloj para toda la lista: pedirlo por fila daria dos fechas distintas
        // a la misma lista si la peticion cruzara la medianoche.
        LocalDate today = LocalDate.now(clock);

        return new DeclaredGapDetailResponse(
                gap,
                codeOf(gap),
                PlanningOperationalMetricsResponse.Declared.SOURCE,
                PlanningOperationalMetricsResponse.Declared.SCOPE,
                Instant.now(clock),
                metadata.findByDeclaredGap(gap).stream()
                        .map(row -> PlanningMetadataResponse.of(row, today))
                        .toList());
    }

    /**
     * Los requerimientos desplazados, con su causa.
     *
     * <p>Las filas salen del timeline y el motivo del plan, y no al reves: es el timeline quien marca
     * que un elemento esta desplazado —lo hace a partir de los eventos—, asi que listar los eventos
     * daria por desplazado algo que la tarjeta no cuenta y el enlace prometeria de mas. El plan solo
     * aporta el texto de la causa, que ya deriva el mismo para su propia lectura.
     *
     * <p><strong>El plan se lee solo para quien tiene algo desplazado.</strong> La mayoria de los
     * desarrolladores no tiene ninguno, y pedirlo para todos seria una lectura por cabeza a cambio de
     * nada. Aun asi esto cuesta dos lecturas por cada desarrollador con desplazamientos —el timeline y
     * el plan—, que es el precio de que la lista y la tarjeta no puedan discrepar.
     */
    public DisplacedRequirementsResponse displaced() {
        List<DisplacedRequirementsResponse.Element> elements = new ArrayList<>();

        for (PlanReference reference : planSnapshots.findLatestPerDeveloper()) {
            Map<String, List<TimelinePlanResponse.TimelineItem>> displaced =
                    displacedItems(planningService.timeline(reference.planId()));

            if (displaced.isEmpty()) {
                continue;
            }

            List<PlanningSimulationResponse.RescheduleEventView> events =
                    planningService.findPlan(reference.planId()).rescheduleEvents();

            for (String workItemId : displaced.keySet()) {
                elements.add(new DisplacedRequirementsResponse.Element(
                        reference.developerId(),
                        reference.planId(),
                        reference.createdAt(),
                        workItemId,
                        events.stream()
                                .filter(event -> workItemId.equals(event.requirementId()))
                                .toList()));
            }
        }

        return new DisplacedRequirementsResponse(
                PlanningOperationalMetricsResponse.Current.SOURCE,
                PlanningOperationalMetricsResponse.Current.SCOPE,
                Instant.now(clock),
                elements);
    }

    /**
     * El codigo con el que se nombra una carencia declarada.
     *
     * <p>El codigo existe una sola vez, en el enum de descartes; aqui solo se elige cual. Sin rama
     * por defecto, como el {@code switch} del adaptador: añadir una carencia deja de compilar en vez
     * de responder sin codigo.
     */
    private static GlpiDiscardReason codeOf(DeclaredGap gap) {
        return switch (gap) {
            case SIN_ESTIMACION -> GlpiDiscardReason.SIN_ESTIMACION_DECLARADA;
        };
    }

    /**
     * Suma un conjunto de capacidades, publicando el total como se publican las horas.
     *
     * <p>Sumar valores ya limpios vuelve a ensuciarlos: {@code 8.5 + 8.5} da {@code 17.0}. Por eso
     * el total se limpia otra vez con el mismo ayudante que usa el timeline, y no con uno propio.
     */
    private static PlanningOperationalMetricsResponse.Capacity sum(
            List<PlanningOperationalMetricsResponse.Capacity> capacities) {

        BigDecimal available = BigDecimal.ZERO;
        BigDecimal occupied = BigDecimal.ZERO;
        BigDecimal remaining = BigDecimal.ZERO;

        for (PlanningOperationalMetricsResponse.Capacity capacity : capacities) {
            available = available.add(capacity.availableHours());
            occupied = occupied.add(capacity.occupiedHours());
            remaining = remaining.add(capacity.remainingHours());
        }

        return new PlanningOperationalMetricsResponse.Capacity(
                PlanningService.published(available),
                PlanningService.published(occupied),
                PlanningService.published(remaining));
    }
}
