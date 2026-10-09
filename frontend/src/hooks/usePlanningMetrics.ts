import { useQuery } from '@tanstack/react-query'

import { fetchDeclaredGap, fetchDisplaced, fetchPlanningMetrics } from '@/services/planningMetricsService'
import type { MetricGap } from '@/types/planningMetrics'

/**
 * Clave unica y sin parametros: la fotografia es una sola para toda la aplicacion, a diferencia de
 * la del timeline, que es una por plan.
 */
export const planningMetricsQueryKey = ['planning', 'metrics'] as const

/**
 * Fotografia operativa de la planificacion.
 *
 * Sin `retry: false`: aqui no hay un 404 esperable que reintentar no vaya a arreglar —como el plan
 * inexistente del timeline—, y un fallo de red si merece el reintento que ya trae el QueryClient.
 */
export function usePlanningMetrics() {
  return useQuery({
    queryKey: planningMetricsQueryKey,
    queryFn: ({ signal }) => fetchPlanningMetrics(signal),
  })
}

/**
 * Clave del desglose de una carencia. Lleva el token de la ruta y no el de la API: el que identifica
 * la pantalla es el que se comparte.
 */
export const declaredGapQueryKey = (gap: MetricGap) =>
  ['planning', 'metrics', 'declared', gap] as const

/** Clave del desglose de desplazados, que es uno solo para todo el conjunto. */
export const displacedQueryKey = ['planning', 'metrics', 'displaced'] as const

/**
 * Las filas declaradas que producen una de las tarjetas de carencia.
 *
 * `retry: false` como en el timeline y por el mismo motivo: aqui si hay un 404 y un 400 esperables
 * —una carencia que no existe, un plan vigente roto— y reintentar no los arregla, solo retrasa el
 * mensaje. Un fallo de red se ve igual, con su texto.
 */
export function useDeclaredGap(gap: MetricGap) {
  return useQuery({
    queryKey: declaredGapQueryKey(gap),
    queryFn: ({ signal }) => fetchDeclaredGap(gap, signal),
    retry: false,
  })
}

/** Los requerimientos desplazados que suma la tarjeta, con su causa. */
export function useDisplaced() {
  return useQuery({
    queryKey: displacedQueryKey,
    queryFn: ({ signal }) => fetchDisplaced(signal),
    retry: false,
  })
}
