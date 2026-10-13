/**
 * Espeja el DTO OperationalAlertResponse del backend (GET /api/planning/alerts).
 *
 * No es un agregado que el frontend arme: es la proyeccion que el backend ya calculo, tal como la
 * publica. La vista **no ordena** —el backend ya entrega de mas grave a menos—, no suma los
 * contadores y no re-deriva ninguna prioridad.
 *
 * Solo llegan las condiciones que hoy se cumplen. Una lista vacia no es un error ni un hueco que
 * rellenar: es la forma que tiene una alerta de declarar que no hay nada que mirar, y por eso la
 * respuesta viene fechada aunque no traiga ninguna.
 */

/**
 * Cuanto urge una alerta. Espeja el enum AlertSeverity del backend.
 *
 * Se declara como union y no como texto libre porque la vista si decide con el: el color del
 * distintivo sale de aqui. El `type` de la alerta, en cambio, se queda como texto —la vista no
 * ramifica por el, y el backend ya dijo por escrito que un consumidor no tiene por que conocer su
 * catalogo—.
 */
export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO'

/**
 * Una alerta operativa: una condicion que hoy se cumple, y cuantos elementos la cumplen.
 *
 * **Una alerta no es un elemento.** Lleva *cuantos* hay y a donde ir a verlos; no lleva los
 * elementos. Un equipo entero con la jornada agotada produce una alerta con `count: 20`, no veinte
 * alertas. Y como clasifican y no particionan, un mismo elemento puede producir varias: sumar los
 * `count` de la lista no mide nada, asi que la vista no publica ningun total.
 */
export interface OperationalAlert {
  /** Que condicion se cumple. Es la identidad estable de la alerta, y es unica en la lista. */
  type: string
  severity: AlertSeverity
  /** De que tabla sale el numero, con el texto que publica la fotografia operativa. */
  source: string
  /** Sobre que universo se conto, con el texto que publica la fotografia operativa. */
  scope: string
  /** La condicion que se conto, en palabras. */
  condition: string
  /** Cuantos elementos la producen. Siempre mayor que cero. */
  count: number
  /**
   * La ruta del desglose **en la API**, o nulo si la alerta no tiene listado propio.
   *
   * No es una ruta de la interfaz: el backend no conoce el prefijo con el que se sirve la
   * aplicacion ni si va detras de un proxy, y publicar la pantalla seria la tercera copia de un
   * hecho que ya tiene dos dueños aqui. Traducirla es de este lado, con `alertDetailPath`.
   */
  detailUrl: string | null
  /** Cuando se evaluo. Hoy es, por construccion, el mismo instante que el de la respuesta. */
  generatedAt: string
}

/** Respuesta completa de GET /api/planning/alerts. */
export interface OperationalAlertResponse {
  /** Cuando se evaluaron las condiciones. Fecha tambien la lista vacia. */
  generatedAt: string
  /** Las alertas disparadas, de mas grave a menos. Vacia si no hay ninguna. */
  alerts: OperationalAlert[]
}
