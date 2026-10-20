import { AlertTriangle, ClipboardList } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  capacityOn,
  countOf,
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
  // La causa completa va en el texto: el tramo puede ser demasiado bajo para pintarla, y esconderla
  // porque no cabe no es lo mismo que no tenerla.
  if (item.displacement) {
    parts.push(
      `Movido de ${formatDay(item.displacement.originalDate)} a ${formatDay(item.displacement.newDate)}: ${item.displacement.reason}`,
    )
  }

  return parts.join(' · ')
}

/** Fecha corta `dd/mm` para el tramo, donde no cabe el día completo. */
function shortDate(isoDay: string): string {
  return `${isoDay.slice(8, 10)}/${isoDay.slice(5, 7)}`
}

interface BlockProps {
  item: TimelineItem
  axis: HourAxis
  hourHeight: number
  /** Sin esto el tramo es de solo lectura, que es lo que era antes del timeline accionable. */
  onSelect?: (item: TimelineItem) => void
  selected?: boolean
  /**
   * La fecha a la que la simulación movería este tramo, si la simulación lo afecta.
   *
   * `undefined` es «no lo afecta»; `null`, «lo afecta y no hay día hábil donde moverlo». Es la
   * distinción que necesita la marca: un tramo sin fecha propuesta no se pinta como si la tuviera.
   */
  displacedTo?: string | null
}

/**
 * Alturas a partir de las cuales cabe cada línea del tramo.
 *
 * El bloque mide lo que dura, y en la densidad compacta una hora son 26 px. En vez de recortar el
 * texto a media línea se deja de pintar lo que no cabe: el identificador siempre cabe, la hora desde
 * los 34 px y las etiquetas desde los 54. El resto sigue en el `title` del bloque.
 */
const MIN_TIME_HEIGHT = 34
const MIN_BADGES_HEIGHT = 54

