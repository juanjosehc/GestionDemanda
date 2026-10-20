package co.com.coltefinanciera.gestiondemanda.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import co.com.coltefinanciera.gestiondemanda.domain.enums.AppliedRule;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.TimelineItemStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;

/**
 * Salida de {@code GET /api/planning/{planId}/timeline}: la agenda de un plan guardado, con su
 * capacidad, lista para pintar.
 *
 * <p><strong>Es una proyeccion de lectura, no un calculo.</strong> No se ejecuta el motor en ningun
 * punto: todo sale de lo que ya estaba guardado —los bloques y las asignaciones del plan, la foto de
 * su entrada y el contexto congelado con el que se decidio—. Lo unico que se deriva es la capacidad,
 * que es aritmetica de calendario sobre los tramos que ya existen.
 *
 * <p><strong>Que responde que no respondia ninguna lectura anterior.</strong> {@code /{planId}} da el
 * plan entero y {@code /{planId}/blocks} da los tramos, pero contestar «que ocupa esta franja y
 * cuanto queda libre ese dia» exigia tres llamadas y una cuenta en el navegador. Aqui las dos
 * preguntas vienen juntas y ya resueltas.
 *
 * <p><strong>Reproducible por construccion.</strong> El mismo {@code planId} devuelve siempre lo
 * mismo, hoy y dentro de un ano: las horas y el compromiso salen de la foto de la entrada, no de la
 * planificacion declarada de hoy, y ningun valor depende del reloj. Un plan se lee como quedo, no
 * como estan los tickets ahora.
 *
 * <p><strong>La forma admite un equipo; el endpoint sirve un plan.</strong> Cada plan es de un solo
 * desarrollador, asi que hoy {@code resources} trae un elemento. Se modela igualmente como coleccion
 * para que una vista de equipo agregue varias respuestas sin que el contrato cambie — que es lo que
 * pide «preparado para Resource Planning». Lo que <em>no</em> se hace aqui es decidir cual manda
 * cuando un desarrollador tiene varios planes guardados: eso es consolidacion, y no esta resuelto.
 *
 * @param planId      el plan del que sale esta lectura.
 * @param developerId el desarrollador del plan, tal como quedo en su entrada.
 * @param from        primer dia de la ventana, o {@code null} si el plan no tiene agenda.
 * @param to          ultimo dia de la ventana, o {@code null} si el plan no tiene agenda.
 * @param resources   un recurso por desarrollador con tramos, con su capacidad dia a dia.
 * @param items       los tramos, ordenados por inicio.
 * @param allocations lo pactado por elemento, para no perder el total al mirar los tramos.
 */
