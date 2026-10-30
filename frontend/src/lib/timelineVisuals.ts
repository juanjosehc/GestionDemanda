import { AlertTriangle, CalendarClock, Clock, Flag } from 'lucide-react'

import type { BadgeVariant } from '@/components/ui/badge'
import type { CommitmentRisk, TimelineState } from '@/types/timeline'

/**
 * La paleta visual del Timeline, en un solo sitio.
 *
 * **Vive aquí y no en la rejilla porque la usan dos pantallas.** El Gantt de capacidad pinta sus
 * barras con la misma tabla de estados y sus banderas con la misma de riesgos: si cada vista
 * definiera su copia, el mismo ticket podría salir de dos colores distintos y ninguna de las dos
 * estaría mintiendo por separado.
 */
/**
 * La paleta de los seis estados, en un solo sitio.
 *
 * **Cada estado tiene un color que ningún otro usa**, porque el color es lo único que un tramo de
 * dos líneas puede decir antes de que alguien lo lea: azul es «está donde debe», ámbar «el plan lo
 * movió», violeta «espera una decisión de una persona», verde y verde azulado «ya hay acuerdo» —uno
 * lo concilió el sistema y otro lo firmó alguien—, y gris punteado «no se puede planificar todavía».
 *
 * **El gris no es el color del error**: un ticket sin estimación no está mal, está incompleto, y la
 * pantalla lo que hace es pedir el dato, no denunciarlo. El rojo queda para lo único que es un
 * error: capacidad ocupada por encima de la disponible, que ya se pinta en la franja del día.
 *
 * El estado no se decide aquí: llega resuelto por `blockState`, que cruza el plan con el acuerdo.
 */
export const STATES: Record<TimelineState, { label: string; variant: BadgeVariant; block: string }> = {
  SIN_ESTIMACION: {
    label: 'Requiere estimación',
    variant: 'secondary',
    block: 'border-dashed border-slate-400 bg-slate-50 text-slate-600',
  },
  PLANIFICADO: {
    label: 'Planificado',
    variant: 'info',
    block: 'border-sky-200 bg-sky-50 text-sky-900',
  },
  DESPLAZADO: {
    label: 'Desplazado',
    variant: 'warning',
    block: 'border-amber-400 bg-amber-50 text-amber-900',
  },
  PENDIENTE_DE_ACUERDO: {
    label: 'Pendiente de acuerdo',
    variant: 'warning',
    block: 'border-violet-400 bg-violet-50 text-violet-900',
  },
  ACORDADO_GLPI: {
    label: 'Acordado en GLPI',
    variant: 'success',
    block: 'border-emerald-400 bg-emerald-50 text-emerald-900',
  },
  ACORDADO_MANUAL: {
    label: 'Acordado manualmente',
    variant: 'success',
    block: 'border-teal-400 bg-teal-50 text-teal-900',
  },
}

/**
 * La capa de compromisos: cuánto apremia la fecha que GLPI publica.
 *
 * **Es un eje aparte del de {@link STATES} y no lo reemplaza.** El color del tramo dice qué hizo el
 * plan —lo colocó, lo movió, espera un acuerdo—; esto dice cuánto queda hasta la entrega. Un tramo
 * azul puede vencer hoy, y por eso el riesgo no repinta el bloque: le cambia el icono de entrega y
 * tiñe el chip del ticket que no tiene horas.
 *
 * `FUTURA` no está aquí porque no tiene marca: lo que no corre riesgo no se resalta, y una leyenda
 * que anunciara «todavía no vence» pintaría de excepción lo que es la norma.
 *
 * Los iconos no son decoración: sobreviven al daltonismo y a una captura en blanco y negro, que es
 * lo único que el color no hace.
 */
export const RISK = {
  VENCIDA: {
    label: 'Entrega vencida',
    icon: AlertTriangle,
    chip: 'border-red-500 bg-red-50 text-red-900',
    flag: 'text-red-600',
    swatch: 'border-red-500 bg-red-50',
  },
  HOY: {
    label: 'Entrega hoy',
    icon: Clock,
    chip: 'border-orange-500 bg-orange-50 text-orange-900',
    flag: 'text-orange-600',
    swatch: 'border-orange-500 bg-orange-50',
  },
  PROXIMA: {
    label: 'Entrega próxima',
    icon: CalendarClock,
    chip: 'border-amber-500 bg-amber-50 text-amber-900',
    flag: 'text-amber-600',
    swatch: 'border-amber-500 bg-amber-50',
  },
} as const satisfies Record<
  Exclude<CommitmentRisk, 'FUTURA'>,
  { label: string; icon: typeof Flag; chip: string; flag: string; swatch: string }
>

/** El orden de la leyenda de riesgo: primero lo que ya se incumplió. */
export const RISK_ORDER = ['VENCIDA', 'HOY', 'PROXIMA'] as const

/**
 * El orden en que se leen los estados: primero lo que falta, después lo que el plan decidió y al
 * final los acuerdos. Es el orden de la leyenda y el del recorrido de un gestor.
 */
export const STATE_ORDER: readonly TimelineState[] = [
  'SIN_ESTIMACION',
  'PLANIFICADO',
  'DESPLAZADO',
  'PENDIENTE_DE_ACUERDO',
  'ACORDADO_GLPI',
  'ACORDADO_MANUAL',
]
