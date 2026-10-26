import { Link } from 'react-router-dom'

import { DisplacementCause } from '@/components/timeline/DisplacementCause'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AGREEMENT_ORIGIN_BADGE,
  STATUS_VARIANTS,
  agreementOrigin,
} from '@/lib/renegotiations'
import { formatInstant } from '@/lib/format'
import { formatDay } from '@/lib/timeline'
import { NO_FILTERS } from '@/lib/incidents'
import { calendarPath, incidentsPath, ticketTimelinePath } from '@/routes/navigation'
import type { RenegotiationItem } from '@/types/renegotiations'

/** Lo que se pinta donde el backend no publico nada. No es un cero: es la ausencia. */
const MISSING = '—'

interface RenegotiationTableProps {
  items: readonly RenegotiationItem[]
  selected: string | null
  /**
   * Abre el acuerdo. Lleva el botón que se pulsó —no `document.activeElement`— porque es a ese
   * botón, y no a donde estuviera el foco, a donde hay que devolverlo al cerrar el modal.
   */
  onSelect: (workItemId: string, opener: HTMLElement) => void
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
              Desplazamiento
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
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Por qué se acordó
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
                data-agreed-reason={agreement?.agreedReason ?? ''}
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
                  {/*
                    Las dos salidas contextuales, con las rutas que ya existen: el Timeline filtrado
                    por la persona y con el tramo del ticket abierto, y Tickets filtrado por ella. No
                    hay pantalla nueva ni una vista de detalle que mantener: son las mismas que el
                    menu ya publica, con el contexto puesto.
                  */}
                  <p className="mt-1 flex items-center gap-3 text-xs">
                    <Link
                      data-slot="ticket-timeline-link"
                      to={ticketTimelinePath(item.developerId, item.workItemId)}
                      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Ver en el Timeline
                    </Link>
                    <Link
                      data-slot="ticket-incidents-link"
                      to={incidentsPath({ ...NO_FILTERS, person: item.developerId }, 'operativo')}
                      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Ver en Tickets
                    </Link>
                  </p>
                </td>

                <td className="py-3 pr-4">
                  <Badge variant={STATUS_VARIANTS[item.status]}>{item.status}</Badge>
                  {/*
                    El origen del acuerdo, debajo del estado y no en una columna nueva: el estado
                    dice si hay que renegociar y el origen dice quien lo trajo. Son dos preguntas
                    distintas sobre la misma fila.
                  */}
                  {agreement && (
                    <div className="mt-1">
                      <Badge
                        variant={agreementOrigin(agreement.source) === 'GLPI' ? 'info' : 'secondary'}
                        data-slot="agreement-origin"
                        data-source={agreement.source}
                      >
                        {AGREEMENT_ORIGIN_BADGE[agreementOrigin(agreement.source)]}
                      </Badge>
                    </div>
                  )}
                </td>

                {/*
                  Los desplazamientos, uno por linea y en el orden en que los publica el backend, con
                  su causa entera: incidente, regla, fechas y motivo. Es el mismo bloque que enseña el
                  detalle del Timeline, importado de un solo sitio, para que las dos pantallas no
                  expliquen el mismo movimiento con palabras distintas. Un elemento puede traer varios
                  y se pintan todos: resumirlos escondería el segundo.
                */}
                <td className="py-3 pr-4">
                  <ul className="space-y-2">
                    {item.events.map((event) => (
                      <li
                        key={`${event.timestamp}-${event.incidentId}-${event.originalDate}`}
                        data-slot="renegotiation-event"
                        // La pareja de fechas auditada, sin formatear, para poder afirmarla.
                        data-original={event.originalDate}
                        data-rescheduled={event.rescheduledDate}
                      >
                        {/* La misma causa, con las mismas etiquetas, que el detalle del Timeline. */}
                        <DisplacementCause
                          originalDate={event.originalDate}
                          newDate={event.rescheduledDate}
                          appliedRule={event.appliedRule}
                          incidentId={event.incidentId}
                          severity={event.severity}
                          reason={event.reason}
                        />
                      </li>
                    ))}
                  </ul>
                </td>

                <td className="py-3 pr-4 tabular-nums">
                  {agreement ? (
                    <>
                      {formatDay(agreement.agreedDate)}
                      {/*
                        En un acuerdo conciliado, esta fecha ES el TTR del ticket: el sistema la
                        copio de GLPI, no la tecleo nadie. Decirlo evita que parezca un dato que la
                        pantalla invento.
                      */}
                      {agreementOrigin(agreement.source) === 'GLPI' && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          <span data-slot="ttr-detected">TTR detectado</span>
                          {' · '}
                          <span>Conciliado automáticamente</span>
                        </span>
                      )}
                    </>
                  ) : (
                    MISSING
                  )}
                </td>

                <td className="py-3 pr-4">{agreement ? agreement.agreedBy : MISSING}</td>

                <td className="py-3 pr-4 text-xs text-muted-foreground">
                  {agreement ? (
                    <time dateTime={agreement.agreedAt}>{formatInstant(agreement.agreedAt)}</time>
                  ) : (
                    MISSING
                  )}
                </td>

                {/*
                  El motivo del acuerdo, y no el del desplazamiento: el de arriba —dentro del evento—
                  explica por que el motor movio el requerimiento, y este explica por que la persona
                  llego a esa fecha. Es el unico campo de la fila que ningun dato puede deducir, y por
                  eso la fila contesta las siete preguntas sin abrir nada.
                */}
                <td className="py-3 pr-4 text-xs">
                  {agreement?.agreedReason ?? MISSING}
                </td>

                <td className="py-3">
                  {/* La etiqueta dice lo que el boton va a hacer —crear o reemplazar—, y eso lo dice
                      la existencia del acuerdo, no el estado de la fila. */}
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={isSelected}
                    onClick={(event) => onSelect(item.workItemId, event.currentTarget)}
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
