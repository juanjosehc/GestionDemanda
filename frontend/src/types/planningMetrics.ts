import type { IncidentSeverity } from '@/types/timeline'

/**
 * Espeja el DTO PlanningOperationalMetricsResponse del backend (GET /api/planning/metrics).
 *
 * No es un agregado que el frontend arme: es la fotografia tal como la calcula el backend. Se
 * mantiene igual de partida que alli —tres bloques separados y no una lista plana de numeros—
 * porque mezclarlos daria a entender que se mueven juntos, y no se mueven juntos.
 *
 * `declared` es de ahora, `plans` solo crece y `current` es un plan congelado por desarrollador,
 * que puede ser de ayer. Por eso los dos primeros numeros de bloques distintos no se restan ni se
 * dividen entre si: el backend lo prohibe por escrito en el javadoc del DTO, y aqui no hay ningun
 * campo derivado que lo invite.
 *
 * `generatedAt` es lo unico que depende del reloj. Sin el, dos fotografias distintas serian
 * indistinguibles.
 */

/** Valores del enum GlpiDiscardReason del backend. */
export type GlpiDiscardReason =
  | 'SIN_IDENTIFICADOR_TICKET'
  | 'TIPO_DESCONOCIDO'
  | 'ESTADO_DESCONOCIDO'
  | 'FECHA_CREACION_ILEGIBLE'
  | 'SIN_ESTIMACION_DECLARADA'
  | 'SIN_FECHA_EN_GLPI'
  | 'TRADUCCION_FALLIDA'

/**
 * Filas declaradas que faltan por un motivo, con el codigo ya definido de ese motivo.
 *
 * El codigo viaja en el JSON: no se escribe en la vista, para que renombrarlo en el backend no
 * deje aqui un literal que solo se descubre el dia que alguien compara los dos.
 */
export interface DeclaredGap {
  code: GlpiDiscardReason
  count: number
}

/** La planificacion declarada, contada sobre el estado de hoy. */
export interface DeclaredMetrics {
  /** Tabla de la que sale el bloque. Viaja en el JSON para poder mostrarla. */
  source: string
  /** Sobre que se conto, en palabras del backend. */
  scope: string
  /** Filas declaradas. El denominador. */
  total: number
  /** Filas con horas: las que hoy entrarian al motor. Es `total - withoutEstimation`. */
  plannable: number
  /**
   * Filas sin horas. Es la unica carencia de la declaracion desde la Fase 77: la fecha de
   * compromiso la publica GLPI —su Internal TTR— y no se declara, asi que no hay una segunda
   * mitad que contar ni una union de las dos.
   */
  withoutEstimation: DeclaredGap
}

/** Cuantos planes se han guardado. Cuenta ejecuciones, no planes distintos. */
export interface PlansMetrics {
  source: string
  scope: string
  generated: number
}

/** Cuanto cabe, cuanto esta ocupado y cuanto queda, sumado sobre la ventana. */
export interface PlanningCapacity {
  availableHours: number
  occupiedHours: number
  /** No se recorta a cero: un negativo significa que el plan contradice su contexto. */
  remainingHours: number
}

/** El plan vigente de un desarrollador, con lo necesario para comprobarlo. */
export interface DeveloperPlanningMetrics {
  developerId: string
  /** El plan del que salen estas cifras. Se muestra para poder pedirlo por su ruta. */
  planId: string
  calculatedAt: string
  /** Primer dia de la ventana de este plan, o nulo si no tiene agenda. */
  from: string | null
  /** Ultimo dia de la ventana, o nulo si no tiene agenda. */
  to: string | null
  capacity: PlanningCapacity
  /** Elementos distintos desplazados, no tramos: uno que ocupa dos dias se movio una vez. */
  displacedRequirements: number
}

/** El plan vigente de cada desarrollador. */
export interface CurrentMetrics {
  source: string
  scope: string
  /** Primer dia abarcado por algun plan vigente, o nulo si ninguno tiene agenda. */
  from: string | null
  /** Ultimo dia abarcado, o nulo si ninguno tiene agenda. */
  to: string | null
  /** La suma de la capacidad de todos los planes vigentes. */
  capacity: PlanningCapacity
  displacedRequirements: number
  /** Ordenado por identificador, como lo entrega el backend. */
  byDeveloper: DeveloperPlanningMetrics[]
}

/** Respuesta completa de GET /api/planning/metrics. */
export interface PlanningOperationalMetricsResponse {
  /** Instante UTC en que se armo la fotografia. */
  generatedAt: string
  declared: DeclaredMetrics
  plans: PlansMetrics
  current: CurrentMetrics
}