function Block({ item, axis, hourHeight, onSelect, selected, displacedTo }: BlockProps) {
  const status = STATUS[item.planningStatus]
  const Icon = TYPE[item.workItemType].icon
  const demo = displacedTo !== undefined

  const start = minutesOfDay(item.startsAt)
  const end = minutesOfDay(item.endsAt)
  const height = Math.max(((end - start) / 60) * hourHeight, MIN_BLOCK_HEIGHT)
  const cause = item.displacement

  const style = {
    top: ((start - axis.startMinutes) / 60) * hourHeight,
    height,
  }

  const className = cn(
    'absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-xs',
    status.block,
    // Un tramo que la simulación mueve se marca con un contorno, no se mueve: lo que se ve sigue
    // siendo la agenda real, y la simulación es una capa encima que se puede quitar.
    demo && 'border-red-500 ring-2 ring-red-500 ring-offset-1',
  )

  const body = (
    <>
      <span className="flex items-center gap-1 font-medium">
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{item.workItemId}</span>
      </span>

      {height >= MIN_TIME_HEIGHT && (
        <span className="block truncate tabular-nums opacity-80">
          {formatTime(item.startsAt)}–{formatTime(item.endsAt)} · {formatHours(item.durationHours)} h
        </span>
      )}

      {/*
        La causa en el propio tramo: de qué fecha a qué fecha y, si se sabe, qué incidente la ocupó.
        Es lo que permite ver un desplazamiento sin abrir nada; el motivo completo queda en el título
        y en el panel de detalle.
      */}
      {cause && height >= MIN_TIME_HEIGHT && (
        <span className="block truncate font-mono opacity-80" data-slot="timeline-cause">
          {shortDate(cause.originalDate)} → {shortDate(cause.newDate)}
          {cause.incidentId ? ` · ${cause.incidentId}` : ''}
        </span>
      )}

      {/* La capa de simulación dice a dónde iría el tramo; la fecha real no se toca. */}
      {demo && height >= MIN_TIME_HEIGHT && (
        <span className="block truncate font-semibold" data-slot="timeline-demo-displacement">
          DEMO → {displacedTo ? shortDate(displacedTo) : 'sin hueco'}
        </span>
      )}

      {height >= MIN_BADGES_HEIGHT && (
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          <Badge variant={status.variant}>{status.label}</Badge>
          {item.severity && <Badge variant={SEVERITY[item.severity]}>{item.severity}</Badge>}
        </span>
      )}
    </>
  )

  const title = demo
    ? `${describe(item)} · SIMULADO: se movería a ${displacedTo ?? 'ningún día hábil de la ventana'}`
    : describe(item)

  if (!onSelect) {
    return (
      <div
        data-slot="timeline-block"
        data-status={item.planningStatus}
        data-demo={demo ? 'true' : undefined}
        title={title}
        className={className}
        style={style}
      >
        {body}
      </div>
    )
  }

  /*
   * Un tramo con acción se pinta como botón y no como caja con un `onClick`: así llega con el tabulador
   * y el lector de pantalla lo anuncia como lo que es. La agenda de un plan, que no pasa `onSelect`,
   * sigue siendo la misma caja de antes.
   */
  return (
    <button
      type="button"
      data-slot="timeline-block"
      data-status={item.planningStatus}
      data-demo={demo ? 'true' : undefined}
      aria-pressed={selected ?? false}
      title={title}
      onClick={() => onSelect(item)}
      className={cn(
        className,
        'cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'ring-2 ring-ring',
      )}
      style={style}
    >
      {body}
    </button>
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

/**
 * Los dias en que **ningun** recurso tiene jornada.
 *
 * El backend calcula `availableHours` con el calendario congelado del plan, asi que un dia no
 * laborable llega con cero disponible —y cero ocupado, porque el motor no coloca trabajo fuera de la
 * jornada—. No hay que leer el calendario para saberlo: ya esta en la respuesta que la pagina pide
 * desde siempre.
 *
 * Se exige que el dia traiga al menos una fila: un dia que solo aparece por un tramo, sin capacidad
 * que lo respalde, no es un dia cerrado —es un dia del que esta vista no sabe nada—, y marcarlo
 * afirmaria algo que nadie publico.
 */
function nonWorkingDays(
  resources: readonly TimelineResource[],
  days: readonly string[],
): ReadonlySet<string> {
  const rows = resources.flatMap((resource) => resource.capacity)

  return new Set(
    days.filter((day) => {
      const onDay = rows.filter((row) => row.date === day)
      return onDay.length > 0 && onDay.every((row) => row.availableHours === 0)
    }),
  )
}

/**
 * El incidente simulado que la rejilla pinta encima de la agenda real.
 *
 * **No es un dato.** Nada de esto viaja al backend ni se guarda: el estado vive en la pantalla y se
 * pierde al recargar. La rejilla solo lo usa para marcar el día y los tramos que la simulación
 * movería, sin tocar los tramos que recibió.
 */
export interface TimelineSimulation {
  developerId: string
  date: string
  hours: number
  severity: IncidentSeverity
  /** La capacidad publicada del día, para poder enseñar cuánto queda después del incidente. */
  availableHours: number
  /** Lo que quedaría libre; negativo si no cabe ni vaciando el día. */
  remainingAfter: number
  /** Clave `workItemId@startsAt` → fecha propuesta. `null` si no hay día hábil en la ventana. */
  displaced: ReadonlyMap<string, string | null>
}

interface TimelineGridProps {
  resources: readonly TimelineResource[]
  items: readonly TimelineItem[]
  /**
   * Nombre a mostrar por desarrollador. La respuesta solo trae el identificador —el padrón es otra
   * lectura—, así que quien lo tenga lo pasa; sin entrada se enseña el identificador, que es lo que
   * esta rejilla hacía siempre.
   */
  names?: Readonly<Record<string, string>>
  /**
   * Cuántos pendientes tiene cada desarrollador. No son tramos y por eso no se pintan en la rejilla:
   * van en su fila, como aviso de que ahí hay trabajo sin colocar.
   */
  pending?: Readonly<Record<string, number>>
  /**
   * De esos pendientes, cuántos se desbloquean declarando. Es lo que convierte el aviso de la fila
   * en una acción: no solo hay trabajo sin colocar, hay una parte que una llamada puede recuperar.
   */
  recoverable?: Readonly<Record<string, number>>
  /**
   * A dónde lleva el nombre de cada persona. Sin entrada el nombre sigue siendo texto.
   *
   * Es lo que hace que una fila «Sin plan» sea accionable: el contador dice cuántos faltan, la
   * declaración dice exactamente cuáles y qué le falta a cada uno.
   */
  nameLinks?: Readonly<Record<string, string>>
  /** Nombre accesible de la región. Por defecto, la agenda de un plan. */
  label?: string
  /**
   * Las columnas del eje, cuando quien llama ya las calculó sobre el universo completo.
   *
   * **Es lo que mantiene fija la ventana al filtrar.** Si la rejilla derivara los días de las filas
   * que recibe, buscar a una persona sin plan acortaría el calendario y las columnas se moverían con
   * cada tecla. Sin esta prop, se derivan de los recursos y los tramos, que es lo que hacía siempre.
   */
  dayColumns?: readonly string[]
  /**
   * Con qué densidad abre la rejilla, de `0` (compacta) a `2` (amplia). Por defecto, normal.
   *
   * En la agenda de un plan hay una sola fila y el detalle importa; en la del equipo hay una fila
   * por persona y lo que importa es cuántas se ven de un vistazo, así que esa vista abre compacta.
   * Es el mismo control —sigue en pantalla—, solo cambia el valor inicial.
   */
  initialZoom?: 0 | 1 | 2
  /**
   * Qué hacer al elegir un tramo. Sin esto la rejilla es de solo lectura, que es lo que era.
   *
   * Es lo que convierte el timeline en el sitio donde se trabaja y no solo donde se mira: el panel
   * de detalle y las acciones —declarar, renegociar, abrir— cuelgan de la selección.
   */
  onSelect?: (item: TimelineItem) => void
  /** El tramo elegido, por su clave `workItemId@startsAt`. Solo sirve para marcarlo. */
  selected?: string | null
  /**
   * El incidente simulado, si hay uno. Se pinta como una capa de demostración y **no altera ni los
   * recursos ni los tramos**: al quitarlo, la rejilla vuelve a ser exactamente la misma.
   */
  simulation?: TimelineSimulation
}

/**
 * Rejilla de la agenda: una fila por recurso, una columna por dia y los tramos posicionados por
 * hora.
 *
 * Es CSS Grid y no una libreria de scheduling a proposito: mientras el licenciamiento no este
 * decidido, la vista se sostiene con lo que ya hay. Sustituir este componente por FullCalendar o
 * vis-timeline no cambia ni el contrato ni el backend.
 */
export function TimelineGrid({
  resources,
  items,
  names,
  pending,
  recoverable,
  nameLinks,
  label,
  dayColumns,
  initialZoom = 1,
  onSelect,
  selected,
  simulation,
}: TimelineGridProps) {
  const [zoom, setZoom] = useState<number>(initialZoom)

  /** El marco que scrollea. La simulación se lleva a la vista dentro de él, no en la página. */
  const scrollRef = useRef<HTMLDivElement>(null)

  const { hourHeight, dayWidth } = ZOOM[zoom]
  const computedDays = useMemo(() => timelineDays(resources, items), [resources, items])
  const days = dayColumns ?? computedDays
  const axis = useMemo(() => hourAxis(items), [items])
  const closed = useMemo(() => nonWorkingDays(resources, days), [resources, days])

  /*
   * Al simular, el incidente aparece en su día —que en una ventana de cuatro meses puede estar a
   * más de trece mil píxeles a la derecha—. Sin esto la demostración se calcula bien y no se ve, que
   * es indistinguible de no haberla hecho: se centra la celda del incidente dentro del marco.
   */
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || !simulation) return

    const frame = window.requestAnimationFrame(() => {
      const cell = scroller.querySelector<HTMLElement>(
        '[data-slot="timeline-cell"][data-demo="true"]',
      )
      if (!cell) return

      const cellRect = cell.getBoundingClientRect()
      const frameRect = scroller.getBoundingClientRect()

      scroller.scrollLeft +=
        cellRect.left - frameRect.left - (scroller.clientWidth - cellRect.width) / 2
      scroller.scrollTop +=
        cellRect.top - frameRect.top - (scroller.clientHeight - cellRect.height) / 2
    })

    return () => window.cancelAnimationFrame(frame)
  }, [simulation, zoom, days.length])

  const bodyHeight = ((axis.endMinutes - axis.startMinutes) / 60) * hourHeight
  const hourMarks: number[] = []
  for (let mark = axis.startMinutes; mark <= axis.endMinutes; mark += 60) {
    hourMarks.push(mark)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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

        {/*
          La leyenda explica las tres marcas que la rejilla usa y no explica sola. El rojo no es un
          error de la vista: es lo ocupado por encima de lo disponible, o sea una contradiccion del
          plan con su propio contexto, y por eso se enseña en vez de recortarse.
        */}
        <ul
          data-slot="timeline-legend"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          <li className="flex items-center gap-1.5">
            <span className="h-1.5 w-6 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            Ocupado sobre lo disponible
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-1.5 w-6 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
            Ocupado por encima: el plan contradice su contexto
          </li>
          <li className="flex items-center gap-1.5">
            <span
              className="size-3 shrink-0 rounded-xs border border-border bg-muted"
              aria-hidden="true"
            />
            Día no laborable
          </li>
        </ul>
      </div>

      {/*
        El marco scrollea en los dos ejes. `overflow-x-auto` a secas convertía este div en el
        contenedor de scroll horizontal y el encabezado no podía quedarse pegado al hacer scroll
        vertical en la página: no era el suyo. Con el alto máximo aquí, el scroll vertical ocurre
        dentro del marco y el encabezado temporal se queda arriba mientras las filas pasan debajo,
        sin necesidad de sincronizar dos scrolls a mano.
      */}
      <div
        role="region"
        aria-label={label ?? 'Agenda del plan'}
        data-slot="timeline-scroll"
        ref={scrollRef}
        className="max-h-[70vh] overflow-auto rounded-lg border border-border"
      >
        <div className="min-w-max">
          {/*
            El encabezado es sticky y con fondo sólido: los tramos pasan por debajo al scrollear y
            una franja translúcida los dejaría verse entre las fechas. La esquina queda por encima
            de las dos capas (z-30) para que al hacer scroll horizontal las fechas se deslicen por
            debajo de «Recurso» en vez de pintarse encima.
          */}
          <div
            data-slot="timeline-header"
            className="sticky top-0 z-20 flex border-b border-border bg-muted"
          >
            <div
              data-slot="timeline-corner"
              className="sticky left-0 z-30 flex w-44 shrink-0 items-center border-r border-border bg-muted px-3 py-2 text-xs font-medium"
            >
              Recurso
            </div>
            {days.map((day) => (
              <div
                key={day}
                data-slot="timeline-day"
                // La marca de la prueba: el dia cerrado se reconoce por el dato, no por el color.
                data-working={closed.has(day) ? 'false' : 'true'}
                style={{ width: dayWidth }}
                className="shrink-0 border-r border-border bg-muted px-2 py-2 last:border-r-0"
              >
                <p className="truncate text-xs font-medium capitalize">{formatDay(day)}</p>
                {closed.has(day) && <p className="truncate text-[10px]">no laborable</p>}
              </div>
            ))}
          </div>

          {resources.map((resource) => {
            const resourceItems = items.filter((item) => item.developerId === resource.developerId)
            // El indice es de esta fila y no de todo el equipo: agrupado por fecha sin mirar de quien
            // es cada tramo, cada fila pintaba los de todas.
            const resourceByDate = itemsByDate(resourceItems)
            const waiting = pending?.[resource.developerId] ?? 0
            const recovering = recoverable?.[resource.developerId] ?? 0

            return (
              <div
                key={resource.developerId}
                data-slot="timeline-resource"
                className="flex border-b border-border last:border-b-0"
              >
                <div className="sticky left-0 z-10 flex w-44 shrink-0 flex-col justify-center gap-0.5 border-r border-border bg-card px-3 py-2">
                  {nameLinks?.[resource.developerId] ? (
                    <Link
                      to={nameLinks[resource.developerId]}
                      className="truncate text-xs font-medium underline-offset-2 hover:underline"
                      title={`Abrir la declaración de ${names?.[resource.developerId] ?? resource.developerId}.`}
                    >
                      {names?.[resource.developerId] ?? resource.developerId}
                    </Link>
                  ) : (
                    <span className="truncate text-xs font-medium" title={resource.developerId}>
                      {names?.[resource.developerId] ?? resource.developerId}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    {/* La persona simulada se marca en su propia fila: si el día queda fuera de la
                        vista, la fila sigue diciendo que lo que hay ahí es una demostración. */}
                    {simulation?.developerId === resource.developerId && (
                      <Badge variant="danger" data-slot="timeline-demo-row">
                        DEMO
                      </Badge>
                    )}
                    {/* Una fila sin capacidad es una persona que el equipo tiene y que hoy no tiene
                        plan: el backend publica la capacidad de todo plan vigente, aunque no tenga
                        tramos. Se dice «Sin plan» y no «0 tramos» para no afirmar que se miró un
                        plan que no existe. */}
                    {resource.capacity.length === 0 ? (
                      <Badge variant="secondary" data-slot="timeline-no-plan">
                        Sin plan
                      </Badge>
                    ) : (
                      countOf(resourceItems.length, 'tramo', 'tramos')
                    )}
                    {waiting > 0 && (
                      <Badge variant="warning" data-slot="timeline-pending">
                        {waiting} {waiting === 1 ? 'pendiente' : 'pendientes'}
                      </Badge>
                    )}
                    {recovering > 0 && (
                      <span data-slot="timeline-recoverable" className="text-[10px]">
                        {countOf(recovering, 'recuperable', 'recuperables')}
                      </span>
                    )}
                  </span>
                </div>

                {days.map((day, dayIndex) => {
                  // El día del incidente simulado, solo en la fila de la persona elegida. La franja de
                  // capacidad es de alto fijo, así que sustituirla por el aviso no desalinea las
                  // horas de esta celda con las de las demás.
                  const demoHere =
                    simulation?.developerId === resource.developerId && simulation.date === day

                  return (
                    <div
                      key={day}
                      data-slot="timeline-cell"
                      data-working={closed.has(day) ? 'false' : 'true'}
                      data-demo={demoHere ? 'true' : undefined}
                      style={{ width: dayWidth }}
                      className={cn(
                        'shrink-0 border-r border-border last:border-r-0',
                        closed.has(day) && 'bg-muted/40',
                        demoHere && 'bg-red-50/50',
                      )}
                    >
                      {demoHere && simulation ? (
                        <div
                          data-slot="timeline-demo-incident"
                          className="flex h-10 flex-wrap content-center items-center gap-1 bg-red-100 px-2 py-1 text-[10px] font-semibold text-red-900"
                        >
                          <span className="rounded-xs bg-red-600 px-1 py-0.5 text-white">DEMO</span>
                          <span>
                            incidente {formatHours(simulation.hours)} h · {simulation.severity}
                          </span>
                          {/* La capacidad ya consumida se ve en el sitio donde se consume: lo que
                              queda después del incidente, no la capacidad intacta del plan. */}
                          <span
                            className="font-normal"
                            data-slot="timeline-demo-capacity"
                          >
                            {simulation.remainingAfter >= 0
                              ? `quedan ${formatHours(simulation.remainingAfter)} h de ${formatHours(simulation.availableHours)}`
                              : 'no cabe ni vaciando el día'}
                          </span>
                        </div>
                      ) : (
                        <CapacityStrip capacity={capacityOn(resource, day)} />
                      )}

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

                        {(resourceByDate.get(day) ?? []).map((item) => (
                          <Block
                            key={`${item.workItemId}-${item.startsAt}`}
                            item={item}
                            axis={axis}
                            hourHeight={hourHeight}
                            onSelect={onSelect}
                            selected={selected === `${item.workItemId}@${item.startsAt}`}
                            displacedTo={
                              demoHere
                                ? simulation?.displaced.get(`${item.workItemId}@${item.startsAt}`)
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
