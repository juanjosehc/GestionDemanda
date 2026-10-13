import { AlertTriangle, BellRing, CheckCircle2, FilterX } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useAlerts } from '@/hooks/useAlerts'
import { SEVERITY_VARIANTS } from '@/lib/alerts'
import { formatInstant } from '@/lib/format'
import { alertDetailPath } from '@/routes/navigation'
import type { OperationalAlert } from '@/types/alerts'

/** Valor de un filtro sin aplicar. No es una severidad ni un tipo: es la ausencia de filtro. */
const ANY = ''

interface AlertFilters {
  severity: string
  type: string
}

const NO_FILTERS: AlertFilters = { severity: ANY, type: ANY }

/**
 * Las opciones de un filtro, sacadas de lo que llego.
 *
 * El catalogo **no se escribe aqui**: el backend dijo por escrito que el suyo vive en un solo sitio
 * y que no se repite, y esta pantalla no lo necesita —los valores que ofrece son los que la lista
 * ya trae—. El orden es el de la respuesta, asi que las severidades salen ya de mas grave a menos.
 */
function optionsOf<T extends string>(values: readonly T[], anyLabel: string) {
  return [
    { value: ANY, label: anyLabel },
    ...[...new Set(values)].map((value) => ({ value, label: value })),
  ]
}

/**
 * Selector nativo de filtro: el navegador ya sabe hacerlo y la aplicacion no tiene componente de
 * select.
 *
 * Es el mismo que la Timeline guarda en privado. Vive tambien aqui por el mismo motivo por el que
 * `EmptyState` se copio en su dia: esta fase no puede tocar la Timeline, asi que el original no se
 * puede sustituir por uno compartido. El dia que la Timeline se retoque, su copia desaparece y este
 * se queda con los dos consumidores.
 */
