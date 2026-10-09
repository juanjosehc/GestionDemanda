import { apiGet } from '@/services/apiClient'
import { METRIC_GAPS } from '@/types/planningMetrics'
import type {
  DeclaredGapDetailResponse,
  DisplacedRequirementsResponse,
  MetricGap,
  PlanningOperationalMetricsResponse,
} from '@/types/planningMetrics'

/**
 * Fotografia operativa de la planificacion.
 *
 * Es la unica fuente del tablero: no se pide ninguna otra cosa para pintarlo. El backend no pide
 * parametros —la foto es del conjunto, no de un plan—, asi que no hay nada que componer.
 */
export function fetchPlanningMetrics(
  signal?: AbortSignal,
): Promise<PlanningOperationalMetricsResponse> {
  return apiGet<PlanningOperationalMetricsResponse>('/api/planning/metrics', signal)
}

/**
 * Las filas declaradas que producen una de las tarjetas de carencia.
 *
 * La ruta lleva el nombre de la constante del backend, que la tabla `METRIC_GAPS` traduce desde el
 * token de la URL. El backend no acepta la forma con guiones, asi que la traduccion no es opcional.
 */
export function fetchDeclaredGap(
  gap: MetricGap,
  signal?: AbortSignal,
): Promise<DeclaredGapDetailResponse> {
  const token = encodeURIComponent(METRIC_GAPS[gap])
  return apiGet<DeclaredGapDetailResponse>(`/api/planning/metrics/declared/${token}`, signal)
}

/**
 * Los requerimientos desplazados que suma la tarjeta, con su causa.
 *
 * No se pide un plan por cada desarrollador y se unen en el navegador: eso pondria aqui la decision
 * de que es un elemento desplazado, y ademas serian N peticiones. La lectura agregada existe en el
 * backend sobre el mismo timeline que alimenta la cifra.
 */
export function fetchDisplaced(signal?: AbortSignal): Promise<DisplacedRequirementsResponse> {
  return apiGet<DisplacedRequirementsResponse>('/api/planning/metrics/displaced', signal)
}
