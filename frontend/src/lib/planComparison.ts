import type { PlanElement, PlanOutcome } from '@/lib/planResult'
import type { DeveloperPlan } from '@/types/planning'

/**
 * La diferencia entre dos planes guardados del mismo técnico.
 *
 * **Resta, no recalcula.** Recibe dos resultados ya contados —los que produce `planOutcome`— y hace
 * aritmética de conjuntos sobre ellos: qué identificadores están en uno y no en el otro, cuánto se
 * movió cada número de capacidad y qué filas cambiaron. No hay una sola regla del motor reescrita
 * aquí, y no la puede haber: el motor no corre en el navegador (decisión 87).
 *
 * Recibe los resultados y **no las fuentes** a propósito. Aceptar las cuatro lecturas obligaría a
 * llamar a `planOutcome` dos veces por lado —una por cada pregunta— para acabar contando lo mismo dos
 * veces, que es literalmente recalcular lo que ya estaba contado.
 *
 * La clave de unión es `workItemId`: el identificador de ticket de GLPI, que es el mismo texto en
 * todos los planes en los que aparece el mismo elemento. **No se emparejan tramos por fecha**: la
 * identidad de un tramo incluye su fecha de inicio, y esa fecha es justo lo que se está comparando.
 */

/** Los cinco números de capacidad que la comparación resta. */
export interface ComparisonCapacity {
  availableHours: number
  occupiedHours: number
  remainingHours: number
  /** Días laborables que quedaron a cero. */
  saturatedDays: number
  /** Días que quedaron por debajo de cero. */
  overDays: number
}

/** Las tres caras de la capacidad: la del plan anterior, la del nuevo y su resta. */
export interface CapacityComparison {
  from: ComparisonCapacity
  to: ComparisonCapacity
  /** `to − from`, con su signo. Es el único número que la pantalla tiene que interpretar. */
  delta: ComparisonCapacity
}

/**
 * Lo que cambió entre dos planes, que es la respuesta a las siete preguntas.
 *
 * Cada lista es la respuesta a una y trae los elementos enteros y no sus identificadores: quien pinta
 * una fila necesita el veredicto, las horas y —si se movió— sus dos fechas y la regla que lo movió, y
 * volver a buscarlos por identificador sería repartir la misma respuesta en dos sitios.
 */
export interface PlanComparison {
  /** Cuántos elementos tenía cada plan. Sin esto, dos planes vacíos y dos planes idénticos se leen igual. */
  elementCounts: { from: number; to: number }
  /**
   * Si los dos planes tienen foto de entrada.
   *
   * **Cuando falta una, «entraron» y «salieron» dejan de ser una resta y pasan a ser un mínimo.**
   * El universo de un plan sin foto son solo sus asignaciones y sus conflictos, así que lo que entró
   * y no está en el plan anterior se cuenta sobre lo que la foto ausente conocía, y puede haber más.
   * No es un cero: es un suelo. Por eso esta bandera existe y por eso el token no lo decide esa
   * pareja de listas cuando está en falso (riesgo 182).
   */
  photosKnown: boolean
  /** Los que están en el nuevo y no estaban en el anterior. */
  entered: readonly PlanElement[]
  /** Los que estaban en el anterior y ya no están. */
  left: readonly PlanElement[]
  capacity: CapacityComparison
  /**
   * Los desplazamientos que aparecieron: desplazados en el nuevo que no lo estaban en el anterior.
   *
   * Incluye el caso en que el elemento no estuviera en el plan anterior, porque entonces el
   * desplazamiento también es nuevo. Es lo que el brief pregunta y no «desplazados nuevos de un
   * elemento viejo».
   */
  newDisplacements: readonly PlanElement[]
  /** Los desplazamientos que desaparecieron, simétrico. */
  goneDisplacements: readonly PlanElement[]
  /**
   * Los acuerdos registrados **después** del sello del plan anterior.
   *
   * Vacío cuando `agreementsKnown` es falso, y esas dos cosas no significan lo mismo: una lista vacía
   * con el indicador en verdadero dice «no se registró ninguno», y con el indicador en falso dice «no
   * consta». La pantalla tiene que distinguirlas en vez de pintar un cero.
   */
  newAgreements: readonly PlanElement[]
  /** Si la lectura de acuerdos habla del plan nuevo. Cuando es falso, la última pregunta no se contesta. */
  agreementsKnown: boolean
  /** Los que están en los dos y su fila no cambió. */
  unchanged: readonly PlanElement[]
  /** Los que están en los dos y su fila cambió. */
  changed: readonly PlanElement[]
}

