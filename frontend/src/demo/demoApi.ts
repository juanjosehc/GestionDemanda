/**
 * El backend simulado del Modo DEMO.
 *
 * **Contesta las mismas rutas que el backend real, con la misma forma, y no sale de memoria.** Cuando
 * el modo esta activo, `apiClient` no abre un socket: le pasa la ruta a esta funcion. Eso es lo que
 * garantiza el contrato del modo —no se llama a GLPI, no se lee un snapshot, no se escribe en la
 * base— sin tocar una sola linea del backend.
 *
 * **Las escrituras no son un agujero en el «solo lectura»: son el mismo contrato que las lecturas.**
 * Una pantalla de demostracion que no deja estimar ni acordar no demuestra el flujo. Lo que si se
 * garantiza es que no persisten: viven en el objeto del escenario y desaparecen al recargar, porque
 * nadie las manda a ningun sitio.
 *
 * El orden de las coincidencias importa: `/api/planning/metrics`, `/api/planning/team/timeline`,
 * `/api/planning/plans/{id}` y `/api/planning/from-glpi` se resuelven **antes** que el comodin
 * `/api/planning/{planId}`, que si no se las tragaria.
 */

import { DEMO_CONFLICTS, DEMO_FROM, DEMO_PEOPLE, DEMO_TO, allocationsOf, demoStore, itemsForPlan, newAgreement, plansOf, teamResources } from '@/demo/demoWorld'
import type {
  DeclarationItem,
  DeveloperDeclarationsResponse,
  PlanningMetadata,
  TeamDeclarationsResponse,
} from '@/types/declarations'
import type { OperationalAlert, OperationalAlertResponse } from '@/types/alerts'
import type { GlpiHealth } from '@/types/glpi'
import type {
  DeclaredGapDetailResponse,
  DisplacedRequirement,
  DisplacedRequirementsResponse,
  PlanningMetadataItem,
  PlanningOperationalMetricsResponse,
  RescheduleEvent,
} from '@/types/planningMetrics'
import type {
  DeveloperPlansResponse,
  PlanningFromGlpiResponse,
  PlanningInputResponse,
  PlanSnapshotResponse,
} from '@/types/planning'
import type { Renegotiation, RenegotiationHistoryResponse, RenegotiationItem, RenegotiationsResponse } from '@/types/renegotiations'
import type { TeamCatalogResponse } from '@/types/team'
import type { TeamTimelineResponse, TimelineItem, TimelinePlanResponse } from '@/types/timeline'

/** Lo que la capa DEMO devuelve: el mismo cuerpo que el backend, y el estado HTTP que lo acompana. */
export interface DemoResponse {
  status: number
  body: unknown
}

const now = (): string => new Date().toISOString()

const ok = (body: unknown): DemoResponse => ({ status: 200, body })

const notFound = (message: string): DemoResponse => ({ status: 404, body: { message } })

const created = (body: unknown): DemoResponse => ({ status: 201, body })

/** El tecnico y la posicion que nombra un identificador de plan del escenario. */
function planInfo(planId: string): { developerId: string; index: number } | null {
  const match = /^demo-(.+)-(\d+)$/.exec(planId)
  return match ? { developerId: match[1], index: Number(match[2]) } : null
}

/** Los tramos de un plan, con su identificador como origen. */
function itemsOfPlan(planId: string): TimelineItem[] {
  const info = planInfo(planId)
  if (!info) return []

  return itemsForPlan(info.index)
    .filter((item) => item.developerId === info.developerId)
    .map((item) => ({ ...item, sourcePlanId: planId }))
}

/** El evento auditado que explica un tramo desplazado. */
function eventOf(item: TimelineItem): RescheduleEvent {
  const displacement = item.displacement
  return {
    timestamp: now(),
    incidentId: displacement?.incidentId ?? '',
    requirementId: item.workItemId,
    originalDate: displacement?.originalDate ?? '',
    rescheduledDate: item.startsAt.slice(0, 10),
    appliedRule: displacement?.appliedRule ?? '',
    severity: displacement?.incidentSeverity ?? 'BAJO',
    reason: displacement?.reason ?? '',
  }
}

