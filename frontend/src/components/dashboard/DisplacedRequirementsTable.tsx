import { CalendarRange } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { SEVERITY_VARIANTS } from '@/lib/severity'
import { formatDay } from '@/lib/timeline'
import { calendarPath } from '@/routes/navigation'
import type { DisplacedRequirement } from '@/types/planningMetrics'

const INSTANT_FORMAT = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

interface DisplacedRequirementsTableProps {
  items: readonly DisplacedRequirement[]
}

/**
 * Los requerimientos desplazados que suma la tarjeta, con el motivo de cada movimiento.
 *
 * La fila es el elemento y no el tramo: uno que se movio dos veces por dos incidentes distintos
 * aparece una vez con los dos eventos dentro. Es la misma cuenta que hace la tarjeta —elementos— y
 * por eso las dos cifras no pueden discrepar.
 *
 * El motivo no se reconstruye aqui: `reason` y `appliedRule` llegan escritos por el backend desde la
 * auditoria del plan, y esta tabla solo los pinta. La fecha original y la nueva tampoco se comparan
 * ni se restan para decidir nada.
 */
export function DisplacedRequirementsTable({ items }: DisplacedRequirementsTableProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Ningún requerimiento quedó desplazado"
        detail="Los planes vigentes no movieron ningún elemento de su fecha original, así que la tarjeta marca cero."
      />
    )
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div
          key={`${item.planId}-${item.workItemId}`}
          data-slot="displaced-row"
          data-events={item.events.length}
          className="rounded-lg border border-border p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-mono text-sm font-medium">{item.workItemId}</p>

            <p className="text-xs text-muted-foreground">
              {item.developerId} ·{' '}
              <Link
                to={calendarPath(item.planId)}
                className="font-mono underline-offset-4 hover:text-foreground hover:underline"
              >
                {item.planId}
              </Link>{' '}
              · calculado el{' '}
              <time dateTime={item.calculatedAt}>{INSTANT_FORMAT.format(new Date(item.calculatedAt))}</time>
            </p>
          </div>

          <ul className="mt-3 space-y-2">
            {item.events.map((event) => (
              <li
                key={`${event.timestamp}-${event.incidentId}-${event.originalDate}`}
                data-slot="reschedule-event"
                className="border-l-2 border-amber-400 pl-3 text-xs"
              >
                <p className="flex flex-wrap items-center gap-2">
                  <Badge variant={SEVERITY_VARIANTS[event.severity]}>{event.severity}</Badge>

                  <span className="tabular-nums">
                    {formatDay(event.originalDate)} → {formatDay(event.rescheduledDate)}
                  </span>

                  <span className="font-mono text-muted-foreground">{event.incidentId}</span>

                  <span className="font-mono text-muted-foreground">{event.appliedRule}</span>
                </p>

                {/* El motivo lo redacta el backend desde la regla aplicada; aqui no se re-deriva. */}
                <p className="mt-0.5">{event.reason}</p>

                <p className="mt-0.5 text-muted-foreground">
                  Auditado el{' '}
                  <time dateTime={event.timestamp}>
                    {INSTANT_FORMAT.format(new Date(event.timestamp))}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
