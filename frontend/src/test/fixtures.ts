import type {
  DeclaredGapDetailResponse,
  DisplacedRequirementsResponse,
  PlanningOperationalMetricsResponse,
} from '@/types/planningMetrics'
import type { TimelinePlanResponse } from '@/types/timeline'

export const PLAN_ID = '11111111-1111-1111-1111-111111111111'
export const DEVELOPER_ID = 'dev-001'

/**
 * Plan de dos dias con tres tramos: un incidente planificado y dos requerimientos desplazados.
 *
 * Cubre de una vez los casos que la vista tiene que distinguir: un solo recurso, varios tramos,
 * un desplazamiento y capacidad con y sin holgura.
 */
export function timelineFixture(
  overrides: Partial<TimelinePlanResponse> = {},
): TimelinePlanResponse {
  return {
    planId: PLAN_ID,
    developerId: DEVELOPER_ID,
    from: '2026-10-05',
    to: '2026-10-06',
    resources: [
      {
        developerId: DEVELOPER_ID,
        capacity: [
          { date: '2026-10-05', availableHours: 8, occupiedHours: 8, remainingHours: 0 },
          { date: '2026-10-06', availableHours: 8, occupiedHours: 2, remainingHours: 6 },
        ],
      },
    ],
    items: [
      {
        workItemId: 'INC-1',
        workItemType: 'INCIDENTE',
        startsAt: '2026-10-05T09:00:00',
        endsAt: '2026-10-05T15:00:00',
        durationHours: 6,
        developerId: DEVELOPER_ID,
        estimatedHours: 6,
        committedDate: null,
        severity: 'MEDIO',
        planningStatus: 'PLANIFICADO',
        sourcePlanId: PLAN_ID,
      },
      {
        workItemId: 'REQ-1',
        workItemType: 'REQUERIMIENTO',
        startsAt: '2026-10-05T15:00:00',
        endsAt: '2026-10-05T17:00:00',
        durationHours: 2,
        developerId: DEVELOPER_ID,
        estimatedHours: 2,
        committedDate: '2026-10-05',
        severity: null,
        planningStatus: 'DESPLAZADO',
        sourcePlanId: PLAN_ID,
      },
      {
        workItemId: 'REQ-2',
        workItemType: 'REQUERIMIENTO',
        startsAt: '2026-10-06T09:00:00',
        endsAt: '2026-10-06T11:00:00',
        durationHours: 2,
        developerId: DEVELOPER_ID,
        estimatedHours: 2,
        committedDate: '2026-10-06',
        severity: null,
        planningStatus: 'DESPLAZADO',
        sourcePlanId: PLAN_ID,
      },
    ],
    allocations: [],
    ...overrides,
  }
}

export const EMPTY_DEVELOPER_ID = 'dev-000'
export const FULL_DEVELOPER_ID = 'dev-002'
export const OVER_DEVELOPER_ID = 'dev-003'

/**
 * Fotografia operativa con los tres desenlaces de cuello de botella de una sola vez.
 *
 * `dev-001` tiene holgura, `dev-002` esta al limite (`remaining` a cero) y `dev-003` se paso
 * (`remaining` negativo). Los agregados del bloque `current` son la suma exacta de los tres, para
 * que una prueba pueda afirmar cualquiera de los dos niveles sin que se contradigan.
 *
 * Los numeros declarados cierran con el algebra del backend: sin estimacion (4) y sin compromiso (2)
 * se solapan solo en las retiradas (0), asi que incompleta son 6 y planificables 34 de 40. Un
 * `retracted` mayor que `withoutCommitment` describiria un estado que el backend no puede producir, y
 * la prueba de que el detalle cuadra con la tarjeta afirmaria una propiedad sobre datos imposibles.
 */
export function planningMetricsFixture(
  overrides: Partial<PlanningOperationalMetricsResponse> = {},
): PlanningOperationalMetricsResponse {
  return {
    generatedAt: '2026-10-07T15:00:00Z',
    declared: {
      // Los textos salen de las constantes del DTO del backend, no se inventan aqui.
      source: 'planning_metadata',
      scope: 'estado declarado hoy, sin ventana temporal',
      total: 40,
      plannable: 34,
      withoutEstimation: { code: 'SIN_ESTIMACION_DECLARADA', count: 4 },
      withoutCommitment: { code: 'SIN_COMPROMISO_DECLARADO', count: 2 },
      incomplete: 6,
      retracted: 0,
    },
    plans: {
      source: 'plan_snapshot',
      scope: 'historico completo: una fila por ejecucion guardada',
      generated: 9,
    },
    current: {
      source: 'plan_snapshot.created_at + work_block + planning_context',
      scope: 'el plan vigente de cada desarrollador: el mas reciente por created_at',
      from: '2026-10-05',
      to: '2026-10-09',
      capacity: { availableHours: 160, occupiedHours: 163, remainingHours: -3 },
      displacedRequirements: 5,
      byDeveloper: [
        {
          developerId: DEVELOPER_ID,
          planId: PLAN_ID,
          calculatedAt: '2026-10-07T14:00:00Z',
          from: '2026-10-05',
          to: '2026-10-09',
          capacity: { availableHours: 80, occupiedHours: 71, remainingHours: 9 },
          displacedRequirements: 0,
        },
        {
          developerId: FULL_DEVELOPER_ID,
          planId: '22222222-2222-2222-2222-222222222222',
          calculatedAt: '2026-10-07T14:05:00Z',
          from: '2026-10-05',
          to: '2026-10-09',
          capacity: { availableHours: 40, occupiedHours: 40, remainingHours: 0 },
          displacedRequirements: 5,
        },
        {
          developerId: OVER_DEVELOPER_ID,
          planId: '33333333-3333-3333-3333-333333333333',
          calculatedAt: '2026-10-07T14:10:00Z',
          from: '2026-10-05',
          to: '2026-10-09',
          capacity: { availableHours: 40, occupiedHours: 52, remainingHours: -12 },
          displacedRequirements: 0,
        },
      ],
    },
    ...overrides,
  }
}

