import { useQuery } from '@tanstack/react-query'

import { fetchTimeline } from '@/services/timelineService'

/** Clave por plan: cada planId es una lectura distinta, y el mismo plan siempre da lo mismo. */
export const timelineQueryKey = (planId: string) => ['planning', 'timeline', planId] as const

/**
 * Agenda guardada de un plan. Sin planId la consulta no se dispara.
 *
 * {@code retry: false} porque un plan inexistente responde 404 y reintentarlo no lo va a crear.
 */
export function useTimeline(planId: string | undefined) {
  return useQuery({
    queryKey: timelineQueryKey(planId ?? ''),
    // El planId ya esta garantizado por `enabled`; TypeScript no puede verlo a traves del cierre.
    queryFn: ({ signal }) => fetchTimeline(planId as string, signal),
    enabled: Boolean(planId),
    retry: false,
  })
}
