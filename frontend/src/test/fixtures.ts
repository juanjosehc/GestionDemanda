import type { OperationalAlertResponse } from '@/types/alerts'
import type {
  DeclarationItem,
  DeveloperDeclarationsResponse,
  PlanningMetadata,
} from '@/types/declarations'
import type {
  DeveloperPlansResponse,
  PlanningFromGlpiResponse,
  PlanningInputResponse,
  PlanSnapshotResponse,
} from '@/types/planning'
import type {
  DeclaredGapDetailResponse,
  DisplacedRequirementsResponse,
  PlanningOperationalMetricsResponse,
} from '@/types/planningMetrics'
import type {
  RenegotiationHistoryResponse,
  RenegotiationsResponse,
} from '@/types/renegotiations'
import type { TeamCatalogResponse } from '@/types/team'
import type { TeamTimelineResponse, TimelineItem, TimelinePlanResponse } from '@/types/timeline'

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
        displacement: null,
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
        displacement: null,
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
        displacement: null,
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
 * Las seis alertas del catalogo, disparadas, en el orden en que el backend las publica.
 *
 * No es una lista escrita a mano: es la proyeccion de `planningMetricsFixture()`, y los numeros
 * **cuadran con ella** —1 desarrollador con restante negativo, 1 con restante exactamente cero, 5
 * elementos desplazados, 4 sin estimacion, 2 sin compromiso y 6 incompletas—. Si los dos fixtures
 * se separaran, la prueba que compara la alerta con su metrica afirmaria algo sobre datos que el
 * backend no produce, que es el error que la Fase 18 tuvo que corregir en el suyo.
 *
 * El orden es el de la respuesta real: por severidad y, dentro de cada nivel, por el orden del
 * catalogo. Las dos de capacidad van con `detailUrl` nulo porque su detalle es el calendario del
 * plan, que no es un listado de esta API.
 */
