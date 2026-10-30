/**
 * El escenario sintetico del Modo DEMO.
 *
 * **Todo sale de aqui y nada sale de aqui.** No hay una sola llamada a GLPI, ni una lectura de
 * snapshot, ni una escritura: el mundo se arma en memoria relativo al dia del navegador, y las
 * escrituras que la demostracion permite —estimar, acordar— viven en este mismo objeto y mueren al
 * recargar.
 *
 * El escenario esta construido para que **cada estado visual tenga al menos una instancia**: los seis
 * del Timeline, los cuatro grupos de pendientes, los tres modos de renegociacion y las cinco bandas
 * de carga del Gantt. Si se agrega un estado nuevo a la vista, aqui es donde falta su caso.
 *
 * Las fechas son relativas a hoy y no fijas: un escenario clavado en octubre solo demuestra algo ese
 * mes, y las marcas de vencimiento —hoy, vencida, proxima— dependen del reloj del navegador.
 */

import { addDays, localTodayIso, weekStartOf } from '@/lib/timeline'
import type {
  DeclarationItem,
  DeclarationStatus,
  DeveloperDeclarationsResponse,
} from '@/types/declarations'
import type { Renegotiation, RenegotiationChange, RenegotiationItem } from '@/types/renegotiations'
import type { RescheduleEvent } from '@/types/planningMetrics'
import type { TeamPerson } from '@/types/team'
import type {
  IncidentSeverity,
  TeamConflict,
  TeamTimelinePlan,
  TimelineAllocation,
  TimelineCapacity,
  TimelineDisplacement,
  TimelineItem,
  TimelineResource,
  WorkItemType,
} from '@/types/timeline'

/** Hoy, una sola vez: el escenario no cambia a mitad de sesion. */
export const DEMO_TODAY = localTodayIso()

/** El lunes de esta semana: ancla de todas las fechas del escenario. */
const WEEK = weekStartOf(DEMO_TODAY)

/** Primer y ultimo dia de la ventana comun del equipo. */
export const DEMO_FROM = addDays(WEEK, -7)
export const DEMO_TO = addDays(WEEK, 27)

/** Dia relativo a hoy. */
const d = (offset: number): string => addDays(DEMO_TODAY, offset)

/** Dia de una semana del escenario: `week` 0 es esta semana, `index` 0 es lunes. */
const wd = (week: number, index: number): string => addDays(WEEK, week * 7 + index)

/** Cuantos planes guardados tiene cada persona antes de que el DEMO genere uno nuevo. */
const PLAN_COUNT = 3

const planIdOf = (developerId: string, index: number): string => `demo-${developerId}-${index}`

/** Las seis personas y su papel en el escenario. */
export const DEMO_PEOPLE: readonly TeamPerson[] = [
  { developerId: 'atorres', glpiId: 2101, name: 'Ana Torres', active: true, sourceType: 'GLPI', operational: true },
  { developerId: 'cramirez', glpiId: 2102, name: 'Carlos Ramírez', active: true, sourceType: 'GLPI', operational: true },
  { developerId: 'dquintero', glpiId: 2103, name: 'Diego Quintero', active: true, sourceType: 'GLPI', operational: true },
  { developerId: 'jhernandez', glpiId: 2104, name: 'Juan Hernández', active: true, sourceType: 'GLPI', operational: true },
  { developerId: 'mlopez', glpiId: 2105, name: 'María López', active: true, sourceType: 'GLPI', operational: true },
  { developerId: 'smejia', glpiId: 2106, name: 'Sofía Mejía', active: true, sourceType: 'GLPI', operational: true },
]

/** El nombre legible de cada persona, para los sitios que solo tienen el login. */
export const DEMO_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  DEMO_PEOPLE.map((person) => [person.developerId, person.name ?? person.developerId]),
)