/** Todos los tickets del escenario, planificados o no, con su persona. */
function allItems(): { developerId: string; item: DeclarationItem }[] {
  return Object.entries(demoStore().declarations).flatMap(([developerId, declaration]) =>
    declaration.items.map((item) => ({ developerId, item })),
  )
}

function findDeclaration(workItemId: string): DeclarationItem | null {
  return allItems().find((row) => row.item.workItemId === workItemId)?.item ?? null
}

const emptyMetadata = (workItemId: string): PlanningMetadata => ({
  workItemId,
  estimatedHours: null,
  committedDate: null,
  estimatedBy: null,
  committedBy: null,
  estimatedAt: null,
  committedAt: null,
  source: 'DEMO',
  commitmentOverdue: false,
})

/** El bloque de planificacion declarada del tablero. */
function declaredMetrics(): PlanningOperationalMetricsResponse['declared'] {
  const rows = allItems().map((row) => row.item)
  const plannable = rows.filter((item) => item.declarationStatus === 'PLANIFICABLE').length

  return {
    source: 'DEMO',
    scope: 'tickets activos del equipo demo',
    total: rows.length,
    plannable,
    withoutEstimation: { code: 'SIN_ESTIMACION_DECLARADA', count: rows.length - plannable },
  }
}

/** El bloque de planes vigentes del tablero. */
function currentMetrics(): PlanningOperationalMetricsResponse['current'] {
  const resources = teamResources().filter((resource) => resource.capacity.length > 0)
  const capacity = resources.reduce(
    (sum, resource) => ({
      availableHours: sum.availableHours + resource.capacity.reduce((n, day) => n + day.availableHours, 0),
      occupiedHours: sum.occupiedHours + resource.capacity.reduce((n, day) => n + day.occupiedHours, 0),
      remainingHours: sum.remainingHours + resource.capacity.reduce((n, day) => n + day.remainingHours, 0),
    }),
    { availableHours: 0, occupiedHours: 0, remainingHours: 0 },
  )

  const items = demoStore().items
  const byDeveloper = resources.map((resource) => {
    const own = items.filter((item) => item.developerId === resource.developerId)
    const days = resource.capacity.filter((day) => day.availableHours > 0 || day.occupiedHours > 0)
    return {
      developerId: resource.developerId,
      planId: `demo-${resource.developerId}-3`,
      calculatedAt: DEMO_FROM + 'T07:00:00',
      from: days[0]?.date ?? null,
      to: days.at(-1)?.date ?? null,
      capacity: {
        availableHours: resource.capacity.reduce((n, day) => n + day.availableHours, 0),
        occupiedHours: resource.capacity.reduce((n, day) => n + day.occupiedHours, 0),
        remainingHours: resource.capacity.reduce((n, day) => n + day.remainingHours, 0),
      },
      displacedRequirements: new Set(own.filter((item) => item.planningStatus === 'DESPLAZADO').map((item) => item.workItemId)).size,
    }
  })

  return {
    source: 'DEMO',
    scope: 'plan vigente de cada tecnico del equipo demo',
    from: DEMO_FROM,
    to: DEMO_TO,
    capacity,
    displacedRequirements: byDeveloper.reduce((n, row) => n + row.displacedRequirements, 0),
    byDeveloper,
  }
}

function metrics(): PlanningOperationalMetricsResponse {
  return {
    generatedAt: now(),
    declared: declaredMetrics(),
    plans: { source: 'DEMO', scope: 'planes guardados en el escenario', generated: DEMO_PEOPLE.length * 3 },
    current: currentMetrics(),
  }
}

function declaredGap(): DeclaredGapDetailResponse {
  const items: PlanningMetadataItem[] = allItems()
    .filter((row) => row.item.declaration?.estimatedHours === null || row.item.declaration === null)
    .map((row) => row.item.declaration ?? emptyMetadata(row.item.workItemId))

  return {
    gap: 'SIN_ESTIMACION',
    code: 'SIN_ESTIMACION_DECLARADA',
    source: 'DEMO',
    scope: 'tickets activos sin horas declaradas',
    generatedAt: now(),
    items,
  }
}

