import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { STATUS_VARIANTS } from '@/lib/renegotiations'
import { formatInstant } from '@/lib/format'
import { formatDay } from '@/lib/timeline'
import { calendarPath } from '@/routes/navigation'
import type { RenegotiationItem } from '@/types/renegotiations'

/** Lo que se pinta donde el backend no publico nada. No es un cero: es la ausencia. */
const MISSING = '—'

/** Severidad del incidente que provoco el movimiento. Los tres valores los fija el backend. */
const SEVERITY = {
  ALTO: 'danger',
  MEDIO: 'warning',
  BAJO: 'secondary',
} as const

interface RenegotiationTableProps {
  items: readonly RenegotiationItem[]
  selected: string | null
  onSelect: (workItemId: string) => void
}

/**
 * Los requerimientos desplazados con su trazabilidad, tal como los publica la lectura consolidada.
 *
 * **La fila es el requerimiento y no el tramo**: uno que se movio dos veces por dos incidentes
 * distintos aparece una vez, con los dos desplazamientos dentro. Es la misma cuenta que hace la
 * tarjeta de desplazamientos del tablero, y por eso las dos cifras no pueden discrepar.
 *
 * Lo que esta tabla **no** hace: no deduce el estado —pinta el que llego—, no decide si un acuerdo
 * cubre un desplazamiento —eso lo decidio el backend al calcular `status`—, no compara fechas entre
 * si y no reconstruye el motivo de ningun movimiento. Cada celda es un campo del contrato.
 *
 * La accion de la fila se decide por **la existencia del acuerdo** (`renegotiation`), nunca por el
 * estado: un requerimiento que se movio despues de haberse acordado sigue en PENDIENTE_DE_ACUERDO
 * —hay que volver a acordar— pero ya tiene un acuerdo que reemplazar, y ofrecerle «Registrar» seria
 * mandar un `POST` contra un recurso que existe.
 */
export function RenegotiationTable({ items, selected, onSelect }: RenegotiationTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[72rem] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Requerimiento
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Estado
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Fecha desplazada
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Fecha acordada
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Acordó
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Registrado el
            </th>
            <th scope="col" className="py-2 text-left font-medium">
              Acuerdo
            </th>
          </tr>
        </thead>

        <tbody>
          {items.map((item) => {
            const agreement = item.renegotiation
            const isSelected = item.workItemId === selected

            return (
              <tr
                key={`${item.planId}-${item.workItemId}`}
                data-slot="renegotiation-row"
                data-work-item={item.workItemId}
                // El estado que publico el backend, sin traducir: es la costura de la prueba que
                // comprueba que la vista no lo recalcula.
                data-status={item.status}
                data-agreed={agreement ? 'true' : 'false'}
                // La fecha acordada tal como llega, sin formatear: es lo que permite afirmar que la
                // vista enseña la del contrato y no una que haya derivado por su cuenta.
                data-agreed-date={agreement?.agreedDate ?? ''}
                data-agreed-by={agreement?.agreedBy ?? ''}
                data-selected={isSelected ? 'true' : 'false'}
                className="border-b border-border/60 align-top last:border-0"
              >
                <td className="py-3 pr-4">
                  <p className="font-mono text-sm font-medium">{item.workItemId}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.developerId} ·{' '}
                    <Link
                      to={calendarPath(item.planId)}
                      className="font-mono underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {item.planId}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    calculado el{' '}
                    <time dateTime={item.calculatedAt}>{formatInstant(item.calculatedAt)}</time>
                  </p>
                </td>

                <td className="py-3 pr-4">
                  <Badge variant={STATUS_VARIANTS[item.status]}>{item.status}</Badge>
                </td>

                {/*
                  Los desplazamientos, uno por linea y en el orden en que los publica el backend. La
                  pareja «de que fecha a que fecha» es la que el plan audito: no se recalcula ni se
                  resume en una sola fecha, porque un elemento puede traer varios y resumirlos
                  escondería el segundo.
                */}
                <td className="py-3 pr-4">
                  <ul className="space-y-1">
                    {item.events.map((event) => (
                      <li
                        key={`${event.timestamp}-${event.incidentId}-${event.originalDate}`}
                        data-slot="renegotiation-event"
                        // La pareja de fechas auditada, sin formatear, para poder afirmarla.
                        data-original={event.originalDate}
                        data-rescheduled={event.rescheduledDate}
                        className="flex flex-wrap items-center gap-2 text-xs"
                      >
                        <Badge variant={SEVERITY[event.severity]}>{event.severity}</Badge>
                        <span className="tabular-nums">
                          {formatDay(event.originalDate)} → {formatDay(event.rescheduledDate)}
                        </span>
                        <span className="font-mono text-muted-foreground">{event.incidentId}</span>
                      </li>
                    ))}
                  </ul>
                </td>

                <td className="py-3 pr-4 tabular-nums">
                  {agreement ? formatDay(agreement.agreedDate) : MISSING}
                </td>

                <td className="py-3 pr-4">{agreement ? agreement.agreedBy : MISSING}</td>

                <td className="py-3 pr-4 text-xs text-muted-foreground">
                  {agreement ? (
                    <time dateTime={agreement.agreedAt}>{formatInstant(agreement.agreedAt)}</time>
                  ) : (
                    MISSING
                  )}
                </td>

                <td className="py-3">
                  {/* La etiqueta dice lo que el boton va a hacer —crear o reemplazar—, y eso lo dice
                      la existencia del acuerdo, no el estado de la fila. */}
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={isSelected}
                    onClick={() => onSelect(item.workItemId)}
                  >
                    {agreement ? 'Editar acuerdo' : 'Registrar acuerdo'}
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