/**
 * Las filas declaradas de un desglose, con las tres formas que la tabla tiene que distinguir.
 *
 * `67502` tiene fecha compromiso pero no estimacion, `67501` al reves y ya vencida, y `67503` no
 * tiene ninguna de las dos —es una fila retirada—. Las tres caben en una carencia distinta, asi que
 * la prueba elige el `gap` que quiere mirar y este fixture le sirve igual.
 */
export function declaredGapFixture(
  overrides: Partial<DeclaredGapDetailResponse> = {},
): DeclaredGapDetailResponse {
  return {
    gap: 'SIN_ESTIMACION',
    code: 'SIN_ESTIMACION_DECLARADA',
    // La procedencia la declara el backend dentro de la respuesta; aqui se copia tal cual.
    source: 'planning_metadata',
    scope: 'estado declarado hoy, sin ventana temporal',
    generatedAt: '2026-10-07T15:00:00Z',
    items: [
      {
        workItemId: '67501',
        estimatedHours: 8,
        committedDate: '2026-10-01',
        estimatedBy: 'carlos',
        committedBy: 'ana',
        estimatedAt: '2026-09-28T13:05:00Z',
        committedAt: '2026-09-29T09:00:00Z',
        source: 'HTTP',
        commitmentOverdue: true,
      },
      {
        workItemId: '67502',
        estimatedHours: null,
        committedDate: '2026-10-20',
        estimatedBy: null,
        committedBy: 'ana',
        estimatedAt: null,
        committedAt: '2026-10-01T14:00:00Z',
        source: 'HTTP',
        commitmentOverdue: false,
      },
      {
        workItemId: '67503',
        estimatedHours: null,
        committedDate: null,
        estimatedBy: null,
        committedBy: null,
        estimatedAt: null,
        committedAt: null,
        source: 'GLPI',
        commitmentOverdue: false,
      },
    ],
    ...overrides,
  }
}

/**
 * Dos elementos desplazados: el primero se movio dos veces y el segundo una.
 *
 * El primero es el caso que distingue elementos de tramos —una fila, dos eventos— y trae las dos
 * severidades para que la vista tenga que pintar mas de una.
 */
export function displacedFixture(
  overrides: Partial<DisplacedRequirementsResponse> = {},
): DisplacedRequirementsResponse {
  return {
    source: 'plan_snapshot.created_at + work_block + planning_context',
    scope: 'el plan vigente de cada desarrollador: el mas reciente por created_at',
    generatedAt: '2026-10-07T15:00:00Z',
    items: [
      {
        developerId: DEVELOPER_ID,
        planId: PLAN_ID,
        calculatedAt: '2026-10-07T14:00:00Z',
        workItemId: 'REQ-1',
        events: [
          {
            timestamp: '2026-10-07T14:00:00Z',
            incidentId: 'INC-9',
            requirementId: 'REQ-1',
            originalDate: '2026-10-05',
            rescheduledDate: '2026-10-06',
            appliedRule: 'INCIDENTE_ALTO_DESPLAZA_REQUERIMIENTOS',
            severity: 'ALTO',
            reason: 'Incidente de severidad alta sobre la misma jornada',
          },
          {
            timestamp: '2026-10-07T14:00:00Z',
            incidentId: 'INC-11',
            requirementId: 'REQ-1',
            originalDate: '2026-10-06',
            rescheduledDate: '2026-10-07',
            appliedRule: 'SIN_CAPACIDAD_EN_LA_JORNADA',
            severity: 'MEDIO',
            reason: 'La jornada quedo sin capacidad disponible',
          },
        ],
      },
      {
        developerId: FULL_DEVELOPER_ID,
        planId: '22222222-2222-2222-2222-222222222222',
        calculatedAt: '2026-10-07T14:05:00Z',
        workItemId: 'REQ-2',
        events: [
          {
            timestamp: '2026-10-07T14:05:00Z',
            incidentId: 'INC-9',
            requirementId: 'REQ-2',
            originalDate: '2026-10-05',
            rescheduledDate: '2026-10-08',
            appliedRule: 'INCIDENTE_ALTO_DESPLAZA_REQUERIMIENTOS',
            severity: 'ALTO',
            reason: 'Incidente de severidad alta sobre la misma jornada',
          },
        ],
      },
    ],
    ...overrides,
  }
}
