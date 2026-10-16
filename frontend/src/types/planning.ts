/**
 * Lo que las pantallas de planificacion leen del plan: el que se acaba de generar y el que ya estaba
 * guardado.
 *
 * **El contrato entero no se copia aqui.** `plan` es la simulacion completa —asignaciones, bloques,
 * desplazamientos, eventos, conflictos, politicas de incidencia, calendario y vencimientos—, y de todo
 * eso esta pantalla cuenta tres listas y no pinta ninguna. Declarar los diez campos seria mantener una
 * copia que nadie lee y que se queda vieja en cuanto el DTO cambie: el contrato de esa simulacion ya
 * tiene dueño, que es `types/timeline` y el tablero, y cada uno declara la parte que consume.
 *
 * Lo que si se declara con nombre propio es lo que se afirma en voz alta: el plan, su fecha y sus
 * descartes —y, para un plan guardado, su sello, sus conflictos, sus desplazamientos y la foto de la
 * entrada.
 *
 * **Dos formas se reutilizan en vez de redeclararse**: la asignacion es la del timeline y el evento de
 * reprogramacion es el de las metricas. Son literalmente la misma fila que el backend publica por dos
 * rutas, y dos declaraciones de la misma forma acaban divergiendo.
 */

import type { RescheduleEvent } from '@/types/planningMetrics'
import type { IncidentSeverity, TimelineAllocation, WorkItemType } from '@/types/timeline'

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

/** Un conflicto de capacidad: el trabajo que no cupo en el horizonte, con el motivo del motor. */
export interface PlanConflict {
  workItemId: string
  workItemType: WorkItemType
  /** La frase que redacto el motor. Se pinta tal cual: la vista no la traduce ni la reescribe. */
  reason: string
}

/**
 * Respuesta de `GET /api/planning/{planId}`: un plan guardado, releido.
 *
 * Es la lectura que el frontend nunca habia hecho, y la unica que publica **los conflictos**. El
 * timeline no los trae, y no es un olvido: un requerimiento que no cupo no tiene tramo, asi que no
 * tiene item de agenda.
 *
 * **Declara la parte que se consume, no el contrato entero.** `blocks` viaja en la respuesta y no se
 * declara aqui: el timeline ya publica los mismos tramos enriquecidos —con su estimacion, su fecha
 * compromiso y su estado—, y copiarlos seria una segunda forma de la misma fila.
 */
export interface PlanSnapshotResponse {
  planId: string
  developerId: string
  /** Cuando el motor calculo el plan. Es la fecha de generacion que el resumen enseña. */
  createdAt: string
  /** Lo comprometido por elemento y dia. Misma forma que en el timeline: es la misma fila. */
  allocations: readonly TimelineAllocation[]
  /** La auditoria de cada desplazamiento, con la regla aplicada y el motivo. */
  rescheduleEvents: readonly RescheduleEvent[]
  /** Lo que no cupo en el horizonte, con el motivo. **Solo esta lectura lo publica.** */
  conflicts: readonly PlanConflict[]
}

/**
 * Respuesta de `GET /api/planning/{planId}/input`: los datos exactos que recibio el motor.
 *
 * Responde lo que el resultado no responde. `GET /{planId}` dice que salio; esto dice con que se
 * entro. **No es el total que GLPI entrego**: es la foto de lo que llego al motor despues de validar,
 * y las dos cifras son distintas (riesgo 122).
 *
 * Se devuelven **todos** los elementos recibidos, incluidos los que el motor descarto por estar
 * resueltos o finalizados: la foto es de lo que entro, no de lo que se uso. Por eso es la unica
 * lectura que permite nombrar a los excluidos.
 *
 * `404` en los planes anteriores a la Fase 8: no hay foto, y eso **no significa que la entrada
 * estuviera vacia**.
 */
export interface PlanningInputResponse {
  planId: string
  developerId: string
  incidents: readonly PlanInputIncident[]
  requirements: readonly PlanInputRequirement[]
  /** Quien puso la foto: `GLPI` cuando vino de la extraccion, `HTTP` en las entradas a mano. */
  source: string
  /** Cuando se extrajo. Nulo en las entradas HTTP: no hubo extraccion que fechar. */
  extractedAt: string | null
}

/**
 * Un incidente tal como entro al motor.
 *
 * `status` viaja como texto y se pinta tal cual, sin traducir: es el estado que el motor leyo, y es lo
 * unico que explica por que un elemento que entro no aparece en el resultado.
 */
export interface PlanInputIncident {
  id: string
  estimatedHours: number
  status: string
  /** Nula en los incidentes anteriores a la priorizacion por severidad. El nulo no se disfraza. */
  severity: IncidentSeverity | null
}

/** Un requerimiento tal como entro al motor, con la fecha en que se comprometio. */
export interface PlanInputRequirement {
  id: string
  estimatedHours: number
  /** Fecha compromiso de la foto. */
  plannedDate: string
  status: string
}

/**
 * Respuesta de `GET /api/planning/plans/{developerId}`: los planes guardados de un tecnico.
 *
 * Es la primera lectura de esta API que devuelve **una coleccion de planes** y no un plan: las demas o
 * son de uno concreto o son agregados. Existe porque sin ella «el plan anterior» no es una cosa
 * nombrable —`/metrics` publica el vigente de cada tecnico y descarta el resto—, y sin nombre no hay
 * comparacion que construir.
 *
 * **`developerId` viaja una vez**, en la respuesta y no en cada fila: es constante en toda la lista.
 * **No hay `total`**: seria `plans.length` con otro nombre.
 */
export interface DeveloperPlansResponse {
  /** El tecnico que se consulto, tal como lo devolvio el backend. */
  developerId: string
  /**
   * Sus planes, **del mas antiguo al mas reciente**.
   *
   * **El orden es parte del contrato, no un detalle de presentacion.** Quien compara elige «el
   * anterior» por posicion sobre esta lista, y por eso la vista no la reordena: reordenarla seria la
   * segunda definicion de «cual es el anterior».
   *
   * Una lista vacia significa «no tiene planes», no «no existe»: esta capa no tiene padron de tecnicos
   * y no puede distinguirlos.
   */
  plans: readonly DeveloperPlan[]
  /** Hasta donde mira la lista. Es la nota que explica por que puede estar acotada. */
  scope: string
}

/**
 * Un plan guardado, reducido a lo que hace falta para nombrarlo y ordenarlo.
 *
 * **No se declara la entrada ni el resultado.** Para comparar dos planes hay que leerlos enteros, y se
 * leen por sus rutas de siempre —`/{planId}`, `/{planId}/input` y el timeline—, que ya estan
 * declaradas. Esta lista solo contesta *cuales* hay y *desde cuando*.
 */
export interface DeveloperPlan {
  planId: string
  /** Cuando el motor calculo el plan. Es el sello con el que se fecha la comparacion. */
  createdAt: string
}
