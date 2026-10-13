import { apiGet } from '@/services/apiClient'
import type { OperationalAlertResponse } from '@/types/alerts'

/**
 * Las condiciones operativas que hoy se cumplen, de mas grave a menos.
 *
 * Es la unica fuente del centro de alertas, y no se pide nada mas para pintarlo: la lista ya trae
 * la severidad, la condicion, el origen y el destino de cada alerta. El backend no acepta
 * parametros —la proyeccion es del conjunto, no de una alerta—, asi que no hay nada que componer.
 *
 * No se filtra en el servidor a proposito: los filtros de la pantalla son de presentacion, y una
 * consulta por filtro convertiria una lista ya recibida en una llamada nueva.
 */
export function fetchAlerts(signal?: AbortSignal): Promise<OperationalAlertResponse> {
  return apiGet<OperationalAlertResponse>('/api/planning/alerts', signal)
}
