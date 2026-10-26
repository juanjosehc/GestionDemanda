import type { BadgeVariant } from '@/components/ui/badge'
import type { RenegotiationItem, RenegotiationStatus, RenegotiationsResponse } from '@/types/renegotiations'
import type { TimelineState } from '@/types/timeline'

/**
 * Un color por estado, y los dos salen del backend.
 *
 * El mapa es **total** sobre los dos valores del enum: anadir un estado sin darle color no compila.
 * No hay un color para «renegociada y despues movida otra vez» porque el backend no declara ese
 * estado: lo publica como PENDIENTE_DE_ACUERDO —hay que volver a acordar— y pintarlo distinto seria
 * inventar un tercer estado en la vista, que es justo lo que esta pantalla no puede hacer.
 *
 * Vive aqui y no dentro de la tabla porque el formulario y el historial pintan el mismo estado, y dos
 * copias de una paleta acaban siendo dos paletas.
 */
export const STATUS_VARIANTS: Record<RenegotiationStatus, BadgeVariant> = {
  PENDIENTE_DE_ACUERDO: 'warning',
  ACORDADA: 'success',
}

/**
 * De donde vino el acuerdo.
 *
 * `GLPI` es la conciliacion automatica de la Fase 64: el gestor cambio el TTR en GLPI y el sistema
 * lo registro sin que nadie volviera a teclearlo. `HTTP` es una persona por la API.
 *
 * La vista **no deduce el origen**: lo pinta tal como llega. Y no lo confunde con el autor: un
 * acuerdo conciliado puede corregirse a mano, y en ese momento el backend lo pasa a `HTTP` porque
 * el ultimo cambio lo hizo una persona.
 */
export type AgreementOrigin = 'HTTP' | 'GLPI'

/** La etiqueta larga, la que explica el origen sin abreviar. */
export const AGREEMENT_ORIGIN_LABEL: Record<AgreementOrigin, string> = {
  GLPI: 'Conciliado automáticamente',
  HTTP: 'Acordado manualmente',
}

/** La etiqueta corta del Timeline, donde el espacio lo comparte con el estado. */
export const AGREEMENT_ORIGIN_BADGE: Record<AgreementOrigin, string> = {
  GLPI: 'Acordada en GLPI',
  HTTP: 'Acordada manualmente',
}

/**
 * El origen tal como llega, acotado a los dos valores que el contrato publica.
 *
 * El backend lo declara como enum y lo serializa por nombre. Si algun dia apareciera un tercero,
 * caeria aqui en vez de romper la vista: se lee como manual, que es la lectura conservadora —no
 * atribuir a GLPI un acuerdo que no se sabe de donde vino—.
 */
export function agreementOrigin(source: string | undefined): AgreementOrigin {
  return source === 'GLPI' ? 'GLPI' : 'HTTP'
}

/** Valor del filtro sin aplicar. No es un estado del contrato: es la ausencia de filtro. */
export const ANY_STATUS = 'TODOS'

/**
 * Los filtros de la lista, aplicados **en memoria** sobre lo ya recibido.
 *
 * `PENDIENTE_DE_ACUERDO` y `ACORDADA` son valores del enum del backend. `ACORDADA_MANUAL` y
 * `ACORDADA_GLPI` **no son estados**: son la combinacion de dos hechos que el contrato ya publica
 * —el estado y el origen del acuerdo— y existen para que el gestor pueda quedarse con los acuerdos
 * que trajo GLPI sin leer la columna de origen fila a fila. Se escriben una sola vez, aqui, y la
 * vista no los interpreta: los compara contra el estado y el `source` recibidos.
 *
 * No hay una peticion por filtro: la lista es del conjunto y se pidio una sola vez. Filtrar contra el
 * backend convertiria una seleccion de la interfaz en trafico, y ademas el endpoint no acepta
 * parametros. Cambiar de filtro no dispara ninguna llamada, y por eso el filtro no puede discrepar
 * de los numeros que el backend conto sobre las mismas filas.
 */
export type RenegotiationFilter =
  | typeof ANY_STATUS
  | RenegotiationStatus
  | 'ACORDADA_MANUAL'
  | 'ACORDADA_GLPI'

/**
 * Las cinco opciones, en el orden en que se leen: todo, lo que falta, lo que ya esta y de donde vino.
 *
 * Las etiquetas son de la interfaz —«Pendientes», «Acordadas en GLPI»— pero **los dos primeros
 * valores son los del enum**, sin traducir: el filtro compara contra el estado que publico el
 * backend, no contra una palabra que la vista haya decidido.
 */
export const FILTER_OPTIONS: readonly { value: RenegotiationFilter; label: string }[] = [
  { value: ANY_STATUS, label: 'Todas' },
  { value: 'PENDIENTE_DE_ACUERDO', label: 'Pendientes' },
  { value: 'ACORDADA', label: 'Acordadas' },
  { value: 'ACORDADA_MANUAL', label: 'Acordadas manualmente' },
  { value: 'ACORDADA_GLPI', label: 'Acordadas en GLPI' },
]

/**
 * Aplica el filtro. Compara contra el estado y el origen recibidos; no los deduce ni los corrige.
 *
 * Los dos filtros por origen exigen **estar acordado**: un requerimiento que se movio despues de
 * haberse acordado esta `PENDIENTE_DE_ACUERDO` y conserva su acuerdo anterior, y listarlo como
 * «acordada» seria afirmar que ya no hay nada que hacer con el. Se encuentra con «Pendientes».
 */
export function matchesFilter(item: RenegotiationItem, filter: RenegotiationFilter): boolean {
  if (filter === ANY_STATUS) {
    return true
  }
  if (filter === 'ACORDADA_MANUAL' || filter === 'ACORDADA_GLPI') {
    const wanted = filter === 'ACORDADA_GLPI' ? 'GLPI' : 'HTTP'

    return (
      item.status === 'ACORDADA' &&
      item.renegotiation !== null &&
      agreementOrigin(item.renegotiation.source) === wanted
    )
  }

  return item.status === filter
}

/**
 * El estado visual del Timeline para cada elemento desplazado, indexado por ticket.
 *
 * **Es el único sitio que traduce el acuerdo a la rejilla.** La rejilla pinta tramos y no sabe de
 * renegociaciones; la página ya tiene esta lectura cargada para el panel de acuerdos, así que la
 * cruza aquí una vez y se la pasa hecha. Deducir el color dentro del bloque habría pedido que cada
 * tramo tuviera la lista entera a mano y habría duplicado la regla de origen.
 *
 * Un elemento que la lista no menciona no aparece en el mapa: el plan manda entonces y el tramo
 * conserva su estado de plan.
 */
export function agreementStates(
  renegotiations: RenegotiationsResponse | undefined,
): Record<string, TimelineState> {
  const states: Record<string, TimelineState> = {}

  for (const item of renegotiations?.items ?? []) {
    if (item.status === 'PENDIENTE_DE_ACUERDO') {
      states[item.workItemId] = 'PENDIENTE_DE_ACUERDO'
      continue
    }

    // El origen se lee acotado, igual que en la tabla: un origen desconocido se pinta como manual
    // en vez de atribuirle a GLPI un acuerdo que no se sabe de dónde vino.
    states[item.workItemId] =
      agreementOrigin(item.renegotiation?.source) === 'GLPI' ? 'ACORDADO_GLPI' : 'ACORDADO_MANUAL'
  }

  return states
}
