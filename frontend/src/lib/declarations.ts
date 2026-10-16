import type { BadgeVariant } from '@/components/ui/badge'
import type { DeclarationItem, DeclarationStatus } from '@/types/declarations'

/**
 * Un color por estado de declaracion, y los cinco salen del backend.
 *
 * No hay umbrales aqui: los cinco valores son las cinco clases que el enum del backend declara, y
 * el mapa es total sobre ellas —añadir un estado sin darle color no compila—. Vive en `lib/` y no
 * dentro de una pantalla por el mismo motivo que `SEVERITY_VARIANTS`: es un hecho que acabara
 * teniendo mas de un consumidor, y dos copias de una paleta acaban siendo dos paletas.
 *
 * `SIN_DECLARACION` va en neutro y no en aviso porque es el estado de partida de casi todo: se dio
 * de alta el ticket y todavia nadie ha declarado nada, que es lo normal y no una incidencia. Los dos
 * parciales si advierten —alguien empezo y falta la otra mitad—, y `NO_TRADUCIBLE` es el unico que
 * señala un problema que no se arregla declarando.
 */
export const DECLARATION_VARIANTS: Record<DeclarationStatus, BadgeVariant> = {
  PLANIFICABLE: 'success',
  SIN_ESTIMACION: 'warning',
  SIN_COMPROMISO: 'warning',
  SIN_DECLARACION: 'secondary',
  NO_TRADUCIBLE: 'danger',
}

/** Numero de horas sin ceros de relleno: `6`, no `6.0000`. */
export function formatDeclaredHours(hours: number): string {
  return String(Number(hours))
}

/**
 * Los estados que se arreglan declarando: falta un valor, y ponerlo lo resuelve.
 *
 * **`PLANIFICABLE` y `NO_TRADUCIBLE` quedan fuera, y por motivos distintos.** Al primero no le falta
 * nada. El segundo no es un campo que falte sino un tipo o un estado que el contrato no sabe leer, y
 * ninguna estimacion lo arregla: ofrecerlo como «pendiente de declarar» mandaria a alguien a rellenar
 * un formulario que no cambia nada.
 *
 * La lista se declara **una sola vez** porque tiene dos lectores con formas distintas: la pantalla de
 * declaracion pregunta por un ticket —`isDeclarable`— y la vista previa del estado de entrada suma
 * cajones —`declarableOf`, en `lib/planningPreview`—. Escribirla dos veces seria la segunda version de
 * la misma regla, y el dia que el backend añadiera un parcial las dos se separarian sin avisar.
 */
export const DECLARABLE_STATUSES: ReadonlySet<DeclarationStatus> = new Set([
  'SIN_ESTIMACION',
  'SIN_COMPROMISO',
  'SIN_DECLARACION',
])

/** Si este ticket se arregla declarando: le falta un valor, y ponerlo lo resuelve. */
export function isDeclarable(item: DeclarationItem): boolean {
  return DECLARABLE_STATUSES.has(item.declarationStatus)
}
