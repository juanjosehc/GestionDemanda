import { isActive } from '@/lib/incidents'
import {
  addDays,
  blockState,
  formatWeek,
  isoDate,
  isoWeekNumber,
  parseLocalDateTime,
  riskOf,
  weekStartOf,
} from '@/lib/timeline'
import type { DeveloperDeclarationsResponse } from '@/types/declarations'
import type {
  CommitmentRisk,
  IncidentSeverity,
  TimelineItem,
  TimelineResource,
  TimelineState,
  UnscheduledItem,
  WorkItemType,
} from '@/types/timeline'

/**
 * Ayudantes puros de la vista de capacidad: periodos, ocupacion y barras.
 *
 * **No calcula planificacion.** Todo lo que suma —horas disponibles, ocupadas y restantes— ya viene
 * calculado por el motor en la capacidad diaria de cada recurso; esta capa solo recorta al periodo
 * visible y suma. Ni una regla de calendario, ni un desplazamiento, ni un umbral del motor vive aqui.
 *
 * Es el mismo principio que `lib/timeline.ts`: si el motor cambia lo que publica, cambia esta capa y
 * no la vista.
 */

/** Las tres escalas de la vista. Solo cambian el ancho de los dias y el rotulo, no los datos. */
export type CapacityView = 'semana' | 'mes' | 'trimestre'

/** Opciones del conmutador, con su rotulo. */
export const CAPACITY_VIEWS: readonly { value: CapacityView; label: string }[] = [
  { value: 'semana', label: 'Semanal' },
  { value: 'mes', label: 'Mensual' },
  { value: 'trimestre', label: 'Trimestral' },
]

/** Ancho de cada columna de dia, en pixeles. La vista trimestral se lee con scroll horizontal. */
export const DAY_WIDTH: Record<CapacityView, number> = {
  semana: 104,
  mes: 40,
  trimestre: 18,
}

/** El primer dia del periodo que contiene al ancla, en formato del contrato. */
export function periodStart(view: CapacityView, anchor: string): string {
  const date = parseLocalDateTime(anchor)

  if (view === 'semana') {
    return weekStartOf(anchor)
  }

  if (view === 'mes') {
    return isoDate(new Date(date.getFullYear(), date.getMonth(), 1))
  }

  return isoDate(new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1))
}

/** El ultimo dia del periodo, inclusive. */
export function periodEnd(view: CapacityView, anchor: string): string {
  const date = parseLocalDateTime(anchor)

  if (view === 'semana') {
    return addDays(weekStartOf(anchor), 6)
  }

  if (view === 'mes') {
    return isoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0))
  }

  return isoDate(new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3 + 3, 0))
}

/**
 * El ancla del periodo siguiente o anterior.
 *
 * Se mueve por periodos completos y no por dias: en mensual, «siguiente» es el primer dia del mes
 * siguiente, aunque el ancla estuviera a mitad de mes. La semana la devuelve su lunes.
 */
export function shiftPeriod(view: CapacityView, anchor: string, delta: number): string {
  const date = parseLocalDateTime(anchor)

  if (view === 'semana') {
    return addDays(weekStartOf(anchor), 7 * delta)
  }

  if (view === 'mes') {
    return isoDate(new Date(date.getFullYear(), date.getMonth() + delta, 1))
  }

  return isoDate(new Date(date.getFullYear(), date.getMonth() + 3 * delta, 1))
}

/** Todos los dias del periodo, en orden. El tope es una defensa, no un caso esperado. */
export function daysBetween(start: string, end: string): string[] {
  const days: string[] = []
  let cursor = start

  while (cursor <= end && days.length < 400) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }

  return days
}

const MONTH_FORMAT = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' })
const PERCENT_FORMAT = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

/** El rotulo del periodo que se esta viendo. */
export function periodLabel(view: CapacityView, start: string): string {
  if (view === 'semana') {
    return formatWeek(start)
  }

  if (view === 'mes') {
    return MONTH_FORMAT.format(parseLocalDateTime(start))
  }

  const date = parseLocalDateTime(start)
  return `T${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`
}