function displaced(): DisplacedRequirementsResponse {
  const items: DisplacedRequirement[] = []

  for (const person of DEMO_PEOPLE) {
    const own = demoStore().items.filter(
      (item) => item.developerId === person.developerId && item.planningStatus === 'DESPLAZADO',
    )

    for (const item of own) {
      items.push({
        developerId: person.developerId,
        planId: item.sourcePlanId,
        calculatedAt: DEMO_FROM + 'T07:00:00',
        workItemId: item.workItemId,
        events: [eventOf(item)],
      })
    }
  }

  return {
    source: 'DEMO',
    scope: 'desplazamientos del plan vigente',
    generatedAt: now(),
    items,
  }
}

function alerts(): OperationalAlertResponse {
  const resources = teamResources().filter((resource) => resource.capacity.length > 0)
  const over = resources.filter((resource) => {
    const available = resource.capacity.reduce((n, day) => n + day.availableHours, 0)
    const occupied = resource.capacity.reduce((n, day) => n + day.occupiedHours, 0)
    return available > 0 && occupied > available
  }).length

  const overdue = Object.values(demoStore().declarations)
    .flatMap((declaration) => declaration.items)
    .filter((item) => item.operationalDate !== null && item.operationalDate < DEMO_FROM.slice(0, 10))
    .length

  const withoutEstimation = allItems().filter((row) => row.item.declarationStatus === 'SIN_ESTIMACION').length
  const moved = demoStore().items.filter((item) => item.planningStatus === 'DESPLAZADO').length

  const list: OperationalAlert[] = [
    {
      type: 'JORNADA_AGOTADA',
      severity: 'CRITICAL',
      source: 'DEMO',
      scope: 'plan vigente del equipo demo',
      condition: 'Personas con la jornada por encima de su capacidad.',
      count: Math.max(over, 1),
      detailUrl: null,
      generatedAt: now(),
    },
    {
      type: 'COMPROMISO_VENCIDO',
      severity: 'WARNING',
      source: 'DEMO',
      scope: 'declaracion de los tickets activos',
      condition: 'Tickets con el Internal TTR ya vencido.',
      count: Math.max(overdue, 1),
      detailUrl: null,
      generatedAt: now(),
    },
    {
      type: 'SIN_ESTIMACION',
      severity: 'WARNING',
      source: 'DEMO',
      scope: 'tickets activos del equipo demo',
      condition: 'Tickets con fecha en GLPI y sin horas declaradas.',
      count: withoutEstimation,
      detailUrl: '/api/planning/metrics/declared/SIN_ESTIMACION',
      generatedAt: now(),
    },
    {
      type: 'REQUERIMIENTOS_DESPLAZADOS',
      severity: 'INFO',
      source: 'DEMO',
      scope: 'plan vigente del equipo demo',
      condition: 'Requerimientos que el plan movio de fecha.',
      count: moved,
      detailUrl: '/api/planning/metrics/displaced',
      generatedAt: now(),
    },
  ]

  return { generatedAt: now(), alerts: list.filter((alert) => alert.count > 0) }
}

function teamTimeline(): TeamTimelineResponse {
  const resources = teamResources()
  const items = demoStore().items
  const plans = DEMO_PEOPLE.flatMap((person) => plansOf(person.developerId)).filter(
    (plan) => !plan.planId.endsWith('-1') && !plan.planId.endsWith('-2'),
  )

  return {
    from: DEMO_FROM,
    to: DEMO_TO,
    resources,
    items: [...items],
    plans: plans.map((plan) => ({ ...plan, planId: plan.planId })),
    conflicts: [...DEMO_CONFLICTS],
  }
}

function planTimeline(planId: string): TimelinePlanResponse {
  const info = planInfo(planId)
  const items = itemsOfPlan(planId)

  return {
    planId,
    developerId: info?.developerId ?? '',
    from: items.length > 0 ? items.map((item) => item.startsAt.slice(0, 10)).sort()[0] : null,
    to: items.length > 0 ? (items.map((item) => item.startsAt.slice(0, 10)).sort().at(-1) ?? null) : null,
    resources: items.length > 0 ? teamResources().filter((resource) => resource.developerId === info?.developerId) : [],
    items,
    allocations: allocationsOf(items),
  }
}

