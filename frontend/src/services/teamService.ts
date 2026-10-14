import { apiGet } from '@/services/apiClient'
import type { TeamCatalogResponse } from '@/types/team'

/**
 * El padrón del equipo: las personas del grupo de GLPI y las excepciones declaradas.
 *
 * Sin parámetros: el grupo lo elige el backend por configuración, no la pantalla. Una petición que
 * llevara el grupo en la URL trasladaría aquí una decisión que es de operación.
 */
export function fetchTeam(signal?: AbortSignal): Promise<TeamCatalogResponse> {
  return apiGet<TeamCatalogResponse>('/api/team', signal)
}