/** «118 %», sin decimales: la cifra es para leer de un vistazo, no para conciliar. */
export function formatPercent(percent: number): string {
  return `${PERCENT_FORMAT.format(percent)} %`
}

/**
 * Las bandas de ocupacion que pidio el negocio.
 *
 * **Los cortes se resuelven hacia abajo en el limite.** Un 60 % exacto ya es «ocupado» y no
 * «disponible», y un 100 % exacto es «al limite» —la jornada esta llena y no rebasada—: la
 * sobrecarga empieza en el primer decimal por encima de 100, que es justo lo que el backend publica
 * como restante negativo. Asi el color y el numero nunca se contradicen.
 */
export type OccupancyBand = 'libre' | 'normal' | 'lleno' | 'sobre' | 'critico' | 'sin-plan'

export function occupancyBand(percent: number | null): OccupancyBand {
  if (percent === null) return 'sin-plan'
  if (percent < 60) return 'libre'
  if (percent < 90) return 'normal'
  if (percent <= 100) return 'lleno'
  if (percent <= 120) return 'sobre'
  return 'critico'
}

/** Rotulo y clases de cada banda, en un solo sitio. El texto acompaña siempre al color. */
export const BAND: Record<OccupancyBand, { label: string; chip: string; dot: string }> = {
  libre: {
    label: 'Con margen',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
  },
  normal: {
    label: 'Ocupado',
    chip: 'border-sky-200 bg-sky-50 text-sky-700',
    dot: 'bg-sky-500',
  },
  lleno: {
    label: 'Al límite',
    chip: 'border-amber-200 bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
  },
  sobre: {
    label: 'Sobrecarga',
    chip: 'border-orange-200 bg-orange-50 text-orange-700',
    dot: 'bg-orange-500',
  },
  critico: {
    label: 'Sobrecarga crítica',
    chip: 'border-red-200 bg-red-50 text-red-700',
    dot: 'bg-red-500',
  },
  'sin-plan': {
    label: 'Sin plan',
    chip: 'border-border bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/40',
  },
}

/** La carga de una persona en el periodo visible. */
export interface DeveloperLoad {
  developerId: string
  availableHours: number
  occupiedHours: number
  /** Suma de los restantes del backend; puede ser negativa y se enseña tal cual. */
  remainingHours: number
  /** Cuantos dias del periodo tienen capacidad declarada. Cero es «sin plan en el periodo». */
  coveredDays: number
  /** Trabajos distintos con al menos un tramo en el periodo. */
  jobs: number
  /** `ocupadas / disponibles`, o nulo cuando no hay capacidad que cubra el periodo. */
  percent: number | null
}

/**
 * La carga de una persona, sumando la capacidad que el motor ya calculo.
 *
 * **No se recalcula nada**: `availableHours` y `occupiedHours` son los del backend. Lo unico que se
 * hace es recortar a los dias del periodo visible, porque la capacidad de un recurso cubre toda la
 * ventana de su plan y aqui solo interesa la parte que se esta mirando.
 */
