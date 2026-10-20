/**
 * Espeja los DTO del backend de la declaracion de planificacion: la lectura consolidada de un
 * tecnico y el recurso de un ticket.
 *
 * **La clasificacion no esta aqui y no se puede derivar de aqui.** `declarationStatus` y
 * `discards[]` llegan ya decididos por el backend —los produce el mismo validador que decide que
 * entra al plan—, y esta capa se limita a transportarlos. No hay en este archivo ninguna funcion
 * que mire `estimatedHours` o `committedDate` para concluir un estado: seria la segunda version de
 * una regla que ya tiene dueño, y la afirmacion que sostiene toda la pantalla.
 */

/**
 * Que le falta a un ticket para poder planificarse. Espeja el enum `DeclarationStatus` del backend.
 *
 * Se declara como union y no como texto libre por el mismo motivo que `AlertSeverity`: la vista si
 * decide con el —el color del distintivo sale de aqui—. Los cinco valores son los que el backend
 * deriva de los codigos del validador, y la vista no puede producir ninguno mas.
 */
export type DeclarationStatus =
  | 'PLANIFICABLE'
  | 'SIN_ESTIMACION'
  | 'SIN_COMPROMISO'
  | 'SIN_DECLARACION'
  | 'NO_TRADUCIBLE'

/** Incidencia o peticion. Espeja el enum `WorkItemType` del backend. */
export type WorkItemType = 'INCIDENTE' | 'REQUERIMIENTO'

/**
 * Una causa por la que un ticket no llegaria al plan.
 *
 * El codigo va como texto y no como union, al contrario que `declarationStatus`: la vista **no
 * ramifica** por el, solo lo publica junto a su motivo. Cerrar la lista aqui obligaria a tocar el
 * frontend cada vez que el backend añadiera una causa de descarte, y no ganaria nada.
 */
export interface Discard {
  /** La regla que se aplico. No cambia aunque alguien reescriba el texto de al lado. */
  code: string
  /** El mismo hecho en palabras, ya redactado por el backend para quien opera GLPI. */
  reason: string
}

/**
 * La planificacion declarada de un ticket, tal como esta hoy. Espeja `PlanningMetadataResponse`.
 *
 * Un cuerpo con los dos valores en nulo es un recurso que **existe** y no afirma nada: alguien
 * declaro y despues retiro. Eso no es lo mismo que no tener declaracion, y por eso el tipo de
 * `declaration` en un elemento es `PlanningMetadata | null` y no un objeto con campos opcionales.
 *
 * `commitmentOverdue` es un derivado que el backend calcula al responder, con su reloj. La vista lo
 * pinta tal como llega y no compara fechas por su cuenta.
 */
export interface PlanningMetadata {
  workItemId: string
  estimatedHours: number | null
  committedDate: string | null
  /** El autor del ultimo cambio de ese campo. Sobrevive al valor: retirar tambien tiene autor. */
  estimatedBy: string | null
  committedBy: string | null
  estimatedAt: string | null
  committedAt: string | null
  /** De donde salio la fila. Espeja el enum `InputSource` del backend. */
  source: string
  /** true si el compromiso ya vencio. Un compromiso de hoy no esta vencido; uno de ayer si. */
  commitmentOverdue: boolean
}

/** Un ticket asignado al tecnico, con su clasificacion y lo que ya tiene declarado. */
export interface DeclarationItem {
  /**
   * El identificador del ticket en GLPI, que es la clave de su declaracion. Vale `(sin id)` cuando
   * GLPI no lo dio, que es la convencion que el backend ya usa en los descartes.
   */
  workItemId: string
  /** Nulo si el tipo que trajo GLPI no esta en el contrato. Entonces nada mas se puede leer. */
  type: WorkItemType | null
  /** El estado del dominio ya traducido. Nulo por el mismo motivo que el tipo. */
  status: string | null
  /**
   * La prioridad **cruda** de GLPI, en su escala 1..5, tal como la publica el backend.
   *
   * No se traduce a `CRITICAL`/`HIGH`/`MEDIUM`/`LOW`: la normalizacion de prioridades es del motor
   * de planificacion y no ha ocurrido todavia. Traducirla aqui seria inventar una decision de
   * negocio para poder pintar una celda.
   */
  priority: number | null
  createdAt: string | null
  title: string
  /** Que le falta a este ticket para poder planificarse, ya decidido por el backend. */
  declarationStatus: DeclarationStatus
  /** Por que no llegaria al plan. Vacio si es planificable. */
  discards: Discard[]
  /** Lo declarado hoy, o nulo si nadie ha declarado nada. */
  declaration: PlanningMetadata | null
}

/**
 * Respuesta de `GET /api/planning-metadata/declarations?developerId=...`: varias personas en una
 * sola lectura.
 *
 * **Es el mismo cuerpo por persona, repetido en un viaje.** Cada elemento de `developers` es
 * exactamente un `DeveloperDeclarationsResponse`, así que la clasificación sigue siendo la del
 * backend y esta capa no la reinterpreta.
 *
 * `unknownDevelopers` no es un error: es la lista de identificadores que GLPI no conoce —el `404`
 * de la ruta por persona, trasladado al lote—. Se publica aparte para poder decir *cuántas* personas
 * no se leyeron sin inventarles una respuesta vacía.
 */
export interface TeamDeclarationsResponse {
  developers: DeveloperDeclarationsResponse[]
  unknownDevelopers: string[]
}

/** Respuesta completa de `GET /api/planning-metadata/declarations/{developerId}`. */
export interface DeveloperDeclarationsResponse {
  /** El tecnico tal como lo conoce GLPI. `name` puede venir nulo: un usuario sin nombre usable. */
  developer: { id: string; name: string | null }
  /** Sus tickets, clasificados, en el orden en que los devolvio GLPI. Vacio si no tiene ninguno. */
  items: DeclarationItem[]
  /** De donde sale cada dato, declarado por el backend dentro del propio payload. */
  source: { glpi: string; declaration: string }
}

/** Cuerpo de `POST /api/planning-metadata`. Al menos uno de los dos valores es obligatorio. */
export interface DeclarationCreateRequest {
  workItemId: string
  estimatedHours: number | null
  committedDate: string | null
  /** Firma la operacion entera: es quien declara esto ahora. */
  changedBy: string
}

/**
 * Cuerpo de `PUT /api/planning-metadata/{workItemId}`.
 *
 * **Reemplaza, no parchea**: lo que no venga queda en nulo. Por eso este tipo no tiene campos
 * opcionales —los dos valores viajan siempre, con nulo para decir «retiralo»— y por eso el
 * formulario no puede enviar medio cuerpo.
 */
export interface DeclarationUpdateRequest {
  estimatedHours: number | null
  committedDate: string | null
  changedBy: string
}