export function alertsFixture(
  overrides: Partial<OperationalAlertResponse> = {},
): OperationalAlertResponse {
  const generatedAt = '2026-10-07T15:00:00Z'
  // Los textos de procedencia salen de las constantes del DTO del backend, no se inventan aqui.
  const current = {
    source: 'plan_snapshot.created_at + work_block + planning_context',
    scope: 'el plan vigente de cada desarrollador: el mas reciente por created_at',
  }
  const declared = {
    source: 'planning_metadata',
    scope: 'estado declarado hoy, sin ventana temporal',
  }

  return {
    generatedAt,
    alerts: [
      {
        type: 'CAPACIDAD_NEGATIVA',
        severity: 'CRITICAL',
        ...current,
        condition: 'planes vigentes cuya capacidad restante es negativa',
        count: 1,
        detailUrl: null,
        generatedAt,
      },
      {
        type: 'REQUERIMIENTOS_DESPLAZADOS',
        severity: 'WARNING',
        ...current,
        condition:
          'elementos desplazados en los planes vigentes, sumados y contados una vez cada uno',
        count: 5,
        detailUrl: '/api/planning/metrics/displaced',
        generatedAt,
      },
      {
        type: 'CAPACIDAD_AGOTADA',
        severity: 'WARNING',
        ...current,
        condition: 'planes vigentes cuya capacidad restante es exactamente cero',
        count: 1,
        detailUrl: null,
        generatedAt,
      },
      {
        type: 'SIN_ESTIMACION',
        severity: 'WARNING',
        ...declared,
        condition: 'filas de planning_metadata con estimated_hours nulo',
        count: 4,
        detailUrl: '/api/planning/metrics/declared/SIN_ESTIMACION',
        generatedAt,
      },
      {
        type: 'SIN_COMPROMISO',
        severity: 'WARNING',
        ...declared,
        condition: 'filas de planning_metadata con committed_date nulo',
        count: 2,
        detailUrl: '/api/planning/metrics/declared/SIN_COMPROMISO',
        generatedAt,
      },
      {
        type: 'METADATA_INCOMPLETA',
        severity: 'INFO',
        ...declared,
        condition: 'filas de planning_metadata con estimated_hours o committed_date nulos',
        count: 6,
        detailUrl: '/api/planning/metrics/declared/METADATA_INCOMPLETA',
        generatedAt,
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

export const DECLARATION_DEVELOPER_ID = 'dev-1'

/**
 * La planificacion declarada de un ticket, tal como la devuelve el backend.
 *
 * Los autores y los sellos van rellenos porque en el recurso real tambien lo estan: `estimatedBy` y
 * `committedBy` son el autor del ultimo cambio de ese campo, y sobreviven al valor —retirar una
 * estimacion conserva quien la retiro—. Un fixture con esos campos en nulo describiria un recurso
 * que el backend no produce.
 */
export function planningMetadataFixture(
  overrides: Partial<PlanningMetadata> = {},
): PlanningMetadata {
  return {
    workItemId: '501',
    estimatedHours: 6,
    committedDate: '2026-10-20',
    estimatedBy: 'ana',
    committedBy: 'ana',
    estimatedAt: '2026-10-05T14:05:00Z',
    committedAt: '2026-10-05T14:05:00Z',
    source: 'HTTP',
    commitmentOverdue: false,
    ...overrides,
  }
}

/**
 * Los tickets de un tecnico, con los cinco estados de declaracion de una sola vez.
 *
 * Cada estado trae **el codigo de descarte y el motivo que el backend produce de verdad**, copiados
 * de `GlpiTicketValidator`: los dos parciales nombran el campo que falta, y el que no tiene
 * declaracion ninguna dice que nadie empezo —que es un diagnostico distinto del de una declaracion
 * retirada, aunque el codigo sea el mismo—. Inventarse los textos aqui haria que la prueba de que la
 * pantalla no reescribe los motivos no probara nada.
 *
 * `505` es el unico que no se puede traducir: GLPI entrego un tipo que el contrato no declara, asi
 * que no hay tipo ni estado que enseñar y los dos van en nulo. No es un hueco del fixture: es lo que
 * el backend responde, y la pantalla tiene que saber pintarlo sin rellenarlo.
 */
export function declarationsFixture(
  overrides: Partial<DeveloperDeclarationsResponse> = {},
): DeveloperDeclarationsResponse {
  const sinDeclaracion = 'no hay planificacion declarada para este elemento'

  return {
    developer: { id: DECLARATION_DEVELOPER_ID, name: 'Ana Perez' },
    // Los textos de procedencia salen de las constantes del DTO del backend, no se inventan aqui.
    source: {
      glpi:
        '/search/Ticket por criterio de tecnico (opcion 5): workItemId, type, status, priority, ' +
        'createdAt y title',
      declaration:
        'planning_metadata por workItemId: estimatedHours y committedDate, con su autor, su sello ' +
        'y lo que falta',
    },
    items: [
      {
        workItemId: '501',
        type: 'INCIDENTE',
        status: 'ABIERTO',
        priority: 4,
        createdAt: '2026-10-05T14:00:00Z',
        title: 'Falla en produccion 501',
        declarationStatus: 'PLANIFICABLE',
        discards: [],
        declaration: planningMetadataFixture(),
        // Una incidencia no se ubica por una promesa, asi que GLPI no le da fecha operativa.
        operationalDate: null,
        operationalDateSource: null,
      },
      {
        workItemId: '502',
        type: 'INCIDENTE',
        status: 'ABIERTO',
        priority: 3,
        createdAt: '2026-10-05T14:00:00Z',
        title: 'Falla en produccion 502',
        declarationStatus: 'SIN_ESTIMACION',
        discards: [
          {
            code: 'SIN_ESTIMACION_DECLARADA',
            reason: 'la planificacion declarada no tiene estimacion',
          },
        ],
        declaration: planningMetadataFixture({
          workItemId: '502',
          estimatedHours: null,
          committedDate: '2026-10-21',
          estimatedBy: null,
          estimatedAt: null,
        }),
        operationalDate: null,
        operationalDateSource: null,
      },
      {
        workItemId: '503',
        type: 'REQUERIMIENTO',
        status: 'ABIERTO',
        priority: 2,
        createdAt: '2026-10-01T13:00:00Z',
        title: 'Ajuste de reporte 503',
        declarationStatus: 'SIN_COMPROMISO',
        discards: [
          {
            code: 'SIN_FECHA_EN_GLPI',
            reason: 'GLPI no trae ni internal_time_to_resolve ni time_to_resolve',
          },
        ],
        declaration: planningMetadataFixture({
          workItemId: '503',
          estimatedHours: 4,
          committedDate: null,
          committedBy: null,
          committedAt: null,
        }),
        operationalDate: null,
        operationalDateSource: null,
      },
      {
        workItemId: '504',
        type: 'REQUERIMIENTO',
        status: 'NUEVO',
        priority: 1,
        createdAt: '2026-10-02T13:00:00Z',
        title: 'Ajuste de reporte 504',
        declarationStatus: 'SIN_DECLARACION',
        // Le faltan las dos cosas y se informan las dos: son dos personas distintas las que tienen
        // que actuar, y un campo unico obligaria a callar a una de ellas.
        discards: [
          { code: 'SIN_ESTIMACION_DECLARADA', reason: sinDeclaracion },
          {
            code: 'SIN_FECHA_EN_GLPI',
            reason: 'GLPI no trae ni internal_time_to_resolve ni time_to_resolve',
          },
        ],
        declaration: null,
        operationalDate: null,
        operationalDateSource: null,
      },
      {
        workItemId: '505',
        type: null,
        status: null,
        priority: 3,
        createdAt: '2026-10-05T14:00:00Z',
        title: 'Ticket raro',
        declarationStatus: 'NO_TRADUCIBLE',
        discards: [
          {
            code: 'TIPO_DESCONOCIDO',
            reason:
              'tipo de ticket desconocido: 99 (el contrato solo declara incidencias y peticiones)',
          },
        ],
        declaration: null,
        operationalDate: null,
        operationalDateSource: null,
      },
    ],
    ...overrides,
  }
}

/** Un elemento de la respuesta, para las pruebas que necesitan contradecir un solo campo. */
export function declarationItemFixture(
  overrides: Partial<DeclarationItem> = {},
): DeclarationItem {
  return { ...declarationsFixture().items[0], ...overrides }
}

export const ACORDADO_ID = 'REQ-1'
export const PENDIENTE_ID = 'REQ-2'
/** Pendiente **y** con acuerdo anterior: el caso que distingue el estado del verbo de escritura. */
export const REMOVIDO_ID = 'REQ-3'

/**
 * El motivo del acuerdo, que es lo que firma quien acuerda.
 *
 * **No es el motivo del desplazamiento.** Los de abajo —`alto`, `sinCapacidad`— los redacta el motor
 * desde la regla que aplico y viajan dentro del evento; estos los escribe una persona y viajan en el
 * acuerdo. Las pruebas que comprueban que la vista no los confunde se apoyan en que son textos
 * distintos, asi que no pueden compartir valor.
 */
export const MOTIVO_ACORDADO = 'el cliente aplazo la instalacion'
export const MOTIVO_REMOVIDO = 'se acordo con el usuario mover la entrega'

/**
 * Los tres desenlaces de la renegociacion, en una sola respuesta.
 *
 * `REQ-1` esta acordado y su acuerdo cubre su unico desplazamiento. `REQ-2` no tiene acuerdo ninguno.
 * `REQ-3` es el caso que justifica la pantalla entera: **esta en PENDIENTE_DE_ACUERDO y a la vez trae
 * un acuerdo**, porque se movio otra vez despues de haberse acordado. Sin esa fila, la prueba de que
 * la vista no recalcula estados pasaria por casualidad, porque los dos hechos coincidirian.
 *
 * El resumen cuadra con las filas —3 desplazados, 2 pendientes, 1 acordado— y `displaced` es la suma
 * de los otros dos, como lo cuenta el backend. Los motivos y las reglas son los textos que el motor
 * escribe de verdad, no inventados aqui.
 */
export function renegotiationsFixture(
  overrides: Partial<RenegotiationsResponse> = {},
): RenegotiationsResponse {
  const alto = 'Incidente de severidad alta sobre la misma jornada'
  const sinCapacidad = 'La jornada quedo sin capacidad disponible'

  return {
    source: 'plan_snapshot + reschedule_event + renegotiation',
    scope: 'el plan vigente de cada desarrollador: el mas reciente por created_at',
    generatedAt: '2026-10-07T15:00:00Z',
    summary: { displaced: 3, pending: 2, agreed: 1 },
    items: [
      {
        developerId: DEVELOPER_ID,
        planId: PLAN_ID,
        calculatedAt: '2026-10-07T14:00:00Z',
        workItemId: ACORDADO_ID,
        status: 'ACORDADA',
        events: [
          {
            timestamp: '2026-10-05T14:00:00Z',
            incidentId: 'INC-9',
            requirementId: ACORDADO_ID,
            originalDate: '2026-10-05',
            rescheduledDate: '2026-10-06',
            appliedRule: 'INCIDENTE_ALTO_DESPLAZA_REQUERIMIENTOS',
            severity: 'ALTO',
            reason: alto,
          },
        ],
        renegotiation: {
          workItemId: ACORDADO_ID,
          agreedDate: '2026-10-08',
          agreedBy: 'ana',
          agreedReason: MOTIVO_ACORDADO,
          agreedAt: '2026-10-06T09:30:00Z',
          source: 'HTTP',
        },
      },
      {
        developerId: FULL_DEVELOPER_ID,
        planId: '22222222-2222-2222-2222-222222222222',
        calculatedAt: '2026-10-07T14:05:00Z',
        workItemId: PENDIENTE_ID,
        status: 'PENDIENTE_DE_ACUERDO',
        events: [
          {
            timestamp: '2026-10-05T14:05:00Z',
            incidentId: 'INC-9',
            requirementId: PENDIENTE_ID,
            originalDate: '2026-10-05',
            rescheduledDate: '2026-10-08',
            appliedRule: 'INCIDENTE_ALTO_DESPLAZA_REQUERIMIENTOS',
            severity: 'ALTO',
            reason: alto,
          },
        ],
        renegotiation: null,
      },
      {
        developerId: OVER_DEVELOPER_ID,
        planId: '33333333-3333-3333-3333-333333333333',
        calculatedAt: '2026-10-07T14:10:00Z',
        workItemId: REMOVIDO_ID,
        status: 'PENDIENTE_DE_ACUERDO',
        events: [
          {
            timestamp: '2026-10-04T14:10:00Z',
            incidentId: 'INC-11',
            requirementId: REMOVIDO_ID,
            originalDate: '2026-10-06',
            rescheduledDate: '2026-10-07',
            appliedRule: 'SIN_CAPACIDAD_EN_LA_JORNADA',
            severity: 'MEDIO',
            reason: sinCapacidad,
          },
          {
            // El segundo desplazamiento es **posterior** al acuerdo de abajo: es lo que deja la fila
            // pendiente aunque el acuerdo exista, y lo que la vista no puede decidir por su cuenta.
            timestamp: '2026-10-07T14:10:00Z',
            incidentId: 'INC-12',
            requirementId: REMOVIDO_ID,
            originalDate: '2026-10-07',
            rescheduledDate: '2026-10-09',
            appliedRule: 'SIN_CAPACIDAD_EN_LA_JORNADA',
            severity: 'MEDIO',
            reason: sinCapacidad,
          },
        ],
        renegotiation: {
          workItemId: REMOVIDO_ID,
          agreedDate: '2026-10-07',
          agreedBy: 'carlos',
          agreedReason: MOTIVO_REMOVIDO,
          agreedAt: '2026-10-05T08:00:00Z',
          source: 'HTTP',
        },
      },
    ],
    ...overrides,
  }
}

/**
 * El historial de un acuerdo, con las dos formas que la vista tiene que distinguir.
 *
 * La primera entrada tiene `previousDate` en nulo: es el primer acuerdo, el momento en que no habia
 * fecha. Las dos van en el orden en que las publica el backend —que no es un orden que la vista deba
 * reproducir, sino el que recibe—, asi que una prueba que las vea invertidas falla.
 */
export function renegotiationHistoryFixture(
  overrides: Partial<RenegotiationHistoryResponse> = {},
): RenegotiationHistoryResponse {
  return {
    workItemId: ACORDADO_ID,
    changes: [
      {
        previousDate: null,
        newDate: '2026-10-06',
        agreedReason: MOTIVO_ACORDADO,
        changedBy: 'ana',
        changedAt: '2026-10-05T09:00:00Z',
      },
      {
        previousDate: '2026-10-06',
        newDate: '2026-10-08',
        agreedReason: MOTIVO_REMOVIDO,
        changedBy: 'carlos',
        changedAt: '2026-10-06T09:30:00Z',
      },
    ],
    ...overrides,
  }
}

export const GENERATED_PLAN_ID = '44444444-4444-4444-4444-444444444444'
/** El identificador que se teclea y el que devuelve el plan: el de GLPI, en su escala numerica. */
export const GENERATED_DEVELOPER_ID = '296'

/**
 * El plan que devuelve la generacion desde GLPI, con la forma de descarte que la pantalla tiene que
 * saber contar.
 *
 * **Trae solo las tres listas que la pantalla cuenta**, no la simulacion entera que el backend
 * publica: el contrato de esta vista declara unicamente lo que lee —ver `types/planning`—, y un
 * fixture con los diez campos de `PlanningSimulationResponse` describiria una copia que nadie usa. Los
 * tres numeros son **distintos a proposito** (2 ubicados, 1 desplazado, 1 conflicto) para que una
 * prueba no pueda confundir una cuenta con otra y pasar por casualidad.
 *
 * Los dos descartes son **el mismo ticket con dos causas**. Es el caso que el contrato documenta —un
 * ticket puede aparecer mas de una vez— y el que distingue contar filas de contar tickets: una vista
 * que agrupara por ticket daria 1 donde el backend publica 2. Los codigos y los motivos salen de
 * `GlpiDiscardReason` y del validador, no se inventan aqui.
 */
export function planningFromGlpiFixture(
  overrides: Partial<PlanningFromGlpiResponse> = {},
): PlanningFromGlpiResponse {
  return {
    planId: GENERATED_PLAN_ID,
    createdAt: '2026-10-13T14:00:00Z',
    plan: {
      developerId: GENERATED_DEVELOPER_ID,
      allocations: [
        { workItemId: '501', developerId: GENERATED_DEVELOPER_ID },
        { workItemId: '502', developerId: GENERATED_DEVELOPER_ID },
      ],
      displacedRequirements: [{ workItemId: 'REQ-1' }],
      conflicts: [{ workItemId: 'REQ-9' }],
    },
    discarded: [
      {
        ticketId: '504',
        code: 'SIN_ESTIMACION_DECLARADA',
        reason: 'la planificacion declarada no tiene estimacion',
      },
      {
        ticketId: '504',
        code: 'SIN_FECHA_EN_GLPI',
        reason: 'GLPI no trae ni internal_time_to_resolve ni time_to_resolve',
      },
    ],
    ...overrides,
  }
}

/** El número de GLPI de cada persona del fixture: la otra clave con la que se puede pedir un plan. */
export const DEVELOPER_GLPI_ID = 101
export const FULL_DEVELOPER_GLPI_ID = 102
export const OVER_DEVELOPER_GLPI_ID = 103

/**
 * El padrón del equipo: las tres personas del grupo de GLPI, con su nombre y su vigencia.
 *
 * **Es la lectura que decide quién está en la tabla**, y por eso trae los nombres: hasta esta fase el
 * nombre de cada persona lo publicaba la declaración del técnico —una lectura por persona— y ahora lo
 * publica el padrón entero de una vez. Son las mismas tres de la fotografía operativa, con su número de
 * GLPI, que es la otra clave con la que un plan puede haberse pedido.
 *
 * `available` en verdadero y ninguna excepción: es el estado normal, y las pruebas que quieren otro lo
 * cambian por `overrides` en vez de darlo por supuesto.
 */
export function teamCatalogFixture(
  overrides: Partial<TeamCatalogResponse> = {},
): TeamCatalogResponse {
  return {
    generatedAt: '2026-10-14T15:00:00Z',
    // Los textos de procedencia salen de las constantes del DTO del backend, no se inventan aquí.
    source: {
      glpi:
        '/search/User por criterio de grupo (opcion 13), con subgrupos: id, login, nombre, ' +
        'apellido y vigencia',
      exceptions:
        'team.exceptions de la configuracion: personas declaradas a mano con su login, su ' +
        'identificador de GLPI si lo tienen y su vigencia',
    },
    glpi: { available: true, groupId: 1, groupName: 'Desarrollo N2', detail: null },
    people: [
      {
        developerId: DEVELOPER_ID,
        glpiId: DEVELOPER_GLPI_ID,
        name: 'Ana Perez',
        active: true,
        sourceType: 'GLPI',
        // Las tres son del equipo operativo: es el estado normal de la vista por defecto, y un fixture
        // con alguien fuera dejaria la tabla a medias en todas las pruebas que ya existen. Las que
        // necesitan a alguien fuera lo piden por `overrides` en vez de darlo por supuesto.
        operational: true,
      },
      {
        developerId: FULL_DEVELOPER_ID,
        glpiId: FULL_DEVELOPER_GLPI_ID,
        name: 'Carlos Ruiz',
        active: true,
        sourceType: 'GLPI',
        operational: true,
      },
      {
        developerId: OVER_DEVELOPER_ID,
        glpiId: OVER_DEVELOPER_GLPI_ID,
        name: 'Diana Lopez',
        active: true,
        sourceType: 'GLPI',
        operational: true,
      },
    ],
    unusedExceptions: [],
    unusedOperational: [],
    ...overrides,
  }
}

/**
 * El plan guardado, releido por `GET /api/planning/{planId}`, sobre el mismo plan del timeline.
 *
 * **Los tres numeros son los del `timelineFixture`, no unos inventados aqui**: las asignaciones suman
 * las mismas 8 horas del dia 5 y las 2 del dia 6 que su capacidad ya declara ocupadas, y los dos
 * eventos son los de los dos tramos que ese fixture marca `DESPLAZADO`. Si los dos fixtures se
 * separaran, la prueba de que el resumen y la rejilla dicen lo mismo afirmaria algo sobre datos que el
 * backend no produce —el error que la Fase 18 tuvo que corregir en el suyo—.
 *
 * `REQ-3` es el que no cupo: **esta en `conflicts` y no tiene asignacion**, y por eso no aparece en el
 * timeline. Es la fila que justifica leer este endpoint, porque es la unica lectura que la publica.
 *
 * Los motivos son los textos que el motor escribe de verdad —el del conflicto lo compone el backend
 * con el horizonte congelado—, no unos redactados para que la prueba pase.
 */
export function planSnapshotFixture(
  overrides: Partial<PlanSnapshotResponse> = {},
): PlanSnapshotResponse {
  return {
    planId: PLAN_ID,
    developerId: DEVELOPER_ID,
    createdAt: '2026-10-07T14:00:00Z',
    allocations: [
      {
        workItemId: 'INC-1',
        workItemType: 'INCIDENTE',
        developerId: DEVELOPER_ID,
        date: '2026-10-05',
        hours: 6,
      },
      {
        workItemId: 'REQ-1',
        workItemType: 'REQUERIMIENTO',
        developerId: DEVELOPER_ID,
        date: '2026-10-05',
        hours: 2,
      },
      {
        workItemId: 'REQ-2',
        workItemType: 'REQUERIMIENTO',
        developerId: DEVELOPER_ID,
        date: '2026-10-06',
        hours: 2,
      },
    ],
    rescheduleEvents: [
      {
        timestamp: '2026-10-07T14:00:00Z',
        incidentId: 'INC-1',
        requirementId: 'REQ-1',
        originalDate: '2026-10-05',
        rescheduledDate: '2026-10-05',
        appliedRule: 'INCIDENTE_ALTO_DESPLAZA_REQUERIMIENTOS',
        severity: 'ALTO',
        reason: 'Incidente de severidad alta sobre la misma jornada',
      },
      {
        timestamp: '2026-10-07T14:00:00Z',
        incidentId: 'INC-1',
        requirementId: 'REQ-2',
        originalDate: '2026-10-06',
        rescheduledDate: '2026-10-06',
        appliedRule: 'SIN_CAPACIDAD_EN_LA_JORNADA',
        severity: 'MEDIO',
        reason: 'La jornada quedo sin capacidad disponible',
      },
    ],
    conflicts: [
      {
        workItemId: 'REQ-3',
        workItemType: 'REQUERIMIENTO',
        reason: 'Sin capacidad en el horizonte de 10 dias',
      },
    ],
    ...overrides,
  }
}

/**
 * La foto de la entrada: los cinco elementos que el motor recibio, con los cuatro desenlaces.
 *
 * **Es mas grande que el plan a proposito.** `REQ-4` entro y no aparece en ninguna lista del
 * resultado: el motor lo filtro por estar resuelto, y esa es la unica caja que no se puede contar sin
 * esta lectura. Sin el, `considerados` cuadraria por casualidad con la suma de las otras tres y una
 * prueba que confundiera el residuo con cero pasaria.
 *
 * Los cuatro suman los cinco: 1 planificado (`INC-1`), 2 desplazados (`REQ-1`, `REQ-2`), 1 fuera
 * (`REQ-3`) y 1 excluido (`REQ-4`). `status` viaja tal cual porque es el estado que el motor leyo.
 */
export function planInputFixture(
  overrides: Partial<PlanningInputResponse> = {},
): PlanningInputResponse {
  return {
    planId: PLAN_ID,
    developerId: DEVELOPER_ID,
    incidents: [{ id: 'INC-1', estimatedHours: 6, status: 'ABIERTO', severity: 'MEDIO' }],
    requirements: [
      { id: 'REQ-1', estimatedHours: 2, plannedDate: '2026-10-05', status: 'ABIERTO' },
      { id: 'REQ-2', estimatedHours: 2, plannedDate: '2026-10-06', status: 'ABIERTO' },
      { id: 'REQ-3', estimatedHours: 8, plannedDate: '2026-10-09', status: 'ABIERTO' },
      { id: 'REQ-4', estimatedHours: 4, plannedDate: '2026-10-08', status: 'RESUELTO' },
    ],
    source: 'GLPI',
    extractedAt: '2026-10-07T13:59:00Z',
    ...overrides,
  }
}

/**
 * Los dos desenlaces del acuerdo, **atados al plan que se mira**.
 *
 * `GET /api/renegotiations` recorre el plan vigente de cada desarrollador, asi que las filas de un plan
 * comparten `planId`; el fixture general las reparte entre tres planes para cubrir la pantalla
 * consolidada, y aqui se atan al mismo. Es la diferencia entre un acuerdo que habla de este
 * desplazamiento y uno que habla de otro: la vista no puede pegarlos por el identificador a secas.
 *
 * `REQ-1` queda acordado y `REQ-2` pendiente, que son los dos estados que el resumen tiene que
 * distinguir.
 */
export function planRenegotiationsFixture(
  overrides: Partial<RenegotiationsResponse> = {},
): RenegotiationsResponse {
  const base = renegotiationsFixture()

  return {
    ...base,
    items: base.items.slice(0, 2).map((one) => ({ ...one, planId: PLAN_ID })),
    summary: { displaced: 2, pending: 1, agreed: 1 },
    ...overrides,
  }
}

/** El plan anterior de `PLAN_ID`: el que existia antes y con el que se compara. */
export const PREVIOUS_PLAN_ID = '55555555-5555-5555-5555-555555555555'

/**
 * El plan **anterior** al del `planSnapshotFixture`, sobre el timeline de arriba.
 *
 * Existe para que la comparacion tenga dos fotos coherentes con las que trabajar y trae, a proposito,
 * las cinco diferencias que el brief pregunta: `REQ-2` no estaba (entro), `REQ-6` estaba y ya no esta
 * (salio), `REQ-6` estaba desplazado (su desplazamiento desaparecio), `REQ-1` estaba planificado y
 * ahora esta desplazado (aparecio uno nuevo) y `REQ-1` cambio de caja. `INC-1` y `REQ-3` estan iguales
 * en los dos, que es la parte que sigue igual.
 *
 * **Se sella antes del acuerdo del `planRenegotiationsFixture`** —`09:00` contra `09:30`— para que la
 * pregunta 6 tenga una respuesta: un acuerdo registrado despues de que se calculara este plan. Si el
 * sello fuera posterior, esa pregunta saldria vacia y la prueba pasaria por casualidad.
 *
 * Las asignaciones suman lo mismo que la capacidad de su timeline —8 horas el dia 5 y 2 el dia 6—,
 * por la misma razon que en el fixture del plan nuevo: dos fixtures que se separan afirman cosas sobre
 * datos que el backend no produce.
 */
export function previousPlanSnapshotFixture(
  overrides: Partial<PlanSnapshotResponse> = {},
): PlanSnapshotResponse {
  return {
    planId: PREVIOUS_PLAN_ID,
    developerId: DEVELOPER_ID,
    createdAt: '2026-10-06T09:00:00Z',
    allocations: [
      {
        workItemId: 'INC-1',
        workItemType: 'INCIDENTE',
        developerId: DEVELOPER_ID,
        date: '2026-10-05',
        hours: 6,
      },
      {
        workItemId: 'REQ-1',
        workItemType: 'REQUERIMIENTO',
        developerId: DEVELOPER_ID,
        date: '2026-10-05',
        hours: 2,
      },
      {
        workItemId: 'REQ-6',
        workItemType: 'REQUERIMIENTO',
        developerId: DEVELOPER_ID,
        date: '2026-10-06',
        hours: 2,
      },
    ],
    rescheduleEvents: [
      {
        timestamp: '2026-10-06T09:00:00Z',
        incidentId: 'INC-1',
        requirementId: 'REQ-6',
        originalDate: '2026-10-05',
        rescheduledDate: '2026-10-06',
        appliedRule: 'SIN_CAPACIDAD_EN_LA_JORNADA',
        severity: 'MEDIO',
        reason: 'La jornada quedo sin capacidad disponible',
      },
    ],
    conflicts: [
      {
        workItemId: 'REQ-3',
        workItemType: 'REQUERIMIENTO',
        reason: 'Sin capacidad en el horizonte de 10 dias',
      },
    ],
    ...overrides,
  }
}

/**
 * La foto de la entrada del plan anterior: cuatro elementos, uno de ellos excluido.
 *
 * Trae `REQ-6`, que en el plan nuevo ya no esta, y no trae `REQ-2` ni `REQ-4`, que son los que
 * entraron despues. `REQ-3` sigue estando y sigue sin caber: la parte que no cambio.
 */
export function previousPlanInputFixture(
  overrides: Partial<PlanningInputResponse> = {},
): PlanningInputResponse {
  return {
    planId: PREVIOUS_PLAN_ID,
    developerId: DEVELOPER_ID,
    incidents: [{ id: 'INC-1', estimatedHours: 6, status: 'ABIERTO', severity: 'MEDIO' }],
    requirements: [
      { id: 'REQ-1', estimatedHours: 2, plannedDate: '2026-10-05', status: 'ABIERTO' },
      { id: 'REQ-3', estimatedHours: 8, plannedDate: '2026-10-09', status: 'ABIERTO' },
      { id: 'REQ-6', estimatedHours: 2, plannedDate: '2026-10-05', status: 'ABIERTO' },
    ],
    source: 'GLPI',
    extractedAt: '2026-10-06T08:59:00Z',
    ...overrides,
  }
}

/**
 * La agenda del plan anterior, coherente con su foto y su plan.
 *
 * `REQ-1` sale **planificado** —tiene tramo y ningun evento—, que es lo que hace que en el plan nuevo
 * cuente como desplazamiento aparecido. `REQ-6` sale desplazado, y su desplazamiento es el que
 * desaparece: en el plan nuevo ni siquiera esta.
 */
export function previousTimelineFixture(
  overrides: Partial<TimelinePlanResponse> = {},
): TimelinePlanResponse {
  return {
    planId: PREVIOUS_PLAN_ID,
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
        sourcePlanId: PREVIOUS_PLAN_ID,
        displacement: null,
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
        planningStatus: 'PLANIFICADO',
        sourcePlanId: PREVIOUS_PLAN_ID,
        displacement: null,
      },
      {
        workItemId: 'REQ-6',
        workItemType: 'REQUERIMIENTO',
        startsAt: '2026-10-06T09:00:00',
        endsAt: '2026-10-06T11:00:00',
        durationHours: 2,
        developerId: DEVELOPER_ID,
        estimatedHours: 2,
        committedDate: '2026-10-05',
        severity: null,
        planningStatus: 'DESPLAZADO',
        sourcePlanId: PREVIOUS_PLAN_ID,
        displacement: null,
      },
    ],
    allocations: [],
    ...overrides,
  }
}

/**
 * La lista de planes de un tecnico, con el anterior y el nuevo.
 *
 * **En el orden del backend y no en otro**: del mas antiguo al mas reciente. Es la lista de la que sale
 * «el anterior» por posicion, asi que una prueba que la vea invertida esta probando lo contrario de lo
 * que promete el contrato.
 */
export function developerPlansFixture(
  overrides: Partial<DeveloperPlansResponse> = {},
): DeveloperPlansResponse {
  return {
    developerId: DEVELOPER_ID,
    plans: [
      { planId: PREVIOUS_PLAN_ID, createdAt: '2026-10-06T09:00:00Z' },
      { planId: PLAN_ID, createdAt: '2026-10-07T14:00:00Z' },
    ],
    scope: 'los planes guardados de un desarrollador, del mas antiguo al mas reciente',
    ...overrides,
  }
}

export const SECOND_PLAN_ID = '22222222-2222-2222-2222-222222222222'

/**
 * El timeline de equipo: dos personas con planes vigentes en la **misma** ventana.
 *
 * **La ventana es una sola y las dos filas la cubren entera.** La de `dev-001` trae el miercoles
 * aunque su plan solo tenga tramos el lunes y el martes, porque con la ventana de equipo la capacidad
 * se mide contra la ventana y no contra el plan de cada uno. Pegar las lecturas de los dos planes
 * daria dos columnas de dias distintas y esa fila tendria dos dias en vez de tres: es exactamente la
 * diferencia que el fixture tiene que representar.
 *
 * Los tramos y la capacidad de `dev-001` son **los del `timelineFixture`** y no unos inventados aqui,
 * por la misma razon que en el resto del archivo: dos fixtures que se separan afirman cosas sobre
 * datos que el backend no produce.
 */
export function teamTimelineFixture(
  overrides: Partial<TeamTimelineResponse> = {},
): TeamTimelineResponse {
  const primera: TimelineItem = {
    workItemId: 'REQ-9',
    workItemType: 'REQUERIMIENTO',
    startsAt: '2026-10-07T09:00:00',
    endsAt: '2026-10-07T13:00:00',
    durationHours: 4,
    developerId: FULL_DEVELOPER_ID,
    estimatedHours: 4,
    committedDate: '2026-10-07',
    severity: null,
    planningStatus: 'PLANIFICADO',
    sourcePlanId: SECOND_PLAN_ID,
    displacement: null,
  }

  return {
    from: '2026-10-05',
    to: '2026-10-07',
    resources: [
      {
        developerId: DEVELOPER_ID,
        capacity: [
          { date: '2026-10-05', availableHours: 8, occupiedHours: 8, remainingHours: 0 },
          { date: '2026-10-06', availableHours: 8, occupiedHours: 2, remainingHours: 6 },
          { date: '2026-10-07', availableHours: 8, occupiedHours: 0, remainingHours: 8 },
        ],
      },
      {
        developerId: FULL_DEVELOPER_ID,
        capacity: [
          { date: '2026-10-05', availableHours: 8, occupiedHours: 0, remainingHours: 8 },
          { date: '2026-10-06', availableHours: 8, occupiedHours: 0, remainingHours: 8 },
          { date: '2026-10-07', availableHours: 8, occupiedHours: 4, remainingHours: 4 },
        ],
      },
    ],
    items: [...timelineFixture().items, primera],
    plans: [
      { developerId: DEVELOPER_ID, planId: PLAN_ID, from: '2026-10-05', to: '2026-10-06' },
      {
        developerId: FULL_DEVELOPER_ID,
        planId: SECOND_PLAN_ID,
        from: '2026-10-07',
        to: '2026-10-07',
      },
    ],
    conflicts: [],
    ...overrides,
  }
}
