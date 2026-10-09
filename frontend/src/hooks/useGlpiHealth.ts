import { useQuery } from '@tanstack/react-query'

import { fetchGlpiHealth } from '@/services/glpiService'

/** Clave de cache de TanStack Query para el estado de GLPI. */
export const glpiHealthQueryKey = ['glpi', 'health'] as const

/**
 * Estado de la integracion con GLPI.
 *
 * Se revalida cada 60 s: es un diagnostico de conectividad, no un dato de negocio.
 * El endpoint responde 200 incluso si GLPI esta caido, por lo que un error de la consulta
 * significa que el backend no esta disponible.
 */
export function useGlpiHealth() {
  return useQuery({
    queryKey: glpiHealthQueryKey,
    queryFn: ({ signal }) => fetchGlpiHealth(signal),
    refetchInterval: 60_000,
    retry: 1,
  })
}
