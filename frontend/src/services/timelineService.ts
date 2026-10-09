import { apiGet } from '@/services/apiClient'
import type { TimelinePlanResponse } from '@/types/timeline'

/** Agenda guardada de un plan, con su capacidad dia a dia. Es la unica fuente de la vista. */
export function fetchTimeline(planId: string, signal?: AbortSignal): Promise<TimelinePlanResponse> {
  return apiGet<TimelinePlanResponse>(`/api/planning/${planId}/timeline`, signal)
}
