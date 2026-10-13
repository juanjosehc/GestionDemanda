import type { BadgeVariant } from '@/components/ui/badge'
import type { DeclarationStatus } from '@/types/declarations'

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
