import { PENDING_CAUSE_LABEL } from '@/lib/pending'
import type { DeveloperDeclarationsResponse } from '@/types/declarations'
import type { TeamPerson } from '@/types/team'
import type {
  CommitmentRisk,
  IncidentSeverity,
  TeamConflict,
  TeamTimelineResponse,
  TimelineItem,
  TimelineItemStatus,
  TimelineResource,
  TimelineState,
  UnscheduledItem,
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

/** Rango del eje vertical, en minutos desde medianoche. La jornada de la vista es fija. */
export interface HourAxis {
  startMinutes: number
  endMinutes: number
}

/**
 * La jornada laboral oficial: lunes a viernes, 07:00-17:30.
 *
 * Es el mismo bloque que declara el backend en `planning.calendar`: si el eje dijera otra cosa, la
 * rejilla estaría dibujando una jornada que el motor no usa.
 */
const DEFAULT_AXIS: HourAxis = { startMinutes: 7 * 60, endMinutes: 17 * 60 + 30 }

const DAY_FORMAT = new Intl.DateTimeFormat('es-CO', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

/** El extremo de una semana en la etiqueta de navegación: «19 oct». */
const RANGE_FORMAT = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' })

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
 * Eje horario: siempre la jornada oficial, de 07:00 a 17:30.
 *
 * La jornada es fija y no se deriva de los tramos: si el eje fuera del primer inicio al ultimo
 * fin, un dia con un solo tramo de 09:00 a 10:00 borraria las otras horas y la escala cambiaria
 * de forma al cambiar de semana, que es justo lo que impide leer dos dias comparando.
 *
 * Si algun tramo cae fuera de esa ventana, el eje se estira hacia fuera a la hora entera: la
 * jornada fija no puede esconder trabajo que existe. Un tramo que termina a las 17:30 —el cierre
 * oficial— no estira nada: el eje solo crece cuando el trabajo lo rebasa.
 */
export function hourAxis(items: readonly TimelineItem[]): HourAxis {
  let startMinutes = DEFAULT_AXIS.startMinutes
  let endMinutes = DEFAULT_AXIS.endMinutes

  for (const item of items) {
    const start = minutesOfDay(item.startsAt)
    const end = minutesOfDay(item.endsAt)

    if (start < startMinutes) {
      startMinutes = Math.floor(start / 60) * 60
    }
    if (end > endMinutes) {
      endMinutes = Math.ceil(end / 60) * 60
    }
  }

  return { startMinutes, endMinutes }
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

/** Una fecha del contrato (aaaa-mm-dd) a partir de un Date local. */
export function isoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** La fecha de hoy en hora local, que es la que habla el contrato. */
export function localTodayIso(): string {
  return isoDate(new Date())
}

/** Suma (o resta) dias a una fecha del contrato sin pasar por zonas horarias. */
export function addDays(isoDay: string, days: number): string {
  const date = parseLocalDateTime(isoDay)
  date.setDate(date.getDate() + days)
  return isoDate(date)
}

/**
 * El lunes de la semana que contiene el dia.
 *
 * La semana de trabajo empieza el lunes y termina el domingo; se navega por semanas completas, y
 * por eso el ancla de la ventana es siempre un lunes.
 */
export function weekStartOf(isoDay: string): string {
  const date = parseLocalDateTime(isoDay)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return isoDate(date)
}

/** Los siete dias de la semana que empieza en ese lunes, de lunes a domingo. */
export function weekDaysOf(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
}

/** Numero de semana ISO-8601 del dia. */
export function isoWeekNumber(isoDay: string): number {
  const date = parseLocalDateTime(isoDay)
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const offset = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - offset + 3)

  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const firstOffset = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstOffset + 3)

  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604_800_000)
}

/** «Semana 43 · 19 oct – 25 oct»: lo que la navegación dice que se está viendo. */
export function formatWeek(weekStart: string): string {
  const end = addDays(weekStart, 6)
  return `Semana ${isoWeekNumber(weekStart)} · ${RANGE_FORMAT.format(parseLocalDateTime(weekStart))} – ${RANGE_FORMAT.format(parseLocalDateTime(end))}`
}

/**
 * La semana con la que abre la agenda: la de hoy si la ventana la contiene, y si no la primera.
 *
 * «Hoy» fuera de la ventana cargada no es una semana vacía: es una semana de la que esta vista no
 * sabe nada y en la que no hay ni una persona con capacidad. Abrir ahí sería enseñar un hueco que
 * no significa nada, así que se abre en el borde de la ventana y «Volver a hoy» lleva al mismo
 * sitio.
 */
