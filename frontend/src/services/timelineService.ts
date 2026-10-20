import { apiGet } from '@/services/apiClient'
import type { TeamTimelineResponse, TimelinePlanResponse } from '@/types/timeline'

/** Agenda guardada de un plan, con su capacidad dia a dia. Es la unica fuente de la vista. */
export function fetchTimeline(planId: string, signal?: AbortSignal): Promise<TimelinePlanResponse> {
  return apiGet<TimelinePlanResponse>(`/api/planning/${planId}/timeline`, signal)
}

/**
 * Agenda de todo el equipo en una ventana común, sin pedir ningún identificador.
 *
 * Es la lectura que permite abrir la aplicación en el timeline: a diferencia de la de un plan, no
 * necesita saber cuál. El backend la arma con los planes vigentes que ya tiene guardados.
 */
export function fetchTeamTimeline(signal?: AbortSignal): Promise<TeamTimelineResponse> {
  return apiGet<TeamTimelineResponse>('/api/planning/team/timeline', signal)
}
