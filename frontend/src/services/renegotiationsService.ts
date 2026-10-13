import { apiGet, apiPost, apiPut } from '@/services/apiClient'
import type {
  Renegotiation,
  RenegotiationCreateRequest,
  RenegotiationHistoryResponse,
  RenegotiationUpdateRequest,
  RenegotiationsResponse,
} from '@/types/renegotiations'

/**
 * Las cinco operaciones de la renegociacion, contra las cinco rutas que ya existen.
 *
 * No hay ninguna ruta nueva: la pantalla se construye con lo que la Fase 25 publico. Las tres de
 * lectura van a `GET` y las dos de escritura a `POST` y `PUT`, que es el mismo reparto que hace el
 * controlador.
 *
 * El identificador del requerimiento va codificado en el camino: es un identificador de GLPI, dato
 * de fuera, y no una parte fija de la ruta. En el `POST` no hay camino que codificar porque el
 * identificador viaja en el cuerpo —el recurso todavia no existe—, y en el `PUT` si, porque es el
 * recurso que se reemplaza.
 */

/**
 * Los requerimientos desplazados del plan vigente de cada desarrollador, con su acuerdo si lo hay.
 *
 * **Una sola lectura contesta las seis preguntas de la trazabilidad**: que requerimiento se movio,
 * que incidente lo movio, de que fecha a que fecha, cual es la fecha acordada y quien la registro y
 * cuando. No hay una peticion por fila ni por pregunta: pedir el plan de cada desarrollador por
 * separado seria el N+1 que la lectura consolidada existe para evitar.
 */
export function fetchRenegotiations(signal?: AbortSignal): Promise<RenegotiationsResponse> {
  return apiGet<RenegotiationsResponse>('/api/renegotiations', signal)
}

/**
 * El acuerdo de un requerimiento, leido justo antes de reemplazarlo.
 *
 * Existe por el `PUT`, igual que la lectura previa de la declaracion: el `PUT` reemplaza lo que no
 * venga en el cuerpo, asi que modificar la fecha obliga a saber cual es la vigente, y saberla exige
 * leerla. Fiarse de lo que traia la lista reemplazaria con un dato de hace un minuto y borraria lo
 * que alguien cambio en ese minuto.
 *
 * Responde `404` cuando no hay acuerdo. Ese `404` no es una averia: es el estado normal de un
 * requerimiento desplazado del que nadie ha registrado aun la fecha nueva.
 */
export function fetchRenegotiation(
  workItemId: string,
  signal?: AbortSignal,
): Promise<Renegotiation> {
  return apiGet<Renegotiation>(`/api/renegotiations/${encodeURIComponent(workItemId)}`, signal)
}

/**
 * Todo lo que le ha pasado al acuerdo de un requerimiento, en el orden en que lo publica el backend.
 *
 * Es la mitad que hace comprobable la trazabilidad. La vista no la reconstruye ni la reordena: pinta
 * los cambios tal como llegan, porque un historial recompuesto en el cliente afirmaria un orden que
 * nadie audito.
 */
export function fetchRenegotiationHistory(
  workItemId: string,
  signal?: AbortSignal,
): Promise<RenegotiationHistoryResponse> {
  return apiGet<RenegotiationHistoryResponse>(
    `/api/renegotiations/${encodeURIComponent(workItemId)}/history`,
    signal,
  )
}

/** El primer acuerdo de un requerimiento. Responde `409` si ya tenia uno. */
export function createRenegotiation(body: RenegotiationCreateRequest): Promise<Renegotiation> {
  return apiPost<Renegotiation>('/api/renegotiations', body)
}

/** Reemplaza la fecha acordada de un requerimiento. Responde `404` si no habia acuerdo que reemplazar. */
export function updateRenegotiation(
  workItemId: string,
  body: RenegotiationUpdateRequest,
): Promise<Renegotiation> {
  return apiPut<Renegotiation>(`/api/renegotiations/${encodeURIComponent(workItemId)}`, body)
}