/** El titulo de cada ticket. Es lo que lee quien opera, no el identificador. */
const TITLES: Readonly<Record<string, string>> = {
  'REQ-4101': 'Alta de usuario en el portal de proveedores',
  'INC-4102': 'Caída del servicio de pagos',
  'REQ-4103': 'Reporte de cartera por vencimiento',
  'INC-4104': 'Lentitud en la bandeja de radicación',
  'REQ-4105': 'Parametrización de tasas del trimestre',
  'REQ-4201': 'Migración de la tabla de amortización',
  'INC-4202': 'Error 500 en consulta de saldos',
  'REQ-4203': 'Nuevo campo de identificación en el formulario',
  'INC-4204': 'Correo de notificación duplicado',
  'REQ-4205': 'Cierre contable de septiembre',
  'REQ-4301': 'Integración del módulo de cobranza',
  'INC-4302': 'Pantalla en blanco al guardar',
  'REQ-4303': 'Ajuste de plantilla de contrato',
  'INC-4304': 'Sesión expirada antes de tiempo',
  'REQ-4305': 'Validación de firma electrónica',
  'REQ-4401': 'Rediseño de la ficha del cliente',
  'INC-4402': 'Descuadre en el estado de cuenta',
  'REQ-4403': 'Exportación a Excel del histórico',
  'INC-4404': 'Adjuntos que no cargan',
  'REQ-4500': 'Revisión de reglas de negocio',
  'INC-4509': 'Ajuste de permisos en el tablero',
  'REQ-4501': 'Ampliación de cupo en el portal de pagos',
  'INC-4502': 'Reinicio inesperado del servicio de colas',
  'REQ-4503': 'Solicitud de nueva categoría de producto',
  'INC-4504': 'Ticket sin tipo reconocible',
  'REQ-4505': 'Conciliación bancaria automática',
  'REQ-4506': 'Informe regulatorio trimestral',
  'REQ-4601': 'Carga masiva de terceros',
  'INC-4602': 'Error al generar el certificado',
  'REQ-4603': 'Formulario de actualización de datos',
}

/** Una fila de la tabla de bloques del plan vigente. */
interface Block {
  dev: string
  id: string
  type: WorkItemType
  week: number
  day: number
  /** Hora de inicio, en formato 24 h. */
  start: number
  hours: number
  estimate: number
  /** Fecha de compromiso (Internal TTR), o nula en incidentes. */
  committed: string | null
  severity?: IncidentSeverity
  displaced?: Omit<TimelineDisplacement, 'newDate'>
}

/**
 * La agenda del plan vigente.
 *
 * **Las horas por persona no son decorativas: son el escenario de carga.** Ana suma 50 h sobre 40
 * disponibles —critica—, Diego 48 —sobre—, Carlos 38 —llena—, Maria 26 —normal— y Juan 10 —libre—.
 * Sofia no tiene plan. Mover una fila cambia la banda del Gantt, que es justo lo que se quiere ver.
 */
