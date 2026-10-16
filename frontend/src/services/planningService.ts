import { apiGet, apiPost } from '@/services/apiClient'
import type {
  PlanningFromGlpiResponse,
  PlanningInputResponse,
  PlanSnapshotResponse,
} from '@/types/planning'

/**
 * El unico endpoint que genera planes, y el unico que esta pantalla invoca.
 *
 * **La interfaz no planifica.** El motor corre entero en el backend con las reglas configuradas; el
 * cuerpo lleva el identificador del tecnico y nada mas, asi que desde aqui no se puede alterar una
 * regla, ni un horizonte, ni una prioridad. Lo que vuelve es un plan ya guardado, con su `planId` y su
 * fecha: la vista enseña el resultado, no lo produce.
 *
 * **Es una escritura, no una lectura.** Cada llamada deja un plan detras y sube el contador de planes
 * generados, asi que se invoca desde una accion explicita —el boton— y nunca al abrir la pantalla. Es
 * la misma razon por la que `Declarations` no usa esta ruta para listar.
 *
 * Los errores no se traducen aqui: `apiClient` convierte el cuerpo del backend en un `ApiError` con su
 * estado y su mensaje, y ese mensaje es el que se enseña. `404` cuando GLPI no tiene ese tecnico, `503`
 * cuando GLPI no responde, `502` cuando responde mal o rechaza las credenciales, `400` cuando el
 * identificador viene vacio. Esta ruta no produce `409`: no hay nada que ya exista, cada llamada crea
 * un plan nuevo.
 */
export function generatePlan(developerId: string): Promise<PlanningFromGlpiResponse> {
  return apiPost<PlanningFromGlpiResponse>('/api/planning/from-glpi', { developerId })
}

/**
 * `GET /api/planning/{planId}`: un plan guardado, releido de la base de datos.
 *
 * Es la unica lectura que publica los **conflictos** —el trabajo que no cupo en el horizonte, con el
 * motivo que redacto el motor— y los eventos de reprogramacion con su regla aplicada. El timeline no
 * los trae: un requerimiento en conflicto no tiene tramo, asi que no tiene item de agenda.
 *
 * **No recalcula nada.** Devuelve las filas que quedaron guardadas, asi que el mismo plan devuelve
 * siempre lo mismo y no puede discrepar de lo que el motor decidio aquel dia.
 *
 * `404` con codigo `PLAN_NOT_FOUND` si el identificador no corresponde a ningun plan.
 */
export function fetchPlanSnapshot(planId: string, signal?: AbortSignal): Promise<PlanSnapshotResponse> {
  return apiGet<PlanSnapshotResponse>(`/api/planning/${planId}`, signal)
}

/**
 * `GET /api/planning/{planId}/input`: con que datos se calculo el plan guardado.
 *
 * Devuelve **todos** los elementos que el motor recibio, incluidos los que descarto por estar resueltos
 * o finalizados: la foto es de lo que entro, no de lo que se uso. Es lo que permite contar los
 * recibidos y nombrar a los excluidos, que no aparecen en ninguna otra lectura.
 *
 * **`404` no es un fallo.** Los planes anteriores a la Fase 8 no tienen foto de entrada, y el contrato
 * lo dice con esas palabras: vacio significa que no consta, no que fuera vacia. Quien la lea tiene que
 * distinguir «no entro nada» de «no sabemos que entro».
 */
export function fetchPlanInput(planId: string, signal?: AbortSignal): Promise<PlanningInputResponse> {
  return apiGet<PlanningInputResponse>(`/api/planning/${planId}/input`, signal)
}
