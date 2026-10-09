import { apiGet } from '@/services/apiClient'
import type { GlpiHealth } from '@/types/glpi'

/** Consulta el estado de la integracion con GLPI. El endpoint responde 200 siempre. */
export function fetchGlpiHealth(signal?: AbortSignal): Promise<GlpiHealth> {
  return apiGet<GlpiHealth>('/api/glpi/health', signal)
}