function planSnapshot(planId: string): PlanSnapshotResponse {
  const info = planInfo(planId)
  const items = itemsOfPlan(planId)
  const developerId = info?.developerId ?? ''

  return {
    planId,
    developerId,
    createdAt: DEMO_FROM + 'T07:00:00',
    allocations: allocationsOf(items),
    rescheduleEvents: items.filter((item) => item.displacement !== null).map(eventOf),
    conflicts: DEMO_CONFLICTS.filter((conflict) => conflict.developerId === developerId).map((conflict) => ({
      workItemId: conflict.workItemId,
      workItemType: conflict.workItemType,
      reason: conflict.reason,
    })),
  }
}

function planInput(planId: string): PlanningInputResponse {
  const info = planInfo(planId)
  const items = itemsOfPlan(planId)

  return {
    planId,
    developerId: info?.developerId ?? '',
    incidents: items
      .filter((item) => item.workItemType === 'INCIDENTE')
      .map((item) => ({ id: item.workItemId, estimatedHours: item.estimatedHours, status: 'NUEVO', severity: item.severity })),
    requirements: items
      .filter((item) => item.workItemType === 'REQUERIMIENTO')
      .map((item) => ({
        id: item.workItemId,
        estimatedHours: item.estimatedHours,
        plannedDate: item.committedDate ?? item.startsAt.slice(0, 10),
        status: 'NUEVO',
      })),
    source: 'DEMO',
    extractedAt: DEMO_FROM + 'T07:00:00',
  }
}

function declarationsOf(developerId: string): DeveloperDeclarationsResponse | null {
  return demoStore().declarations[developerId] ?? null
}

function renegotiations(): RenegotiationsResponse {
  const items = demoStore().renegotiations
  const pending = items.filter((item) => item.status === 'PENDIENTE_DE_ACUERDO').length

  return {
    source: 'DEMO',
    scope: 'requerimientos desplazados del plan vigente',
    generatedAt: now(),
    summary: { displaced: items.length, pending, agreed: items.length - pending },
    items: items.map((item) => ({ ...item })),
  }
}

function findRenegotiation(workItemId: string): RenegotiationItem | null {
  return demoStore().renegotiations.find((item) => item.workItemId === workItemId) ?? null
}

/** Guarda el nuevo estado de una declaracion y devuelve lo que el recurso publica. */
function writeDeclaration(
  workItemId: string,
  estimatedHours: number | null,
  changedBy: string,
): DemoResponse {
  const item = findDeclaration(workItemId)
  if (!item) return notFound(`No hay un ticket ${workItemId} en el escenario DEMO.`)

  const previous = item.declaration ?? emptyMetadata(workItemId)
  const metadata: PlanningMetadata = {
    ...previous,
    workItemId,
    estimatedHours,
    estimatedBy: changedBy,
    estimatedAt: now(),
    source: 'HTTP',
  }

  item.declaration = metadata
  item.declarationStatus = estimatedHours === null ? 'SIN_ESTIMACION' : 'PLANIFICABLE'

  return created(metadata)
}

/** Registra un acuerdo sobre un desplazamiento existente. */
function writeAgreement(
  workItemId: string,
  agreedDate: string,
  agreedBy: string,
  agreedReason: string,
): DemoResponse {
  const item = findRenegotiation(workItemId)
  if (!item) return notFound(`El ticket ${workItemId} no esta desplazado en el escenario DEMO.`)

  const previousDate = item.renegotiation?.agreedDate ?? null
  const agreement: Renegotiation = newAgreement(workItemId, agreedDate, agreedBy, agreedReason)

  item.renegotiation = agreement
  item.status = 'ACORDADA'

  const history = demoStore().histories[workItemId] ?? []
  history.push({ previousDate, newDate: agreedDate, agreedReason, changedBy: agreedBy, changedAt: agreement.agreedAt })
  demoStore().histories[workItemId] = history

  return ok(agreement)
}

/**
 * Contesta una peticion como lo haria el backend.
 *
 * Devuelve `null` cuando la ruta no esta implementada, y entonces `apiClient` falla con un `404`
 * visible: una pantalla rota se nota, en vez de fingir un cuerpo vacio.
 */