/**
 * Si dos filas del mismo elemento enseñan lo mismo.
 *
 * **Compara lo que la fila enseña, no solo el veredicto.** Un requerimiento que se mueve de día sin
 * cambiar de caja sigue siendo `DESPLAZADO` en los dos planes, y un diff por veredicto se lo comería:
 * moverse de día es exactamente una de las cosas que la comparación viene a contar. Por eso entran
 * también la fecha compromiso, lo comprometido, la estimación y —si está desplazado— sus dos fechas.
 *
 * El tipo de ticket **no** se compara, y es la limitación que el riesgo 187 declara: meterlo en la
 * clave convertiría un cambio de tipo en un «entró y salió» falso, que es peor que no verlo.
 */
function sameRow(from: PlanElement, to: PlanElement): boolean {
  return (
    from.verdict === to.verdict &&
    from.committedDate === to.committedDate &&
    from.allocatedHours === to.allocatedHours &&
    from.estimatedHours === to.estimatedHours &&
    (from.reschedule?.originalDate ?? null) === (to.reschedule?.originalDate ?? null) &&
    (from.reschedule?.rescheduledDate ?? null) === (to.reschedule?.rescheduledDate ?? null)
  )
}

/** Los elementos indexados por su identificador. El último gana, como en `planOutcome`. */
function byId(elements: readonly PlanElement[]): Map<string, PlanElement> {
  return new Map(elements.map((one) => [one.workItemId, one]))
}

/** Los identificadores desplazados de un plan, que es el conjunto que las preguntas 4 y 5 restan. */
function displacedIds(outcome: PlanOutcome): ReadonlySet<string> {
  return new Set(
    outcome.elements.filter((one) => one.verdict === 'DESPLAZADO').map((one) => one.workItemId),
  )
}

function capacityOf(outcome: PlanOutcome): ComparisonCapacity {
  return {
    availableHours: outcome.capacity.availableHours,
    occupiedHours: outcome.capacity.occupiedHours,
    remainingHours: outcome.capacity.remainingHours,
    saturatedDays: outcome.saturatedDays,
    overDays: outcome.overDays,
  }
}

function subtract(from: ComparisonCapacity, to: ComparisonCapacity): ComparisonCapacity {
  return {
    availableHours: to.availableHours - from.availableHours,
    occupiedHours: to.occupiedHours - from.occupiedHours,
    remainingHours: to.remainingHours - from.remainingHours,
    saturatedDays: to.saturatedDays - from.saturatedDays,
    overDays: to.overDays - from.overDays,
  }
}

/**
 * Compara dos planes ya contados.
 *
 * `since` es el sello del plan anterior —su `createdAt`—, y solo lo usa la última pregunta. Se compara
 * como número y no como texto: en texto, `…14:00:00Z` ordena *después* de `…14:00:00.5Z`, que es
 * falso.
 */