const BLOCKS: readonly Block[] = [
  // Ana Torres — sobrecarga critica (50 h / 40 h = 125 %)
  { dev: 'atorres', id: 'REQ-4101', type: 'REQUERIMIENTO', week: 0, day: 0, start: 8, hours: 10, estimate: 10, committed: d(0) },
  { dev: 'atorres', id: 'INC-4102', type: 'INCIDENTE', week: 0, day: 1, start: 8, hours: 10, estimate: 10, committed: null, severity: 'ALTO' },
  {
    dev: 'atorres', id: 'REQ-4103', type: 'REQUERIMIENTO', week: 0, day: 2, start: 8, hours: 10, estimate: 10, committed: d(2),
    displaced: { originalDate: wd(0, 0), appliedRule: 'CAPACIDAD', incidentId: 'INC-4102', incidentSeverity: 'ALTO', reason: 'El incidente de severidad alta ocupó la jornada del lunes.' },
  },
  { dev: 'atorres', id: 'INC-4104', type: 'INCIDENTE', week: 0, day: 3, start: 8, hours: 10, estimate: 10, committed: null, severity: 'MEDIO' },
  { dev: 'atorres', id: 'REQ-4105', type: 'REQUERIMIENTO', week: 0, day: 4, start: 8, hours: 10, estimate: 10, committed: d(-2) },

  // Diego Quintero — sobrecarga (48 h / 40 h = 120 %)
  {
    dev: 'dquintero', id: 'REQ-4201', type: 'REQUERIMIENTO', week: 0, day: 0, start: 8, hours: 8, estimate: 8, committed: d(1),
    displaced: { originalDate: wd(-1, 4), appliedRule: 'CAPACIDAD', incidentId: null, incidentSeverity: null, reason: 'La jornada anterior ya estaba ocupada al calcular el plan.' },
  },
  { dev: 'dquintero', id: 'INC-4202', type: 'INCIDENTE', week: 0, day: 1, start: 8, hours: 10, estimate: 10, committed: null, severity: 'ALTO' },
  { dev: 'dquintero', id: 'REQ-4203', type: 'REQUERIMIENTO', week: 0, day: 2, start: 8, hours: 10, estimate: 10, committed: d(10) },
  { dev: 'dquintero', id: 'INC-4204', type: 'INCIDENTE', week: 0, day: 3, start: 8, hours: 10, estimate: 10, committed: null, severity: 'BAJO' },
  { dev: 'dquintero', id: 'REQ-4205', type: 'REQUERIMIENTO', week: 0, day: 4, start: 8, hours: 10, estimate: 10, committed: d(-1) },

  // Carlos Ramírez — jornada llena (38 h / 40 h = 95 %)
  {
    dev: 'cramirez', id: 'REQ-4301', type: 'REQUERIMIENTO', week: 0, day: 0, start: 8, hours: 8, estimate: 8, committed: d(5),
    displaced: { originalDate: wd(-1, 2), appliedRule: 'INCIDENTE_ALTO', incidentId: 'INC-4302', incidentSeverity: 'ALTO', reason: 'Un incidente alto desplazó el requerimiento.' },
  },
  { dev: 'cramirez', id: 'INC-4302', type: 'INCIDENTE', week: 0, day: 1, start: 8, hours: 8, estimate: 8, committed: null, severity: 'ALTO' },
  { dev: 'cramirez', id: 'REQ-4303', type: 'REQUERIMIENTO', week: 0, day: 2, start: 8, hours: 8, estimate: 8, committed: d(0) },
  { dev: 'cramirez', id: 'INC-4304', type: 'INCIDENTE', week: 0, day: 3, start: 8, hours: 8, estimate: 8, committed: null, severity: 'MEDIO' },
  { dev: 'cramirez', id: 'REQ-4305', type: 'REQUERIMIENTO', week: 0, day: 4, start: 8, hours: 6, estimate: 6, committed: d(2) },

  // María López — carga normal (26 h / 40 h = 65 %)
  {
    dev: 'mlopez', id: 'REQ-4401', type: 'REQUERIMIENTO', week: 0, day: 0, start: 8, hours: 8, estimate: 8, committed: d(8),
    displaced: { originalDate: wd(-1, 3), appliedRule: 'CAPACIDAD', incidentId: null, incidentSeverity: null, reason: 'El plan lo movió a la primera jornada con hueco.' },
  },
  { dev: 'mlopez', id: 'INC-4402', type: 'INCIDENTE', week: 0, day: 1, start: 8, hours: 6, estimate: 6, committed: null, severity: 'MEDIO' },
  { dev: 'mlopez', id: 'REQ-4403', type: 'REQUERIMIENTO', week: 0, day: 2, start: 8, hours: 6, estimate: 6, committed: d(-3) },
  { dev: 'mlopez', id: 'INC-4404', type: 'INCIDENTE', week: 0, day: 3, start: 8, hours: 6, estimate: 6, committed: null, severity: 'BAJO' },

  // Juan Hernández — con capacidad libre (10 h / 40 h = 25 %)
  { dev: 'jhernandez', id: 'REQ-4500', type: 'REQUERIMIENTO', week: 0, day: 0, start: 8, hours: 6, estimate: 6, committed: d(4) },
  { dev: 'jhernandez', id: 'INC-4509', type: 'INCIDENTE', week: 0, day: 1, start: 8, hours: 4, estimate: 4, committed: null, severity: 'BAJO' },
]

/** Los tickets que existen sin bloque: los que dan los cuatro grupos de pendientes. */
interface Loose {
  dev: string
  id: string
  type: WorkItemType | null
  status: DeclarationStatus
  committed: string | null
  time?: string
  priority: number | null
}

