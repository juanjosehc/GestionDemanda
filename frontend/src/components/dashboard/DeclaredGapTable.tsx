import { CheckCircle2, ClipboardList } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { PlanningMetadataItem } from '@/types/planningMetrics'

/** Instante UTC del contrato, mostrado en la hora del navegador. */
const INSTANT_FORMAT = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

function formatInstant(isoInstant: string): string {
  return INSTANT_FORMAT.format(new Date(isoInstant))
}

/** Un valor declarado, o el guion que dice que no lo hay. Nunca se sustituye por un cero. */
function valor(texto: string | null) {
  return texto ?? <span className="text-muted-foreground">—</span>
}

interface DeclaredGapTableProps {
  items: readonly PlanningMetadataItem[]
}

/**
 * Las filas declaradas que producen una tarjeta de carencia.
 *
 * Las columnas se rotulan por lo que son y no por lo que uno esperaria encontrar. `estimatedBy` y
 * `committedBy` son **quien declaro**, no quien va a ejecutar: la tabla de la planificacion
 * declarada no guarda el desarrollador asignado, y nombrarlo exigiria consultar GLPI. Poner
 * «Desarrollador» encima de esos valores seria afirmar algo que el dato no dice.
 *
 * Los dos valores nulos no se esconden: una fila retirada los tiene los dos y se ve asi, con su
 * guion, en vez de con un cero que afirmaria una estimacion de cero horas.
 *
 * **La fecha de la columna es historia.** Desde la Fase 77 no se declara —el compromiso es el
 * Internal TTR que publica GLPI—, pero las filas anteriores conservan la que alguien escribio y
 * borrarla seria perder el rastro. El rotulo lo dice: «Compromiso declarado», con la fecha en que se
 * registro, y no «Fecha compromiso», que hoy solo puede ser una.
 */
export function DeclaredGapTable({ items }: DeclaredGapTableProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Ningún requerimiento cae en esta carencia"
        detail="La cifra de la tarjeta es cero y no hay elementos que enseñar. La lista y el número salen del mismo predicado, así que no pueden discrepar."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Elemento
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Horas estimadas
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Compromiso declarado
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Estimado por
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Registrado por
            </th>
            <th scope="col" className="py-2 text-left font-medium">
              Origen
            </th>
          </tr>
        </thead>

        <tbody>
          {items.map((item) => (
            <tr
              key={item.workItemId}
              data-slot="gap-row"
              data-overdue={item.commitmentOverdue ? 'true' : 'false'}
              className="border-b border-border/60 last:border-0"
            >
              <td className="py-2 pr-4 font-mono text-xs font-medium">{item.workItemId}</td>

              <td className="py-2 pr-4 text-right tabular-nums">
                {valor(item.estimatedHours === null ? null : String(item.estimatedHours))}
              </td>

              <td className="py-2 pr-4 tabular-nums">
                {item.committedDate === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {/* Fecha local sin hora: se pinta tal cual, no hay instante que convertir. */}
                    {item.committedDate}
                    {/* Vencido lo dice el backend; aqui solo se pinta su respuesta. */}
                    {item.commitmentOverdue && <Badge variant="danger">vencido</Badge>}
                  </span>
                )}
              </td>

              <td className="py-2 pr-4">
                {valor(item.estimatedBy)}
                {item.estimatedAt && (
                  <span className="block text-xs text-muted-foreground">
                    {formatInstant(item.estimatedAt)}
                  </span>
                )}
              </td>

              <td className="py-2 pr-4">
                {valor(item.committedBy)}
                {item.committedAt && (
                  <span className="block text-xs text-muted-foreground">
                    {formatInstant(item.committedAt)}
                  </span>
                )}
              </td>

              <td className="py-2 font-mono text-xs text-muted-foreground">{item.source}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ClipboardList className="size-3.5 shrink-0" aria-hidden="true" />
        Quien estima y quien registró el compromiso no es necesariamente quien ejecuta: el
        desarrollador asignado no está en la planificación declarada. La fecha declarada es historia:
        el compromiso vigente es el Internal TTR que publica GLPI.
      </p>
    </div>
  )
}
