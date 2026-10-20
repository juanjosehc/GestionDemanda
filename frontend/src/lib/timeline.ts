import type { TeamPerson } from '@/types/team'
import type {
  IncidentSeverity,
  TeamConflict,
  TeamTimelineResponse,
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

/** «1 tramo» / «3 tramos»: el número decide la concordancia, no el sustantivo. */
export function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
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
 * La clave de un tramo: el elemento y el instante en que arranca.
 *
 * Es lo que reconoce un bloque entre lecturas —y lo que la simulación usa para decir cuáles
 * movería—, así que se escribe una sola vez.
 */
export function blockKey(item: Pick<TimelineItem, 'workItemId' | 'startsAt'>): string {
  return `${item.workItemId}@${item.startsAt}`
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
 * La agenda del equipo, con **las personas como filas**.
 *
 * `GET /api/planning/team/timeline` sigue siendo la lectura de los planes, y por eso solo trae una
 * fila por técnico con plan. **Quién aparece lo decide el padrón**, que llega por otra ruta: esta
 * función cruza las dos lecturas y devuelve una fila por persona operativa, tenga plan o no. Una
 * persona sin plan queda con capacidad vacía, que es el hecho de que hoy no tiene nada planificado y
 * no de que no exista.
 *
 * **El cruce es por login y por número de GLPI**, porque un plan se guarda con lo que se tecleó al
 * pedirlo (`keysOf` en `lib/team.ts` hace lo mismo para la tabla de Recursos). Sin la segunda clave,
 * `FranZulu`, `NilsCort` y `JoseDiaz` perderían su plan —guardado como `160`, `17` y `296`— y
 * aparecerían dos veces: una fila vacía con su nombre y otra con su trabajo.
 *
 * Los tramos y conflictos de quien no está en el equipo **no se descartan en silencio**: vuelven en
 * `outside` para que la pantalla pueda decir cuántos son. No se dibujan, porque un identificador que
 * el padrón no conoce no es una persona del equipo, pero borrarlos de la lectura sin decirlo sería
 * esconder trabajo real —el de un usuario de GLPI fuera del grupo— junto con el de demostración.
 */
export interface TeamAgenda {
  /** Una fila por persona operativa, en el orden en que llega el padrón. */
  resources: TimelineResource[]
  /** Los tramos de esas personas, reetiquetados con su login canónico. */
  items: TimelineItem[]
  /** Los conflictos de esas personas, reetiquetados igual. */
  conflicts: TeamConflict[]
  /** Lo que quedó fuera del equipo: tramos y conflictos que no se dibujan. */
  outside: {
    items: TimelineItem[]
    conflicts: TeamConflict[]
  }
}

export function teamAgenda(
  people: readonly TeamPerson[],
  timeline: Pick<TeamTimelineResponse, 'resources' | 'items' | 'conflicts'> | undefined,
): TeamAgenda {
  // La clave con la que se guardó el plan, al login con el que el padrón nombra a la persona.
  const canonical = new Map<string, string>()

  for (const person of people) {
    canonical.set(person.developerId, person.developerId)

    if (person.glpiId !== null) {
      canonical.set(String(person.glpiId), person.developerId)
    }
  }

  const plannedByPerson = new Map<string, TimelineResource>()

  for (const resource of timeline?.resources ?? []) {
    const developerId = canonical.get(resource.developerId)

    if (developerId) {
      plannedByPerson.set(developerId, resource)
    }
  }

  const resources = people.map((person) => {
    const planned = plannedByPerson.get(person.developerId)

    // La fila es la persona: su login manda aunque el plan se haya guardado con el número.
    return {
      developerId: person.developerId,
      capacity: planned?.capacity ?? [],
    }
  })

  const items: TimelineItem[] = []
  const conflicts: TeamConflict[] = []
  const outside: TeamAgenda['outside'] = { items: [], conflicts: [] }

  for (const item of timeline?.items ?? []) {
    const developerId = canonical.get(item.developerId)

    if (developerId) {
      items.push({ ...item, developerId })
    } else {
      outside.items.push(item)
    }
  }

  for (const conflict of timeline?.conflicts ?? []) {
    const developerId = canonical.get(conflict.developerId)

    if (developerId) {
      conflicts.push({ ...conflict, developerId })
    } else {
      outside.conflicts.push(conflict)
    }
  }

  return { resources, items, conflicts, outside }
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
