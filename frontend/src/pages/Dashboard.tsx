import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  ClipboardList,
  Gauge,
  Layers,
  ListChecks,
  Timer,
} from 'lucide-react'

import { BottleneckTable } from '@/components/dashboard/BottleneckTable'
import { StatCard } from '@/components/dashboard/StatCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlanningMetrics } from '@/hooks/usePlanningMetrics'
import { formatInstant } from '@/lib/format'
import { metricPath } from '@/routes/navigation'
import { DISPLACED_TOKEN } from '@/types/planningMetrics'
import type { PlanningOperationalMetricsResponse } from '@/types/planningMetrics'

/** Sin filas declaradas ni planes vigentes no hay fotografia que enseñar, solo ceros. */
function isEmpty(metrics: PlanningOperationalMetricsResponse): boolean {
  return metrics.declared.total === 0 && metrics.current.byDeveloper.length === 0
}

/** Esqueleto de la carga: la misma rejilla que el contenido, para que no haya salto de altura. */
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-80" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>

      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/**
 * Tablero principal: la fotografia operativa de la planificacion.
 *
 * Consume exclusivamente {@code GET /api/planning/metrics} y pinta lo que recibe. No hay una sola
 * cifra derivada: ni tasas, ni porcentajes, ni sumas propias. Los tres bloques de la respuesta son
 * de momentos distintos —lo declarado es de hoy, la capacidad es del ultimo plan de cada uno— y el
 * backend prohibe mezclarlos, asi que la vista no los mezcla ni deja un hueco donde parezca que
 * deberia hacerlo.
 *
 * No se dibuja ninguna barra de ocupacion: para eso habria que dividir dos bloques que no son
 * comparables, y el resultado no mediria nada.
 */
export function Dashboard() {
  const { data, isPending, isError, error, refetch } = usePlanningMetrics()
  const loading = isPending && !data

  if (loading) {
    return <DashboardSkeleton />
  }

  if (isError) {
    return (
      <EmptyState
        tone="danger"
        icon={AlertTriangle}
        title="No fue posible cargar la fotografía operativa"
        detail={error instanceof Error ? error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  if (!data || isEmpty(data)) {
    return (
      <EmptyState
        icon={Gauge}
        title="Todavía no hay nada que fotografiar"
        detail="No hay requerimientos declarados ni planes guardados. La fotografía se arma solo con lo que ya está persistido."
      />
    )
  }

  const { declared, plans, current } = data

  /**
   * Lo que la vista afirma sobre de donde sale cada cifra. El texto sale del JSON, no de aqui: si
   * el backend renombra una tabla, esto lo dice sin que nadie edite la vista.
   */
  const traceability = [
    {
      block: 'Declarado',
      source: declared.source,
      scope: declared.scope,
      cards: 'Tickets planificables, sin estimación, sin compromiso y metadata incompleta',
    },
    {
      block: 'Vigente',
      source: current.source,
      scope: current.scope,
      cards: 'Requerimientos desplazados y capacidad disponible, ocupada y restante',
    },
    {
      block: 'Planes',
      source: plans.source,
      scope: plans.scope,
      cards: 'Planes generados',
    },
  ]

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Fotografía generada el{' '}
        <time dateTime={data.generatedAt}>{formatInstant(data.generatedAt)}</time>. Los tres bloques
        son de momentos distintos y no se comparan entre sí.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Tickets planificables"
          icon={ClipboardList}
          tone="primary"
          value={declared.plannable}
          hint="Con estimación y compromiso"
        />

        <StatCard
          label="Sin estimación"
          icon={AlertTriangle}
          tone="warning"
          value={declared.withoutEstimation.count}
          hint={declared.withoutEstimation.code}
          to={metricPath('sin-estimacion')}
        />

        <StatCard
          label="Sin compromiso"
          icon={CalendarClock}
          tone="warning"
          value={declared.withoutCommitment.count}
          hint={declared.withoutCommitment.code}
          to={metricPath('sin-compromiso')}
        />

        <StatCard
          label="Metadata incompleta"
          icon={ListChecks}
          tone="muted"
          value={declared.incomplete}
          hint={`de ${declared.total} declaradas · ${declared.retracted} retiradas`}
          to={metricPath('metadata-incompleta')}
        />

        <StatCard
          label="Requerimientos desplazados"
          icon={CalendarRange}
          tone="warning"
          value={current.displacedRequirements}
          hint="Elementos, no tramos"
          to={metricPath(DISPLACED_TOKEN)}
        />

        <StatCard
          label="Planes generados"
          icon={Layers}
          tone="primary"
          value={plans.generated}
          hint="Cuenta ejecuciones, no planes distintos"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Capacidad disponible"
          icon={Gauge}
          tone="success"
          value={data.current.capacity.availableHours}
          hint="horas · plan vigente"
        />

        <StatCard
          label="Capacidad ocupada"
          icon={Activity}
          tone="primary"
          value={data.current.capacity.occupiedHours}
          hint="horas · plan vigente"
        />

        <StatCard
          label="Capacidad restante"
          icon={Timer}
          tone="muted"
          value={data.current.capacity.remainingHours}
          hint="horas · no se recorta a cero"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Cuellos de botella por desarrollador
          </CardTitle>
          <CardDescription>
            El plan vigente de cada uno, el más reciente por fecha de cálculo. Se resalta la
            capacidad restante agotada o negativa, y los requerimientos desplazados.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <BottleneckTable byDeveloper={current.byDeveloper} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            De dónde sale cada cifra
          </CardTitle>
          <CardDescription>
            La procedencia la declara el backend dentro de la propia respuesta. Esta vista no
            calcula ninguna métrica.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {traceability.map((row) => (
            <div key={row.block} className="space-y-0.5">
              <p className="text-xs font-medium">
                {row.block} · <span className="font-mono font-normal">{row.source}</span>
              </p>
              <p className="text-xs text-muted-foreground">{row.scope}</p>
              <p className="text-xs text-muted-foreground">Métricas: {row.cards}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