export function planComparison(from: PlanOutcome, to: PlanOutcome, since: string): PlanComparison {
  const inFrom = byId(from.elements)
  const inTo = byId(to.elements)

  const displacedFrom = displacedIds(from)
  const displacedTo = displacedIds(to)

  const kept = to.elements.filter((one) => inFrom.has(one.workItemId))
  const seal = Date.parse(since)

  const capacityFrom = capacityOf(from)
  const capacityTo = capacityOf(to)

  return {
    elementCounts: { from: from.elements.length, to: to.elements.length },
    photosKnown: from.considered !== null && to.considered !== null,

    entered: to.elements.filter((one) => !inFrom.has(one.workItemId)),
    left: from.elements.filter((one) => !inTo.has(one.workItemId)),

    capacity: {
      from: capacityFrom,
      to: capacityTo,
      delta: subtract(capacityFrom, capacityTo),
    },

    newDisplacements: to.elements.filter(
      (one) => one.verdict === 'DESPLAZADO' && !displacedFrom.has(one.workItemId),
    ),
    goneDisplacements: from.elements.filter(
      (one) => one.verdict === 'DESPLAZADO' && !displacedTo.has(one.workItemId),
    ),

    // Sin la lectura de acuerdos atada al plan nuevo, la pregunta no se contesta: la lista sale vacía
    // y el indicador lo dice. Devolver un cero sería afirmar que nadie acordó nada.
    newAgreements: to.agreementsKnown
      ? to.elements.filter((one) => {
          const agreement = one.renegotiation?.renegotiation
          return agreement != null && Date.parse(agreement.agreedAt) > seal
        })
      : [],
    agreementsKnown: to.agreementsKnown,

    unchanged: kept.filter((one) => sameRow(inFrom.get(one.workItemId) as PlanElement, one)),
    changed: kept.filter((one) => !sameRow(inFrom.get(one.workItemId) as PlanElement, one)),
  }
}

/** Las tres frases posibles sobre una comparación. La prosa vive en la pantalla. */
export type ComparisonToken = 'sin-elementos' | 'sin-diferencias' | 'con-diferencias'

/** Si los cinco deltas de capacidad están a cero. */
function sameCapacity(delta: ComparisonCapacity): boolean {
  return (
    delta.availableHours === 0 &&
    delta.occupiedHours === 0 &&
    delta.remainingHours === 0 &&
    delta.saturatedDays === 0 &&
    delta.overDays === 0
  )
}

/**
 * Qué se puede decir de la comparación, en un token.
 *
 * **`sin-elementos` es un caso aparte y no un `sin-diferencias` más.** Dos planes que no tenían nada
 * no coinciden en nada: lo que pasa es que no hay nada que comparar, y decir «sin diferencias» sobre
 * dos agendas vacías afirmaría una igualdad que nadie comprobó. Es la misma distinción que
 * `verdictOf` hace con el plan vacío.
 */
export function comparisonOf(comparison: PlanComparison): ComparisonToken {
  if (comparison.elementCounts.from === 0 && comparison.elementCounts.to === 0) {
    return 'sin-elementos'
  }

  // Las dos orillas de la entrada solo cuentan como diferencia si las dos fotos estan: sin una de
  // ellas, la lista es un suelo y no una cuenta, y dejar que decidiera el token afirmaria que algo
  // entro cuando lo que pasa es que no se sabe cuanto entro (riesgo 182).
  const moved =
    comparison.photosKnown && (comparison.entered.length > 0 || comparison.left.length > 0)

  const changed =
    moved ||
    comparison.changed.length > 0 ||
    comparison.newDisplacements.length > 0 ||
    comparison.goneDisplacements.length > 0 ||
    comparison.newAgreements.length > 0 ||
    !sameCapacity(comparison.capacity.delta)

  return changed ? 'con-diferencias' : 'sin-diferencias'
}

/**
 * El plan anterior a uno dado, o nulo si es el primero.
 *
 * **La posición la fija la lista del backend**, que viene del más antiguo al más reciente y no se
 * reordena aquí: sería la segunda definición de «cuál es el anterior», y la primera ya está en la
 * consulta.
 *
 * Nulo significa «no hay anterior», y también es lo que devuelve un identificador que no está en la
 * lista. Quien llama no puede distinguir las dos cosas por el valor de vuelta, y no le hace falta:
 * para saber si el plan existe tiene su propia lectura, que contesta `404`.
 */
export function previousPlanOf(
  plans: readonly DeveloperPlan[],
  planId: string,
): DeveloperPlan | null {
  const position = plans.findIndex((one) => one.planId === planId)

  return position > 0 ? plans[position - 1] : null
}
