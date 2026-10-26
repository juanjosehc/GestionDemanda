import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DECLARATION_LABEL, DECLARATION_VARIANTS } from '@/lib/declarations'
import { formatInstant } from '@/lib/format'
import { PENDING, PENDING_AGREEMENT, declarationSideOf } from '@/lib/incidents'
import { STATUS_VARIANTS } from '@/lib/renegotiations'
import { formatHours } from '@/lib/timeline'
import type { BadgeVariant } from '@/components/ui/badge'
import type { IncidentRow } from '@/lib/incidents'
import type { DeclarationItem } from '@/types/declarations'
import type { RenegotiationStatus } from '@/types/renegotiations'
import type { TimelineItemStatus } from '@/types/timeline'

/** Lo que hay que enseñar cuando GLPI no pudo dar el dato. Un hueco declarado, no un cero. */
const MISSING = '—'

/**
 * El estado del tramo, en palabras y con su color.
 *
 * **`PLANIFICADO` va en informativo y no en éxito**: estar colocado no significa que no falte nada
 * —un ticket puede estar en el plan y aun así esperar un acuerdo—, y el verde queda reservado para
 * «nada pendiente», que es lo que dice el estado de declaración. `DESPLAZADO` advierte porque el plan
 * lo movió de fecha. La ausencia de tramo no es un estado del tramo: se pinta «Sin plan» en neutro.
 */
const PLAN_VARIANTS: Record<TimelineItemStatus, BadgeVariant> = {
  PLANIFICADO: 'info',
  DESPLAZADO: 'warning',
}

const PLAN_LABEL: Record<TimelineItemStatus, string> = {
  PLANIFICADO: 'Planificado',
  DESPLAZADO: 'Desplazado',
}

/** El estado del acuerdo, en las palabras de la pantalla. Los valores son los del backend. */
const AGREEMENT_LABEL: Record<RenegotiationStatus, string> = {
  PENDIENTE_DE_ACUERDO: 'Pendiente de acuerdo',
  ACORDADA: 'Acordado',
}

/** Un distintivo del plan, o el hueco cuando la lectura todavía no llegó. */
function PlanBadge({ status }: { status: TimelineItemStatus | null | undefined }) {
  if (status === undefined) {
    return <>{MISSING}</>
  }

  if (status === null) {
    return <Badge variant="secondary">Sin plan</Badge>
  }

  return <Badge variant={PLAN_VARIANTS[status]}>{PLAN_LABEL[status]}</Badge>
}

/** Un distintivo del acuerdo, o el hueco cuando no hay acuerdo registrado o no se pudo leer. */
function AgreementBadge({ status }: { status: RenegotiationStatus | null | undefined }) {
  if (status === undefined || status === null) {
    return <>{MISSING}</>
  }

  return <Badge variant={STATUS_VARIANTS[status]}>{AGREEMENT_LABEL[status]}</Badge>
}

/** Lo que ubica al ticket, en una linea: las horas declaradas y la fecha de GLPI. */
function declarationSummary(item: DeclarationItem): string {
  const hours =
    item.declaration?.estimatedHours == null
      ? 'sin estimación'
      : `${formatHours(item.declaration.estimatedHours)} h`
  const date = item.operationalDate ?? 'sin fecha en GLPI'

  return `${hours} · ${date}`
}

interface IncidentTableProps {
  rows: readonly IncidentRow[]
  /**
   * La dirección que abre la declaración de una fila, con su ticket y su vuelta.
   *
   * La tabla **no la compone**: no sabe nada de filtros, de modos ni de rutas, y construirla aquí
   * obligaría a pasarle el estado de la pantalla entera. Quien la sabe —Incidentes— la entrega hecha.
   */
  declarationHref: (row: IncidentRow) => string
  /** La agenda del equipo con esta persona —y este ticket— ya filtrados. */
  timelineHref: (row: IncidentRow) => string
  /** La renegociación de este ticket, con su fila ya seleccionada. */
  renegotiationHref: (row: IncidentRow) => string
}

/**
 * El trabajo activo del equipo: un ticket por fila, con la persona a la que GLPI se lo tiene asignado.
 *
 * **No clasifica nada.** El tipo, el estado y la prioridad son los del backend, y la columna de
 * declaración pinta el `declarationStatus` que llegó y sus `discards[]` con el código y el motivo tal
 * cual. La tabla no mira `estimatedHours` ni `committedDate` para deducir un estado: si lo hiciera
 * existirían dos versiones de la misma regla, y la de la pantalla se desviaría de la del plan sin que
 * nadie se enterara.
 *
 * **Solo las filas pendientes llevan atajo, y el lado lo dice `declarationSideOf`** —el mismo
 * predicado que el filtro—, no una comparación escrita aquí. Una fila ya declarada deja la celda
 * vacía: se sigue editando desde la declaración, como antes.
 *
 * Es hermana de `DeclarationTable` y no una variante suya: allí las props son la maquinaria de
 * selección y edición que esta pantalla no tiene, y allí una fila se identifica solo por el ticket
 * —aquí un ticket compartido por dos personas necesita además el nombre de quién lo tiene, o las dos
 * filas colisionarían—.
 */
