import type { BadgeVariant } from '@/components/ui/badge'
import type { RenegotiationStatus } from '@/types/renegotiations'

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

/** Valor del filtro sin aplicar. No es un estado del contrato: es la ausencia de filtro. */
export const ANY_STATUS = 'TODOS'

/**
 * Los filtros de la lista, aplicados **en memoria** sobre lo ya recibido.
 *
 * No hay una peticion por filtro: la lista es del conjunto y se pidio una sola vez. Filtrar contra el
 * backend convertiria una seleccion de la interfaz en trafico, y ademas el endpoint no acepta
 * parametros. Cambiar de filtro no dispara ninguna llamada, y por eso el filtro no puede discrepar
 * de los numeros que el backend conto sobre las mismas filas.
 */
export type RenegotiationFilter = RenegotiationStatus | typeof ANY_STATUS

/**
 * Las tres opciones, en el orden en que se leen: todo, lo que falta y lo que ya esta.
 *
 * Las etiquetas son de la interfaz —«Pendientes» y «Acordadas»— pero **los valores son los del
 * enum**, sin traducir: el filtro compara contra el estado que publico el backend, no contra una
 * palabra que la vista haya decidido. Traducir el valor haria que la pantalla tuviera su propia
 * definicion de cada estado.
 */
export const FILTER_OPTIONS: readonly { value: RenegotiationFilter; label: string }[] = [
  { value: ANY_STATUS, label: 'Todas' },
  { value: 'PENDIENTE_DE_ACUERDO', label: 'Pendientes' },
  { value: 'ACORDADA', label: 'Acordadas' },
]

/** Aplica el filtro. Compara contra el estado recibido; no lo deduce ni lo corrige. */
export function matchesFilter(status: RenegotiationStatus, filter: RenegotiationFilter): boolean {
  return filter === ANY_STATUS || status === filter
}
