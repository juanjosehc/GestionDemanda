/**
 * Lo que esta pantalla lee de `POST /api/planning/from-glpi`, y nada mas.
 *
 * **El contrato entero no se copia aqui.** `plan` es la simulacion completa —asignaciones, bloques,
 * desplazamientos, eventos, conflictos, politicas de incidencia, calendario y vencimientos—, y de todo
 * eso esta pantalla cuenta tres listas y no pinta ninguna. Declarar los diez campos seria mantener una
 * copia que nadie lee y que se queda vieja en cuanto el DTO cambie: el contrato de esa simulacion ya
 * tiene dueño, que es `types/timeline` y el tablero, y cada uno declara la parte que consume.
 *
 * Lo que si se declara con nombre propio es lo que se afirma en voz alta: el plan, su fecha y sus
 * descartes.
 */

/** Respuesta de POST /api/planning/from-glpi. `201` cuando el plan se calculo y se guardo. */
export interface PlanningFromGlpiResponse {
  /** El plan que acaba de quedar guardado. Es la unica direccion con la que se abre su timeline. */
  planId: string
  /** Cuando lo calculo el servidor. La vista no lo compara con nada. */
  createdAt: string
  plan: GeneratedPlan
  /**
   * Los tickets que GLPI entrego y el motor no pudo usar, con el motivo.
   *
   * **Un ticket puede aparecer mas de una vez.** Contar la lista da el numero de causas; contar
   * identificadores distintos da el de tickets. El backend lo documenta asi y aqui se respeta: la
   * pantalla cuenta filas y lo dice con esas palabras, en vez de agrupar por ticket y afirmar una
   * cuenta que el contrato no publica.
   */
  discarded: readonly DiscardedTicket[]
}

/**
 * Lo que esta pantalla lee del plan que acaba de salir.
 *
 * Las tres listas se **cuentan**, no se pintan: son los tres numeros que contestan «que produjo esta
 * ejecucion». Se declaran como listas opacas a proposito, para que nadie las confunda con las que el
 * tablero y el timeline ya saben dibujar.
 */
export interface GeneratedPlan {
  /** El tecnico que se consulto, tal como lo devolvio el backend: no es el texto que se tecleo. */
  developerId: string
  /** Una pieza por elemento ubicado en la agenda. */
  allocations: readonly unknown[]
  /**
   * Los desplazamientos que produjo **esta** ejecucion.
   *
   * No es el numero del tablero: aquel cuenta los del plan vigente de cada tecnico, y este cuenta los
   * de la corrida que se acaba de pedir. Coinciden cuando el plan recien generado es el vigente, y no
   * antes.
   */
  displacedRequirements: readonly unknown[]
  /** El trabajo que no cupo en el horizonte. */
  conflicts: readonly unknown[]
}

/** Un ticket que no entro al plan, con el codigo de la causa y su motivo en palabras. */
export interface DiscardedTicket {
  ticketId: string
  /** Uno de los siete valores de `GlpiDiscardReason`. Se pinta tal cual: la vista no lo traduce. */
  code: string
  /** El motivo que redacto el backend. Es el texto que se enseña, no el codigo. */
  reason: string
}
