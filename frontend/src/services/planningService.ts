import { apiPost } from '@/services/apiClient'
import type { PlanningFromGlpiResponse } from '@/types/planning'

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
