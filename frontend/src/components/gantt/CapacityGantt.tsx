import { CircleDashed, Flag } from 'lucide-react'
import { Fragment } from 'react'

import { RISK, STATES } from '@/lib/timelineVisuals'
import {
  BAND,
  DAY_WIDTH,
  formatPercent,
  laneCount,
  occupancyBand,
  shortName,
  weekShortLabel,
} from '@/lib/gantt/capacity'
import { formatDay, formatHours, parseLocalDateTime, weekStartOf } from '@/lib/timeline'
import { cn } from '@/lib/utils'
import type { CapacityBar, CapacityView, DeveloperLoad, PendingDay } from '@/lib/gantt/capacity'
import type { CommitmentRisk, WorkItemType } from '@/types/timeline'

/** Ancho de la columna fija de personas. Deja sitio al nombre, el porcentaje y las horas. */
const LEFT_WIDTH = 272

/** Alto de un carril de trabajo y margen de la fila. Dos trabajos el mismo dia van en dos carriles. */
const LANE_HEIGHT = 34
const ROW_PADDING = 6

/** El carril de los compromisos sin estimar: bajo y aparte, porque no ocupan jornada. */
const PENDING_HEIGHT = 22

const TYPE_LABEL: Record<WorkItemType, string> = {
  INCIDENTE: 'Incidente',
  REQUERIMIENTO: 'Requerimiento',
}

/** «12 nov»: la fecha de entrega cabe dentro de la barra sin comerse el nombre. */
const SHORT_DATE = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' })

export interface CapacityRow {
  developerId: string
  name: string
  load: DeveloperLoad
}

interface CapacityGanttProps {
  rows: readonly CapacityRow[]
  bars: readonly CapacityBar[]
  /** Los compromisos sin estimar del periodo, agrupados por persona y dia. */
  pending: readonly PendingDay[]
  days: readonly string[]
  view: CapacityView
  /** El dia de hoy, para marcar la columna cuando el periodo lo contiene. */
  today: string
  /** El titulo de cada ticket, para rotular las barras y los pendientes. */
  titles: Readonly<Record<string, string>>
}

/**
 * El Gantt de capacidad: personas a la izquierda, dias a la derecha.
 *
 * **Es una vista de lectura y no tiene una sola interaccion.** No se pulsa, no se arrastra, no se
 * edita y no escribe: los bloques son el plan guardado, pintado. La accion vive en el Timeline, que
 * es donde se declara y se renegocia.
 *
 * **Los colores no se definen aqui.** Las barras toman `STATES[state]` y las banderas `RISK[risk]`
 * de `lib/timelineVisuals`, el unico dueño de la paleta: la misma tarea tiene el mismo azul en las
 * dos pantallas porque es literalmente la misma cadena de clases, importada de un solo sitio.
 *
 * **La columna de personas queda fija** mientras el eje se desplaza en horizontal, que es lo que
 * permite leer un trimestre sin perder de vista de quien es cada fila.
 */
