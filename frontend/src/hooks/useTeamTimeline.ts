import { useQuery } from '@tanstack/react-query'

import { fetchTeamTimeline } from '@/services/timelineService'

/**
 * Clave de la agenda del equipo: única y sin parámetros, como la fotografía operativa.
 *
 * Cuelga del mismo prefijo que la de un plan —`['planning','timeline', …]`— para que invalidar el
 * timeline entero las alcance a las dos. El tercer segmento es un literal y no un identificador: un
 * plan nunca se llama `team`, así que no hay colisión posible con `timelineQueryKey`.
 */
export const teamTimelineQueryKey = ['planning', 'timeline', 'team'] as const

/**
 * La agenda de todo el equipo, sin conocer ningún plan.
 *
 * Sin `retry: false`, al contrario que la lectura de un plan: aquí no hay un `404` esperable que
 * reintentar no vaya a arreglar —no se pide ningún identificador—, y un fallo de red sí merece el
 * reintento que ya trae el QueryClient.
 *
 * Una respuesta con `resources` vacío **no es un error**: significa que hoy no hay ningún plan
 * vigente, que es un hecho del sistema y no un fallo de la lectura.
 */
export function useTeamTimeline() {
  return useQuery({
    queryKey: teamTimelineQueryKey,
    queryFn: ({ signal }) => fetchTeamTimeline(signal),
  })
}
