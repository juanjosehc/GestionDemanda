package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;

import co.com.coltefinanciera.gestiondemanda.domain.enums.AlertSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.OperationalAlertType;

/**
 * Una alerta operativa: una condicion que hoy se cumple, y cuanto la cumple.
 *
 * <p><strong>Una alerta no es un elemento.</strong> No lleva el ticket que la produce ni el plan que la
 * provoca: lleva <em>cuantos</em> hay, y {@code detailUrl} para ir a verlos. Duplicar aqui el listado
 * seria construir un segundo detalle que pudiera discrepar del que ya existe, y la fase anterior dejo
 * ese trabajo hecho.
 *
 * <p><strong>Los campos derivados del tipo viajan repetidos, y es deliberado.</strong> {@code severity},
 * {@code condition} y {@code detailUrl} son los mismos que declara {@link OperationalAlertType}, que es
 * donde estan escritos una sola vez. Se publican tambien aqui porque un consumidor —una pantalla, o el
 * dia de mañana un notificador— no tiene por que conocer el enum del backend para saber cuanto urge una
 * alerta o a donde lleva: se lo dice el propio JSON.
 *
 * <p><strong>{@code source} y {@code scope} no son textos propios.</strong> Son los mismos que la
 * fotografia operativa publica para el bloque del que sale el numero, tomados de sus constantes. Un
 * dato escrito en dos sitios acaba escrito de dos formas, asi que se toma prestado en vez de copiarse.
 *
 * <p><strong>{@code detailUrl} es una ruta de esta API</strong>, la del desglose que enseña los
 * elementos que producen la alerta —el mismo endpoint que sirve la Fase 18—, y no una ruta de la
 * interfaz. Es lo que la hace comprobable: se puede pedir y verificar que el numero de elementos cuadra
 * con {@code count}. Cuando la alerta no tiene listado propio viaja {@code null}, y el campo viaja
 * igualmente, para que el esquema sea el mismo en todas.
 *
 * <p><strong>{@code generatedAt} va tambien en la alerta</strong>, aunque hoy sea el mismo instante que
 * el de la respuesta: hay una sola fuente, la fotografia. Va porque el dia que una alerta salga de otra
 * fuente su fecha ya estara donde tiene que estar, y porque una alerta sin fecha no se puede ni
 * archivar ni comparar.
 *
 * <p><strong>Las alertas clasifican, no particionan.</strong> Un mismo elemento puede producir mas de
 * una —un plan desplazado que ademas agoto la capacidad, por ejemplo—, asi que sumar los
 * {@code count} de la lista no mide nada. No se publica ningun total, y esto se dice aqui para que
 * nadie lo construya.
 *
 * @param type        que condicion se cumple. Es la identidad estable de la alerta.
 * @param severity    cuanto urge.
 * @param source      de que tabla sale el numero, con el texto que publica la fotografia.
 * @param condition   la condicion que se conto, en palabras.
 * @param scope       sobre que universo se conto, con el texto que publica la fotografia.
 * @param count       cuantos elementos la producen. Siempre mayor que cero: una condicion que no se
 *                    cumple no es una alerta y no se lista. La unidad la dice {@code condition}.
 * @param detailUrl   la ruta del desglose en esta API, o {@code null} si la alerta no tiene listado
 *                    propio.
 * @param generatedAt cuando se evaluo.
 */
public record OperationalAlert(
        OperationalAlertType type,
        AlertSeverity severity,
        String source,
        String condition,
        String scope,
        long count,
        String detailUrl,
        Instant generatedAt) {
}