export function IncidentTable({
  rows,
  declarationHref,
  timelineHref,
  renegotiationHref,
}: IncidentTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[88rem] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Tipo
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              ID GLPI
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Título
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Estado
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Persona asignada
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Prioridad
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Fecha publicada por GLPI
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Declaración
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Plan
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Acuerdo
            </th>
            <th scope="col" className="py-2 text-left font-medium">
              Acciones
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.developerId}-${row.item.workItemId}`}
              data-slot="incident-row"
              data-work-item={row.item.workItemId}
              data-developer={row.developerId}
              data-type={row.item.type ?? ''}
              data-status={row.item.status ?? ''}
              data-declaration={row.item.declarationStatus}
              data-plan={row.facts.planStatus ?? ''}
              data-agreement={row.facts.agreement ?? ''}
              className="border-b border-border/60 align-top last:border-0"
            >
              {/* El tipo y el estado del dominio llegan nulos cuando el ticket no se pudo
                  traducir: se enseña el hueco en vez de rellenarlo con algo parecido. */}
              <td className="py-3 pr-4 font-mono text-xs">{row.item.type ?? MISSING}</td>

              <td className="py-3 pr-4 font-mono text-xs">{row.item.workItemId}</td>

              <td className="max-w-md py-3 pr-4" title={row.item.title}>
                {row.item.title}
              </td>

              <td className="py-3 pr-4 font-mono text-xs">{row.item.status ?? MISSING}</td>

              {/* De quién es el ticket no se deduce de la fila: viene de la respuesta de esa
                  persona. Es la columna que contesta «¿qué tiene Abraham?» sin salir de aquí. */}
              <td className="py-3 pr-4" data-slot="incident-person">
                {row.personName}
              </td>

              {/* La prioridad cruda de GLPI, en su escala 1..5. No se traduce a una severidad: esa
                  normalización es del motor y todavía no ha ocurrido. */}
              <td className="py-3 pr-4 text-right tabular-nums">{row.item.priority ?? MISSING}</td>

              <td className="py-3 pr-4 text-xs text-muted-foreground">
                {row.item.createdAt ? (
                  <time dateTime={row.item.createdAt}>{formatInstant(row.item.createdAt)}</time>
                ) : (
                  MISSING
                )}
              </td>

              <td className="py-3 pr-4">
                {/* El estado se lee en palabras; el código del backend queda en el `title`, que es
                    lo que permite contrastarlo con la regla que lo produjo. */}
                <Badge
                  variant={DECLARATION_VARIANTS[row.item.declarationStatus]}
                  title={row.item.declarationStatus}
                >
                  {DECLARATION_LABEL[row.item.declarationStatus]}
                </Badge>

                {/* La fecha la publica GLPI aunque nadie haya declarado horas, y es la que ubica
                    el ticket en el plan: se enseña igual, con la estimación que falte. */}
                {(row.item.declaration !== null || row.item.operationalDate !== null) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {declarationSummary(row.item)}
                  </p>
                )}

                {/* La trazabilidad: el código es la regla que se aplicó, y el motivo la nombra en
                    palabras. Los dos vienen del backend y se pintan sin reescribirlos. Es lo que
                    convierte «Pendiente» en «le falta la estimación». */}
                {row.item.discards.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {row.item.discards.map((discard) => (
                      <li key={discard.code} className="text-xs text-muted-foreground">
                        <span className="font-mono">{discard.code}</span> ·{' '}
                        <span>{discard.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </td>

              {/* Dónde está el ticket según el plan vigente. La ausencia de tramo es un hecho
                  —«Sin plan»—; el hueco es no haber podido leerlo. */}
              <td className="py-3 pr-4" data-slot="incident-plan">
                <PlanBadge status={row.facts.planStatus} />
              </td>

              {/* El acuerdo solo existe para lo que el plan desplazó; sin desplazamiento no hay
                  nada que acordar y la celda queda vacía en vez de inventar «Sin acuerdo». */}
              <td className="py-3 pr-4" data-slot="incident-agreement">
                <AgreementBadge status={row.facts.agreement} />
              </td>

              {/* Las tres salidas de la fila, cada una a su pantalla de siempre. El nombre
                  accesible lleva el ticket y la persona porque un ticket compartido produce dos
                  enlaces con el mismo texto y destinos distintos: sin él, la pantalla tendría dos
                  enlaces indistinguibles. */}
              <td className="whitespace-nowrap py-3" data-slot="incident-action">
                <div className="flex items-center gap-1.5">
                  {declarationSideOf(row.item) === PENDING && (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={declarationHref(row)}
                        aria-label={`Declarar el ticket ${row.item.workItemId} de ${row.personName}`}
                      >
                        Declarar
                      </Link>
                    </Button>
                  )}

                  <Button asChild variant="ghost" size="sm">
                    <Link
                      to={timelineHref(row)}
                      aria-label={`Ver el ticket ${row.item.workItemId} de ${row.personName} en el Timeline`}
                    >
                      Timeline
                    </Link>
                  </Button>

                  {row.facts.agreement === PENDING_AGREEMENT && (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={renegotiationHref(row)}
                        aria-label={`Renegociar el ticket ${row.item.workItemId} de ${row.personName}`}
                      >
                        Renegociar
                      </Link>
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
