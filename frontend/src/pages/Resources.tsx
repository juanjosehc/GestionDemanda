import { Activity, AlertTriangle, BellRing, CheckCircle2, Gauge, Timer, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { StatCard } from '@/components/dashboard/StatCard'
import { TeamTable } from '@/components/team/TeamTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useAlerts } from '@/hooks/useAlerts'
import { usePlanningMetrics } from '@/hooks/usePlanningMetrics'
import { SEVERITY_VARIANTS } from '@/lib/alerts'
import { formatInstant } from '@/lib/format'
import { formatHours } from '@/lib/timeline'
import { ROUTES } from '@/routes/navigation'

/** Esqueleto de la carga: la misma forma que el contenido, para que no haya salto de altura. */
function TeamSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-96" />

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>

      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/**
 * El equipo sin nadie a quien consolidar.
 *
 * Cubre los dos motivos por los que la tabla no tiene filas, y el segundo importa: un desarrollador
 * con trabajo declarado pero sin plan vigente **no aparece**, porque la vista consolida planes y no
 * personas. La lista de personas del equipo todavía no existe en el backend, así que la ausencia se
 * declara en vez de rellenarse con una fila de ceros que afirmaría una capacidad que nadie calculó.
 */
function EmptyTeam({ withDetail }: { withDetail: boolean }) {
  return (
    <EmptyState
      icon={Users}
      title="Ningún desarrollador tiene un plan vigente"
      detail={
        withDetail
          ? 'La vista consolida planes ya guardados y todavía no hay ninguno, así que no hay equipo que comparar. Un desarrollador sin plan vigente tampoco aparecería: la vista consolida planes, no personas.'
          : 'La vista consolida planes ya guardados y todavía no hay ninguno, así que no hay equipo que comparar.'
      }
    />
  )
}

/**
 * Vista consolidada del equipo: el plan vigente de cada desarrollador, uno al lado del otro.
 *
 * **No es un plan de equipo.** No fusiona planes, no suma tramos y no recalcula capacidad: cada fila
 * es un plan que ya existe y las cifras son las que el backend publicó para él. Lo único que la
 * vista aporta es la comparación —ordenar por una columna— y la navegación hacia el detalle, que ya
 * existía.
 *
 * La consolidación es una **proyección de dos respuestas existentes**: la fotografía operativa, de
 * donde sale `current.byDeveloper` —un plan vigente por desarrollador, con la vigencia ya resuelta
 * por el backend— y el centro de alertas. No hay endpoint nuevo porque no falta información: lo que
 * la vista necesita ya viaja publicado, y pedirlo otra vez sería la tercera copia del mismo hecho.
 */
export function Resources() {
  const { data, isPending, isError, error, refetch } = usePlanningMetrics()
  const alerts = useAlerts()
  const loading = isPending && !data

  if (loading) {
    return <TeamSkeleton />
  }

  if (isError) {
    return (
      <EmptyState
        tone="danger"
        icon={AlertTriangle}
        title="No fue posible cargar la vista del equipo"
        detail={error instanceof Error ? error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  if (!data) {
    return <EmptyTeam withDetail={false} />
  }

  const { current } = data
  const team = current.byDeveloper

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Un plan vigente por desarrollador, en la fotografía generada el{' '}
        <time dateTime={data.generatedAt}>{formatInstant(data.generatedAt)}</time>
        {current.from && current.to && (
          <>
            {' '}
            · ventana del {current.from} al {current.to}
          </>
        )}{' '}
        · {team.length} {team.length === 1 ? 'desarrollador con plan' : 'desarrolladores con plan'}
      </p>

      {/*
        Sin planes no se pinta la tabla ni las tarjetas —serian tres ceros que nadie calculo—, pero
        las alertas del conjunto se siguen enseñando: hay condiciones que se evaluan sobre lo
        declarado y no sobre la capacidad, y esconderlas porque la tabla este vacia borraria el unico
        sitio donde se ven.
      */}
      {team.length === 0 ? (
        <EmptyTeam withDetail />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Capacidad disponible"
              icon={Gauge}
              tone="success"
              value={formatHours(current.capacity.availableHours)}
              hint="horas · suma de los planes vigentes"
            />

            <StatCard
              label="Capacidad ocupada"
              icon={Activity}
              tone="primary"
              value={formatHours(current.capacity.occupiedHours)}
              hint="horas · suma de los planes vigentes"
            />

            <StatCard
              label="Capacidad restante"
              icon={Timer}
              tone="muted"
              value={formatHours(current.capacity.remainingHours)}
              hint="horas · no se recorta a cero"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Desarrolladores
              </CardTitle>
              <CardDescription>
                Ordena por cualquier columna: la cabecera es un botón y el orden de partida es el que
                entregó el backend, por desarrollador. Ordenar mueve filas; no recalcula ninguna
                cifra. Un desarrollador sin plan vigente no aparece en la tabla.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <TeamTable byDeveloper={team} />
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Alertas activas
          </CardTitle>
          <CardDescription>
            Las condiciones que hoy se cumplen, tal como las publica el backend. Las dos de capacidad
            se desglosan por desarrollador en la tabla de arriba: las filas con el restante agotado o
            negativo son exactamente su contador. Las demás son del conjunto y no se reparten por
            persona.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/*
            Las alertas se leen aparte y fallan aparte: si su consulta se cae, la tabla del equipo
            —que es la vista— sigue en pie y el fallo se declara en su sitio, no en toda la pantalla.
          */}
          {alerts.isPending && !alerts.data ? (
            <Skeleton className="h-24 w-full" />
          ) : alerts.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                No fue posible leer las alertas.{' '}
                {alerts.error instanceof Error ? alerts.error.message : 'Error desconocido'}
              </p>
              <Button variant="outline" size="sm" onClick={() => void alerts.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : !alerts.data || alerts.data.alerts.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Ninguna condición exige atención ahora.
            </p>
          ) : (
            <ul className="space-y-2">
              {alerts.data.alerts.map((alert) => (
                <li
                  key={alert.type}
                  data-slot="team-alert"
                  data-type={alert.type}
                  data-severity={alert.severity}
                  className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge variant={SEVERITY_VARIANTS[alert.severity]}>{alert.severity}</Badge>
                    <span className="truncate font-mono text-xs">{alert.type}</span>
                  </span>

                  <span className="shrink-0 text-sm font-semibold tabular-nums">{alert.count}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BellRing className="size-3.5" aria-hidden="true" />
          Solo lectura: la vista proyecta el plan vigente de cada uno. No crea un plan de equipo, no
          fusiona planes y no recalcula capacidad.
        </p>

        <Button variant="outline" size="sm" asChild>
          <Link to={ROUTES.alerts}>Ver el centro de alertas</Link>
        </Button>
      </div>
    </div>
  )
}
