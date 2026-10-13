package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import co.com.coltefinanciera.gestiondemanda.domain.enums.RenegotiationStatus;

/**
 * Salida de {@code GET /api/renegotiations}: los requerimientos desplazados del plan vigente de cada
 * desarrollador, con lo que hay que saber para renegociarlos.
 *
 * <p><strong>Una sola lectura contesta las siete preguntas de la trazabilidad.</strong> Que
 * requerimiento fue afectado —{@code workItemId}—; que incidente causo el desplazamiento, cual era la
 * fecha original y a cual se movio —{@code events}, que es la auditoria que el plan ya guardaba—; cual
 * es la fecha nueva acordada, quien la registro, cuando y por que —{@code renegotiation}—. Las siete
 * salen de aqui sin pedir el plan ni el timeline por separado, y sin que ninguna se re-derive: el
 * incidente, las fechas y su motivo son los que el motor audito, y el acuerdo con el suyo —que es otro
 * motivo, el que dio la persona— es el que alguien registro.
 *
 * <p><strong>Las filas salen del mismo sitio que la tarjeta de desplazamientos.</strong> Se listan los
 * elementos que el timeline del plan vigente marca como desplazados, reutilizando la lectura que ya
 * existe para {@code GET /api/planning/metrics/displaced}. No es una casualidad: si esta lista se
 * armara por su cuenta, podria tener mas filas que el numero al que se llega por la tarjeta, o menos,
 * y no habria forma de saber cual de las dos miente.
 *
 * <p><strong>Un desplazamiento no se borra al renegociar.</strong> El elemento sigue en la lista
 * despues de acordar la fecha nueva: cambia de {@link RenegotiationStatus}, no desaparece. La lista
 * es la historia de lo que se movio, y esconder lo ya resuelto dejaria sin explicacion por que la
 * fecha de un requerimiento no es la que se le prometio al usuario.
 *
 * <p><strong>Lo que esta lectura NO hace.</strong> No consulta GLPI: un requerimiento cerrado o
 * desaparecido en el origen sigue apareciendo mientras su plan vigente lo siga desplazando, porque lo
 * que se cuenta es lo que el plan decidio, no lo que el origen dice hoy. Tampoco recalcula nada ni
 * toca el motor: lee lo guardado.
 *
 * @param source      de donde sale cada parte de la fila.
 * @param scope       sobre que se conto.
 * @param generatedAt cuando se armo esta lista.
 * @param summary     los tres numeros de la pantalla, contados sobre {@code items}.
 * @param items       los elementos, en el orden en que la fotografia recorre los planes vigentes.
 */
public record RenegotiationsResponse(
        String source,
        String scope,
        Instant generatedAt,
        Summary summary,
        List<Item> items) {

    /** De donde sale cada parte: la agenda del plan, su auditoria de desplazamientos y el acuerdo. */
    public static final String SOURCE = "plan_snapshot + reschedule_event + renegotiation";

    /** Sobre que se conto: un plan por desarrollador, el mas reciente, igual que la tarjeta. */
    public static final String SCOPE =
            "el plan vigente de cada desarrollador: el mas reciente por created_at";

    /**
     * Los tres numeros, contados sobre las mismas filas que se devuelven.
     *
     * <p>No son una consulta aparte: se cuentan recorriendo {@code items}, asi que no pueden
     * discrepar del listado. Un numero que se calcula por otro camino acaba diciendo otra cosa el dia
     * que una de las dos condiciones cambie.
     *
     * @param displaced cuantos requerimientos estan desplazados en el plan vigente. Es
     *                  {@code pending + agreed}, y por eso no se cuenta aparte.
     * @param pending   cuantos siguen sin una fecha acordada que cubra sus desplazamientos.
     * @param agreed    cuantos ya la tienen.
     */
    public record Summary(long displaced, long pending, long agreed) {
    }

    /**
     * Un requerimiento desplazado, con su trazabilidad entera.
     *
     * <p>Lleva el plan y su sello de calculo porque son lo que permite volver a el y comprobar la
     * fila: el plan sigue guardado y {@code GET /api/planning/{planId}} devuelve los mismos eventos.
     * Sin ellos la fila seria una afirmacion sin original que consultar.
     *
     * @param workItemId    el requerimiento desplazado. Es la identidad de la fila junto con el plan.
     * @param status        si sus desplazamientos vigentes ya tienen acuerdo. Se deduce al leer y no
     *                      se guarda: ver {@link RenegotiationStatus}.
     * @param events        sus desplazamientos, uno por cada pareja (incidente, requerimiento) que lo
     *                      movio. Un elemento puede traer varios —varios incidentes, o el mismo
     *                      requerimiento movido mas de una vez— y la lista sigue teniendo una sola
     *                      fila para el. <strong>Nunca viene vacio</strong>: el timeline solo marca
     *                      desplazado a quien tiene un evento que lo justifique.
     * @param renegotiation el acuerdo registrado, o {@code null} si todavia no hay ninguno. Un
     *                      acuerdo <strong>anterior</strong> a un desplazamiento tambien llega aqui,
     *                      aunque no lo cubra: es lo que deja ver que hubo una renegociacion y que
     *                      despues el requerimiento se movio otra vez.
     */
    public record Item(
            String developerId,
            UUID planId,
            Instant calculatedAt,
            String workItemId,
            RenegotiationStatus status,
            List<PlanningSimulationResponse.RescheduleEventView> events,
            RenegotiationResponse renegotiation) {
    }
}
