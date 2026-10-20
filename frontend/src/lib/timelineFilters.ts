import type { WorkItemType } from '@/types/timeline'

/**
 * Los filtros del Timeline, aplicados sobre las filas que ya están cargadas.
 *
 * **No piden nada.** La agenda, los pendientes, los acuerdos y la cobertura ya están en pantalla;
 * esto decide qué filas se ven, y nada más. Filtrar en el servidor habría pedido un contrato nuevo
 * para una pregunta que se contesta con lo que la pantalla ya tiene.
 *
 * **La búsqueda es por fila, no por tramo.** Quien escribe un número de ticket quiere llegar a la
 * persona que lo tiene; una vez en su fila ve todo su trabajo, que es el contexto que necesita para
 * decidir. Esconder los demás tramos de esa persona convertiría la búsqueda en una vista nueva.
 */

/** Lo que la fila deja ver y por lo que se la puede buscar y filtrar. */
export interface TeamRowSignals {
  developerId: string
  name: string | null
  glpiId: number | null
  hasPlan: boolean
  /** Pendientes del panel de trabajo, no tramos de la rejilla. */
  pending: number
  /** Desplazamientos que esperan una fecha acordada. */
  agreements: number
  /** Tramos que el plan vigente movió de fecha. */
  displacements: number
  /** Tickets que hoy tienen lo necesario para entrar al plan. */
  plannable: number
  /** De los pendientes, los que una declaración desbloquea. */
  recoverable: number
  /** Los tipos que aparecen entre sus tramos y sus pendientes. */
  types: ReadonlySet<WorkItemType>
  /** Todo lo visible de la fila, ya en minúsculas: login, nombre, GLPI, tickets y títulos. */
  searchText: string
}

/** Qué mostrar de las filas. `TODOS` es «sin restricción», no un valor del dominio. */
export interface TeamRowFilters {
  query: string
  developerId: string | 'TODOS'
  type: WorkItemType | 'TODOS'
  plan: 'TODOS' | 'CON' | 'SIN'
  withPending: boolean
  withAgreements: boolean
  withDisplacements: boolean
  plannableOnly: boolean
  recoverableOnly: boolean
}

/** Filtros sin aplicar, que es como abre el Timeline. */
export const NO_ROW_FILTERS: TeamRowFilters = {
  query: '',
  developerId: 'TODOS',
  type: 'TODOS',
  plan: 'TODOS',
  withPending: false,
  withAgreements: false,
  withDisplacements: false,
  plannableOnly: false,
  recoverableOnly: false,
}

/** Las palabras de la búsqueda. Se exigen todas: «ana REQ-9» encuentra a Ana por ese ticket. */
function tokensOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

/** Si la fila cumple todos los filtros activos. */
export function matchesRow(row: TeamRowSignals, filters: TeamRowFilters): boolean {
  if (filters.developerId !== 'TODOS' && row.developerId !== filters.developerId) {
    return false
  }

  if (filters.type !== 'TODOS' && !row.types.has(filters.type)) {
    return false
  }

  if (filters.plan === 'CON' && !row.hasPlan) {
    return false
  }

  if (filters.plan === 'SIN' && row.hasPlan) {
    return false
  }

  if (filters.withPending && row.pending === 0) {
    return false
  }

  if (filters.withAgreements && row.agreements === 0) {
    return false
  }

  if (filters.withDisplacements && row.displacements === 0) {
    return false
  }

  if (filters.plannableOnly && row.plannable === 0) {
    return false
  }

  if (filters.recoverableOnly && row.recoverable === 0) {
    return false
  }

  return tokensOf(filters.query).every((token) => row.searchText.includes(token))
}

/** Las filas que pasan los filtros, en el orden en que llegaron. */
export function filterRows<T extends TeamRowSignals>(
  rows: readonly T[],
  filters: TeamRowFilters,
): T[] {
  return rows.filter((row) => matchesRow(row, filters))
}

/** Si hay algún filtro puesto, para poder ofrecer «Limpiar» y contar las filas visibles. */
export function hasFilters(filters: TeamRowFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.developerId !== 'TODOS' ||
    filters.type !== 'TODOS' ||
    filters.plan !== 'TODOS' ||
    filters.withPending ||
    filters.withAgreements ||
    filters.withDisplacements ||
    filters.plannableOnly ||
    filters.recoverableOnly
  )
}
