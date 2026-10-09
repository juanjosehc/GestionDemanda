package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Salida de {@code GET /api/planning/metrics/displaced}: los requerimientos desplazados que suman la
 * tarjeta, uno a uno y con su causa.
 *
 * <p><strong>La fila es el elemento, no el tramo.</strong> Un requerimiento movido a lo largo de dos
 * jornadas ocupa dos tramos de agenda y se movio una vez; la tarjeta cuenta elementos, asi que la
 * lista tiene que contar elementos. Sus desplazamientos van dentro de su fila, que es donde se pueden
 * contar sin confundirlos con el.
 *
 * <p><strong>La causa no se re-deriva.</strong> Sale de la auditoria que el plan ya guarda y viaja con
 * el mismo texto que publica {@code GET /api/planning/{planId}} —el que se deriva de la regla
 * aplicada—, porque un hecho escrito en dos sitios acaba escrito de dos formas.
 *
 * <p><strong>De donde salen las filas.</strong> Del mismo timeline que la tarjeta cuenta: se listan
 * los elementos que ese timeline marca como desplazados, no todos los que tienen un evento. La
 * diferencia es real —un requerimiento desplazado mas alla del horizonte tiene evento y no tiene
 * tramo, y la tarjeta no lo cuenta— y se resuelve a favor de la tarjeta, que es lo que el enlace
 * promete: la lista no puede tener mas elementos que el numero al que se llego por ella. Es una
 * limitacion heredada de la metrica, no introducida aqui.
 *
 * @param source      de donde sale, la misma constante que publica el bloque vigente de la fotografia.
 * @param scope       sobre que se conto, la misma constante que publica el bloque vigente.
 * @param generatedAt cuando se armo esta lista.
 * @param items       los elementos, en el orden en que la fotografia recorre los planes vigentes.
 */
public record DisplacedRequirementsResponse(
        String source,
        String scope,
        Instant generatedAt,
        List<Element> items) {

    /**
     * Un requerimiento desplazado, con donde se movio y por que.
     *
     * <p>Lleva el plan y el sello con el que se calculo porque son lo que permite volver a el y
     * comprobar la fila entera: el plan sigue guardado y {@code /{planId}} devuelve los mismos
     * eventos. Sin ellos la fila seria una afirmacion sin original que consultar.
     *
     * @param workItemId el requerimiento desplazado. Es la identidad de la fila junto con el plan: el
     *                   mismo requerimiento desplazado en el plan de dos desarrolladores son dos
     *                   filas, y la tarjeta tambien cuenta dos, porque suma por desarrollador.
     * @param events     sus desplazamientos, en el orden en que se auditaron. Uno por cada pareja
     *                   (incidente, requerimiento) que lo movio, asi que un elemento puede traer
     *                   varios y la lista sigue teniendo una sola fila para el.
     */
    public record Element(
            String developerId,
            UUID planId,
            Instant calculatedAt,
            String workItemId,
            List<PlanningSimulationResponse.RescheduleEventView> events) {
    }
}