function Filter({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Los filtros, aplicados en memoria sobre la lista ya recibida.
 *
 * No hay una peticion por filtro: la lista es del conjunto y se pidio una sola vez. Filtrar en el
 * servidor convertiria una seleccion de la interfaz en trafico contra el backend, y el backend no
 * tiene por donde filtrar —la proyeccion no acepta parametros—.
 */
function filterAlerts(alerts: readonly OperationalAlert[], filters: AlertFilters): OperationalAlert[] {
  return alerts.filter(
    (alert) =>
      (filters.severity === ANY || alert.severity === filters.severity) &&
      (filters.type === ANY || alert.type === filters.type),
  )
}

/** Esqueleto de la carga: la misma forma que el contenido, para que no haya salto de altura. */
function AlertsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/**
 * El centro de alertas operativas: de la fotografia a lo que exige atencion.
 *
 * Consume exclusivamente {@code GET /api/planning/alerts} y pinta lo que recibe. No recalcula
 * ninguna alerta —no cuenta elementos, no re-deriva prioridades y no consulta las metricas para
 * comprobar nada—: cada fila es una alerta que el backend ya emitio, con la severidad que el ya
 * decidio, en el orden en que el la mando.
 *
 * Las alertas son **derivadas y de solo lectura**. No hay reconocer, cerrar ni descartar: la unica
 * forma de que una alerta desaparezca es que la condicion deje de cumplirse, y eso se cambia donde
 * se declara el trabajo, no aqui.
 */
export function Alerts() {
  const { data, isPending, isError, error, refetch } = useAlerts()
  const [filters, setFilters] = useState<AlertFilters>(NO_FILTERS)
  const loading = isPending && !data

  if (loading) {
    return <AlertsSkeleton />
  }

  if (isError) {
    return (
      <EmptyState
        tone="danger"
        icon={AlertTriangle}
        title="No fue posible cargar las alertas operativas"
        detail={error instanceof Error ? error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  if (!data || data.alerts.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Ninguna condición exige atención ahora"
        detail={`Se evaluaron las condiciones operativas${
          data ? ` el ${formatInstant(data.generatedAt)}` : ''
        } y no se cumple ninguna. Una lista vacía es el estado que una alerta existe para poder declarar: no es una respuesta incompleta.`}
      />
    )
  }

  const visible = filterAlerts(data.alerts, filters)

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Condiciones evaluadas el{' '}
        <time dateTime={data.generatedAt}>{formatInstant(data.generatedAt)}</time>. Solo se listan
        las que se cumplen, de más grave a menos, en el orden en que las publica el backend.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <Filter
          id="filtro-severidad"
          label="Severidad"
          value={filters.severity}
          options={optionsOf(
            data.alerts.map((alert) => alert.severity),
            'Todas',
          )}
          onChange={(severity) => setFilters((current) => ({ ...current, severity }))}
        />
        <Filter
          id="filtro-tipo"
          label="Tipo"
          value={filters.type}
          options={optionsOf(
            data.alerts.map((alert) => alert.type),
            'Todos',
          )}
          onChange={(type) => setFilters((current) => ({ ...current, type }))}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={FilterX}
          title="Ninguna alerta coincide con los filtros"
          detail={`Se recibieron ${data.alerts.length} alertas y los filtros dejan fuera a todas. Los filtros no vuelven a consultar nada: se aplican sobre la lista que ya está en pantalla.`}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Alertas disparadas
            </CardTitle>
            <CardDescription>
              Una fila por condición, no por elemento: cuántos elementos la producen lo dice la
              cifra, y a los elementos se va por el detalle. Las alertas clasifican, no particionan,
              así que sumar los contadores no mediría nada y no se publica ningún total.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 text-left font-medium">
                      Severidad
                    </th>
                    <th scope="col" className="py-2 pr-4 text-left font-medium">
                      Alerta
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Cuántos
                    </th>
                    <th scope="col" className="py-2 pr-4 text-left font-medium">
                      Origen
                    </th>
                    <th scope="col" className="py-2 text-left font-medium">
                      Detalle
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {visible.map((alert) => {
                    const path = alertDetailPath(alert.detailUrl)

                    return (
                      <tr
                        key={alert.type}
                        data-slot="alert-row"
                        data-severity={alert.severity}
                        data-type={alert.type}
                        data-detail={alert.detailUrl ? 'true' : 'false'}
                        // La fecha de cada alerta va en el tooltip: hoy es, por construccion, el
                        // mismo instante que el de la respuesta, que esta arriba y a la vista.
                        data-generated-at={alert.generatedAt}
                        title={`Evaluada el ${formatInstant(alert.generatedAt)}`}
                        className="border-b border-border/60 align-top last:border-0"
                      >
                        <td className="py-3 pr-4">
                          <Badge variant={SEVERITY_VARIANTS[alert.severity]}>{alert.severity}</Badge>
                        </td>

                        <td className="py-3 pr-4">
                          <p className="font-mono text-xs font-medium">{alert.type}</p>
                          {/* La condicion la escribe el backend; la vista solo la pinta. */}
                          <p className="mt-0.5 text-xs text-muted-foreground">{alert.condition}</p>
                        </td>

                        <td className="py-3 pr-4 text-right text-lg font-semibold tabular-nums">
                          {alert.count}
                        </td>

                        <td className="py-3 pr-4">
                          <p className="font-mono text-xs">{alert.source}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{alert.scope}</p>
                        </td>

                        <td className="py-3">
                          {path ? (
                            <Button variant="outline" size="sm" asChild>
                              <Link to={path}>Ver el desglose</Link>
                            </Button>
                          ) : alert.detailUrl ? (
                            // Hay desglose, pero esta aplicacion no sabe abrirlo: se enseña la
                            // ruta tal como la publica el backend en vez de inventar un destino.
                            <p className="font-mono text-xs text-muted-foreground">
                              {alert.detailUrl}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Sin desglose propio: el detalle está en el calendario del plan.
                            </p>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Marcador de posicion del centro de notificaciones: no hay envío, ni correo, ni push. */}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellRing className="size-3.5" aria-hidden="true" />
        Solo lectura: las alertas se derivan en cada consulta y no se reconocen, cierran ni archivan.
      </p>
    </div>
  )
}