const LOOSE: readonly Loose[] = [
  // P1 — falta informacion, en sus cuatro formas.
  { dev: 'jhernandez', id: 'REQ-4501', type: 'REQUERIMIENTO', status: 'SIN_ESTIMACION', committed: d(1), time: '11:30:00', priority: 2 },
  { dev: 'jhernandez', id: 'INC-4502', type: 'INCIDENTE', status: 'SIN_COMPROMISO', committed: null, priority: 3 },
  { dev: 'jhernandez', id: 'REQ-4503', type: 'REQUERIMIENTO', status: 'SIN_DECLARACION', committed: null, priority: 4 },
  { dev: 'jhernandez', id: 'INC-4504', type: null, status: 'NO_TRADUCIBLE', committed: null, priority: null },
  // P2 — el motor lo recibio y no cupo (viaja en `conflicts`).
  { dev: 'jhernandez', id: 'REQ-4505', type: 'REQUERIMIENTO', status: 'PLANIFICABLE', committed: d(4), priority: 2 },
  // P4 — planificable y el plan nunca lo recibio.
  { dev: 'jhernandez', id: 'REQ-4506', type: 'REQUERIMIENTO', status: 'PLANIFICABLE', committed: d(6), priority: 3 },
  // Sofia no tiene plan: su trabajo existe y no esta colocado.
  { dev: 'smejia', id: 'REQ-4601', type: 'REQUERIMIENTO', status: 'SIN_ESTIMACION', committed: d(2), time: '09:00:00', priority: 1 },
  { dev: 'smejia', id: 'INC-4602', type: 'INCIDENTE', status: 'SIN_COMPROMISO', committed: null, priority: 3 },
  { dev: 'smejia', id: 'REQ-4603', type: 'REQUERIMIENTO', status: 'SIN_ESTIMACION', committed: d(5), time: '15:00:00', priority: 2 },
]

/** El trabajo que el motor recibio y no cupo. Es lo que separa P2 de P4. */
export const DEMO_CONFLICTS: readonly TeamConflict[] = [
  {
    developerId: 'jhernandez',
    workItemId: 'REQ-4505',
    workItemType: 'REQUERIMIENTO',
    reason: 'No hay horas disponibles antes de la fecha compromiso.',
  },
]

/** El evento de desplazamiento auditado de un bloque. */
function eventOf(block: Block): RescheduleEvent {
  return {
    timestamp: d(-4) + 'T07:00:00',
    incidentId: block.displaced?.incidentId ?? '',
    requirementId: block.id,
    originalDate: block.displaced?.originalDate ?? '',
    rescheduledDate: wd(block.week, block.day),
    appliedRule: block.displaced?.appliedRule ?? '',
    severity: block.displaced?.incidentSeverity ?? 'BAJO',
    reason: block.displaced?.reason ?? '',
  }
}

const hh = (hour: number): string => `${String(hour).padStart(2, '0')}:00:00`

/** Un bloque tal como lo publica el timeline de su plan. */
function itemOf(block: Block, planId: string): TimelineItem {
  const date = wd(block.week, block.day)
  return {
    workItemId: block.id,
    workItemType: block.type,
    startsAt: `${date}T${hh(block.start)}`,
    endsAt: `${date}T${hh(block.start + block.hours)}`,
    durationHours: block.hours,
    developerId: block.dev,
    estimatedHours: block.estimate,
    committedDate: block.committed,
    severity: block.severity ?? null,
    planningStatus: block.displaced ? 'DESPLAZADO' : 'PLANIFICADO',
    sourcePlanId: planId,
    displacement: block.displaced
      ? { ...block.displaced, newDate: date }
      : null,
  }
}

const WEEKEND = new Set([0, 6])