export function CapacityGantt({
  rows,
  bars,
  pending,
  days,
  view,
  today,
  titles,
}: CapacityGanttProps) {
  const dayWidth = DAY_WIDTH[view]
  const axisWidth = days.length * dayWidth
  const todayIndex = days.indexOf(today)

  const barsByDeveloper = new Map<string, CapacityBar[]>()
  const pendingByDeveloper = new Map<string, PendingDay[]>()

  for (const bar of bars) {
    const own = barsByDeveloper.get(bar.developerId)

    if (own) {
      own.push(bar)
    } else {
      barsByDeveloper.set(bar.developerId, [bar])
    }
  }

  for (const day of pending) {
    const own = pendingByDeveloper.get(day.developerId)

    if (own) {
      own.push(day)
    } else {
      pendingByDeveloper.set(day.developerId, [day])
    }
  }

  return (
    <div
      data-slot="capacity-gantt"
      className="overflow-x-auto rounded-xl border border-border bg-card"
    >
      <div style={{ minWidth: LEFT_WIDTH + axisWidth }}>
        {/* Cabecera: las semanas agrupan los dias, que son las columnas del eje. */}
        <div className="flex border-b border-border">
          <div
            className="sticky left-0 z-20 shrink-0 border-r border-border bg-card px-4 py-2 text-xs font-medium text-muted-foreground"
            style={{ width: LEFT_WIDTH }}
          >
            Desarrollador
          </div>

          <div style={{ width: axisWidth }}>
            <div className="flex border-b border-border/60">
              {weeksOf(days).map((week) => (
                <div
                  key={week.start}
                  className="shrink-0 border-r border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground"
                  style={{ width: week.days * dayWidth }}
                >
                  {weekShortLabel(week.start)}
                </div>
              ))}
            </div>

            <div className="flex" style={columnsBackground(dayWidth)}>
              {days.map((day) => (
                <div
                  key={day}
                  className={cn(
                    'shrink-0 border-r border-border/40 py-1 text-center text-[10px] tabular-nums',
                    isWeekend(day)
                      ? 'bg-muted/50 text-muted-foreground/70'
                      : 'text-muted-foreground',
                  )}
                  style={{ width: dayWidth }}
                >
                  {dayLabel(day, view)}
                </div>
              ))}
            </div>
          </div>
        </div>

        {rows.map((row) => {
          const ownBars = barsByDeveloper.get(row.developerId) ?? []
          const ownPending = pendingByDeveloper.get(row.developerId) ?? []
          const lanes = laneCount(ownBars)
          const pendingHeight = ownPending.length > 0 ? PENDING_HEIGHT : 0
          const height = ROW_PADDING * 2 + pendingHeight + lanes * LANE_HEIGHT

          return (
            <div key={row.developerId} className="flex border-b border-border/60 last:border-b-0">
              <div
                className="sticky left-0 z-10 shrink-0 border-r border-border bg-card px-4 py-2"
                style={{ width: LEFT_WIDTH }}
              >
                <PersonCell name={row.name} load={row.load} />
              </div>

              <div
                className="relative"
                style={{ width: axisWidth, height, ...columnsBackground(dayWidth) }}
              >
                {days.map((day, index) =>
                  isWeekend(day) ? (
                    <div
                      key={day}
                      aria-hidden="true"
                      className="absolute inset-y-0 bg-muted/40"
                      style={{ left: index * dayWidth, width: dayWidth }}
                    />
                  ) : null,
                )}

                {todayIndex >= 0 && (
                  <div
                    aria-hidden="true"
                    data-slot="capacity-today"
                    className="absolute inset-y-0 z-10 bg-primary/70"
                    style={{ left: todayIndex * dayWidth, width: 2 }}
                  />
                )}

                {ownPending.map((day) => (
                  <PendingMark
                    key={day.key}
                    day={day}
                    dayWidth={dayWidth}
                    top={ROW_PADDING}
                    titles={titles}
                  />
                ))}

                {ownBars.map((bar) => {
                  const top = ROW_PADDING + pendingHeight + bar.lane * LANE_HEIGHT

                  return (
                    <Fragment key={bar.key}>
                      <Bar
                        bar={bar}
                        dayWidth={dayWidth}
                        top={top}
                        height={LANE_HEIGHT - 6}
                        title={titles[bar.workItemId]}
                      />

                      {/*
                        En el mes una barra de un día mide 38 px y no cabe texto dentro: el rótulo
                        sale a su derecha, que es donde un Gantt lo pone. **En el trimestre no sale**:
                        a 18 px por día, dos trabajos de la misma semana dejan 36 px entre barras y
                        las etiquetas se pisarían; ahí el nombre viaja en el tooltip y la barra dice
                        solo la fecha, que es para lo que existe esa escala.
                      */}
                      {barWidth(bar, dayWidth) < 56 && dayWidth >= 32 && (
                        <span
                          data-slot="capacity-bar-caption"
                          aria-hidden="true"
                          className="pointer-events-none absolute z-[4] max-w-40 truncate text-[10px] leading-none text-muted-foreground"
                          style={{
                            left: (bar.endIndex + 1) * dayWidth + 4,
                            top: top + 9,
                          }}
                        >
                          {shortName(titles[bar.workItemId], bar.workItemType)}
                        </span>
                      )}
                    </Fragment>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * La ficha de una persona: nombre, ocupacion y horas libres. Lo que el negocio pidio leer.
 *
 * La barra de ocupacion **es el porcentaje, no otro calculo**: su largo es `percent` recortado a
 * 100, y el chip de al lado dice la cifra exacta. Por encima del 100 la barra se llena y lleva un
 * remate rojo, porque una barra que siguiera creciendo se saldria de la celda.
 */
function PersonCell({ name, load }: { name: string; load: DeveloperLoad }) {
  const band = occupancyBand(load.percent)
  const tones = BAND[band]
  const filled = load.percent === null ? 0 : Math.min(100, Math.max(0, load.percent))
  const overflow = load.percent !== null && load.percent > 100

  return (
    <div className="flex flex-col justify-center gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium" title={name}>
          {name}
        </span>

        <span
          data-slot="capacity-band"
          data-band={band}
          title={tones.label}
          className={cn(
            'inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
            tones.chip,
          )}
        >
          {load.percent === null ? 'Sin plan' : formatPercent(load.percent)}
        </span>
      </div>

      {load.percent !== null && (
        <div
          data-slot="capacity-load-bar"
          data-over={overflow ? 'true' : undefined}
          aria-hidden="true"
          className="flex h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <span className={cn('h-full rounded-full', tones.dot)} style={{ width: `${filled}%` }} />
          {overflow && <span className="h-full w-1.5 rounded-r-full bg-red-500" />}
        </div>
      )}

      <p className="truncate text-[11px] text-muted-foreground">
        {load.percent === null
          ? 'Sin plan vigente en el periodo'
          : `${formatHours(load.remainingHours)} h libres · ${load.jobs} ${load.jobs === 1 ? 'trabajo' : 'trabajos'} · ${formatHours(load.occupiedHours)}/${formatHours(load.availableHours)} h`}
      </p>
    </div>
  )
}

/**
 * Una barra: los dias que ocupa un trabajo, con su nombre corto, sus horas y su entrega.
 *
 * **El identificador de GLPI no se escribe en la barra**; viaja solo en el nombre accesible y en el
 * tooltip, que es donde un gestor lo busca cuando necesita rastrear la barra hasta el ticket.
 *
 * **La bandera marca la entrega**, que es la fecha que GLPI publica —el Internal TTR—, no el ultimo
 * dia del bloque: cuando las dos coinciden la bandera cae al final de la barra, y cuando no, la fecha
 * escrita al lado dice cuando vence. El color de la bandera sale del nivel de riesgo del Timeline.
 */
function Bar({
  bar,
  dayWidth,
  top,
  height,
  title,
}: {
  bar: CapacityBar
  dayWidth: number
  top: number
  height: number
  title: string | undefined
}) {
  const width = barWidth(bar, dayWidth)
  const name = shortName(title, bar.workItemType)
  const type = TYPE_LABEL[bar.workItemType]
  const state = STATES[bar.state]
  const risk = bar.risk !== null && bar.risk !== 'FUTURA' ? RISK[bar.risk] : null
  const delivery = bar.delivery ? SHORT_DATE.format(parseLocalDateTime(bar.delivery)) : null
  const description = [
    `${type} ${bar.workItemId} · ${name}`,
    `${formatHours(bar.hours)} h de ${formatHours(bar.estimatedHours)} h estimadas · ${bar.days} ${bar.days === 1 ? 'dia' : 'dias'}`,
    state.label,
    bar.delivery ? `Entrega ${formatDay(bar.delivery)}` : null,
    risk?.label ?? null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      data-slot="capacity-bar"
      data-work-item={bar.workItemId}
      data-developer={bar.developerId}
      data-state={bar.state}
      title={description}
      className={cn(
        'absolute z-[5] flex items-center overflow-hidden rounded-md border shadow-sm ring-1 ring-inset ring-white/40',
        state.block,
      )}
      style={{
        left: bar.startIndex * dayWidth + 1,
        width: Math.max(width, 3),
        top,
        height,
      }}
    >
      {/*
        **Lo que cabe decide cuantas lineas lleva la barra.** Con dos dias o mas (206 px) todo cabe
        en una linea: nombre, horas, bandera y fecha. Con uno —102 px en la escala semanal— no cabe,
        y antes el nombre se quedaba en tres letras; ahora baja a una segunda linea, que es alto que
        la barra ya tenia. Por debajo de 90 px solo queda el nombre y la bandera, y por debajo de
        56, la bandera sola: lo que no cabe se lee en el tooltip, que lleva siempre el detalle.
      */}
      {width >= 128 && (
        <span className="flex min-w-0 items-center gap-1 px-1.5 text-[11px] leading-none">
          <span className="truncate font-semibold">{name}</span>
          <span className="shrink-0 tabular-nums opacity-70">{formatHours(bar.hours)} h</span>

          {delivery && (
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              <DeliveryFlag risk={bar.risk} />
              <span className={cn('text-[10px] tabular-nums', risk?.flag ?? 'text-emerald-700')}>
                {delivery}
              </span>
            </span>
          )}
        </span>
      )}

      {width >= 90 && width < 128 && delivery && (
        <span className="flex min-w-0 flex-col justify-center gap-0.5 px-1.5 leading-none">
          <span className="truncate text-[11px] font-semibold">{name}</span>
          <span className="flex items-center gap-1 text-[9px]">
            <span className="shrink-0 tabular-nums opacity-70">{formatHours(bar.hours)} h</span>
            <DeliveryFlag risk={bar.risk} />
            <span className={cn('truncate tabular-nums', risk?.flag ?? 'text-emerald-700')}>
              {delivery}
            </span>
          </span>
        </span>
      )}

      {width >= 56 && (width < 90 || (width < 128 && !delivery)) && (
        <span className="flex min-w-0 items-center gap-1 px-1.5 text-[11px] leading-none">
          <span className="truncate font-semibold">{name}</span>
          {delivery && <DeliveryFlag risk={bar.risk} />}
        </span>
      )}

      {width < 56 && delivery && (
        <span className="mx-auto flex items-center">
          <DeliveryFlag risk={bar.risk} />
        </span>
      )}

      <span className="sr-only">{description}</span>
    </div>
  )
}

/**
 * Un compromiso sin estimar, en el dia en que GLPI lo ubica.
 *
 * **No es una barra**: no ocupa jornada, no tiene horas y no está en el plan. Se pinta con el gris
 * punteado del estado «Requiere estimación» del Timeline, que es su mismo significado, y con la
 * cuenta del dia —hoy un dia puede tener diez—. Los tickets concretos van en el tooltip.
 */
function PendingMark({
  day,
  dayWidth,
  top,
  titles,
}: {
  day: PendingDay
  dayWidth: number
  top: number
  titles: Readonly<Record<string, string>>
}) {
  const list = day.items
    .map((item) => `${item.workItemId} · ${shortName(titles[item.workItemId], item.workItemType)}`)
    .join('\n')
  const date = day.items[0]?.date
  const description = `${day.count} sin estimar${date ? ` el ${formatDay(date)}` : ''}:\n${list}`

  return (
    <div
      data-slot="capacity-pending"
      data-developer={day.developerId}
      data-count={day.count}
      title={description}
      className={cn(
        'absolute z-[6] flex items-center gap-1 overflow-hidden rounded-md border border-dashed px-1 text-[10px] font-medium',
        STATES.SIN_ESTIMACION.block,
      )}
      style={{
        left: day.dayIndex * dayWidth + 2,
        width: Math.max(dayWidth - 4, 18),
        top,
        height: PENDING_HEIGHT - 6,
      }}
    >
      {dayWidth >= 60 && <CircleDashed className="size-3 shrink-0" aria-hidden="true" />}
      <span className="tabular-nums">{day.count}</span>
      <span className="sr-only">{description}</span>
    </div>
  )
}

/** La bandera de entrega: el icono del riesgo del Timeline, o la bandera verde cuando hay margen. */
function DeliveryFlag({ risk }: { risk: CommitmentRisk | null }) {
  const mark = risk !== null && risk !== 'FUTURA' ? RISK[risk] : null
  const Icon = mark?.icon ?? Flag

  return (
    <Icon
      data-slot="capacity-delivery"
      className={cn('size-3 shrink-0', mark?.flag ?? 'text-emerald-600')}
      aria-hidden="true"
    />
  )
}

/** El ancho de una barra en pixeles, con el margen de un pixel a cada lado. */
function barWidth(bar: CapacityBar, dayWidth: number): number {
  return (bar.endIndex - bar.startIndex + 1) * dayWidth - 2
}

/** Las semanas del eje, agrupando dias consecutivos. */
function weeksOf(days: readonly string[]): { start: string; days: number }[] {
  const weeks: { start: string; days: number }[] = []

  for (const day of days) {
    const start = weekStartOf(day)
    const last = weeks[weeks.length - 1]

    if (last?.start === start) {
      last.days += 1
    } else {
      weeks.push({ start, days: 1 })
    }
  }

  return weeks
}

function isWeekend(day: string): boolean {
  const weekday = parseLocalDateTime(day).getDay()
  return weekday === 0 || weekday === 6
}

/**
 * La etiqueta de un dia.
 *
 * La semana enseña dia de la semana y fecha; el mes y el trimestre solo el numero, porque a 40 y a
 * 18 px no cabe mas. En el trimestre se rotula el lunes y el dia primero para no llenar el eje de
 * numeros que no se pueden leer.
 */
function dayLabel(day: string, view: CapacityView): string {
  if (view === 'semana') {
    return formatDay(day)
  }

  const date = parseLocalDateTime(day)

  if (view === 'trimestre') {
    return date.getDay() === 1 || date.getDate() === 1 ? String(date.getDate()) : ''
  }

  return String(date.getDate())
}

/** Las lineas verticales de cada dia, sin un div por columna. */
function columnsBackground(dayWidth: number) {
  return {
    backgroundImage:
      'repeating-linear-gradient(to right, transparent 0, transparent calc(100% - 1px), var(--color-border) calc(100% - 1px), var(--color-border) 100%)',
    backgroundSize: `${dayWidth}px 100%`,
  }
}
