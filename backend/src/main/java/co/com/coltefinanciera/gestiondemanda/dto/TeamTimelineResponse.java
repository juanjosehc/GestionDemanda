package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import co.com.coltefinanciera.gestiondemanda.domain.enums.WorkItemType;
import co.com.coltefinanciera.gestiondemanda.dto.TimelinePlanResponse.TimelineItem;
import co.com.coltefinanciera.gestiondemanda.dto.TimelinePlanResponse.TimelineResource;

/**
 * Salida de {@code GET /api/planning/team/timeline}: la agenda de todo el equipo en una ventana comun.
 *
 * <p><strong>No es un tipo nuevo, es un envase.</strong> Los recursos, la capacidad y los tramos son
 * los mismos registros que publica la lectura de un plan —{@link TimelineResource}, {@link
 * TimelinePlanResponse.TimelineCapacity} y {@link TimelineItem}—, compuestos sin tocarlos. Lo unico que
 * esta forma añade es la <em>ventana de equipo</em> y el mapa de que plan es el vigente de cada uno;
 * ninguna de las dos se puede calcular mirando un solo plan.
 *
 * <p><strong>Por que no vale concatenar las respuestas de cada plan.</strong> La ventana de un plan son
 * las fechas de sus propios tramos ({@code toTimelineResponse}), asi que dos planes con cargas distintas
 * devuelven dos ventanas distintas. Pegadas, las columnas de dia no alinean —el martes de uno cae donde
 * el otro no tiene columna— y la capacidad de los dias que un plan no cubre no existe en ninguna parte.
 * Aqui la ventana se calcula una vez, sobre todos los tramos, y la capacidad de cada persona se mide
 * contra ella con <em>el calendario congelado de su propio plan</em>.
 *
 * <p><strong>La ventana son los tramos, no el horizonte.</strong> Es la misma decision que en la lectura
 * de un plan y por el mismo motivo: el horizonte dice cuantos dias miro el motor pero no desde cuando, y
 * esa fecha de inicio no se guarda. Abarcar lo que hay es lo que el dato sostiene.
 *
 * <p><strong>Trazabilidad.</strong> Cada tramo trae su {@code sourcePlanId} y cada plan vigente viaja en
 * {@link TeamPlan} con su propia ventana, asi que de una barra se llega a su plan, y de ahi a sus
 * lecturas de siempre —{@code /{planId}}, {@code /{planId}/input}, {@code /{planId}/timeline}—.
 *
 * @param from      primer dia de la ventana comun, o {@code null} si ningun plan tiene agenda.
 * @param to        ultimo dia de la ventana comun, o {@code null} si ningun plan tiene agenda.
 * @param resources una entrada por desarrollador con tramos o con plan vigente, con su capacidad.
 * @param items     todos los tramos del equipo, ordenados por inicio.
 * @param plans     el plan vigente de cada desarrollador, con su propia ventana.
 * @param conflicts el trabajo que el motor no pudo ubicar, con el motivo que el mismo redacto.
 */
public record TeamTimelineResponse(
        LocalDate from,
        LocalDate to,
        List<TimelineResource> resources,
        List<TimelineItem> items,
        List<TeamPlan> plans,
        List<PlanConflict> conflicts) {

    /**
     * Trabajo que el plan vigente de alguien no pudo ubicar.
     *
     * <p><strong>Es la capa que explica por que hay trabajo pendiente que no es un olvido.</strong> Un
     * elemento planificable que no aparece en la agenda se ve igual que uno que nunca se pidio, y son
     * cosas distintas: aqui viajan los que <em>entraron al motor y el motor dejo fuera</em>, con el
     * motivo que redacto al descartarlos —sin capacidad en el horizonte, o excluido por su estado—.
     *
     * <p><strong>Lo que nunca llego a la entrada no esta aqui</strong>, y no se puede inferir de esta
     * lista: el plan no guarda el trabajo que no recibio. Ese caso se ve en la capa de pendientes del
     * navegador como {@code SIN_CAPACIDAD}, que es el mismo rotulo y un hecho distinto; la limitacion
     * esta declarada y no se disimula con un texto que la respuesta no respalda.
     *
     * <p>El texto lo redacto el motor en el momento del calculo y se publica tal cual: reescribirlo aqui
     * seria la segunda version de una explicacion que ya tiene dueño.
     */
    public record PlanConflict(
            String developerId,
            String workItemId,
            WorkItemType workItemType,
            String reason) {
    }

    /**
     * El plan con el que trabaja hoy un desarrollador.
     *
     * <p>Existe porque {@code resources} solo lleva el identificador de la persona, y una persona con
     * el plan vacio no tiene ningun tramo del que deducir cual es su plan. Sin esto, «este trabajo no
     * entra en el plan vigente» seria una afirmacion que la respuesta no permite comprobar.
     *
     * <p>Lleva su propia ventana y no la del equipo: es la del plan, que es lo que se lee al abrir su
     * calendario.
     *
     * @param from primer dia de los tramos de <em>este</em> plan, o {@code null} si no tiene agenda.
     * @param to   ultimo dia de los tramos de <em>este</em> plan, o {@code null} si no tiene agenda.
     */
    public record TeamPlan(
            String developerId,
            UUID planId,
            LocalDate from,
            LocalDate to) {
    }
}