/**
 * La carencia declarada que se puede abrir, con el token de la ruta.
 *
 * El token es lo que va en la URL —`/metricas/sin-estimacion`— y el valor es lo que viaja a la API,
 * que es el nombre de la constante del backend. Son dos escrituras del mismo hecho y por eso viven
 * en la misma tabla y no en dos sitios: la ruta que se comparte se lee bien y la peticion no lleva
 * un literal inventado. El backend no acepta la forma con guiones, asi que esta tabla es la unica
 * traduccion del sistema.
 *
 * Era de tres entradas hasta la Fase 77. `sin-compromiso` y `metadata-incompleta` se retiraron con
 * la captura manual de la fecha: el backend ya no publica esos contadores y pedirlos responde
 * `400`, asi que seguir ofreciendolos seria un enlace roto esperando a que alguien lo pulse.
 */
export const METRIC_GAPS = {
  'sin-estimacion': 'SIN_ESTIMACION',
} as const

/** Carencia declarada, por su token de ruta. */
export type MetricGap = keyof typeof METRIC_GAPS

/**
 * Distingue una carencia valida de un segmento de URL escrito a mano.
 *
 * Existe porque `:gap` llega como texto libre: sin esta comprobacion, una URL inventada se traduciria
 * a una peticion que el backend contesta con un 400, y la pagina mostraria un error de red donde el
 * problema es que la direccion no existe.
 */
export function isMetricGap(value: string | undefined): value is MetricGap {
  return value !== undefined && value in METRIC_GAPS
}

/**
 * El otro desglose: los requerimientos desplazados.
 *
 * No entra en `METRIC_GAPS` porque no es una carencia declarada: su lista sale del plan vigente de
 * cada desarrollador y no de `planning_metadata`, y no tiene un nombre de constante al que traducirse
 * en la API. Comparte la ruta con la carencia, y por eso comparte el tipo que la valida.
 */
export const DISPLACED_TOKEN = 'desplazados'

/** Cualquiera de los dos desgloses a los que lleva una tarjeta del tablero. */
export type MetricToken = MetricGap | typeof DISPLACED_TOKEN

/** Distingue un desglose valido de un segmento de URL escrito a mano. */
export function isMetricToken(value: string | undefined): value is MetricToken {
  return isMetricGap(value) || value === DISPLACED_TOKEN
}

/**
 * Una fila declarada, tal como la devuelve el detalle.
 *
 * Es la misma forma que ya publica `GET /api/planning-metadata/{workItemId}`. `estimatedBy` y
 * `committedBy` son quien declaro, no quien va a ejecutar: la tabla de la planificacion declarada no
 * guarda al desarrollador asignado y nombrarlo exigiria consultar GLPI. Las columnas se rotulan por
 * lo que son.
 */
export interface PlanningMetadataItem {
  workItemId: string
  estimatedHours: number | null
  committedDate: string | null
  estimatedBy: string | null
  committedBy: string | null
  estimatedAt: string | null
  committedAt: string | null
  /** De donde vino el dato declarado: `HTTP` si lo escribio alguien por la API, `GLPI` si se extrajo. */
  source: string
  commitmentOverdue: boolean
}

/** Respuesta de GET /api/planning/metrics/declared/{gap}. */
export interface DeclaredGapDetailResponse {
  /** La carencia que se listo, por su nombre de constante. */
  gap: string
  /** El codigo de descarte con el que se nombra esta carencia. */
  code: GlpiDiscardReason
  source: string
  scope: string
  generatedAt: string
  items: PlanningMetadataItem[]
}

/**
 * Un desplazamiento auditado, tal como lo publica el plan.
 *
 * `reason` es el motivo legible que el backend deriva de la regla aplicada. No se re-deriva aqui:
 * un hecho escrito en dos sitios acaba escrito de dos formas.
 */
export interface RescheduleEvent {
  timestamp: string
  incidentId: string
  requirementId: string
  originalDate: string
  rescheduledDate: string
  appliedRule: string
  severity: IncidentSeverity
  reason: string
}

/**
 * Un requerimiento desplazado, con donde se movio y por que.
 *
 * La fila es el elemento y no el tramo: uno que ocupa dos jornadas de agenda aparece una vez, con
 * sus dos eventos dentro. Es la misma diferencia que la tarjeta anuncia con su `hint`.
 */
export interface DisplacedRequirement {
  developerId: string
  planId: string
  calculatedAt: string
  workItemId: string
  events: RescheduleEvent[]
}

/** Respuesta de GET /api/planning/metrics/displaced. */
export interface DisplacedRequirementsResponse {
  source: string
  scope: string
  generatedAt: string
  items: DisplacedRequirement[]
}
