import { CalendarRange } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { TimelineGrid } from '@/components/timeline/TimelineGrid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTimeline } from '@/hooks/useTimeline'
import { EMPTY_FILTERS, filterItems, formatDay } from '@/lib/timeline'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/routes/navigation'
import type { TimelineFilters } from '@/lib/timeline'
import type { ReactNode } from 'react'

const TYPE_OPTIONS = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'INCIDENTE', label: 'Incidentes' },
  { value: 'REQUERIMIENTO', label: 'Requerimientos' },
] as const

const SEVERITY_OPTIONS = [
  { value: 'TODAS', label: 'Todas' },
  { value: 'ALTO', label: 'Alto' },
  { value: 'MEDIO', label: 'Medio' },
  { value: 'BAJO', label: 'Bajo' },
] as const

const STATUS_OPTIONS = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'PLANIFICADO', label: 'Planificado' },
  { value: 'DESPLAZADO', label: 'Desplazado' },
] as const

interface EmptyStateProps {
  title: string
  detail: string
  action?: ReactNode
  tone?: 'muted' | 'danger'
}

function EmptyState({ title, detail, action, tone = 'muted' }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <span
        className={cn(
          'flex size-11 items-center justify-center rounded-full',
          tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-muted text-muted-foreground',
        )}
      >
        <CalendarRange className="size-5" aria-hidden="true" />
      </span>

      <div className="max-w-md">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>

      {action}
    </div>
  )
}

interface FilterProps<T extends string> {
  id: string
  label: string
  value: T
  options: readonly { readonly value: T; readonly label: string }[]
  onChange: (value: T) => void
}

/** Selector nativo: el navegador ya sabe hacerlo y la aplicacion no tiene componente de select. */
function Filter<T extends string>({ id, label, value, options, onChange }: FilterProps<T>) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
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

interface ResourceTimelineProps {
  /** Plan a pintar. Sin el se muestra el estado vacio, que es lo que hace el tablero. */
  planId?: string
}

/**
 * Linea de tiempo de un plan guardado.
 *
 * Consume exclusivamente {@code GET /api/planning/{planId}/timeline} y pinta lo que recibe: no
 * recalcula la planificacion ni pide nada mas. El render es CSS Grid propio (ver TimelineGrid);
 * sustituirlo por una libreria de scheduling no cambia el contrato ni el backend.
 */
export function ResourceTimeline({ planId }: ResourceTimelineProps) {
  const { data, isPending, isError, error, refetch } = useTimeline(planId)
  const [filters, setFilters] = useState<TimelineFilters>(EMPTY_FILTERS)

  const items = useMemo(() => filterItems(data?.items ?? [], filters), [data, filters])
  const loading = isPending && !data

  if (!planId) {
    return (
      <EmptyState
        title="Sin plan seleccionado"
        detail="Abre el calendario e indica el identificador del plan que quieres ver."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTES.calendar}>Ir al calendario</Link>
          </Button>
        }
      />
    )
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <EmptyState
        tone="danger"
        title="No fue posible cargar la agenda"
        detail={error instanceof Error ? error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title="Este plan no tiene agenda"
        detail={`El plan de ${data?.developerId ?? planId} no dejó tramos que pintar.`}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{data.developerId}</p>
          <p className="truncate text-xs text-muted-foreground">
            Plan <span className="font-mono">{data.planId}</span>
            {data.from && data.to ? ` · ${formatDay(data.from)} — ${formatDay(data.to)}` : ''}
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          {items.length} de {data.items.length} tramos
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Filter
          id="filtro-tipo"
          label="Tipo"
          value={filters.workItemType}
          options={TYPE_OPTIONS}
          onChange={(workItemType) => setFilters((current) => ({ ...current, workItemType }))}
        />
        <Filter
          id="filtro-severidad"
          label="Severidad"
          value={filters.severity}
          options={SEVERITY_OPTIONS}
          onChange={(severity) => setFilters((current) => ({ ...current, severity }))}
        />
        <Filter
          id="filtro-estado"
          label="Estado"
          value={filters.planningStatus}
          options={STATUS_OPTIONS}
          onChange={(planningStatus) => setFilters((current) => ({ ...current, planningStatus }))}
        />

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="info">Planificado</Badge>
          <Badge variant="warning">Desplazado</Badge>
        </div>
      </div>

      <TimelineGrid resources={data.resources} items={items} />
    </div>
  )
}