public record TimelinePlanResponse(
        UUID planId,
        String developerId,
        LocalDate from,
        LocalDate to,
        List<TimelineResource> resources,
        List<TimelineItem> items,
        List<PlanningSimulationResponse.Allocation> allocations) {

    /**
     * Un desarrollador con su capacidad dia a dia.
     *
     * <p>Lleva solo el identificador. El nombre, el rol y la jornada semanal <em>no</em> viajan: no
     * estan guardados —la foto de la entrada conserva el identificador del desarrollador porque es lo
     * unico que el motor lee— y no se inventan aqui. Quien pinte la fila los resuelve por su cuenta.
     *
     * <p>La capacidad cubre todos los dias de la ventana del plan, no solo los que tienen trabajo,
     * para que el frontend alinee las filas sin rellenar huecos.
     */
    public record TimelineResource(String developerId, List<TimelineCapacity> capacity) {
    }

    /**
     * Cuanto cabe, cuanto esta ocupado y cuanto queda en una fecha.
     *
     * <p>Los tres terminos salen de datos guardados: lo disponible de la jornada que declara el
     * calendario congelado del plan, y lo ocupado de sumar los tramos que caen en ese dia. Un dia no
     * laborable tiene disponible cero.
     *
     * <p>El restante <strong>no se recorta a cero</strong>. El motor nunca sobrepasa la jornada, asi
     * que un negativo no deberia ocurrir; si ocurriera, significaria que el plan contradice su propio
     * contexto, y es mejor que se vea a que se esconda detras de un cero.
     */
    public record TimelineCapacity(
            LocalDate date,
            BigDecimal availableHours,
            BigDecimal occupiedHours,
            BigDecimal remainingHours) {
    }

    /**
     * Un tramo de agenda con todo lo que hace falta para pintarlo sin pedir nada mas.
     *
     * <p><strong>Las horas estimadas y la fecha compromiso son las de la foto, no las de hoy.</strong>
     * El compromiso de un incidente sale {@code null} y no es un olvido: {@code planning_input_incident}
     * no guarda fecha compromiso, porque en un incidente el compromiso fue una puerta de
     * planificabilidad y no una entrada del calculo. Rellenarlo desde la declaracion viva romperia la
     * reproducibilidad y haria que el mismo plan se leyera distinto manana.
     *
     * <p><strong>Trazabilidad.</strong> {@code workBlockId} «o equivalente» es la pareja
     * {@code workItemId} + {@code startsAt}: un bloque no tiene identificador propio por diseno, se
     * reconoce por el elemento y el instante en que arranca. Con {@code sourcePlanId} y la lista de
     * asignaciones de la respuesta, cada tramo llega hasta su origen —el plan, el elemento, lo pactado
     * y lo que entro al motor— sin duplicar eventos ni copiar la foto entera.
     *
     * @param durationHours horas que consume <em>este tramo</em>, no el total del elemento. Un
     *                      requerimiento de veinte horas son tres tramos, y cada uno trae las suyas.
     * @param estimatedHours total estimado del elemento, de la foto de la entrada.
     * @param committedDate fecha compromiso del elemento, de la foto. Nula en incidentes.
     * @param severity      severidad del incidente, de la foto. Nula en requerimientos.
     * @param displacement  por que este elemento cambio de fecha, o {@code null} si no se movio. Es
     *                      la auditoria del plan puesta al lado del tramo, sin repetirla.
     */
    public record TimelineItem(
            String workItemId,
            WorkItemType workItemType,
            LocalDateTime startsAt,
            LocalDateTime endsAt,
            BigDecimal durationHours,
            String developerId,
            BigDecimal estimatedHours,
            LocalDate committedDate,
            IncidentSeverity severity,
            TimelineItemStatus planningStatus,
            UUID sourcePlanId,
            Displacement displacement) {
    }

    /**
     * La causa de un desplazamiento, tal como quedo auditada en el plan.
     *
     * <p><strong>Es la trazabilidad que ya existia, puesta donde se pregunta.</strong> El plan guarda
     * un evento por cada pareja (incidente, requerimiento) que se movio, y hasta ahora solo se podia
     * leer pidiendo las renegociaciones o el plan entero. Viajando con el tramo, la rejilla puede
     * decir por que un bloque esta donde esta sin una segunda llamada y sin recalcular nada: los dos
     * extremos de fecha y la regla son los del evento guardado.
     *
     * <p><strong>Ni el motivo ni la severidad se vuelven a deducir.</strong> El texto sale de la misma
     * traduccion de regla que usa la simulacion —{@code reason(AppliedRule)}— y la severidad es la
     * copia que el evento guardo, no la del incidente de hoy: un incidente reclasificado despues en
     * GLPI no puede reescribir por que se movio un requerimiento el mes pasado.
     *
     * <p>Cuando un requerimiento se movio varias veces, el tramo lleva <strong>el ultimo</strong>
     * evento: es el que explica la fecha que se esta viendo.
     *
     * @param incidentId incidente que consumio la franja, o {@code null} si el desplazamiento lo
     *                   provoco la ocupacion previa de la jornada.
     */
    public record Displacement(
            LocalDate originalDate,
            LocalDate newDate,
            AppliedRule appliedRule,
            String incidentId,
            IncidentSeverity incidentSeverity,
            String reason) {
    }
}
