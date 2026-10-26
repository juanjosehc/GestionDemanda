import { Badge } from '@/components/ui/badge'
import { SEVERITY_VARIANTS } from '@/lib/severity'
import { formatDay } from '@/lib/timeline'
import { cn } from '@/lib/utils'
import type { IncidentSeverity } from '@/types/timeline'

/**
 * La causa de un desplazamiento, con un solo juego de etiquetas para toda la aplicación.
 *
 * **Existe para que la explicación no se escriba dos veces.** El Timeline la enseñaba en el detalle
 * del tramo y la Renegociación la tenía repartida entre la tabla y el formulario, cada una con sus
 * etiquetas y sus campos. Un desplazamiento es un hecho auditado —fecha original, fecha nueva, regla,
 * incidente y motivo— y quien lo lee desde una pantalla o desde la otra tiene que leer exactamente lo
 * mismo. Por eso las dos importan este componente y ninguna compone el suyo.
 *
 * No calcula nada: los cinco valores llegan del contrato. La fecha se formatea y la severidad se
 * viste, que es todo lo que una vista puede hacer con un hecho que el motor ya decidió. `incidentId`
 * nulo es un desplazamiento por ocupación previa de la jornada y se dice con esas palabras, como en
 * el Timeline, en vez de dejar un hueco.
 */
export interface DisplacementCauseProps {
  originalDate: string
  newDate: string
  appliedRule: string
  incidentId: string | null
  severity: IncidentSeverity | null
  reason: string
  className?: string
}

export function DisplacementCause({
  originalDate,
  newDate,
  appliedRule,
  incidentId,
  severity,
  reason,
  className,
}: DisplacementCauseProps) {
  return (
    <dl
      data-slot="displacement-cause"
      className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs', className)}
    >
      <dt className="text-muted-foreground">Fecha original</dt>
      <dd className="tabular-nums">{formatDay(originalDate)}</dd>

      <dt className="text-muted-foreground">Fecha nueva</dt>
      <dd className="tabular-nums">{formatDay(newDate)}</dd>

      <dt className="text-muted-foreground">Regla aplicada</dt>
      <dd className="font-mono">{appliedRule}</dd>

      <dt className="text-muted-foreground">Incidente causante</dt>
      <dd className="flex flex-wrap items-center gap-2 font-mono">
        {incidentId ?? 'Ocupación previa de la jornada'}
        {severity && <Badge variant={SEVERITY_VARIANTS[severity]}>{severity}</Badge>}
      </dd>

      <dt className="text-muted-foreground">Motivo</dt>
      <dd>{reason}</dd>
    </dl>
  )
}
