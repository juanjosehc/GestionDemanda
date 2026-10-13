import { apiGet, apiPost, apiPut } from '@/services/apiClient'
import type {
  DeclarationCreateRequest,
  DeclarationUpdateRequest,
  DeveloperDeclarationsResponse,
  PlanningMetadata,
} from '@/types/declarations'

/**
 * Las cuatro operaciones de la declaracion, contra las cuatro rutas que ya existen.
 *
 * No hay ninguna ruta nueva: la pantalla se construye con lo que el backend ya publicaba. Las tres
 * de lectura van a `GET` y las dos de escritura a `POST` y `PUT`, que es el mismo reparto que hace
 * el controlador.
 *
 * El identificador del tecnico y el del ticket van codificados en el camino: son datos de fuera
 * —un identificador de GLPI— y no una parte fija de la ruta.
 */

/**
 * Los tickets asignados a un tecnico, con lo que le falta a cada uno para poder planificarse.
 *
 * Es la unica fuente de la pantalla y **es de solo lectura**. No se usa
 * `POST /api/planning/from-glpi` para listar: ese endpoint planifica, y cada vez que alguien abriera
 * la pantalla dejaria un plan guardado.
 */
export function fetchDeclarations(
  developerId: string,
  signal?: AbortSignal,
): Promise<DeveloperDeclarationsResponse> {
  return apiGet<DeveloperDeclarationsResponse>(
    `/api/planning-metadata/declarations/${encodeURIComponent(developerId)}`,
    signal,
  )
}

/**
 * La planificacion declarada de un ticket, leida justo antes de escribirla.
 *
 * Existe por el `PUT`: como reemplaza lo que no venga en el cuerpo, modificar la fecha de un ticket
 * obliga a reenviar tambien sus horas, y reenviarlas exige saber cuales son. Leer aqui y no fiarse
 * de lo que traia la lista es lo que evita borrar un valor que alguien cambio hace un minuto.
 */
export function fetchDeclaration(
  workItemId: string,
  signal?: AbortSignal,
): Promise<PlanningMetadata> {
  return apiGet<PlanningMetadata>(
    `/api/planning-metadata/${encodeURIComponent(workItemId)}`,
    signal,
  )
}

/** La primera declaracion de un ticket. Responde `409` si ya tenia una. */
export function createDeclaration(body: DeclarationCreateRequest): Promise<PlanningMetadata> {
  return apiPost<PlanningMetadata>('/api/planning-metadata', body)
}

/** Reemplaza la declaracion de un ticket. Los dos valores viajan siempre; nulo significa retirar. */
export function updateDeclaration(
  workItemId: string,
  body: DeclarationUpdateRequest,
): Promise<PlanningMetadata> {
  return apiPut<PlanningMetadata>(
    `/api/planning-metadata/${encodeURIComponent(workItemId)}`,
    body,
  )
}
