import { useQuery } from '@tanstack/react-query'

import { fetchAlerts } from '@/services/alertsService'

/**
 * Clave unica y sin parametros: la lista de alertas es una sola para toda la aplicacion, como la
 * fotografia de la que sale.
 */
export const alertsQueryKey = ['planning', 'alerts'] as const

/**
 * Las condiciones operativas que hoy se cumplen.
 *
 * Sin `retry: false`, como la fotografia y por el mismo motivo: aqui no hay un 404 esperable que
 * reintentar no vaya a arreglar —el plan vigente roto que el backend documenta es inalcanzable hoy—,
 * y un fallo de red si merece el reintento que ya trae el QueryClient.
 */
export function useAlerts() {
  return useQuery({
    queryKey: alertsQueryKey,
    queryFn: ({ signal }) => fetchAlerts(signal),
  })
}
