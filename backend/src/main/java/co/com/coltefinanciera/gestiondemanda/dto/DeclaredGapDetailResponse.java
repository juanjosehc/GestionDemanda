package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.util.List;

import co.com.coltefinanciera.gestiondemanda.domain.enums.DeclaredGap;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiDiscardReason;

/**
 * Salida de {@code GET /api/planning/metrics/declared/{gap}}: las filas declaradas que producen una
 * de las tarjetas de carencia, una a una.
 *
 * <p><strong>No recalcula la metrica: la desglosa.</strong> La lista y el contador salen del mismo
 * predicado sobre la misma tabla —{@code countByEstimatedHoursIsNull} y
 * {@code findByEstimatedHoursIsNull} son la misma condicion escrita dos veces por Spring Data—, asi
 * que el numero de elementos de {@code items} es, por construccion, el numero que muestra la tarjeta.
 * No hay una segunda forma de contar que pudiera separarse de la primera.
 *
 * <p><strong>La fila es la de la declaracion, no una copia.</strong> {@link PlanningMetadataResponse}
 * ya dice que hay declarado, quien lo declaro y cuando. Repetir esa forma aqui seria una segunda
 * declaracion de lo mismo, esperando a divergir de la primera.
 *
 * <p><strong>Lo que este detalle no puede decir.</strong> {@code planning_metadata} guarda quien
 * declara —{@code estimatedBy}, {@code committedBy}—, no quien va a ejecutar. El desarrollador
 * asignado no esta en esta tabla y no se puede nombrar sin consultar GLPI, que esta fase no toca: las
 * columnas se rotulan por lo que son. En una fila retirada los dos autores faltan, porque se
 * retiraron los dos valores, y ahi tampoco hay a quien reclamar.
 *
 * @param gap         la carencia que se listo, tal como llego en la ruta. Viaja de vuelta para que la
 *                    respuesta se pueda leer sin su peticion.
 * @param code        el codigo con el que la capa anticorrupcion nombra esta carencia, o nulo cuando
 *                    no tiene uno: {@code incomplete} es la union de las otras dos y no un descarte,
 *                    y la fotografia tampoco le inventa un codigo. Inventarselo aqui publicaria un
 *                    codigo que no existe en ningun descarte.
 * @param source      la tabla de la que sale, la misma constante que publica la fotografia.
 * @param scope       sobre que se conto, la misma constante que publica la fotografia.
 * @param generatedAt cuando se armo esta lista. Como en la fotografia, es lo unico que depende del
 *                    reloj, y sin el dos listados distintos serian indistinguibles.
 * @param items       las filas, ordenadas por identificador de elemento de trabajo.
 */
public record DeclaredGapDetailResponse(
        DeclaredGap gap,
        GlpiDiscardReason code,
        String source,
        String scope,
        Instant generatedAt,
        List<PlanningMetadataResponse> items) {
}
