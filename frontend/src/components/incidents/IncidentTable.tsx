import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DECLARATION_VARIANTS } from '@/lib/declarations'
import { formatInstant } from '@/lib/format'
import { PENDING, declarationSideOf } from '@/lib/incidents'
import { formatHours } from '@/lib/timeline'
import type { IncidentRow } from '@/lib/incidents'
import type { PlanningMetadata } from '@/types/declarations'

/** Lo que hay que enseñar cuando GLPI no pudo dar el dato. Un hueco declarado, no un cero. */
const MISSING = '—'

/** Lo declarado hoy, en una linea: las horas y el compromiso, con lo que falte en su sitio. */
function declarationSummary(declaration: PlanningMetadata): string {
  const hours =
    declaration.estimatedHours === null
      ? 'sin estimación'
      : `${formatHours(declaration.estimatedHours)} h`
  const date = declaration.committedDate ?? 'sin compromiso'

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
export function IncidentTable({ rows, declarationHref }: IncidentTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[78rem] text-sm">
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
              Estado de declaración
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
                <Badge variant={DECLARATION_VARIANTS[row.item.declarationStatus]}>
                  {row.item.declarationStatus}
                </Badge>

                {row.item.declaration && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {declarationSummary(row.item.declaration)}
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

              {/* El atajo, solo donde hay algo que declarar. El nombre accesible lleva el ticket y la
                  persona porque un ticket compartido produce dos enlaces con el mismo texto y destinos
                  distintos: sin él, la pantalla tendría dos enlaces indistinguibles. */}
              <td className="py-3" data-slot="incident-action">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