function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00`).getDay()
}

/** La capacidad de una persona: 8 h de lunes a viernes, cerrado el fin de semana. */
function capacityOf(developerId: string, items: readonly TimelineItem[]): TimelineResource {
  if (developerId === 'smejia') {
    // Sin plan no hay ventana: el Gantt lo pinta como «sin plan» y no como «libre».
    return { developerId, capacity: [] }
  }

  const occupied = new Map<string, number>()

  for (const item of items) {
    if (item.developerId !== developerId) continue
    const date = item.startsAt.slice(0, 10)
    occupied.set(date, (occupied.get(date) ?? 0) + item.durationHours)
  }

  const capacity: TimelineCapacity[] = []

  for (let date = DEMO_FROM; date <= DEMO_TO; date = addDays(date, 1)) {
    const availableHours = WEEKEND.has(weekdayOf(date)) ? 0 : 8
    const occupiedHours = occupied.get(date) ?? 0
    capacity.push({
      date,
      availableHours,
      occupiedHours,
      remainingHours: availableHours - occupiedHours,
    })
  }

  return { developerId, capacity }
}

/** El estado declarado de un ticket planificable con horas. */
function declaredItem(id: string, type: WorkItemType | null, committed: string | null, hours: number): DeclarationItem {
  return {
    workItemId: id,
    type,
    status: 'NUEVO',
    priority: 2,
    createdAt: d(-12) + 'T09:00:00',
    title: TITLES[id] ?? id,
    declarationStatus: 'PLANIFICABLE',
    discards: [],
    declaration: {
      workItemId: id,
      estimatedHours: hours,
      committedDate: null,
      estimatedBy: 'glpi',
      committedBy: null,
      estimatedAt: d(-10) + 'T09:00:00',
      committedAt: null,
      source: 'GLPI',
      commitmentOverdue: committed !== null && committed < DEMO_TODAY,
    },
    operationalDate: committed,
    operationalTime: committed ? '17:30:00' : null,
    operationalDateSource: committed ? 'INTERNAL_TTR' : null,
  }
}

/** El estado de un ticket que no se puede planificar, tal como lo clasifica el validador. */
function pendingItem(loose: Loose): DeclarationItem {
  return {
    workItemId: loose.id,
    type: loose.type,
    status: loose.type === null ? null : 'NUEVO',
    priority: loose.priority,
    createdAt: d(-8) + 'T10:00:00',
    title: TITLES[loose.id] ?? loose.id,
    declarationStatus: loose.status,
    discards:
      loose.status === 'PLANIFICABLE'
        ? []
        : [{ code: loose.status, reason: 'La clasificacion la decidio el validador del backend.' }],
    declaration: null,
    operationalDate: loose.committed,
    operationalTime: loose.time ?? (loose.committed ? '17:30:00' : null),
    operationalDateSource: loose.committed ? 'INTERNAL_TTR' : null,
  }
}

/** Lo que el Modo DEMO guarda en memoria: lo unico que una escritura puede cambiar. */
export interface DemoStore {
  items: readonly TimelineItem[]
  declarations: Record<string, DeveloperDeclarationsResponse>
  renegotiations: RenegotiationItem[]
  histories: Record<string, RenegotiationChange[]>
  /** Los planes que la demostracion genera al pulsar «generar plan». */
  generated: Record<string, TeamTimelinePlan[]>
}

let store: DemoStore | null = null

function build(): DemoStore {
  const currentPlan = (dev: string) => planIdOf(dev, PLAN_COUNT)
  const items = BLOCKS.map((block) => itemOf(block, currentPlan(block.dev)))

  const declarations: Record<string, DeveloperDeclarationsResponse> = {}

  for (const person of DEMO_PEOPLE) {
    const own = items
      .filter((item) => item.developerId === person.developerId)
      .map((item) => declaredItem(item.workItemId, item.workItemType, item.committedDate, item.estimatedHours))

    const loose = LOOSE.filter((row) => row.dev === person.developerId).map(pendingItem)

    declarations[person.developerId] = {
      developer: { id: person.developerId, name: person.name },
      items: [...own, ...loose],
      source: { glpi: 'DEMO', declaration: 'DEMO' },
    }
  }

  const renegotiations: RenegotiationItem[] = [
    {
      developerId: 'atorres',
      planId: planIdOf('atorres', PLAN_COUNT),
      calculatedAt: d(-4) + 'T07:00:00',
      workItemId: 'REQ-4103',
      status: 'PENDIENTE_DE_ACUERDO',
      events: [eventOf(BLOCKS.find((block) => block.id === 'REQ-4103') as Block)],
      renegotiation: null,
    },
    {
      developerId: 'cramirez',
      planId: planIdOf('cramirez', PLAN_COUNT),
      calculatedAt: d(-4) + 'T07:00:00',
      workItemId: 'REQ-4301',
      status: 'ACORDADA',
      events: [eventOf(BLOCKS.find((block) => block.id === 'REQ-4301') as Block)],
      renegotiation: {
        workItemId: 'REQ-4301',
        agreedDate: wd(0, 0),
        agreedBy: 'conciliacion-glpi',
        agreedReason: 'Conciliado automaticamente desde el Internal TTR del ticket.',
        agreedAt: d(-3) + 'T06:30:00',
        source: 'GLPI',
      },
    },
    {
      developerId: 'mlopez',
      planId: planIdOf('mlopez', PLAN_COUNT),
      calculatedAt: d(-4) + 'T07:00:00',
      workItemId: 'REQ-4401',
      status: 'ACORDADA',
      events: [eventOf(BLOCKS.find((block) => block.id === 'REQ-4401') as Block)],
      renegotiation: {
        workItemId: 'REQ-4401',
        agreedDate: wd(0, 0),
        agreedBy: 'jhernandez',
        agreedReason: 'Se acordó con el solicitante aplazarlo al lunes siguiente.',
        agreedAt: d(-2) + 'T15:20:00',
        source: 'HTTP',
      },
    },
  ]

  return { items, declarations, renegotiations, histories: {}, generated: {} }
}

/** El mundo del escenario. Se arma una vez por carga de pagina. */
export function demoStore(): DemoStore {
  return (store ??= build())
}

/** Descarta las escrituras de la demostracion. Solo lo usa la suite de pruebas. */
export function resetDemoStore(): void {
  store = null
}

/** Los bloques del plan `index` (1..3). El vigente es `PLAN_COUNT`; uno generado trae todo. */
export function itemsForPlan(index: number): TimelineItem[] {
  const all = demoStore().items

  if (index >= PLAN_COUNT) {
    return [...all]
  }

  const drop = PLAN_COUNT - index
  const byDeveloper = new Map<string, TimelineItem[]>()

  for (const item of all) {
    const list = byDeveloper.get(item.developerId) ?? []
    list.push(item)
    byDeveloper.set(item.developerId, list)
  }

  return [...byDeveloper.values()].flatMap((list) => list.slice(0, Math.max(list.length - drop, 0)))
}

/** El plan vigente de cada persona, del mas antiguo al mas reciente. */
export function plansOf(developerId: string): TeamTimelinePlan[] {
  const span = (items: readonly TimelineItem[]) =>
    items.length === 0
      ? { from: null, to: null }
      : {
          from: items.map((item) => item.startsAt.slice(0, 10)).sort()[0],
          to: items.map((item) => item.startsAt.slice(0, 10)).sort().at(-1) ?? null,
        }

  const saved = Array.from({ length: PLAN_COUNT }, (_, position) => {
    const index = position + 1
    const items = itemsForPlan(index).filter((item) => item.developerId === developerId)
    return {
      developerId,
      planId: planIdOf(developerId, index),
      ...span(items),
    }
  })

  const generated = demoStore().generated[developerId] ?? []

  return [...saved, ...generated]
}

/** La agenda del equipo tal como la publica `GET /api/planning/team/timeline`. */
export function teamResources(): TimelineResource[] {
  return DEMO_PEOPLE.map((person) => capacityOf(person.developerId, demoStore().items))
}

/** Las asignaciones de un plan, derivadas de sus tramos. */
export function allocationsOf(items: readonly TimelineItem[]): TimelineAllocation[] {
  return items.map((item) => ({
    workItemId: item.workItemId,
    workItemType: item.workItemType,
    developerId: item.developerId,
    date: item.startsAt.slice(0, 10),
    hours: item.durationHours,
  }))
}

/** Un acuerdo nuevo, con el sello del momento en que la demostracion lo registra. */
export function newAgreement(workItemId: string, agreedDate: string, agreedBy: string, agreedReason: string): Renegotiation {
  return {
    workItemId,
    agreedDate,
    agreedBy,
    agreedReason,
    agreedAt: new Date().toISOString(),
    source: 'HTTP',
  }
}
