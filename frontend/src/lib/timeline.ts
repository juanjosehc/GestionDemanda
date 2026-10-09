import type {
  IncidentSeverity,
  TimelineItem,
  TimelineItemStatus,
  TimelineResource,
  WorkItemType,
} from '@/types/timeline'

/** Ayudantes puros de la vista de linea de tiempo: posicion, agrupacion, filtrado y formato. */

/** Filtros visuales. Se aplican en memoria sobre los tramos ya recibidos. */
export interface TimelineFilters {
  workItemType: WorkItemType | 'TODOS'
  severity: IncidentSeverity | 'TODAS'
  planningStatus: TimelineItemStatus | 'TODOS'
}

/** Filtros sin aplicar, que es como arranca la vista. */
export const EMPTY_FILTERS: TimelineFilters = {
  workItemType: 'TODOS',
  severity: 'TODAS',
  planningStatus: 'TODOS',
}

/** Rango del eje vertical, en minutos desde medianoche. */
export interface HourAxis {
  startMinutes: number
  endMinutes: number
}

const DEFAULT_AXIS: HourAxis = { startMinutes: 8 * 60, endMinutes: 18 * 60 }

const DAY_FORMAT = new Intl.DateTimeFormat('es-CO', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

const TIME_FORMAT = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const HOURS_FORMAT = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })

/**
 * Convierte una fecha o fecha-hora local del contrato ("2026-10-05" o "2026-10-05T09:00:00")
 * en un Date.
 *
 * No se usa `new Date(texto)`: una fecha sin hora la interpreta el motor como UTC, y en
 * Colombia (UTC-5) eso devuelve el dia anterior. Se construye a mano, en hora local.
 */
export function parseLocalDateTime(value: string): Date {
  const [datePart = '', timePart = ''] = value.split('T')
  const [year = 0, month = 0, day = 0] = datePart.split('-').map(Number)
  const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number)

  return new Date(year, month - 1, day, hour, minute, second)
}

/** Minutos desde medianoche de una fecha-hora local del contrato. */
export function minutesOfDay(value: string): number {
  const [hour = 0, minute = 0] = (value.split('T')[1] ?? '').split(':').map(Number)
  return hour * 60 + minute
}

/** Fecha (yyyy-MM-dd) en la que arranca el tramo, que es su columna. */
export function itemDate(item: TimelineItem): string {
  return item.startsAt.slice(0, 10)
}

/**
 * Dias del eje horizontal, en orden.
 *
 * La capacidad cubre toda la ventana del plan, asi que ella marca las columnas. Los tramos se
 * suman por si alguno cayera fuera de la ventana: mas vale una columna de mas que un bloque
 * invisible.
 */
export function timelineDays(
  resources: readonly TimelineResource[],
  items: readonly TimelineItem[],
): string[] {
  const days = new Set<string>()

  for (const resource of resources) {
    for (const capacity of resource.capacity) {
      days.add(capacity.date)
    }
  }
  for (const item of items) {
    days.add(itemDate(item))
  }

  // ISO (yyyy-MM-dd) ordena alfabeticamente igual que cronologicamente.
  return [...days].sort()
}

/**
 * Eje horario del que hay datos.
 *
 * La jornada del calendario congelado (09:00-17:00) no viaja en la respuesta, asi que el eje
 * se deriva de los tramos observados y se redondea hacia fuera a la hora entera. Sin tramos se
 * usa 08:00-18:00.
 */
export function hourAxis(items: readonly TimelineItem[]): HourAxis {
  if (items.length === 0) {
    return DEFAULT_AXIS
  }

  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY

  for (const item of items) {
    first = Math.min(first, minutesOfDay(item.startsAt))
    last = Math.max(last, minutesOfDay(item.endsAt))
  }

  const startMinutes = Math.floor(first / 60) * 60
  // Un tramo que acaba en punto no necesita una hora mas de eje.
  const endMinutes = Math.ceil(last / 60) * 60

  return { startMinutes, endMinutes: Math.max(endMinutes, startMinutes + 60) }
}

/** Agrupa los tramos por fecha para pintarlos en su columna sin recorrer la lista por dia. */
export function itemsByDate(items: readonly TimelineItem[]): Map<string, TimelineItem[]> {
  const byDate = new Map<string, TimelineItem[]>()

  for (const item of items) {
    const date = itemDate(item)
    const bucket = byDate.get(date)

    if (bucket) {
      bucket.push(item)
    } else {
      byDate.set(date, [item])
    }
  }

  return byDate
}

/** Capacidad de un recurso en una fecha, o indefinida si esa fecha no esta en su ventana. */
export function capacityOn(resource: TimelineResource, date: string) {
  return resource.capacity.find((capacity) => capacity.date === date)
}

/** Aplica los filtros visuales. No genera llamadas: trabaja sobre lo ya recibido. */
export function filterItems(
  items: readonly TimelineItem[],
  filters: TimelineFilters,
): TimelineItem[] {
  return items.filter(
    (item) =>
      (filters.workItemType === 'TODOS' || item.workItemType === filters.workItemType) &&
      (filters.severity === 'TODAS' || item.severity === filters.severity) &&
      (filters.planningStatus === 'TODOS' || item.planningStatus === filters.planningStatus),
  )
}

/** Nombre del dia de una fecha del contrato. */
export function formatDay(isoDate: string): string {
  return DAY_FORMAT.format(parseLocalDateTime(isoDate))
}

/** Hora local de una fecha-hora del contrato. */
export function formatTime(isoDateTime: string): string {
  return TIME_FORMAT.format(parseLocalDateTime(isoDateTime))
}

/** Horas con un decimal como maximo, sin ceros de relleno. */
export function formatHours(hours: number): string {
  return HOURS_FORMAT.format(hours)
}
