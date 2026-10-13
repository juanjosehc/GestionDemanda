import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { remainingState, sortDevelopers } from '@/lib/capacity'
import type { SortDirection, TeamSortKey } from '@/lib/capacity'
import { formatHours } from '@/lib/timeline'
import { formatInstant } from '@/lib/format'
import { calendarPath, metricPath } from '@/routes/navigation'
import { DISPLACED_TOKEN } from '@/types/planningMetrics'
import type { DeveloperPlanningMetrics } from '@/types/planningMetrics'

/** Columnas ordenables, en el orden en que se pintan. */
const COLUMNS: readonly { key: TeamSortKey; label: string; numeric: boolean }[] = [
  { key: 'developerId', label: 'Desarrollador', numeric: false },
  { key: 'availableHours', label: 'Disponible', numeric: true },
  { key: 'occupiedHours', label: 'Ocupada', numeric: true },
  { key: 'remainingHours', label: 'Restante', numeric: true },
  { key: 'displacedRequirements', label: 'Desplazados', numeric: true },
]

/** La ventana que cubre el plan, o el motivo por el que no hay ninguna. */
function windowOf(developer: DeveloperPlanningMetrics): string {
  if (!developer.from || !developer.to) {
    return 'Sin agenda: el plan no tiene tramos'
  }

  return `${developer.from} → ${developer.to} · calculado el ${formatInstant(developer.calculatedAt)}`
}

interface TeamTableProps {
  /** El plan vigente de cada desarrollador, tal como lo publica la fotografía. */
  byDeveloper: readonly DeveloperPlanningMetrics[]
}

/**
 * La tabla operativa del equipo: un plan vigente por fila.
 *
 * Cada fila **es** un plan, no una suma de planes: la consolidación no fusiona nada. Los números que
 * se ven son los que el backend publicó para ese plan —disponible, ocupada, restante y
 * desplazamientos—, y el color es lo único que la vista decide: los dos casos que el backend ya
 * distingue, restante agotado y restante negativo.
 *
 * Ordenar es una acción del usuario. El orden de partida es el que entregó el backend —por
 * desarrollador, con la vigencia ya resuelta—, y la tabla no re-agrupa ni recalcula: mueve filas.
 *
 * Recibe una lista no vacía: el estado vacío lo decide la página, que es quien sabe si además hay
 * alertas que enseñar.
 */
export function TeamTable({ byDeveloper }: TeamTableProps) {
  const [sort, setSort] = useState<{ key: TeamSortKey; direction: SortDirection } | null>(null)

  const rows = sort ? sortDevelopers(byDeveloper, sort.key, sort.direction) : byDeveloper

  /** Un clic ordena por esa columna; el siguiente la invierte. Cambiar de columna empieza ascendente. */
  function toggle(key: TeamSortKey) {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[58rem] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {COLUMNS.map((column) => {
              const active = sort?.key === column.key
              const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={!active ? 'none' : sort.direction === 'asc' ? 'ascending' : 'descending'}
                  className={`py-2 pr-4 font-medium ${column.numeric ? 'text-right' : 'text-left'}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(column.key)}
                    className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {column.label}
                    <Icon className="size-3" aria-hidden="true" />
                  </button>
                </th>
              )
            })}

            <th scope="col" className="py-2 text-left font-medium">
              Plan vigente
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((developer) => {
            const remaining = remainingState(developer.capacity.remainingHours)
            const displaced = developer.displacedRequirements > 0
            // Agotado advierte; negativo señala un plan que contradice su propio contexto.
            const remainingTone =
              remaining === 'over' ? 'danger' : remaining === 'full' ? 'warning' : undefined

            return (
              <tr
                key={developer.developerId}
                data-slot="team-row"
                data-developer={developer.developerId}
                data-remaining={remaining}
                data-displaced={displaced ? 'true' : 'false'}
                className="border-b border-border/60 align-top last:border-0"
              >
                <td className="py-3 pr-4 font-medium">{developer.developerId}</td>

                <td className="py-3 pr-4 text-right tabular-nums">
                  {formatHours(developer.capacity.availableHours)}
                </td>

                <td className="py-3 pr-4 text-right tabular-nums">
                  {formatHours(developer.capacity.occupiedHours)}
                </td>

                <td className="py-3 pr-4 text-right">
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

                <td className="py-3 pr-4 text-right">
                  {displaced ? (
                    <Badge variant="warning">{developer.displacedRequirements}</Badge>
                  ) : (
                    <span className="tabular-nums">{developer.displacedRequirements}</span>
                  )}

                  {/*
                    Los desplazamientos de este desarrollador se pueden abrir: su listado ya existe y
                    es el mismo que el de la tarjeta del tablero. La ruta se construye con el token,
                    no con un literal.
                  */}
                  {displaced && (
                    <Link
                      to={metricPath(DISPLACED_TOKEN)}
                      className="mt-1 block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Ver el desglose
                    </Link>
                  )}
                </td>

                <td className="py-3 pr-4">
                  {/*
                    El plan vigente y su timeline son el mismo recurso: la agenda de un plan ya existe
                    y se abre por su identificador. No hay una segunda pantalla que inventar.
                  */}
                  <Link
                    to={calendarPath(developer.planId)}
                    className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {developer.planId}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">{windowOf(developer)}</p>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