export function weekAnchor(days: readonly string[], today: string): string {
  const first = days[0] ?? today
  const last = days[days.length - 1] ?? today
  const inside = today >= first && today <= last
  return weekStartOf(inside ? today : first)
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

/**
 * El puesto de un tramo dentro de los días que su elemento ocupa.
 *
 * **El plan ya parte el trabajo en un tramo por día**: quien dura dieciséis horas llega como dos
 * tramos de ocho, uno por jornada. Lo que la rejilla no sabía era que eran el mismo trabajo, así que
 * pintaba dos bloques sueltos y ninguno decía cuál era el último. Esto es ese dato, y no se puede
 * deducir de un tramo aislado: hace falta ver los de su elemento.
 *
 * Los días se cuentan **por fecha distinta y no por tramo**: un elemento puede partirse dos veces en
 * una jornada —la franja libre de la mañana y la de la tarde— y eso es un día, no dos. Contar tramos
 * diría «día 2 de 3» en un trabajo de dos días.
 */
export interface DayPosition {
  /** Día del elemento, desde 1. */
  day: number
  /** Cuántos días ocupa en total. */
  days: number
  /** Si este tramo cae en el último día, que es el día de entrega. */
  delivery: boolean
}

/** El puesto de cada tramo dentro de su elemento, por `blockKey`. */
export function dayPositions(items: readonly TimelineItem[]): Map<string, DayPosition> {
  const daysByItem = new Map<string, Set<string>>()

  for (const item of items) {
    const key = `${item.developerId}|${item.workItemId}`
    const days = daysByItem.get(key)

    if (days) {
      days.add(itemDate(item))
    } else {
      daysByItem.set(key, new Set([itemDate(item)]))
    }
  }

  // ISO ordena alfabéticamente igual que cronológicamente.
  const sorted = new Map<string, string[]>()
  for (const [key, days] of daysByItem) {
    sorted.set(key, [...days].sort())
  }

  const positions = new Map<string, DayPosition>()
  for (const item of items) {
    const days = sorted.get(`${item.developerId}|${item.workItemId}`) ?? []
    const index = days.indexOf(itemDate(item))

    positions.set(blockKey(item), {
      day: index + 1,
      days: days.length,
      // Un tramo que no se encontró en su propio grupo no se afirma como entrega: el marcador
      // tiene que ser cierto o no estar.
      delivery: index >= 0 && index === days.length - 1,
    })
  }

  return positions
}

/**
 * El estado visual del tramo.
 *
 * **El plan manda en lo que el plan sabe y la renegociación en lo que sabe ella.** Un tramo que el
 * motor movió está `DESPLAZADO` hasta que la lectura de acuerdos diga otra cosa: `ACORDADO_GLPI`,
 * `ACORDADO_MANUAL` o `PENDIENTE_DE_ACUERDO`. Cuando no hay lectura de acuerdos —el calendario de un
 * plan suelto, que no pide la lista— el estado es el del plan y ningún tramo se pinta como acuerdo.
 */
export function blockState(
  item: Pick<TimelineItem, 'workItemId' | 'planningStatus'>,
  agreed?: Readonly<Record<string, TimelineState>>,
): TimelineState {
  return (
    agreed?.[item.workItemId] ??
    (item.planningStatus === 'DESPLAZADO' ? 'DESPLAZADO' : 'PLANIFICADO')
  )
}

/**
 * Los tickets que tienen día en GLPI y no tienen tramo porque les faltan las horas.
 *
 * **Es el caso que la rejilla escondía.** Un ticket sin estimación no entra al motor, así que no
 * existe en ningún plan y ningún tramo lo menciona: mirando solo los tramos, desaparece. Pero su
 * fecha sí existe —la publica GLPI— y el negocio necesita verlo en ese día para acordarse de que hay
 * que estimarlo. El 68428 es el caso testigo.
 *
 * **Se filtra la ventana aquí y no en la rejilla**: fuera de la ventana no hay columna donde
 * ponerlo, y devolverlo sería pedirle a la vista que decida qué hacer con lo que no cabe.
 */
export function unscheduledOf(
  declarations: Readonly<Record<string, DeveloperDeclarationsResponse>>,
  plannedIds: ReadonlySet<string>,
  window: { from: string | null; to: string | null },
): UnscheduledItem[] {
  const unscheduled: UnscheduledItem[] = []

  for (const [developerId, declaration] of Object.entries(declarations)) {
    for (const item of declaration.items) {
      // `SIN_ESTIMACION` es «tiene fecha y no tiene horas», que es exactamente el caso. Los otros
      // estados no tienen día (`SIN_DECLARACION` puede no tener ninguna de las dos cosas) o ya
      // están planificados.
      if (item.declarationStatus !== 'SIN_ESTIMACION' || item.operationalDate === null) {
        continue
      }
      if (plannedIds.has(item.workItemId)) {
        continue
      }
      if (window.from !== null && item.operationalDate < window.from) {
        continue
      }
      if (window.to !== null && item.operationalDate > window.to) {
        continue
      }

      unscheduled.push({
        workItemId: item.workItemId,
        workItemType: item.type,
        developerId,
        date: item.operationalDate,
        // La hora viaja con la fecha desde la Fase 72: el Internal TTR es una fecha-hora y la
        // rejilla necesita la parte del reloj para poner el ticket en su sitio. `HH:mm:ss` se
        // recorta a `HH:mm`, que es lo unico que se pinta.
        time: item.operationalTime ? item.operationalTime.slice(0, 5) : null,
        cause: PENDING_CAUSE_LABEL.SIN_ESTIMACION,
      })
    }
  }

  return unscheduled
}

/** Alto del marcador de un ticket sin estimación, en píxeles. */
export const UNSCHEDULED_HEIGHT = 18

/** Dónde cae un marcador sin estimación dentro del cuerpo de su día. */
export interface UnscheduledPlacement {
  /** Distancia desde el borde superior del día, en píxeles. */
  top: number
  /** Alto fijo: el ticket no declara horas, así que el marcador no mide trabajo. */
  height: number
  /** Su hora no está donde se pinta: cae fuera del eje y hubo que pegarlo al borde del día. */
  outside: boolean
}

/** Minutos desde medianoche de una hora del contrato (`13:53`). */
function clockMinutes(time: string): number {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return hour * 60 + minute
}

/**
 * Dónde se pinta cada ticket sin estimación dentro del eje del día.
 *
 * **La posición sale de la hora del Internal TTR** y no de un cálculo de horas: el ticket dice
 * cuándo vence, no cuánto dura, así que el marcador tiene alto fijo y **no consume capacidad**. Si
 * no hay hora —GLPI publicó solo la fecha—, cae al inicio del día, que es lo poco que se sabe.
 *
 * **Las colisiones se apilan hacia abajo.** Varios tickets a la misma hora se dibujan uno debajo de
 * otro, separados por un alto de marcador, en el orden de su hora; el que llega después queda
 * debajo y conserva su posición real mientras haya sitio. Si el grupo no cabe en el día, **sube
 * entero** lo justo para que el último toque el borde: desplazar solo el que sobra borraría el
 * orden y sacaría al resto de su hora sin decirlo.
 *
 * Un marcador cuya hora cae fuera del eje —el eje lo fija el plan, no los compromisos— se pega al
 * borde más cercano y se marca `outside`, para que la vista pueda decir la hora exacta en el texto
 * en vez de fingir que esa posición es la hora.
 */
export function unscheduledPlacements(
  ghosts: readonly UnscheduledItem[],
  axis: HourAxis,
  hourHeight: number,
  bodyHeight: number,
): Map<string, UnscheduledPlacement> {
  const byCell = new Map<string, UnscheduledItem[]>()

  for (const ghost of ghosts) {
    const key = `${ghost.developerId}|${ghost.date}`
    const bucket = byCell.get(key)

    if (bucket) {
      bucket.push(ghost)
    } else {
      byCell.set(key, [ghost])
    }
  }

  const placements = new Map<string, UnscheduledPlacement>()
  const minutesOf = (ghost: UnscheduledItem) =>
    ghost.time === null ? axis.startMinutes : clockMinutes(ghost.time)

  for (const cell of byCell.values()) {
    const ordered = [...cell].sort((left, right) => minutesOf(left) - minutesOf(right))
    const wanted = ordered.map(
      (ghost) => ((minutesOf(ghost) - axis.startMinutes) / 60) * hourHeight,
    )

    const stacked: number[] = []
    let cursor = 0

    for (const position of wanted) {
      // `Math.max` es la pila: nunca por encima de donde le toca, y nunca encima del anterior.
      const top = Math.max(position, cursor)
      stacked.push(top)
      cursor = top + UNSCHEDULED_HEIGHT
    }

    const overflow = Math.max(0, cursor - bodyHeight)

    ordered.forEach((ghost, index) => {
      const top = Math.max(0, (stacked[index] ?? 0) - overflow)
      placements.set(ghost.workItemId, {
        top,
        height: UNSCHEDULED_HEIGHT,
        outside: Math.abs(top - (wanted[index] ?? 0)) > 0.5,
      })
    })
  }

  return placements
}

/**
 * Lo que la fila de una persona dice bajo su nombre: lo que ningún contador dice ya.
 *
 * La Fase 74 quitó «Sin plan» —un dato del documento leído como un dato de la persona— y puso en su
 * lugar el hecho más completo que la fila podía afirmar. La Fase 75 quita también ese hecho cuando
 * lo dice un contador: «Sin estimación» encima de un chip «7 pendientes» repite lo mismo dos veces, y
 * «Sin tramos» encima de un chip «3 pendientes» también.
 *
 * Queda solo lo que nadie más dice:
 *
 * - `TRAMOS` — cuántos tramos tiene colocados. Es una cifra, y la rejilla no la da en otro sitio.
 * - `SIN_TRABAJO` — no hay nada: ni tramos, ni compromisos, ni pendientes ni recuperables.
 *
 * Cuando hay trabajo pero no tramos, la fila **no** inventa una etiqueta: los chips de pendientes y
 * de recuperables ya lo cuentan, y los marcadores del eje ya lo dibujan.
 */
export type ResourcePresenceKind = 'TRAMOS' | 'SIN_TRABAJO'

/** Lo que la fila de una persona cuenta de su trabajo. */
export interface ResourcePresence {
  kind: ResourcePresenceKind
  label: string
}

/** Las cuatro cifras de las que sale lo que la fila dice, y de las que sale su silencio. */
export interface ResourceWork {
  /** Tramos del plan que son de esta persona. */
  tramos: number
  /** Compromisos con fecha de GLPI y sin horas: los marcadores de la rejilla. */
  sinEstimacion: number
  /** Tickets que el motor dejó fuera del plan vigente. */
  pendientes: number
  /** De los pendientes, los que una declaración desbloquea. */
  recuperables: number
}

export function resourcePresence({
  tramos,
  sinEstimacion,
  pendientes,
  recuperables,
}: ResourceWork): ResourcePresence | null {
  if (tramos > 0) return { kind: 'TRAMOS', label: countOf(tramos, 'tramo', 'tramos') }
  // Hay trabajo y lo cuentan los chips: la fila se calla en vez de repetirlo.
  if (sinEstimacion > 0 || pendientes > 0 || recuperables > 0) return null
  return { kind: 'SIN_TRABAJO', label: 'Sin trabajo activo' }
}

/**
 * Cuántos días hacia delante cuenta como «próxima» una entrega.
 *
 * Tres es la ventana que el negocio pidió: lo que vence dentro de la semana en curso todavía se
 * puede atender, y lo que vence pasado mañana ya hay que mirarlo.
 */
export const RISK_HORIZON_DAYS = 3

/**
 * Cuánto apremia un día comprometido, contado desde `today`.
 *
 * **No es una segunda versión de la regla de la declaración.** El backend decide si un ticket es
 * planificable y si su compromiso *declarado* venció (`commitmentOverdue`); esto compara la fecha con
 * la que GLPI ubica el ticket —el Internal TTR— contra el día del navegador, que es lo único que la
 * vista tiene para responder «qué vence esta semana» sin una lectura más. Los dos pueden discrepar, y
 * por eso el riesgo se enseña como un eje aparte y no reemplaza al estado del tramo.
 *
 * Se comparan fechas y no instantes: dos tickets que vencen el 2 de noviembre vencen el mismo día
 * aunque uno lo haga a las 01:00 y el otro a las 23:00.
 */
export function riskOf(date: string, today: string): CommitmentRisk {
  const days = dayGap(today, date)

  if (days < 0) return 'VENCIDA'
  if (days === 0) return 'HOY'
  if (days <= RISK_HORIZON_DAYS) return 'PROXIMA'
  return 'FUTURA'
}

/**
 * El riesgo de cada ticket del equipo, por identificador.
 *
 * Sale de la declaración y no del tramo porque **el tramo no siempre está donde manda el
 * compromiso**: un plan guardado antes de que GLPI moviera el TTR coloca el trabajo en la fecha
 * vieja, y leer el riesgo del último tramo diría «vencido» de un ticket que vence en diciembre. La
 * fecha que manda es la operativa, que es la que el plan obedece hoy.
 *
 * Un ticket sin fecha no entra: no hay compromiso que medir, y eso no es un riesgo sino un hueco del
 * dato, que la declaración publica por su cuenta.
 */
export function commitmentRisksOf(
  declarations: Readonly<Record<string, DeveloperDeclarationsResponse>>,
  today: string,
): Record<string, CommitmentRisk> {
  const risks: Record<string, CommitmentRisk> = {}

  for (const declaration of Object.values(declarations)) {
    for (const item of declaration.items) {
      if (item.operationalDate === null) continue
      risks[item.workItemId] = riskOf(item.operationalDate, today)
    }
  }

  return risks
}

/**
 * Días enteros entre dos fechas del contrato, sin horas: `addDays` al revés y sin zonas.
 *
 * Se recorta a `yyyy-MM-dd` antes de restar porque la resta es de días y no de instantes: sin el
 * recorte, un `2026-10-27T23:59` contra `2026-10-27` da 0,999 días, que redondea a **uno** y
 * convertiría «hoy» en «próxima». Una fecha con hora no cambia el día en que vence.
 */
function dayGap(from: string, to: string): number {
  const start = parseLocalDateTime(from.slice(0, 10))
  const end = parseLocalDateTime(to.slice(0, 10))
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}
