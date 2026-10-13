import type { DeveloperPlanningMetrics } from '@/types/planningMetrics'

/**
 * Estado de la capacidad restante de un plan vigente.
 *
 * Son los dos casos que el backend ya senala —restante exactamente cero y restante negativo—, no
 * umbrales: `0` es el punto en el que el siguiente requerimiento desplaza a otro, y `< 0` el estado
 * que contradice el propio contexto del plan. Ninguna vista anade criterio propio.
 */
export type RemainingState = 'ok' | 'full' | 'over'

/**
 * El estado de un restante. Vive aqui, y no dentro de una tabla, porque tiene dos consumidores —el
 * resumen de cuellos de botella del tablero y la tabla de equipo— y un hecho con dos copias acaba
 * teniendo dos formas.
 */
export function remainingState(remainingHours: number): RemainingState {
  if (remainingHours < 0) return 'over'
  if (remainingHours === 0) return 'full'
  return 'ok'
}

/** Columnas por las que se puede ordenar la tabla de equipo. */
export type TeamSortKey =
  | 'developerId'
  | 'availableHours'
  | 'occupiedHours'
  | 'remainingHours'
  | 'displacedRequirements'

export type SortDirection = 'asc' | 'desc'

/**
 * De donde sale el valor de cada columna ordenable.
 *
 * La tabla mapea clave a valor en un solo sitio: anadir una columna sin decir por que se ordena no
 * compila, y ninguna vista escribe el nombre del campo a mano.
 */
const SORT_ACCESSORS: Record<TeamSortKey, (developer: DeveloperPlanningMetrics) => string | number> =
  {
    developerId: (developer) => developer.developerId,
    availableHours: (developer) => developer.capacity.availableHours,
    occupiedHours: (developer) => developer.capacity.occupiedHours,
    remainingHours: (developer) => developer.capacity.remainingHours,
    displacedRequirements: (developer) => developer.displacedRequirements,
  }

/**
 * Ordena las filas de equipo por una columna, sobre una copia.
 *
 * Ordenar es una **accion del usuario**: el orden por defecto es el que entrego el backend —por
 * `developerId`, con la vigencia ya resuelta— y solo cambia cuando alguien lo pide. La vista no
 * re-agrupa ni recalcula nada: mueve filas.
 *
 * Los numeros se comparan como numeros. Compararlos como texto ordenaria «10» antes que «5», que es
 * el error que esta funcion existe para no tener.
 */
export function sortDevelopers(
  developers: readonly DeveloperPlanningMetrics[],
  key: TeamSortKey,
  direction: SortDirection,
): DeveloperPlanningMetrics[] {
  const valueOf = SORT_ACCESSORS[key]
  const sign = direction === 'asc' ? 1 : -1

  return [...developers].sort((left, right) => {
    const a = valueOf(left)
    const b = valueOf(right)
    const compared = typeof a === 'string' ? a.localeCompare(b as string) : a - (b as number)

    // El desempate es el identificador: sin el, dos filas con la misma cifra podrian intercambiarse
    // entre ordenaciones y la tabla se veria distinta sin que nada hubiera cambiado.
    return compared !== 0 ? compared * sign : left.developerId.localeCompare(right.developerId)
  })
}
