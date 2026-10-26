import { AlertTriangle, ClipboardCheck, History } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useRenegotiationHistory } from '@/hooks/useRenegotiations'
import { formatInstant } from '@/lib/format'
import { AGREEMENT_ORIGIN_LABEL, agreementOrigin } from '@/lib/renegotiations'
import { formatDay } from '@/lib/timeline'
import type { RenegotiationItem } from '@/types/renegotiations'

interface RenegotiationHistoryProps {
  item: RenegotiationItem
}

/**
 * Todo lo que le ha pasado al acuerdo de un requerimiento.
 *
 * **Se lee de su propia ruta y no se reconstruye.** No se ordena, no se deduplica y no se completa
 * con lo que la lista traia: los cambios se pintan en el orden exacto en que los publica el backend,
 * porque un historial recompuesto en el cliente afirmaria un orden que nadie audito. Tampoco se
 * deriva el cambio «actual» de la ultima entrada: el acuerdo vigente ya lo publica la fila.
 *
 * El historial existe **si y solo si alguien registro un acuerdo alguna vez**, y eso lo dice un hecho
 * que el backend publica —`renegotiation` nulo o no—, no una deduccion de la vista. Sin acuerdo no se
 * pide nada: la ruta responde `404` y ese `404` describe el estado normal de un requerimiento
 * desplazado que nadie ha renegociado todavia.
 *
 * Que un requerimiento este en PENDIENTE_DE_ACUERDO **no** significa que no tenga historial: uno que
 * se movio despues de haberse acordado sigue pendiente y conserva su historia entera. Es justo lo que
 * deja ver que hubo una renegociacion y que despues el requerimiento se movio otra vez.
 */
export function RenegotiationHistory({ item }: RenegotiationHistoryProps) {
  const hasAgreement = item.renegotiation !== null
  const { data, isPending, isError, error, refetch } = useRenegotiationHistory(
    item.workItemId,
    hasAgreement,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Historial del acuerdo
        </CardTitle>
        <CardDescription>
          Una entrada por cambio registrado, en el orden en que las publica el backend. Un cambio sin
          fecha anterior es el primer acuerdo: el momento en que no había fecha y alguien la trajo. Y
          uno con las dos fechas iguales es un motivo corregido: el acuerdo no cambió, su explicación
          sí.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/*
          El origen del acuerdo vigente. El historial guarda quien hizo cada cambio —`changedBy`—,
          pero no el origen de cada fila; el del acuerdo actual es el que explica si su primera
          entrada la trajo GLPI o una persona.
        */}
        {item.renegotiation && (
          <p
            data-slot="agreement-origin"
            data-source={item.renegotiation.source}
            className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          >
            <Badge variant={agreementOrigin(item.renegotiation.source) === 'GLPI' ? 'info' : 'secondary'}>
              {AGREEMENT_ORIGIN_LABEL[agreementOrigin(item.renegotiation.source)]}
            </Badge>
            <span>
              registrado el{' '}
              <time dateTime={item.renegotiation.agreedAt}>
                {formatInstant(item.renegotiation.agreedAt)}
              </time>
            </span>
          </p>
        )}

        {!hasAgreement ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Todavía no hay acuerdo registrado"
            detail="Sin acuerdo no hay historial que leer. El primer acuerdo también se registra, así que la primera entrada aparece en cuanto alguien lo firme."
          />
        ) : isPending && !data ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <EmptyState
            tone="danger"
            icon={AlertTriangle}
            title="No fue posible leer el historial"
            detail={error instanceof Error ? error.message : 'Error desconocido'}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Reintentar
              </Button>
            }
          />
        ) : !data || data.changes.length === 0 ? (
          // El backend documenta que esta lista nunca viene vacia mientras haya fila, porque el
          // primer acuerdo tambien se registra. Si llegara vacia, se dice en vez de rellenarla.
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <History className="size-3.5" aria-hidden="true" />
            El backend no publicó ningún cambio para este acuerdo.
          </p>
        ) : (
          <ol className="space-y-2">
            {data.changes.map((change, index) => (
              <li
                key={`${change.changedAt}-${change.newDate}-${index}`}
                data-slot="history-change"
                data-previous={change.previousDate ?? ''}
                data-new={change.newDate}
                data-reason={change.agreedReason ?? ''}
                className="border-l-2 border-border pl-3 text-xs"
              >
                <p className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums font-medium">
                    {change.previousDate === null
                      ? `primer acuerdo: ${formatDay(change.newDate)}`
                      : change.previousDate === change.newDate
                        ? // Las dos fechas iguales ya no son un cambio que no cambio nada: lo que
                          // cambio fue el motivo, y decirlo es lo que evita leer «8 oct → 8 oct».
                          `motivo corregido: ${formatDay(change.newDate)}`
                        : `${formatDay(change.previousDate)} → ${formatDay(change.newDate)}`}
                  </span>
                </p>

                {/*
                  El motivo de esta entrada, no el vigente. Nulo es una entrada anterior a que el
                  motivo se registrara, y se dice en vez de dejar el hueco: un hueco se lee como «no
                  hubo motivo», que es lo contrario de lo que significa.
                */}
                <p className="mt-0.5">
                  {change.agreedReason ?? (
                    <span className="text-muted-foreground italic">
                      sin motivo registrado: la entrada es anterior al campo
                    </span>
                  )}
                </p>

                <p className="mt-0.5 text-muted-foreground">
                  por {change.changedBy} el{' '}
                  <time dateTime={change.changedAt}>{formatInstant(change.changedAt)}</time>
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
