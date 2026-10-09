package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.time.Instant;
import java.util.UUID;

/**
 * Lo que identifica a un plan sin traerlo.
 *
 * <p>Existe porque una lectura de conjunto no necesita el plan entero. Armarlo exige el
 * {@link PlanningResult}, que son cuatro consultas por plan —asignaciones, bloques, eventos y
 * conflictos—, y quien pregunta «cual es el plan vigente de cada desarrollador» no va a mirar
 * ninguno de esos cuatro: le basta con saber cual es.
 *
 * <p><strong>No es un {@link PlanSnapshot} recortado.</strong> Un {@code PlanSnapshot} afirma que
 * hay un resultado detras; esto solo afirma que hay una fila. La diferencia importa el dia que
 * alguien intente pintar una agenda a partir de una lista de referencias: no se puede, y es
 * deliberado.
 *
 * @param planId      el identificador del plan, que es lo unico con lo que se puede volver a pedir.
 * @param developerId el desarrollador al que pertenece, tal como quedo guardado.
 * @param createdAt   cuando se calculo y guardo. Es el sello con el que se decide la vigencia.
 */
public record PlanReference(UUID planId, String developerId, Instant createdAt) {
}
