import { AlertTriangle, CheckCircle2, ListChecks } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSaveDeclarations } from '@/hooks/useDeclarations'
import { DECLARATION_VARIANTS, formatDeclaredHours } from '@/lib/declarations'
import { readFirmante, rememberFirmante } from '@/lib/firmante'
import type { BatchSaveResult, SaveDeclarationInput } from '@/hooks/useDeclarations'
import type { DeclarationItem } from '@/types/declarations'

/** Los dos valores de una fila, tal como se estan escribiendo. */
interface RowValues {
  hours: string
  date: string
}

const EMPTY: RowValues = { hours: '', date: '' }

/** Lo declarado hoy en una fila, como valor inicial: las horas sin ceros de relleno. */
function initialOf(item: DeclarationItem): RowValues {
  return {
    hours:
      item.declaration?.estimatedHours == null
        ? ''
        : formatDeclaredHours(item.declaration.estimatedHours),
    date: item.declaration?.committedDate ?? '',
  }
}

function valuesOf(row: RowValues): { estimatedHours: number | null; committedDate: string | null } {
  return {
    estimatedHours: row.hours.trim() === '' ? null : Number(row.hours),
    committedDate: row.date.trim() === '' ? null : row.date,
  }
}

interface DeclarationBatchProps {
  /** Los tickets activos que se arreglan declarando, en el orden de GLPI. */
  items: readonly DeclarationItem[]
  developerName: string
  onSaved: (count: number) => void
}

/**
 * La declaracion de una persona entera, en una sola vista.
 *
 * **La unidad de trabajo es la persona, no el ticket.** Con los datos reales, ocho de cada diez
 * bloqueos se concentran en quince personas y una sola tiene diez tickets pendientes: abrir un
 * formulario por ticket cuesta un viaje de pantalla y una firma tecleada por cada uno. Aqui se ve la
 * lista completa, se escribe en las filas que haya informacion y se guarda todo de una vez.
 *
 * **Las filas vacias no se envian.** No hay una validacion nueva: la regla de «al menos un valor» es
 * la del backend, y una fila en blanco simplemente no se manda. Las filas con declaracion llegan
 * precargadas para que cambiar una fecha no borre unas horas que ya estaban.
 *
 * **Un solo firmante para el lote.** Es la misma persona la que esta operando; repetir su nombre por
 * fila era la friccion mas cara de la pantalla. El campo se recuerda entre visitas, y lo que viaja al
 * backend sigue siendo un `changedBy` explicito por escritura.
 *
 * **Un fallo no cancela el resto.** Cada ticket se escribe solo; los que fallen quedan en la lista con
 * el mensaje del backend, y los demas se guardan igual.
 */
