import { AlertTriangle, CheckCircle2, ListChecks } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSaveDeclarations } from '@/hooks/useDeclarations'
import { DECLARATION_VARIANTS, formatDeclaredHours, glpiCommitmentOf } from '@/lib/declarations'
import { readFirmante, rememberFirmante } from '@/lib/firmante'
import type { BatchSaveResult, SaveDeclarationInput } from '@/hooks/useDeclarations'
import type { DeclarationItem } from '@/types/declarations'

/** Lo que se escribe en una fila. Solo horas: la fecha la publica GLPI. */
interface RowValues {
  hours: string
}

const EMPTY: RowValues = { hours: '' }

/** Lo declarado hoy en una fila, como valor inicial: las horas sin ceros de relleno. */
function initialOf(item: DeclarationItem): RowValues {
  return {
    hours:
      item.declaration?.estimatedHours == null
        ? ''
        : formatDeclaredHours(item.declaration.estimatedHours),
  }
}

/**
 * El cuerpo de la escritura de una fila.
 *
 * `committedDate` viaja con lo que ya estaba guardado y no con lo que se escribe: desde la Fase 77
 * no se declara, pero el `PUT` reemplaza y mandar nulo borraria el valor historico. Ver
 * `DeclarationForm`, que hace lo mismo.
 */
function valuesOf(
  row: RowValues,
  item: DeclarationItem,
): { estimatedHours: number | null; committedDate: string | null } {
  return {
    estimatedHours: row.hours.trim() === '' ? null : Number(row.hours),
    committedDate: item.declaration?.committedDate ?? null,
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
 * precargadas para que el que ya tenia horas no las pierda por no reescribirlas.
 *
 * **La fecha no se escribe.** Desde la Fase 77 el compromiso es el Internal TTR de GLPI y el lote lo
 * enseña en su propia columna: pedirlo en una tabla de veinte filas era la peor forma de capturar
 * una fecha que ademas no coincidia con la del plan.
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

    return row.hours.trim() !== '' && row.hours.trim() !== initial.hours
  })

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (dirty.length === 0 || changedBy.trim() === '') return

    rememberFirmante(changedBy)

    const entries: SaveDeclarationInput[] = dirty.map((item) => ({
      workItemId: item.workItemId,
      create: item.declaration === null,
      values: { ...valuesOf(rowOf(item), item), changedBy: changedBy.trim() },
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
          Una fila por ticket pendiente. Escribe las horas; las filas vacías no se envían. La fecha
          de compromiso la publica GLPI y se enseña, no se declara. Un solo «Quién declara» firma el
          lote entero, y cada ticket conserva su propia escritura.
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
                      Compromiso GLPI
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
                                : `${initialOf(item).hours} h`}
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
                          <span className="block text-xs text-muted-foreground">
                            {glpiCommitmentOf(item) ?? 'GLPI no publica fecha'}
                          </span>
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
                  ? 'Escribe las horas de una fila para poder guardar.'
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
