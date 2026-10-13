import type { RescheduleEvent } from '@/types/planningMetrics'

/**
 * Espeja el contrato de renegociacion de la Fase 25 (GET/POST/PUT /api/renegotiations).
 *
 * No hay un solo campo derivado aqui. El estado llega calculado, las fechas del desplazamiento
 * llegan auditadas y el acuerdo llega tal como se registro: la vista no tiene por donde recalcular
 * nada, y eso es deliberado —el dia que la pantalla necesite un valor que no esta, el sitio donde
 * anadirlo es el DTO del backend, no esta capa—.
 */

/**
 * Los dos valores del enum RenegotiationStatus del backend.
 *
 * **Son los unicos estados validos y se usan como llegan.** No hay un tercero para «renegociada y
 * despues movida otra vez»: el backend publica ese caso como PENDIENTE_DE_ACUERDO, porque lo que hay
 * que hacer con el es volver a acordar. Deducirlo aqui seria la segunda definicion del mismo hecho.
 */
export type RenegotiationStatus = 'PENDIENTE_DE_ACUERDO' | 'ACORDADA'

/** Espeja RenegotiationResponse: el acuerdo y solo el acuerdo, sin el desplazamiento que lo motiva. */
export interface Renegotiation {
  workItemId: string
  /** La fecha nueva que se acordo. */
  agreedDate: string
  /** Quien registro el acuerdo. */
  agreedBy: string
  /** Cuando se registro. Lo sella el servidor; la vista no lo compara con nada. */
  agreedAt: string
  /** De donde vino el acuerdo: `HTTP` mientras solo lo registre una persona por la API. */
  source: string
}

/**
 * Los tres numeros de la pantalla, contados por el backend sobre las mismas filas que devuelve.
 *
 * No se recuentan aqui: `displaced` es `pending + agreed` por construccion, y recalcularlos en la
 * vista daria dos juegos de cifras que pueden discrepar del listado que hay debajo.
 */
export interface RenegotiationSummary {
  displaced: number
  pending: number
  agreed: number
}

/**
 * Un requerimiento desplazado con su trazabilidad entera.
 *
 * `events` es el desplazamiento —la auditoria que el plan ya guardaba— y `renegotiation` es el
 * acuerdo. Son dos hechos distintos y por eso no se funden: un acuerdo **anterior** a un
 * desplazamiento llega igual, con `status` en PENDIENTE_DE_ACUERDO, y es lo que deja ver que hubo una
 * renegociacion y que despues el requerimiento se movio otra vez.
 */
export interface RenegotiationItem {
  developerId: string
  planId: string
  calculatedAt: string
  workItemId: string
  /** Calculado por el backend al leer. La vista lo pinta, nunca lo deduce. */
  status: RenegotiationStatus
  /** Sus desplazamientos. Nunca viene vacio: el timeline solo marca a quien tiene un evento. */
  events: RescheduleEvent[]
  /** El acuerdo registrado, o nulo si todavia no hay ninguno. */
  renegotiation: Renegotiation | null
}

/** Respuesta de GET /api/renegotiations. */
export interface RenegotiationsResponse {
  source: string
  scope: string
  generatedAt: string
  summary: RenegotiationSummary
  items: RenegotiationItem[]
}

/** Cuerpo de POST /api/renegotiations. El identificador viaja aqui, no en el camino. */
export interface RenegotiationCreateRequest {
  workItemId: string
  agreedDate: string
  agreedBy: string
}

/**
 * Cuerpo de PUT /api/renegotiations/{workItemId}.
 *
 * Reemplaza, no parchea: lo que venga es la fecha vigente. El identificador va en el camino y no se
 * repite aqui, para que los dos no puedan no coincidir.
 */
export interface RenegotiationUpdateRequest {
  agreedDate: string
  agreedBy: string
}

/**
 * Un cambio del acuerdo, tal como lo publica el historial.
 *
 * `previousDate` nulo **es informacion, no una ausencia**: marca el primer acuerdo, el momento en que
 * no habia fecha y alguien la trajo. La lista no se reordena ni se reconstruye en el cliente; se
 * pinta en el orden en que llega.
 */
export interface RenegotiationChange {
  previousDate: string | null
  newDate: string
  changedBy: string
  changedAt: string
}

/** Respuesta de GET /api/renegotiations/{workItemId}/history. Nunca viene vacia mientras haya fila. */
export interface RenegotiationHistoryResponse {
  workItemId: string
  changes: RenegotiationChange[]
}