export function demoRequest(path: string, method: string, body?: unknown): DemoResponse | null {
  const url = new URL(path, 'http://demo.local')
  const route = url.pathname
  const payload = (body ?? {}) as Record<string, unknown>

  // --- Lecturas que no dependen del plan ------------------------------------------------
  if (method === 'GET' && route === '/api/team') {
    const catalog: TeamCatalogResponse = {
      generatedAt: now(),
      source: { glpi: 'DEMO', exceptions: 'DEMO' },
      glpi: { available: true, groupId: 9001, groupName: 'Mesa de soporte DEMO', detail: null },
      people: [...DEMO_PEOPLE],
      unusedExceptions: [],
      unusedOperational: [],
    }
    return ok(catalog)
  }

  if (method === 'GET' && route === '/api/glpi/health') {
    const health: GlpiHealth = {
      connected: true,
      authenticated: true,
      baseUrl: 'https://glpi.demo.local',
      checkedAt: now(),
      detail: 'Modo DEMO: no se contacta GLPI; esta respuesta es sintetica.',
    }
    return ok(health)
  }

  if (method === 'GET' && route === '/api/planning/alerts') return ok(alerts())
  if (method === 'GET' && route === '/api/planning/metrics') return ok(metrics())
  if (method === 'GET' && route === '/api/planning/metrics/displaced') return ok(displaced())
  if (method === 'GET' && route === '/api/planning/team/timeline') return ok(teamTimeline())

  const declaredMatch = /^\/api\/planning\/metrics\/declared\/([^/]+)$/.exec(route)
  if (method === 'GET' && declaredMatch) {
    const code = decodeURIComponent(declaredMatch[1])
    return code === 'SIN_ESTIMACION' ? ok(declaredGap()) : notFound(`El desglose ${code} no existe en el escenario DEMO.`)
  }

  // --- Planes ---------------------------------------------------------------------------
  if (method === 'POST' && route === '/api/planning/from-glpi') {
    const developerId = String(payload.developerId ?? '')
    if (!declarationsOf(developerId)) return notFound(`El tecnico ${developerId} no esta en el escenario DEMO.`)

    const generated = demoStore().generated[developerId] ?? []
    const planId = `demo-${developerId}-${4 + generated.length}`
    const items = itemsForPlan(99).filter((item) => item.developerId === developerId)
    const dates = items.map((item) => item.startsAt.slice(0, 10)).sort()

    generated.push({ developerId, planId, from: dates[0] ?? null, to: dates.at(-1) ?? null })
    demoStore().generated[developerId] = generated

    const response: PlanningFromGlpiResponse = {
      planId,
      createdAt: now(),
      plan: {
        developerId,
        allocations: allocationsOf(items),
        displacedRequirements: items.filter((item) => item.displacement !== null),
        conflicts: DEMO_CONFLICTS.filter((conflict) => conflict.developerId === developerId),
      },
      discarded: [],
    }
    return created(response)
  }

  const plansMatch = /^\/api\/planning\/plans\/([^/]+)$/.exec(route)
  if (method === 'GET' && plansMatch) {
    const developerId = decodeURIComponent(plansMatch[1])
    if (!declarationsOf(developerId)) return notFound(`El tecnico ${developerId} no esta en el escenario DEMO.`)

    const response: DeveloperPlansResponse = {
      developerId,
      plans: plansOf(developerId).map((plan) => ({ planId: plan.planId, createdAt: DEMO_FROM + 'T07:00:00' })),
      scope: 'DEMO',
    }
    return ok(response)
  }

  const planTimelineMatch = /^\/api\/planning\/([^/]+)\/timeline$/.exec(route)
  if (method === 'GET' && planTimelineMatch) {
    const planId = decodeURIComponent(planTimelineMatch[1])
    return planInfo(planId) ? ok(planTimeline(planId)) : notFound(`No hay un plan ${planId} en el escenario DEMO.`)
  }

  const planInputMatch = /^\/api\/planning\/([^/]+)\/input$/.exec(route)
  if (method === 'GET' && planInputMatch) {
    const planId = decodeURIComponent(planInputMatch[1])
    return planInfo(planId) ? ok(planInput(planId)) : notFound(`No hay un plan ${planId} en el escenario DEMO.`)
  }

  const planMatch = /^\/api\/planning\/([^/]+)$/.exec(route)
  if (method === 'GET' && planMatch) {
    const planId = decodeURIComponent(planMatch[1])
    return planInfo(planId) ? ok(planSnapshot(planId)) : notFound(`No hay un plan ${planId} en el escenario DEMO.`)
  }

  // --- Declaraciones --------------------------------------------------------------------
  if (method === 'GET' && route === '/api/planning-metadata/declarations') {
    const requested = url.searchParams.getAll('developerId')
    const developers = requested.flatMap((developerId) => declarationsOf(developerId) ?? [])
    const unknownDevelopers = requested.filter((developerId) => declarationsOf(developerId) === null)
    const response: TeamDeclarationsResponse = { developers, unknownDevelopers }
    return ok(response)
  }

  const declarationMatch = /^\/api\/planning-metadata\/declarations\/([^/]+)$/.exec(route)
  if (method === 'GET' && declarationMatch) {
    const developerId = decodeURIComponent(declarationMatch[1])
    const declaration = declarationsOf(developerId)
    return declaration ? ok(declaration) : notFound(`El tecnico ${developerId} no existe en el escenario DEMO.`)
  }

  if (method === 'POST' && route === '/api/planning-metadata') {
    const workItemId = String(payload.workItemId ?? '')
    const estimatedHours = payload.estimatedHours === undefined ? null : (payload.estimatedHours as number | null)
    return writeDeclaration(workItemId, estimatedHours, String(payload.changedBy ?? 'demo'))
  }

  const metadataMatch = /^\/api\/planning-metadata\/([^/]+)$/.exec(route)
  if (metadataMatch) {
    const workItemId = decodeURIComponent(metadataMatch[1])
    const item = findDeclaration(workItemId)

    if (method === 'GET') {
      return item ? ok(item.declaration ?? emptyMetadata(workItemId)) : notFound(`No hay un ticket ${workItemId} en el escenario DEMO.`)
    }

    if (method === 'PUT') {
      const estimatedHours = payload.estimatedHours === undefined ? null : (payload.estimatedHours as number | null)
      return writeDeclaration(workItemId, estimatedHours, String(payload.changedBy ?? 'demo'))
    }
  }

  // --- Renegociaciones ------------------------------------------------------------------
  if (method === 'GET' && route === '/api/renegotiations') return ok(renegotiations())

  if (method === 'POST' && route === '/api/renegotiations') {
    return writeAgreement(
      String(payload.workItemId ?? ''),
      String(payload.agreedDate ?? ''),
      String(payload.agreedBy ?? 'demo'),
      String(payload.agreedReason ?? ''),
    )
  }

  const historyMatch = /^\/api\/renegotiations\/([^/]+)\/history$/.exec(route)
  if (method === 'GET' && historyMatch) {
    const workItemId = decodeURIComponent(historyMatch[1])
    const item = findRenegotiation(workItemId)
    if (!item) return notFound(`El ticket ${workItemId} no esta desplazado en el escenario DEMO.`)

    const response: RenegotiationHistoryResponse = {
      workItemId,
      changes: demoStore().histories[workItemId] ?? (item.renegotiation
        ? [{
            previousDate: null,
            newDate: item.renegotiation.agreedDate,
            agreedReason: item.renegotiation.agreedReason,
            changedBy: item.renegotiation.agreedBy,
            changedAt: item.renegotiation.agreedAt,
          }]
        : []),
    }
    return ok(response)
  }

  const renegotiationMatch = /^\/api\/renegotiations\/([^/]+)$/.exec(route)
  if (renegotiationMatch) {
    const workItemId = decodeURIComponent(renegotiationMatch[1])
    const item = findRenegotiation(workItemId)

    if (method === 'GET') {
      return item?.renegotiation ? ok(item.renegotiation) : notFound(`El ticket ${workItemId} no tiene acuerdo en el escenario DEMO.`)
    }

    if (method === 'PUT') {
      return writeAgreement(
        workItemId,
        String(payload.agreedDate ?? ''),
        String(payload.agreedBy ?? 'demo'),
        String(payload.agreedReason ?? ''),
      )
    }
  }

  return null
}
