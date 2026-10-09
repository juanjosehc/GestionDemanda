import { AlertTriangle, ClipboardList } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  capacityOn,
  formatDay,
  formatHours,
  formatTime,
  hourAxis,
  itemsByDate,
  minutesOfDay,
  timelineDays,
} from '@/lib/timeline'
import { cn } from '@/lib/utils'
import type { HourAxis } from '@/lib/timeline'
import type { BadgeVariant } from '@/components/ui/badge'
import type {
  IncidentSeverity,
  TimelineCapacity,
  TimelineItem,
  TimelineItemStatus,
  TimelineResource,
} from '@/types/timeline'

/**
 * Densidades del eje temporal. Es el "zoom basico" de la vista: solo cambian los pixeles, no
 * los datos ni el rango.
 */
const ZOOM = [
  { label: 'Compacta', hourHeight: 26, dayWidth: 132 },
  { label: 'Normal', hourHeight: 44, dayWidth: 168 },
  { label: 'Amplia', hourHeight: 72, dayWidth: 224 },
] as const

/** Un tramo corto se queda sin sitio para su contenido; se le deja un minimo legible. */
const MIN_BLOCK_HEIGHT = 18

const STATUS: Record<TimelineItemStatus, { label: string; variant: BadgeVariant; block: string }> = {
  PLANIFICADO: {
    label: 'Planificado',
    variant: 'info',
    block: 'border-sky-200 bg-sky-50 text-sky-900',
  },
  DESPLAZADO: {
    label: 'Desplazado',
    variant: 'warning',
    block: 'border-amber-400 bg-amber-50 text-amber-900',
  },
}

const SEVERITY: Record<IncidentSeverity, BadgeVariant> = {
  ALTO: 'danger',
  MEDIO: 'warning',
  BAJO: 'secondary',
}

const TYPE = {
  INCIDENTE: { label: 'Incidente', icon: AlertTriangle },
  REQUERIMIENTO: { label: 'Requerimiento', icon: ClipboardList },
} as const

/** Texto del tooltip nativo. La aplicacion no tiene componente de tooltip; el navegador basta. */
function describe(item: TimelineItem): string {
  const parts = [
    `${TYPE[item.workItemType].label} ${item.workItemId}`,
    `${formatTime(item.startsAt)}–${formatTime(item.endsAt)} · ${formatHours(item.durationHours)} h de ${formatHours(item.estimatedHours)} h estimadas`,
    STATUS[item.planningStatus].label,
  ]

  if (item.severity) {
    parts.push(`Severidad ${item.severity}`)
  }
  if (item.committedDate) {
    parts.push(`Compromiso ${formatDay(item.committedDate)}`)
  }

  return parts.join(' · ')
}

interface BlockProps {
  item: TimelineItem
  axis: HourAxis
  hourHeight: number
}

function Block({ item, axis, hourHeight }: BlockProps) {
  const status = STATUS[item.planningStatus]
  const Icon = TYPE[item.workItemType].icon

  const start = minutesOfDay(item.startsAt)
  const end = minutesOfDay(item.endsAt)

  return (
    <div
      data-slot="timeline-block"
      data-status={item.planningStatus}
      title={describe(item)}
      className={cn(
        'absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight shadow-xs',
        status.block,
      )}
      style={{
        top: ((start - axis.startMinutes) / 60) * hourHeight,
        height: Math.max(((end - start) / 60) * hourHeight, MIN_BLOCK_HEIGHT),
      }}
    >
      <span className="flex items-center gap-1 font-medium">
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{item.workItemId}</span>
      </span>

      <span className="block truncate tabular-nums opacity-80">
        {formatTime(item.startsAt)}–{formatTime(item.endsAt)} · {formatHours(item.durationHours)} h
      </span>

      <span className="mt-0.5 flex flex-wrap items-center gap-1">
        <Badge variant={status.variant}>{status.label}</Badge>
        {item.severity && <Badge variant={SEVERITY[item.severity]}>{item.severity}</Badge>}
      </span>
    </div>
  )
}

/**
 * Capacidad del dia, tal como la devuelve el backend.
 *
 * Los tres numeros se pintan sin tocarlos: el restante no se recalcula restando, porque un
 * negativo que viniera del plan tiene que verse.
 */
