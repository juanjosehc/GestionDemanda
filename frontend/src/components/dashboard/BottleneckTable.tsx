import { Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { remainingState } from '@/lib/capacity'
import { formatHours } from '@/lib/timeline'
import { calendarPath } from '@/routes/navigation'
import type { DeveloperPlanningMetrics } from '@/types/planningMetrics'

interface BottleneckTableProps {
  byDeveloper: readonly DeveloperPlanningMetrics[]
}

/**
 * Cuellos de botella: el plan vigente de cada desarrollador, tal como llega.
 *
 * Resalta dos cosas y solo dos —capacidad restante agotada o negativa, y requerimientos
 * desplazados— porque son las que el backend ya distingue. La vista no anade umbrales: `0` y `< 0`
 * son las dos condiciones del backend, no un criterio propio.
 *
 * El valor nunca se sustituye por una etiqueta: el numero que se ve es el que se recibio, y el
 * color es lo unico que cambia. Los atributos `data-*` de la fila llevan la condicion, para que se
 * pueda comprobar sin leer clases.
 */
export function BottleneckTable({ byDeveloper }: BottleneckTableProps) {
  if (byDeveloper.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Ningún desarrollador tiene un plan vigente"
        detail="La capacidad se cuenta sobre planes ya guardados y todavía no hay ninguno."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Desarrollador
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Disponible
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Ocupada
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Restante
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Desplazados
            </th>
            <th scope="col" className="py-2 text-left font-medium">
              Plan
            </th>
          </tr>
        </thead>

        <tbody>
          {byDeveloper.map((developer) => {
            const remaining = remainingState(developer.capacity.remainingHours)
            const displaced = developer.displacedRequirements > 0
            // Agotado advierte; negativo senala un plan que contradice su propio contexto.
            const remainingTone =
              remaining === 'over' ? 'danger' : remaining === 'full' ? 'warning' : undefined

            return (
              <tr
                key={developer.developerId}
                data-slot="developer-row"
                data-remaining={remaining}
                data-displaced={displaced ? 'true' : 'false'}
                className="border-b border-border/60 last:border-0"
              >
                <td className="py-2 pr-4 font-medium">{developer.developerId}</td>

                <td className="py-2 pr-4 text-right tabular-nums">
                  {formatHours(developer.capacity.availableHours)}
                </td>

                <td className="py-2 pr-4 text-right tabular-nums">
                  {formatHours(developer.capacity.occupiedHours)}
                </td>

                <td className="py-2 pr-4 text-right">
                  {remainingTone ? (
                    <Badge variant={remainingTone}>
                      {formatHours(developer.capacity.remainingHours)}
                    </Badge>
                  ) : (
                    <span className="tabular-nums">
                      {formatHours(developer.capacity.remainingHours)}
                    </span>
                  )}
                </td>

                <td className="py-2 pr-4 text-right">
                  {displaced ? (
                    <Badge variant="warning">{developer.displacedRequirements}</Badge>
                  ) : (
                    <span className="tabular-nums">{developer.displacedRequirements}</span>
                  )}
                </td>

                <td className="py-2 font-mono text-xs">
                  {/*
                    El plan deja de ser texto y pasa a ser enlace: es el detalle del desarrollador con
                    la capacidad agotada, y ya existe. Sin esto, la cuarta pregunta del brief —quien no
                    tiene capacidad— se responde en el tablero pero no se puede abrir.
                  */}
                  <Link to={calendarPath(developer.planId)} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    {developer.planId}
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