export function DeclarationBatch({ items, developerName, onSaved }: DeclarationBatchProps) {
  const [values, setValues] = useState<Record<string, RowValues>>(() =>
    Object.fromEntries(items.map((item) => [item.workItemId, initialOf(item)])),
  )
  const [changedBy, setChangedBy] = useState(() => readFirmante())
  const [result, setResult] = useState<BatchSaveResult | null>(null)

  const save = useSaveDeclarations()

  function rowOf(item: DeclarationItem): RowValues {
    return values[item.workItemId] ?? EMPTY
  }

  function updateRow(workItemId: string, patch: Partial<RowValues>) {
    setValues((current) => ({
      ...current,
      [workItemId]: { ...(current[workItemId] ?? EMPTY), ...patch },
    }))
  }

  /** Las filas que tienen algo que escribir y difieren de lo que ya estaban. */
  const dirty = items.filter((item) => {
    const row = rowOf(item)
    const initial = initialOf(item)

    return (
      (row.hours.trim() !== '' || row.date.trim() !== '') &&
      (row.hours.trim() !== initial.hours || row.date.trim() !== initial.date)
    )
  })

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (dirty.length === 0 || changedBy.trim() === '') return

    rememberFirmante(changedBy)

    const entries: SaveDeclarationInput[] = dirty.map((item) => ({
      workItemId: item.workItemId,
      create: item.declaration === null,
      values: { ...valuesOf(rowOf(item)), changedBy: changedBy.trim() },
    }))

    setResult(null)

    const saved = await save.mutateAsync(entries)

    setResult(saved)
    if (saved.saved > 0) onSaved(saved.saved)
  }

  const failures = new Map(
    (result?.failed ?? []).map((failure) => [failure.workItemId, failure.message] as const),
  )

  return (
    <Card data-slot="declaration-batch">
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Declaración en lote · {developerName}
        </CardTitle>
        <CardDescription>
          Una fila por ticket pendiente. Escribe las horas, la fecha o las dos; las filas vacías no se
          envían. Un solo «Quién declara» firma el lote entero, y cada ticket conserva su propia
          escritura.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-slot="batch-empty">
            No quedan tickets pendientes de declaración para {developerName}. La lista de abajo sigue
            siendo la fuente del estado.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block max-w-sm space-y-1">
              <span className="text-xs text-muted-foreground">Quién declara</span>
              <input
                type="text"
                maxLength={64}
                value={changedBy}
                onChange={(event) => setChangedBy(event.target.value)}
                placeholder="El nombre de quien registra el lote"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 text-left font-medium">
                      Ticket
                    </th>
                    <th scope="col" className="py-2 pr-4 text-left font-medium">
                      Estado
                    </th>
                    <th scope="col" className="py-2 pr-4 text-left font-medium">
                      Horas estimadas
                    </th>
                    <th scope="col" className="py-2 text-left font-medium">
                      Fecha compromiso
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {items.map((item) => {
                    const row = rowOf(item)
                    const failure = failures.get(item.workItemId)

                    return (
                      <tr
                        key={item.workItemId}
                        data-slot="batch-row"
                        data-work-item={item.workItemId}
                        className="border-b border-border/60 align-top last:border-0"
                      >
                        <td className="max-w-xs py-2 pr-4">
                          <span className="font-mono text-xs">{item.workItemId}</span>
                          <span className="block truncate text-xs text-muted-foreground" title={item.title}>
                            {item.title}
                          </span>
                        </td>

                        <td className="py-2 pr-4">
                          <Badge variant={DECLARATION_VARIANTS[item.declarationStatus]}>
                            {item.declarationStatus}
                          </Badge>
                          {item.declaration && (
                            <span className="mt-1 block text-[10px] text-muted-foreground">
                              {initialOf(item).hours === ''
                                ? 'sin estimación'
                                : `${initialOf(item).hours} h`}{' '}
                              · {item.declaration.committedDate ?? 'sin compromiso'}
                            </span>
                          )}
                        </td>

                        <td className="py-2 pr-4">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max="999999.9999"
                            aria-label={`Horas estimadas de ${item.workItemId}`}
                            value={row.hours}
                            onChange={(event) =>
                              updateRow(item.workItemId, { hours: event.target.value })
                            }
                            className="h-9 w-28 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          />
                        </td>

                        <td className="py-2">
                          <input
                            type="date"
                            aria-label={`Fecha compromiso de ${item.workItemId}`}
                            value={row.date}
                            onChange={(event) =>
                              updateRow(item.workItemId, { date: event.target.value })
                            }
                            className="h-9 w-40 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          />
                          {failure && (
                            <p role="alert" className="mt-1 max-w-xs text-xs text-red-600">
                              {failure}
                            </p>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={dirty.length === 0 || changedBy.trim() === '' || save.isPending}
                data-slot="batch-save"
              >
                <ListChecks aria-hidden="true" />
                {save.isPending
                  ? 'Guardando…'
                  : dirty.length === 1
                    ? 'Guardar 1 declaración'
                    : `Guardar ${dirty.length} declaraciones`}
              </Button>

              <span className="text-xs text-muted-foreground">
                {dirty.length === 0
                  ? 'Escribe al menos un valor en una fila para poder guardar.'
                  : `${dirty.length} de ${items.length} filas con cambios.`}
              </span>
            </div>

            {/* El resultado del lote: lo guardado y lo que fallo, con el mensaje del backend. No se
                resume el error a «no se pudo»: un 409 y un 400 dicen cosas distintas. */}
            {result && (
              <div data-slot="batch-result" className="space-y-1 text-xs">
                {result.saved > 0 && (
                  <p className="flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    {result.saved === 1
                      ? '1 declaración guardada.'
                      : `${result.saved} declaraciones guardadas.`}
                  </p>
                )}
                {result.failed.length > 0 && (
                  <p className="flex items-center gap-1.5 text-red-600">
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    {result.failed.length === 1
                      ? '1 fila no se pudo guardar; su mensaje está en la fila.'
                      : `${result.failed.length} filas no se pudieron guardar; su mensaje está en cada fila.`}
                  </p>
                )}
              </div>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