function CapacityStrip({ capacity }: { capacity: TimelineCapacity | undefined }) {
  return (
    <div className="h-10 space-y-1 px-2 py-1.5">
      {capacity ? (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full',
                capacity.occupiedHours > capacity.availableHours ? 'bg-red-500' : 'bg-primary',
              )}
              style={{
                width: `${capacity.availableHours > 0 ? Math.min(capacity.occupiedHours / capacity.availableHours, 1) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="flex flex-wrap gap-x-1.5 text-[10px] tabular-nums text-muted-foreground">
            <span>{formatHours(capacity.availableHours)} disp</span>
            <span>{formatHours(capacity.occupiedHours)} ocup</span>
            <span>{formatHours(capacity.remainingHours)} libre</span>
          </p>
        </>
      ) : (
        <span className="text-[10px] text-muted-foreground">—</span>
      )}
    </div>
  )
}

interface TimelineGridProps {
  resources: readonly TimelineResource[]
  items: readonly TimelineItem[]
}

/**
 * Rejilla de la agenda: una fila por recurso, una columna por dia y los tramos posicionados por
 * hora.
 *
 * Es CSS Grid y no una libreria de scheduling a proposito: mientras el licenciamiento no este
 * decidido, la vista se sostiene con lo que ya hay. Sustituir este componente por FullCalendar o
 * vis-timeline no cambia ni el contrato ni el backend.
 */
export function TimelineGrid({ resources, items }: TimelineGridProps) {
  const [zoom, setZoom] = useState(1)

  const { hourHeight, dayWidth } = ZOOM[zoom]
  const days = useMemo(() => timelineDays(resources, items), [resources, items])
  const axis = useMemo(() => hourAxis(items), [items])
  const byDate = useMemo(() => itemsByDate(items), [items])

  const bodyHeight = ((axis.endMinutes - axis.startMinutes) / 60) * hourHeight
  const hourMarks: number[] = []
  for (let mark = axis.startMinutes; mark <= axis.endMinutes; mark += 60) {
    hourMarks.push(mark)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <span id="timeline-zoom-label" className="text-xs text-muted-foreground">
          Zoom
        </span>
        <div
          role="group"
          aria-labelledby="timeline-zoom-label"
          className="flex gap-0.5 rounded-md border border-border p-0.5"
        >
          {ZOOM.map((level, index) => (
            <Button
              key={level.label}
              type="button"
              size="sm"
              variant={index === zoom ? 'secondary' : 'ghost'}
              aria-pressed={index === zoom}
              className="h-7 px-2 text-xs"
              onClick={() => setZoom(index)}
            >
              {level.label}
            </Button>
          ))}
        </div>
      </div>

      <div
        role="region"
        aria-label="Agenda del plan"
        className="overflow-x-auto rounded-lg border border-border"
      >
        <div className="min-w-max">
          <div className="flex border-b border-border bg-muted/40">
            <div className="sticky left-0 z-20 flex w-44 shrink-0 items-center border-r border-border bg-muted/40 px-3 py-2 text-xs font-medium">
              Recurso
            </div>
            {days.map((day) => (
              <div
                key={day}
                style={{ width: dayWidth }}
                className="shrink-0 border-r border-border px-2 py-2 last:border-r-0"
              >
                <p className="truncate text-xs font-medium capitalize">{formatDay(day)}</p>
              </div>
            ))}
          </div>

          {resources.map((resource) => {
            const resourceItems = items.filter((item) => item.developerId === resource.developerId)

            return (
              <div
                key={resource.developerId}
                data-slot="timeline-resource"
                className="flex border-b border-border last:border-b-0"
              >
                <div className="sticky left-0 z-10 flex w-44 shrink-0 flex-col justify-center gap-0.5 border-r border-border bg-card px-3 py-2">
                  <span className="truncate text-xs font-medium" title={resource.developerId}>
                    {resource.developerId}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {resourceItems.length} tramos
                  </span>
                </div>

                {days.map((day, dayIndex) => (
                  <div
                    key={day}
                    style={{ width: dayWidth }}
                    className="shrink-0 border-r border-border last:border-r-0"
                  >
                    <CapacityStrip capacity={capacityOn(resource, day)} />

                    <div className="relative border-t border-border" style={{ height: bodyHeight }}>
                      {hourMarks.map((mark) => (
                        <div
                          key={mark}
                          className="absolute inset-x-0 border-t border-border/60"
                          style={{ top: ((mark - axis.startMinutes) / 60) * hourHeight }}
                        >
                          {dayIndex === 0 && (
                            <span className="absolute left-1 top-0.5 text-[10px] tabular-nums text-muted-foreground/70">
                              {String(mark / 60).padStart(2, '0')}:00
                            </span>
                          )}
                        </div>
                      ))}

                      {(byDate.get(day) ?? []).map((item) => (
                        <Block
                          key={`${item.workItemId}-${item.startsAt}`}
                          item={item}
                          axis={axis}
                          hourHeight={hourHeight}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
