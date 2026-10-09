package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * Que le hizo el plan a un elemento de trabajo, para poder pintarlo y agruparlo.
 *
 * <p>No es el estado del ticket. El estado del ticket —{@code ABIERTO}, {@code EN_EJECUCION}, y los
 * demas— dice en que punto del proceso va el trabajo, y viaja en la foto de la entrada. Esto dice
 * otra cosa: que relacion tiene el elemento con <em>esta</em> agenda. Un requerimiento puede estar
 * {@code EN_EJECUCION} en GLPI y ademas {@code DESPLAZADO} en el plan que se calculo ayer, y las dos
 * afirmaciones son ciertas a la vez porque hablan de cosas distintas.
 *
 * <p><strong>El conjunto es de dos valores, y no por falta de imaginacion.</strong> Los candidatos
 * que se descartaron lo fueron por razones concretas, no por simplicidad:
 *
 * <ul>
 *   <li>Un estado de «no cupo» seria <em>inalcanzable</em>. El trabajo que no entra al horizonte sale
 *       en {@code PlanningConflict}, y un elemento en conflicto no tiene bloques. Sin bloques no hay
 *       tramo que pintar, y por tanto no hay elemento de timeline al que colgarle el estado.
 *   <li>Un estado de «sin declaracion» describiria la metadata de hoy, no la del plan. La entrada
 *       congelada solo contiene elementos que ya estaban declarados —es la regla de planificabilidad
 *       de la decision 124.1— asi que dentro de un plan la pregunta no tiene caso.
 *   <li>Un estado de «vencido» —el indicador que la decision 125 apunto como primero— obligaria a
 *       comparar contra el reloj, y el timeline devolveria bytes distintos para el mismo plan segun
 *       el dia en que se pidiera. La representacion de un plan guardado tiene que ser reproducible.
 * </ul>
 *
 * <p>Un incidente nunca aparece desplazado: {@code RescheduleEvent} solo nombra requerimientos, que
 * son el trabajo con fecha pactada y por tanto el unico desplazable.
 */
public enum TimelineItemStatus {

    /** El elemento ocupa agenda y nada lo movio. */
    PLANIFICADO,

    /** El elemento ocupa agenda despues de que un incidente lo desplazara de su fecha pactada. */
    DESPLAZADO
}