export function loadOf(
  developerId: string,
  resource: TimelineResource | undefined,
  days: readonly string[],
  items: readonly TimelineItem[],
): DeveloperLoad {
  const window = new Set(days)
  const capacities = (resource?.capacity ?? []).filter((day) => window.has(day.date))

  const availableHours = sum(capacities.map((day) => day.availableHours))
  const occupiedHours = sum(capacities.map((day) => day.occupiedHours))
  const remainingHours = sum(capacities.map((day) => day.remainingHours))

  const jobs = new Set(
    items
      .filter((item) => item.developerId === developerId && window.has(item.startsAt.slice(0, 10)))
      .map((item) => item.workItemId),
  ).size

  return {
    developerId,
    availableHours,
    occupiedHours,
    remainingHours,
    coveredDays: capacities.length,
    jobs,
    percent: availableHours > 0 ? (occupiedHours / availableHours) * 100 : null,
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** Una barra del Gantt: los tramos de un trabajo, agrupados por persona. */
export interface CapacityBar {
  key: string
  developerId: string
  workItemId: string
  workItemType: WorkItemType
  /** Indice del primer y del ultimo dia del periodo que ocupa. Inclusivo. */
  startIndex: number
  endIndex: number
  /** Dias del periodo que ocupa. */
  days: number
  /** Horas que consumen los tramos visibles. */
  hours: number
  /** Total estimado del elemento, tal como lo trae la foto. */
  estimatedHours: number
  severity: IncidentSeverity | null
  /** Carril dentro de la fila: dos trabajos que comparten dia no se tapan. */
  lane: number
  /**
   * El estado visual del tramo, ya resuelto por `blockState` —la misma funcion del Timeline—.
   *
   * No se decide aqui ni con otra regla: la pagina le pasa el mapa de acuerdos y esta capa lo aplica.
   * Es lo que garantiza que el mismo ticket tenga el mismo color en las dos pantallas.
   */
  state: TimelineState
  /** Cuanto apremia el compromiso (Internal TTR), o nulo si el ticket no tiene fecha en GLPI. */
  risk: CommitmentRisk | null
  /** La fecha de entrega que publica GLPI, en ISO, o nula si el ticket no se ubica por promesa. */
  delivery: string | null
}

/** Lo que el ticket comprometio del lado de GLPI: cuando vence y cuanto apremia. */
export interface Commitment {
  /** Dia del Internal TTR, en ISO. */
  date: string
  /** Hora del compromiso como `HH:mm`, o nula si GLPI publico la fecha sin hora. */
  time: string | null
  risk: CommitmentRisk
}

/**
 * El compromiso de cada ticket, por identificador.
 *
 * **La fecha no se recalcula: la publica la declaracion.** Lo unico que se añade es el riesgo, y sale
 * de `riskOf`, la misma funcion que usa el Timeline para pintar sus fichas de entrega. Asi la
 * bandera roja de una barra y la de un tramo no pueden discrepar.
 */
export function commitmentsOf(
  declarations: Readonly<Record<string, DeveloperDeclarationsResponse>>,
  today: string,
): Record<string, Commitment> {
  const commitments: Record<string, Commitment> = {}

  for (const declaration of Object.values(declarations)) {
    for (const item of declaration.items) {
      if (item.operationalDate === null) continue

      commitments[item.workItemId] = {
        date: item.operationalDate,
        time: item.operationalTime,
        risk: riskOf(item.operationalDate, today),
      }
    }
  }

  return commitments
}

/**
 * Las barras de la vista, agrupando los tramos de un mismo trabajo.
 *
 * El plan parte el trabajo en **un tramo por dia**, asi que pintar los tramos sueltos daria una
 * hilera de bloques de un dia sin decir que son el mismo ticket. Agrupar por elemento y persona,
 * quedandose con el primer y el ultimo dia, es lo que convierte esos tramos en la barra que el
 * negocio espera ver. No se mueve nada: los dias son los que el motor coloco.
 *
 * Los tramos fuera del periodo se descartan, y por eso una barra que empieza antes del periodo se
 * recorta en el primer dia visible en vez de dibujarse fuera del lienzo.
 */
export function barsOf(
  items: readonly TimelineItem[],
  days: readonly string[],
  visual: {
    states?: Readonly<Record<string, TimelineState>>
    commitments?: Readonly<Record<string, Commitment>>
  } = {},
): CapacityBar[] {
  const indexOf = new Map(days.map((day, index) => [day, index]))
  const byWork = new Map<string, CapacityBar>()

  for (const item of items) {
    const index = indexOf.get(item.startsAt.slice(0, 10))

    if (index === undefined) {
      continue
    }

    const key = `${item.developerId}|${item.workItemId}`
    const existing = byWork.get(key)

    if (existing) {
      existing.startIndex = Math.min(existing.startIndex, index)
      existing.endIndex = Math.max(existing.endIndex, index)
      existing.hours += item.durationHours
      existing.days = existing.endIndex - existing.startIndex + 1
    } else {
      const commitment = visual.commitments?.[item.workItemId]

      byWork.set(key, {
        key,
        developerId: item.developerId,
        workItemId: item.workItemId,
        workItemType: item.workItemType,
        startIndex: index,
        endIndex: index,
        days: 1,
        hours: item.durationHours,
        estimatedHours: item.estimatedHours,
        severity: item.severity,
        lane: 0,
        state: blockState(item, visual.states),
        risk: commitment?.risk ?? null,
        delivery: commitment?.date ?? null,
      })
    }
  }

  const bars = [...byWork.values()].sort(
    (a, b) =>
      a.developerId.localeCompare(b.developerId) ||
      a.startIndex - b.startIndex ||
      a.workItemId.localeCompare(b.workItemId),
  )

  // Un carril por barra que no se solape con la ultima de ese carril. Dentro de una persona cabe
  // mas de un trabajo en el mismo dia —el motor parte la jornada— y sin carriles se taparian.
  const lastEndByDeveloper = new Map<string, number[]>()

  for (const bar of bars) {
    const lanes = lastEndByDeveloper.get(bar.developerId) ?? []
    let lane = lanes.findIndex((lastEnd) => lastEnd < bar.startIndex)

    if (lane === -1) {
      lane = lanes.length
      lanes.push(bar.endIndex)
    } else {
      lanes[lane] = bar.endIndex
    }

    bar.lane = lane
    lastEndByDeveloper.set(bar.developerId, lanes)
  }

  return bars
}

/** Cuantos carriles necesita una fila. Con cero barras, uno, para que la fila tenga altura. */
export function laneCount(bars: readonly CapacityBar[]): number {
  return Math.max(1, ...bars.map((bar) => bar.lane + 1))
}

/**
 * Los compromisos pendientes de estimar, agrupados por persona y dia del periodo.
 *
 * **No son barras y no se pueden convertir en barras.** Un ticket sin horas no ocupa jornada: si se
 * pintara como una barra de un dia, la lectura seria «trabajo de un dia», que es justo lo que falta
 * por decidir. Van en su propio carril, con su cuenta, y el dia en que GLPI los ubica.
 *
 * Se agrupan porque un dia puede tener diez —hoy los tiene— y diez etiquetas en 104 pixeles no se
 * leen. La ficha del dia lleva a los diez por su identificador y su titulo.
 */
export interface PendingDay {
  key: string
  developerId: string
  /** Indice del dia en el eje visible. */
  dayIndex: number
  /** Cuantos tickets sin estimacion vencen ese dia. */
  count: number
  items: UnscheduledItem[]
}

export function pendingDaysOf(
  unscheduled: readonly UnscheduledItem[],
  days: readonly string[],
): PendingDay[] {
  const indexOf = new Map(days.map((day, index) => [day, index]))
  const byDay = new Map<string, PendingDay>()

  for (const item of unscheduled) {
    const index = indexOf.get(item.date)

    if (index === undefined) continue

    const key = `${item.developerId}|${item.date}`
    const existing = byDay.get(key)

    if (existing) {
      existing.count += 1
      existing.items.push(item)
    } else {
      byDay.set(key, {
        key,
        developerId: item.developerId,
        dayIndex: index,
        count: 1,
        items: [item],
      })
    }
  }

  return [...byDay.values()]
}

/** Cuantos compromisos del periodo caen en cada franja de riesgo. */
export function riskCountsOf(
  commitments: Readonly<Record<string, Commitment>>,
  days: readonly string[],
): Record<Exclude<CommitmentRisk, 'FUTURA'>, number> {
  const first = days[0]
  const last = days[days.length - 1]
  const counts = { VENCIDA: 0, HOY: 0, PROXIMA: 0 }

  if (first === undefined || last === undefined) return counts

  for (const commitment of Object.values(commitments)) {
    if (commitment.date < first || commitment.date > last) continue
    if (commitment.risk !== 'FUTURA') counts[commitment.risk] += 1
  }

  return counts
}

const TYPE_LABEL: Record<WorkItemType, string> = {
  INCIDENTE: 'Incidente',
  REQUERIMIENTO: 'Requerimiento',
}

/**
 * El nombre con el que se rotula una barra.
 *
 * **Sale del titulo que publica la declaracion, no de la agenda**: la agenda solo lleva el
 * identificador. Cuando el ticket no se declaro —o la lectura fallo— se cae al tipo, que es un
 * hecho y no un nombre inventado. El identificador de GLPI no se enseña en la barra; solo viaja en
 * el tooltip y en el nombre accesible, donde el gestor lo lee si necesita rastrearla.
 */
export function shortName(title: string | undefined, type: WorkItemType | null): string {
  const clean = title?.trim()

  if (!clean) {
    return type ? TYPE_LABEL[type] : 'Trabajo'
  }

  return clean.length > 38 ? `${clean.slice(0, 37).trimEnd()}…` : clean
}

/** Los titulos de los tickets del equipo, por identificador. */
export function titlesOf(
  declarations: Readonly<Record<string, DeveloperDeclarationsResponse>>,
): Record<string, string> {
  const titles: Record<string, string> = {}

  for (const declaration of Object.values(declarations)) {
    for (const item of declaration.items) {
      titles[item.workItemId] = item.title
    }
  }

  return titles
}

/**
 * Los tickets activos que esperan estimacion.
 *
 * **No se deduce aqui**: el estado lo clasifica el backend y esta capa solo cuenta. Se filtra por
 * activos con la misma puerta que usan la cobertura y los pendientes, para que el resumen no sume
 * un ticket que el resto de la aplicacion ya considera cerrado.
 */
export function unestimatedCount(
  declarations: Readonly<Record<string, DeveloperDeclarationsResponse>>,
): number {
  let total = 0

  for (const declaration of Object.values(declarations)) {
    total += declaration.items.filter(
      (item) => isActive(item) && item.declarationStatus === 'SIN_ESTIMACION',
    ).length
  }

  return total
}

/** Lo que el resumen ejecutivo enseña del equipo en el periodo. */
export interface CapacitySummary {
  /** Suma de ocupadas sobre suma de disponibles; nulo si nadie tiene plan en el periodo. */
  percent: number | null
  overloaded: number
  availableHours: number
  occupiedHours: number
  remainingHours: number
  /** Personas con plan en el periodo. Es el denominador de `percent`. */
  covered: number
}

/**
 * El resumen del equipo, sumando horas y no promediando porcentajes.
 *
 * Promediar filas le daria el mismo peso a quien tiene cuatro horas de plan que a quien tiene
 * cuarenta, que es justo lo que un gerente no quiere leer.
 */
export function summaryOf(rows: readonly DeveloperLoad[]): CapacitySummary {
  const covered = rows.filter((row) => row.percent !== null)
  const availableHours = sum(covered.map((row) => row.availableHours))
  const occupiedHours = sum(covered.map((row) => row.occupiedHours))

  return {
    percent: availableHours > 0 ? (occupiedHours / availableHours) * 100 : null,
    overloaded: covered.filter((row) => (row.percent ?? 0) > 100).length,
    availableHours,
    occupiedHours,
    remainingHours: sum(covered.map((row) => row.remainingHours)),
    covered: covered.length,
  }
}

/** «S43»: la etiqueta corta con la que la cabecera agrupa los dias. */
export function weekShortLabel(weekStart: string): string {
  return `S${isoWeekNumber(weekStart)}`
}
