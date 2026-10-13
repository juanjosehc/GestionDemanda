import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DECLARATION_VARIANTS } from '@/lib/declarations'
import { formatInstant } from '@/lib/format'
import { formatHours } from '@/lib/timeline'
import type { DeclarationItem, PlanningMetadata } from '@/types/declarations'

/** Lo que hay que enseñar cuando GLPI no pudo dar el dato. Un hueco declarado, no un cero. */
const MISSING = '—'

/** Lo declarado hoy, en una linea: las horas y el compromiso, con lo que falte en su sitio. */
function declarationSummary(declaration: PlanningMetadata): string {
  const hours =
    declaration.estimatedHours === null ? 'sin estimación' : `${formatHours(declaration.estimatedHours)} h`
  const date = declaration.committedDate ?? 'sin compromiso'

  return `${hours} · ${date}`
}

interface DeclarationTableProps {
  items: readonly DeclarationItem[]
  /** El ticket cuyo formulario esta abierto, para marcar su fila. */
  selected: string | null
  onSelect: (workItemId: string) => void
}

/**
 * La tabla de trabajo del tecnico: un ticket por fila, con lo que le falta para planificarse.
 *
 * **No clasifica nada.** La columna de estado de declaración pinta el `declarationStatus` que llego y
 * los `discards[]` con su código y su motivo, tal cual. La tabla no mira `estimatedHours` ni
 * `committedDate` para deducir un estado: si lo hiciera, existirían dos versiones de la misma regla y
 * la de la pantalla se desviaría de la del plan sin que nadie se enterara.
 *
 * La acción la decide la **existencia de la fila** y no el estado: un ticket con los dos valores
 * retirados se clasifica `SIN_DECLARACION` pero ya tiene fila, y lo que le corresponde es reemplazarla
 * —no volver a crearla, que respondería `409`—.
 */
export function DeclarationTable({ items, selected, onSelect }: DeclarationTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Tipo
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              ID
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Título
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Estado
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Prioridad
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Fecha de creación
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
          {items.map((item) => {
            const hasDeclaration = item.declaration !== null

            return (
              <tr
                key={item.workItemId}
                data-slot="declaration-row"
                data-work-item={item.workItemId}
                data-status={item.declarationStatus}
                data-declared={hasDeclaration ? 'true' : 'false'}
                data-selected={selected === item.workItemId ? 'true' : 'false'}
                className="border-b border-border/60 align-top last:border-0"
              >
                {/* El tipo y el estado del dominio llegan nulos cuando el ticket no se pudo
                    traducir: se enseña el hueco en vez de rellenarlo con algo parecido. */}
                <td className="py-3 pr-4 font-mono text-xs">{item.type ?? MISSING}</td>

                <td className="py-3 pr-4 font-mono text-xs">{item.workItemId}</td>

                <td className="max-w-md py-3 pr-4" title={item.title}>
                  {item.title}
                </td>

                <td className="py-3 pr-4 font-mono text-xs">{item.status ?? MISSING}</td>

                {/* La prioridad cruda de GLPI, en su escala 1..5. No se traduce a una severidad: esa
                    normalización es del motor y todavía no ha ocurrido. */}
                <td className="py-3 pr-4 text-right tabular-nums">
                  {item.priority ?? MISSING}
                </td>

                <td className="py-3 pr-4 text-xs text-muted-foreground">
                  {item.createdAt ? (
                    <time dateTime={item.createdAt}>{formatInstant(item.createdAt)}</time>
                  ) : (
                    MISSING
                  )}
                </td>

                <td className="py-3 pr-4">
                  <Badge variant={DECLARATION_VARIANTS[item.declarationStatus]}>
                    {item.declarationStatus}
                  </Badge>

                  {item.declaration && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {declarationSummary(item.declaration)}
                    </p>
                  )}

                  {/* La trazabilidad: el código es la regla que se aplicó, y el motivo la nombra en
                      palabras. Los dos vienen del backend y se pintan sin reescribirlos. */}
                  {item.discards.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {item.discards.map((discard) => (
                        <li key={discard.code} className="text-xs text-muted-foreground">
                          <span className="font-mono">{discard.code}</span> ·{' '}
                          <span>{discard.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>

                <td className="py-3">
                  <Button
                    variant={selected === item.workItemId ? 'secondary' : 'outline'}
                    size="sm"
                    aria-expanded={selected === item.workItemId}
                    onClick={() => onSelect(item.workItemId)}
                  >
                    {hasDeclaration ? 'Editar' : 'Declarar'}
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
