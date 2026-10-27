import { AlertTriangle, CalendarClock, ClipboardList, Clock, Flag } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SEVERITY_VARIANTS } from '@/lib/severity'
import {
  addDays,
  blockState,
  capacityOn,
  countOf,
  dayPositions,
  formatDay,
  formatHours,
  formatTime,
  formatWeek,
  hourAxis,
  itemDate,
  itemsByDate,
  localTodayIso,
  minutesOfDay,
  timelineDays,
  weekAnchor,
  weekDaysOf,
  weekStartOf,
} from '@/lib/timeline'
import { cn } from '@/lib/utils'
import type { DayPosition, HourAxis } from '@/lib/timeline'
import type { BadgeVariant } from '@/components/ui/badge'
import type {
  CommitmentRisk,
  IncidentSeverity,
  TimelineCapacity,
  TimelineItem,
  TimelineResource,
  TimelineState,
  UnscheduledItem,
} from '@/types/timeline'

/**
 * Densidades del eje temporal. Es el "zoom basico" de la vista: solo cambian los pixeles, no
 * los datos ni el rango.
 */
const ZOOM = [
  { label: 'Compacta', hourHeight: 26, dayWidth: 132 },
  { label: 'Normal', hourHeight: 44, dayWidth: 168 },
  { label: 'Amplia', hourHeight: 72, dayWidth: 224 },
  /*
   * «Detalle» prioriza la lectura del tiempo, no el ancho: una hora son 120 px, así que media hora
   * mide lo que una fila de texto y un tramo de 30 minutos enseña sus horas, su duración y su
   * estado sin recortar nada. Las tres anteriores siguen sirviendo para ver el día entero de un
   * vistazo; esta es para leerlo.
   */
  { label: 'Detalle', hourHeight: 120, dayWidth: 210 },
] as const

/** Un tramo corto se queda sin sitio para su contenido; se le deja un minimo legible. */
const MIN_BLOCK_HEIGHT = 18

/** Cuantos pixeles del tramo simulado se enseñan al simular; el resto queda para el panel. */
const REVEAL = 200

/**
 * La paleta de los seis estados, en un solo sitio.
 *
 * **Cada estado tiene un color que ningún otro usa**, porque el color es lo único que un tramo de
 * dos líneas puede decir antes de que alguien lo lea: azul es «está donde debe», ámbar «el plan lo
 * movió», violeta «espera una decisión de una persona», verde y verde azulado «ya hay acuerdo» —uno
 * lo concilió el sistema y otro lo firmó alguien—, y gris punteado «no se puede planificar todavía».
 *
 * **El gris no es el color del error**: un ticket sin estimación no está mal, está incompleto, y la
 * pantalla lo que hace es pedir el dato, no denunciarlo. El rojo queda para lo único que es un
 * error: capacidad ocupada por encima de la disponible, que ya se pinta en la franja del día.
 *
 * El estado no se decide aquí: llega resuelto por `blockState`, que cruza el plan con el acuerdo.
 */
const STATES: Record<TimelineState, { label: string; variant: BadgeVariant; block: string }> = {
  SIN_ESTIMACION: {
    label: 'Requiere estimación',
    variant: 'secondary',
    block: 'border-dashed border-slate-400 bg-slate-50 text-slate-600',
  },
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
  PENDIENTE_DE_ACUERDO: {
    label: 'Pendiente de acuerdo',
    variant: 'warning',
    block: 'border-violet-400 bg-violet-50 text-violet-900',
  },
  ACORDADO_GLPI: {
    label: 'Acordado en GLPI',
    variant: 'success',
    block: 'border-emerald-400 bg-emerald-50 text-emerald-900',
  },
  ACORDADO_MANUAL: {
    label: 'Acordado manualmente',
    variant: 'success',
    block: 'border-teal-400 bg-teal-50 text-teal-900',
  },
}

/**
 * La capa de compromisos: cuánto apremia la fecha que GLPI publica.
 *
 * **Es un eje aparte del de {@link STATES} y no lo reemplaza.** El color del tramo dice qué hizo el
 * plan —lo colocó, lo movió, espera un acuerdo—; esto dice cuánto queda hasta la entrega. Un tramo
 * azul puede vencer hoy, y por eso el riesgo no repinta el bloque: le cambia el icono de entrega y
 * tiñe el chip del ticket que no tiene horas.
 *
 * `FUTURA` no está aquí porque no tiene marca: lo que no corre riesgo no se resalta, y una leyenda
 * que anunciara «todavía no vence» pintaría de excepción lo que es la norma.
 *
 * Los iconos no son decoración: sobreviven al daltonismo y a una captura en blanco y negro, que es
 * lo único que el color no hace.
 */
const RISK = {
  VENCIDA: {
    label: 'Entrega vencida',
    icon: AlertTriangle,
    chip: 'border-red-500 bg-red-50 text-red-900',
    flag: 'text-red-600',
    swatch: 'border-red-500 bg-red-50',
  },
  HOY: {
    label: 'Entrega hoy',
    icon: Clock,
    chip: 'border-orange-500 bg-orange-50 text-orange-900',
    flag: 'text-orange-600',
    swatch: 'border-orange-500 bg-orange-50',
  },
  PROXIMA: {
    label: 'Entrega próxima',
    icon: CalendarClock,
    chip: 'border-amber-500 bg-amber-50 text-amber-900',
    flag: 'text-amber-600',
    swatch: 'border-amber-500 bg-amber-50',
  },
} as const satisfies Record<
  Exclude<CommitmentRisk, 'FUTURA'>,
  { label: string; icon: typeof Flag; chip: string; flag: string; swatch: string }
>

/** El orden de la leyenda de riesgo: primero lo que ya se incumplió. */
const RISK_ORDER = ['VENCIDA', 'HOY', 'PROXIMA'] as const

/**
 * El orden en que se leen los estados: primero lo que falta, después lo que el plan decidió y al
 * final los acuerdos. Es el orden de la leyenda y el del recorrido de un gestor.
 */
const STATE_ORDER: readonly TimelineState[] = [
  'SIN_ESTIMACION',
  'PLANIFICADO',
  'DESPLAZADO',
  'PENDIENTE_DE_ACUERDO',
  'ACORDADO_GLPI',
  'ACORDADO_MANUAL',
]

const TYPE = {
  INCIDENTE: { label: 'Incidente', icon: AlertTriangle },
  REQUERIMIENTO: { label: 'Requerimiento', icon: ClipboardList },
} as const

/** Texto del tooltip nativo. La aplicacion no tiene componente de tooltip; el navegador basta. */
function describe(
  item: TimelineItem,
  state: TimelineState,
  position: DayPosition | undefined,
  risk?: CommitmentRisk,
): string {
  const parts = [
    `${TYPE[item.workItemType].label} ${item.workItemId}`,
    `${formatTime(item.startsAt)}–${formatTime(item.endsAt)} · ${formatHours(item.durationHours)} h de ${formatHours(item.estimatedHours)} h estimadas`,
    STATES[state].label,
  ]

  if (position && position.days > 1) {
    parts.push(
      position.delivery
        ? `Día ${position.day} de ${position.days} · entrega`
        : `Día ${position.day} de ${position.days} · continúa`,
    )
  } else if (position?.delivery) {
    parts.push('Día de entrega')
  }

  if (item.severity) {
    parts.push(`Severidad ${item.severity}`)
  }
  // El riesgo va con su fecha, porque el icono dice «vence» y no dice cuándo.
  if (risk !== undefined && risk !== 'FUTURA') {
    parts.push(RISK[risk].label)
  }
  if (item.committedDate) {
    // `committedDate` es el compromiso **declarado** del ticket, no la fecha de GLPI. La fecha que el
    // plan obedeció —el Internal TTR— no viaja en el tramo: lo que se ve es dónde la puso, y los dos
    // datos no siempre coinciden porque GLPI y la declaración se corrigen por vías distintas.
    parts.push(`Compromiso declarado ${formatDay(item.committedDate)}`)
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
  /** El estado visual ya resuelto: plan y acuerdo cruzados, nunca deducido aquí. */
  state: TimelineState
  /** En qué día de cuántos va. Indefinido cuando la rejilla no recibió la secuencia. */
  position?: DayPosition
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
  /**
   * Cuánto apremia el compromiso de GLPI de este trabajo.
   *
   * Se aplica **solo a la bandera del día de entrega**, no al relleno ni al borde: el color del
   * bloque es el estado del plan y cambiarlo por el riesgo borraría lo que el plan hizo. La marca
   * dice dos cosas a la vez —«aquí cierra» y «cuánto queda»— en el mismo icono, para no gastar el
   * poco alto que un tramo compacto tiene para texto.
   */
  risk?: CommitmentRisk
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

/**
 * Una hora del eje, en formato `HH:mm`.
 *
 * El eje ya no empieza y acaba en horas exactas —la jornada oficial cierra a las 17:30—, así que
 * la cuenta no puede suponer que los minutos son cero: `17.5:00` no es una hora.
 */
function clockLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function Block({
  item,
  axis,
  hourHeight,
  state,
  position,
  onSelect,
  selected,
  displacedTo,
  risk,
}: BlockProps) {
  const status = STATES[state]
  const Icon = TYPE[item.workItemType].icon
  /*
   * `FUTURA` no se pinta: lo que no corre riesgo no se resalta, y una marca en todos los tramos no
   * marcaría ninguno. El icono de entrega solo cambia cuando hay algo que decir.
   */
  const riskMark = risk !== undefined && risk !== 'FUTURA' ? RISK[risk] : null
  const DeliveryIcon = riskMark?.icon ?? Flag
  const demo = displacedTo !== undefined
  /*
   * Un trabajo de varios días se ve como varios tramos —el plan así lo guarda— y sin marca se leen
   * como trabajos distintos. `continues` dice que hay más después, y solo el último día es la
   * entrega: es el día en que el requerimiento cierra (`placed.getLast().date()` del motor), y no
   * hay que confundirlo con el día en que empieza.
   */
  const continues = position !== undefined && position.day < position.days
  const delivered = position?.delivery ?? false

  const start = minutesOfDay(item.startsAt)
  const end = minutesOfDay(item.endsAt)
  const naturalHeight = ((end - start) / 60) * hourHeight
  const height = Math.max(naturalHeight, MIN_BLOCK_HEIGHT)
  /*
   * El alto mínimo es una concesión de legibilidad, no una medida: un tramo de media hora mide
   * 13 px con el zoom compacto y se pinta con 18 para que se pueda tocar. La marca `clamped` deja
   * constancia de que ese borde inferior no es el final real del tramo.
   */
  const clamped = naturalHeight < MIN_BLOCK_HEIGHT
  const dense = height < MIN_TIME_HEIGHT
  const cause = item.displacement

  const style = {
    top: ((start - axis.startMinutes) / 60) * hourHeight,
    height,
  }

  const className = cn(
    // El `<button>` centra su contenido en vertical: en un tramo largo el texto flotaba a media
    // altura, lejos de la hora en la que empieza. Como columna, cada línea arranca en el borde
    // superior del tramo, que es donde está su hora de inicio.
    'absolute inset-x-1 flex flex-col overflow-hidden rounded-md border px-1.5 text-left text-[11px] leading-tight shadow-xs',
    dense ? 'py-0.5' : 'py-1',
    status.block,
    clamped && 'border-b border-dashed',
    // Un tramo que la simulación mueve se marca con un contorno, no se mueve: lo que se ve sigue
    // siendo la agenda real, y la simulación es una capa encima que se puede quitar.
    demo && 'border-red-500 ring-2 ring-red-500 ring-offset-1',
  )

  const body = (
    <>
      <span className="flex items-center gap-1 font-medium">
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{item.workItemId}</span>
        {/*
          Las horas no dependen de que el tramo sea alto: cuando no cabe la segunda línea se pintan
          en la primera, a la derecha. La escala de la rejilla nunca deja un bloque sin decir a qué
          hora empieza y a qué hora termina. La bandera del día de entrega cabe incluso en un tramo
          de 18 px, y es la marca que no puede faltar.
        */}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {delivered && (
            <DeliveryIcon
              data-slot="timeline-delivery"
              data-risk={riskMark ? risk : undefined}
              className={cn('size-3 shrink-0', riskMark?.flag)}
              aria-label={riskMark ? riskMark.label : 'Día de entrega'}
            />
          )}
          {dense && (
            <span
              data-slot="timeline-block-time"
              className="text-[9px] font-normal tabular-nums opacity-80"
            >
              {formatTime(item.startsAt)}–{formatTime(item.endsAt)}
            </span>
          )}
        </span>
      </span>

      {height >= MIN_TIME_HEIGHT && (
        <span className="block truncate tabular-nums opacity-80">
          {formatTime(item.startsAt)}–{formatTime(item.endsAt)} · {formatHours(item.durationHours)} h
          {position !== undefined && position.days > 1 && ` · día ${position.day} de ${position.days}`}
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
          {item.severity && <Badge variant={SEVERITY_VARIANTS[item.severity]}>{item.severity}</Badge>}
        </span>
      )}

      {/*
        Las dos marcas de la duración multidía, y por qué son dos.
        La barra inferior dice «aquí termina el trabajo» y es la única que puede faltar si el tramo
        es bajo, porque el borde inferior del bloque ya marca dónde acaba. El chevron dice que el
        trabajo sigue en la columna de al lado, que es lo que de otro modo se lee como dos tickets.
      */}
      {delivered && (
        <span
          aria-hidden="true"
          data-slot="timeline-delivery-bar"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-current opacity-60"
        />
      )}
      {continues && (
        <span
          aria-hidden="true"
          data-slot="timeline-continues"
          className="pointer-events-none absolute top-1/2 right-0.5 -translate-y-1/2 text-sm leading-none opacity-70"
        >
          ›
        </span>
      )}
      {position !== undefined && position.day > 1 && (
        <span
          aria-hidden="true"
          data-slot="timeline-continued"
          className="pointer-events-none absolute top-1/2 left-0.5 -translate-y-1/2 text-sm leading-none opacity-70"
        >
          ‹
        </span>
      )}
    </>
  )

  const title = demo
    ? `${describe(item, state, position, risk)} · SIMULADO: se movería a ${displacedTo ?? 'ningún día hábil de la ventana'}`
    : describe(item, state, position, risk)

  if (!onSelect) {
    return (
      <div
        data-slot="timeline-block"
        data-status={item.planningStatus}
        data-state={state}
        data-delivery={delivered ? 'true' : undefined}
        data-demo={demo ? 'true' : undefined}
        data-clamped={clamped ? 'true' : undefined}
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
      data-state={state}
      data-delivery={delivered ? 'true' : undefined}
      data-demo={demo ? 'true' : undefined}
      data-clamped={clamped ? 'true' : undefined}
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
  /*
   * Una fila de capacidad con cero disponible y cero ocupado es la jornada que esa persona no
   * tiene. Se dice «no laborable» en **su** celda, día por día: que un plan cierre el sábado no
   * significa que el de al lado también, y la vista no puede afirmarlo por el equipo entero.
   *
   * Sin fila de capacidad no se dice nada: `—` es «esta vista no sabe», no «no trabaja».
   */
  if (capacity && capacity.availableHours === 0 && capacity.occupiedHours === 0) {
    return (
      <div className="flex h-10 items-center px-2">
        <span
          data-slot="timeline-not-working"
          className="truncate text-[10px] text-muted-foreground"
        >
          no laborable
        </span>
      </div>
    )
  }

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
  /**
   * A dónde lleva el chip «N pendientes» de cada persona, cuando tiene uno solo.
   *
   * Es la diferencia entre un aviso y una acción: el número dice que hay trabajo sin colocar, y el
   * chip lleva al ticket ya abierto —a declararlo, a acordarlo o a replanificarlo, según su causa—,
   * sin que el gestor tenga que buscarlo por identificador en otra pantalla. La ruta la calcula
   * quien llama con `pendingPath`, la misma que usa la fila del panel de pendientes.
   */
  pendingLinks?: Readonly<Record<string, string>>
  /**
   * Qué hacer con el chip cuando la persona tiene **varios** pendientes: no hay un ticket que abrir,
   * así que quien llama filtra por esa persona el panel donde están todos.
   */
  onPendingSelect?: (developerId: string) => void
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
  initialZoom?: 0 | 1 | 2 | 3
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
   * El estado de cada elemento por ticket, cuando quien llama sabe más que el plan.
   *
   * La rejilla **no pregunta por los acuerdos**: pinta los tramos de un plan y no tiene la lista de
   * renegociaciones. Quien la tiene —el Timeline del equipo— la cruza con `agreementStates` y la
   * pasa hecha. Sin esta prop el estado es el del plan y la leyenda no menciona acuerdos, que es lo
   * correcto para el calendario de un plan suelto.
   */
  states?: Readonly<Record<string, TimelineState>>
  /**
   * Tickets con día de GLPI y sin horas: no están en el plan y hay que verlos igual.
   *
   * Se pintan en su día como una franja sin alto de tiempo: **no ocupan jornada y no suman
   * capacidad**, porque no son trabajo planificado. Quien los calcula es `unscheduledOf`, que filtra
   * los que ya están en el plan y los que no tienen fecha.
   */
  unscheduled?: readonly UnscheduledItem[]
  /**
   * Cuánto apremia el compromiso de GLPI de cada ticket, por identificador.
   *
   * **Es el segundo eje de la rejilla y no reemplaza a {@link states}.** El estado dice qué hizo el
   * plan; el riesgo dice cuánto queda hasta la fecha que GLPI publica. Se pinta encima de lo que ya
   * hay —el icono de entrega del tramo y el chip del ticket sin horas— y no repinta ningún relleno,
   * porque un bloque tiene un solo color y el del plan es el que no se puede perder.
   *
   * La calcula `commitmentRisksOf` sobre las declaraciones y **no se deriva del tramo**: un plan
   * guardado antes de que GLPI moviera la fecha coloca el trabajo en el día viejo, y leer el riesgo
   * de ahí diría «vencido» de un ticket que vence en diciembre.
   */
  risks?: Readonly<Record<string, CommitmentRisk>>
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
/**
 * El chip «N pendientes» de una fila.
 *
 * **Es la acción, no el aviso.** Con un solo pendiente es un enlace que lleva directo a donde ese
 * pendiente se resuelve —la misma ruta que la fila del panel—; con varios es un botón que filtra el
 * panel de pendientes por esa persona. Sin ninguna de las dos cosas sigue siendo un distintivo, que
 * es lo que ve el calendario de un plan, donde no hay panel al que llevar.
 */
function PendingChip({
  count,
  name,
  to,
  onSelect,
}: {
  count: number
  name: string
  to?: string
  onSelect?: () => void
}) {
  const label = `${count} ${count === 1 ? 'pendiente' : 'pendientes'}`
  const className = cn(
    'rounded-md hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  )

  if (to) {
    return (
      <Link to={to} data-slot="timeline-pending" title={`Abrir el pendiente de ${name}.`} className={className}>
        <Badge variant="warning">{label}</Badge>
      </Link>
    )
  }

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        data-slot="timeline-pending"
        title={`Ver ${count === 1 ? 'el pendiente' : `los ${count} pendientes`} de ${name} en el panel de trabajo pendiente.`}
        className={cn(className, 'cursor-pointer')}
      >
        <Badge variant="warning">{label}</Badge>
      </button>
    )
  }

  return (
    <Badge variant="warning" data-slot="timeline-pending">
      {label}
    </Badge>
  )
}

export function TimelineGrid({
  resources,
  items,
  names,
  pending,
  recoverable,
  nameLinks,
  pendingLinks,
  onPendingSelect,
  label,
  dayColumns,
  initialZoom = 1,
  onSelect,
  selected,
  simulation,
  states,
  unscheduled,
  risks,
}: TimelineGridProps) {
  const [zoom, setZoom] = useState<number>(initialZoom)

  /** El desplazamiento horizontal vivo: la cabecera se dibuja fuera del scroller y lo imita. */
  const [scrollLeft, setScrollLeft] = useState(0)

  /** El scroller horizontal de las filas. Es el único scroll propio de la rejilla. */
  const scrollRef = useRef<HTMLDivElement>(null)

  const { hourHeight, dayWidth } = ZOOM[zoom]
  const computedDays = useMemo(() => timelineDays(resources, items), [resources, items])
  const allDays = dayColumns ?? computedDays

  /*
   * La agenda se pinta por **semanas**, no por la ventana entera del plan: siete columnas de lunes
   * a domingo y tres controles para moverse. Antes había un horizonte de más de quince mil píxeles
   * y la única forma de navegarlo era el scroll horizontal, que es lo que esta fase quita como
   * mecanismo principal. La semana se puede seguir desplazando a lo ancho cuando el zoom la hace
   * más ancha que la pantalla, pero ya no es la forma de avanzar en el tiempo.
   */
  const today = useMemo(() => localTodayIso(), [])
  const anchor = useMemo(() => weekAnchor(allDays, today), [allDays, today])
  const [weekStart, setWeekStart] = useState(anchor)

  /*
   * Simular en un día que no está en la semana visible lleva la vista a su semana. La demostración
   * no puede desplazar trabajo sobre una semana que no está en pantalla: sería un resultado
   * invisible, indistinguible de no haber simulado nada. Se ajusta durante el render —el patrón de
   * React para estado derivado de una prop— y no en un efecto, que pintaría una semana y saltaría
   * a otra en el cuadro siguiente.
   */
  const [seenSimulation, setSeenSimulation] = useState(simulation)
  if (simulation !== seenSimulation) {
    setSeenSimulation(simulation)
    if (simulation && (simulation.date < weekStart || simulation.date > addDays(weekStart, 6))) {
      setWeekStart(weekStartOf(simulation.date))
    }
  }

  const days = useMemo(() => weekDaysOf(weekStart), [weekStart])

  // Los bordes de la ventana cargada: no se navega fuera de ella, porque ahí no hay nada que mirar.
  const firstWeek = weekStartOf(allDays[0] ?? today)
  const lastWeek = weekStartOf(allDays[allDays.length - 1] ?? today)

  const axis = useMemo(() => hourAxis(items), [items])

  /** En qué día de cuántos va cada tramo: es lo que convierte dos bloques sueltos en un trabajo. */
  const positions = useMemo(() => dayPositions(items), [items])

  /** Los tickets sin horas, por fila y día. Se agrupan una vez y no dentro del recorrido. */
  const ghostsByCell = useMemo(() => {
    const byCell = new Map<string, UnscheduledItem[]>()

    for (const ghost of unscheduled ?? []) {
      const key = `${ghost.developerId}|${ghost.date}`
      const bucket = byCell.get(key)

      if (bucket) {
        bucket.push(ghost)
      } else {
        byCell.set(key, [ghost])
      }
    }

    return byCell
  }, [unscheduled])

  /**
   * Los estados que de verdad se ven esta semana.
   *
   * La leyenda explica lo que hay en pantalla y nada más: una leyenda con los seis estados cuando
   * solo hay dos clases de bloque enseñaría cuatro colores que no existen, y el gestor los buscaría.
   */
  const presentStates = useMemo(() => {
    const present = new Set<TimelineState>()

    // Solo los del rango de columnas: `items` es el plan entero, y anunciar el color de un tramo
    // que está en otra semana es prometer un bloque que no se puede encontrar en pantalla.
    for (const item of items) {
      if (days.includes(itemDate(item))) {
        present.add(blockState(item, states))
      }
    }
    for (const ghost of unscheduled ?? []) {
      if (days.includes(ghost.date)) {
        present.add('SIN_ESTIMACION')
      }
    }

    return STATE_ORDER.filter((state) => present.has(state))
  }, [items, states, unscheduled, days])

  /**
   * Los riesgos que de verdad se ven esta semana.
   *
   * Misma regla que `presentStates`: la leyenda nombra lo que hay en pantalla. Anunciar «entrega
   * vencida» sin un solo vencido a la vista manda a buscarlo donde no está.
   */
  const presentRisks = useMemo(() => {
    const present = new Set<CommitmentRisk>()

    for (const item of items) {
      if (days.includes(itemDate(item)) && risks?.[item.workItemId]) {
        present.add(risks[item.workItemId]!)
      }
    }
    for (const ghost of unscheduled ?? []) {
      if (days.includes(ghost.date) && risks?.[ghost.workItemId]) {
        present.add(risks[ghost.workItemId]!)
      }
    }

    return RISK_ORDER.filter((risk) => present.has(risk))
  }, [items, unscheduled, risks, days])

  /**
   * Si hay algún ticket sin horas esta semana.
   *
   * La franja donde se enseña se reserva en **todas** las celdas de la semana o en ninguna: si solo
   * la reservara el día que tiene uno, la rejilla de las horas de esa columna empezaría veinte
   * píxeles más abajo y las filas dejarían de leerse en horizontal.
   */
  const hasGhosts = useMemo(
    () => (unscheduled ?? []).some((ghost) => days.includes(ghost.date)),
    [unscheduled, days],
  )

  /* Cambiar de semana empieza en su primer día y no donde quedó el desplazamiento de la anterior. */
  function goToWeek(next: string) {
    const scroller = scrollRef.current
    if (scroller) scroller.scrollLeft = 0
    setScrollLeft(0)
    setWeekStart(next)
  }

  /*
   * Al simular, el incidente aparece en su día —que puede ser otra semana, ya resuelta arriba—.
   * Sin esto la demostración se calcula bien y no se ve, que es indistinguible de no haberla
   * hecho: se centra la celda del incidente a lo ancho del marco. La vertical la gobierna la
   * página, así que aquí solo hay un eje que mover.
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
      // Se lee de vuelta porque el navegador recorta al máximo: la cabecera se pinta con este valor.
      setScrollLeft(scroller.scrollLeft)

      /*
       * La vertical la gobierna `main`, el único scroller de la página. Se enseña el principio del
       * tramo y no el tramo entero: subir hasta su final dejaría fuera el panel que cuenta qué se
       * movió, que es la otra mitad de la demostración. Nunca se desplaza hacia arriba.
       */
      const main = scroller.closest('main')
      if (main) {
        const hidden = cellRect.top + REVEAL - main.getBoundingClientRect().bottom
        if (hidden > 0) main.scrollTop += hidden
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [simulation, zoom, weekStart])

  /*
   * Cambiar de zoom cambia el ancho del contenido, y el desplazamiento puede quedar recortado sin
   * disparar `scroll`. Se vuelve a leer para que la cabecera no quede desalineada.
   */
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller) setScrollLeft(scroller.scrollLeft)
  }, [zoom])

  const bodyHeight = ((axis.endMinutes - axis.startMinutes) / 60) * hourHeight
  const hourMarks: number[] = []
  /*
   * Estrictamente menor que el final: la marca del último minuto caía justo en el borde inferior
   * de la fila —una línea que repetía la del borde— y su hora, dibujada con `top-0.5`, colgaba por
   * debajo y alargaba el contenido 19 px. Con un scroller que no scrollea en vertical, eso además
   * recortaba la etiqueta.
   */
  for (let mark = axis.startMinutes; mark < axis.endMinutes; mark += 60) {
    hourMarks.push(mark)
  }

  /*
   * Las medias horas solo cuando hay alto para distinguirlas: con el zoom compacto una hora son
   * 26 px y una línea cada 13 px sería ruido, no información.
   */
  const halfMarks: number[] = []
  if (hourHeight >= 40) {
    for (let mark = axis.startMinutes + 30; mark < axis.endMinutes; mark += 60) {
      halfMarks.push(mark)
    }
  }

  return (
    <div className="space-y-3">
      {/*
        La navegación temporal: una semana, la anterior, la siguiente y la vuelta a hoy. Es la
        forma de avanzar en el tiempo de la agenda; el desplazamiento horizontal ya solo sirve para
        ver una semana que no cabe a lo ancho con el zoom elegido.
      */}
      <div data-slot="timeline-week" className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => goToWeek(addDays(weekStart, -7))}
          disabled={weekStart <= firstWeek}
        >
          ‹ Semana anterior
        </Button>
        <span
          data-slot="timeline-week-label"
          className="min-w-44 text-center text-xs font-medium tabular-nums"
        >
          {formatWeek(weekStart)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => goToWeek(addDays(weekStart, 7))}
          disabled={weekStart >= lastWeek}
        >
          Semana siguiente ›
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => goToWeek(anchor)}
          disabled={weekStart === anchor}
        >
          Volver a hoy
        </Button>
      </div>

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
          {/*
            La leyenda de los estados va primero porque es la que el tramo no puede explicar solo:
            un bloque azul y uno ámbar se distinguen por el color y nada más. Solo se listan los que
            están en la semana visible.
          */}
          {presentStates.map((state) => (
            <li key={state} data-slot="timeline-legend-state" data-state={state} className="flex items-center gap-1.5">
              <span
                className={cn('size-3 shrink-0 rounded-xs border', STATES[state].block)}
                aria-hidden="true"
              />
              {STATES[state].label}
            </li>
          ))}
          {/*
            La leyenda del compromiso va detrás de la de los estados porque explica lo que la
            primera no alcanza: el relleno dice qué hizo el plan, el icono dice cuánto queda hasta
            la fecha de GLPI. Los dos se ven a la vez sobre el mismo tramo.
          */}
          {presentRisks.map((risk) => {
            const mark = RISK[risk]
            const RiskIcon = mark.icon

            return (
              <li
                key={risk}
                data-slot="timeline-legend-risk"
                data-risk={risk}
                className="flex items-center gap-1.5"
              >
                <RiskIcon className={cn('size-3 shrink-0', mark.flag)} aria-hidden="true" />
                {mark.label}
              </li>
            )
          })}
          <li className="flex items-center gap-1.5">
            <Flag className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            Día de entrega: el último que ocupa el trabajo
          </li>
          <li className="flex items-center gap-1.5">
            <span className="text-sm leading-none" aria-hidden="true">
              ›
            </span>
            Continúa en el día siguiente
          </li>
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
            Día sin jornada para esa persona
          </li>
        </ul>
      </div>

      {/*
        Un único flujo vertical: la página. La rejilla desplaza solo en horizontal —con el zoom
        amplio una semana de siete días no cabe a lo ancho— y deja de tener puerto de scroll
        vertical propio, que era el segundo sistema con el que competía el de la página al girar la
        rueda. La semana se cambia con los controles de arriba, no desplazando.

        La cabecera de fechas vive fuera del scroller y se pega al borde superior de `main`: dentro
        de un contenedor que desborda, `sticky` se pegaría a él, que es quien no desplaza. El
        desplazamiento horizontal se imita con una traslación, y la esquina «Recurso» se contraslada
        para quedarse quieta mientras las fechas pasan por debajo, como antes.
      */}
      <div
        role="region"
        aria-label={label ?? 'Agenda del plan'}
        className="rounded-lg border border-border"
      >
        <div
          data-slot="timeline-header"
          // `-top-6` compensa el `py-6` de `main`: sin él la cabecera se pega en el borde del
          // contenido y deja una franja de 24 px por la que las filas asoman por encima de las fechas.
          className="sticky -top-6 z-20 overflow-hidden rounded-t-lg border-b border-border bg-muted"
        >
          <div className="flex w-max" style={{ transform: `translateX(${-scrollLeft}px)` }}>
            <div
              data-slot="timeline-corner"
              className="relative z-30 flex w-44 shrink-0 items-center border-r border-border bg-muted px-3 py-2 text-xs font-medium"
              style={{ transform: `translateX(${scrollLeft}px)` }}
            >
              Recurso
            </div>
            {/* La columna de horas, separada de los días: así la escala no queda debajo de los tramos. */}
            <div
              data-slot="timeline-axis-header"
              aria-hidden="true"
              className="z-20 w-10 shrink-0 border-r border-border bg-muted"
              style={{ transform: `translateX(${scrollLeft}px)` }}
            />
            {days.map((day) => (
              <div
                key={day}
                data-slot="timeline-day"
                data-today={day === today ? 'true' : undefined}
                style={{ width: dayWidth }}
                className="shrink-0 border-r border-border bg-muted px-2 py-2 last:border-r-0"
              >
                <p className="truncate text-xs font-medium capitalize">{formatDay(day)}</p>
              </div>
            ))}
          </div>
        </div>

        <div
          data-slot="timeline-scroll"
          ref={scrollRef}
          onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
          className="overflow-x-auto overflow-y-hidden"
        >
          <div className="min-w-max">
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
                        <PendingChip
                          count={waiting}
                          name={names?.[resource.developerId] ?? resource.developerId}
                          to={pendingLinks?.[resource.developerId]}
                          onSelect={
                            onPendingSelect
                              ? () => onPendingSelect(resource.developerId)
                              : undefined
                          }
                        />
                      )}
                      {recovering > 0 && (
                        <span data-slot="timeline-recoverable" className="text-[10px]">
                          {countOf(recovering, 'recuperable', 'recuperables')}
                        </span>
                      )}
                    </span>
                  </div>

                  {/*
                    La escala horaria en su propia columna: antes vivía dentro del primer día y los
                    tramos la tapaban. Es fija al desplazar a lo ancho —igual que los nombres— y se
                    repite por fila, así que cada persona se lee contra su propia escala.
                  */}
                  <div
                    data-slot="timeline-hour-rail"
                    aria-hidden="true"
                    className="sticky left-44 z-10 w-10 shrink-0 border-r border-border bg-card"
                  >
                    <div className="h-10" />
                    <div className="relative border-t border-border" style={{ height: bodyHeight }}>
                      {hourMarks.map((mark) => (
                        <span
                          key={mark}
                          className="absolute right-1 text-[10px] leading-none tabular-nums text-muted-foreground"
                          style={{ top: ((mark - axis.startMinutes) / 60) * hourHeight + 2 }}
                        >
                          {clockLabel(mark)}
                        </span>
                      ))}
                      {/*
                        La hora en la que cierra el eje también se rotula, sobre el borde inferior:
                        sin ella la escala parecía acabar una hora antes de donde acaban los tramos.
                        La jornada oficial cierra a las 17:30, media hora después de la última
                        marca, y esa media hora también hay que poder leerla.
                      */}
                      <span
                        className="absolute right-1 text-[10px] leading-none tabular-nums text-muted-foreground"
                        style={{ bottom: 1 }}
                      >
                        {clockLabel(axis.endMinutes)}
                      </span>
                    </div>
                  </div>

                  {days.map((day) => {
                    // El día del incidente simulado, solo en la fila de la persona elegida. La franja de
                    // capacidad es de alto fijo, así que sustituirla por el aviso no desalinea las
                    // horas de esta celda con las de las demás.
                    const demoHere =
                      simulation?.developerId === resource.developerId && simulation.date === day
                    // La jornada es de la persona, no del equipo: cada celda dice lo suyo.
                    const capacity = capacityOn(resource, day)
                    const closedHere =
                      capacity !== undefined &&
                      capacity.availableHours === 0 &&
                      capacity.occupiedHours === 0

                    return (
                      <div
                        key={day}
                        data-slot="timeline-cell"
                        data-working={
                          capacity === undefined ? 'unknown' : closedHere ? 'false' : 'true'
                        }
                        data-demo={demoHere ? 'true' : undefined}
                        style={{ width: dayWidth }}
                        className={cn(
                          'shrink-0 border-r border-border last:border-r-0',
                          closedHere && 'bg-muted/40',
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
                          <CapacityStrip capacity={capacity} />
                        )}

                        {/*
                          La franja de los tickets que no caben en el eje del tiempo: tienen un día
                          y no tienen horas, así que no ocupan jornada. Va entre la capacidad y la
                          escala —fuera del área de los tramos— porque dibujarlos dentro del eje
                          afirmaría unas horas que nadie declaró.
                        */}
                        {hasGhosts && (
                          <div
                            data-slot="timeline-unscheduled-band"
                            className="flex h-5 items-center gap-1 overflow-hidden border-t border-dashed border-border/60 px-1.5"
                          >
                            {(ghostsByCell.get(`${resource.developerId}|${day}`) ?? []).map(
                              (ghost) => {
                                const ghostRisk = risks?.[ghost.workItemId]
                                const ghostMark =
                                  ghostRisk !== undefined && ghostRisk !== 'FUTURA'
                                    ? RISK[ghostRisk]
                                    : null
                                const GhostIcon = ghostMark?.icon ?? Flag

                                return (
                                <span
                                  key={ghost.workItemId}
                                  data-slot="timeline-unscheduled"
                                  data-work-item={ghost.workItemId}
                                  data-risk={ghostMark ? ghostRisk : undefined}
                                  title={`Ticket ${ghost.workItemId}: tiene día en GLPI y no ocupa jornada. ${ghost.cause}: requiere una estimación de horas.${ghostMark ? ` ${ghostMark.label}: ${formatDay(ghost.date)}.` : ''}`}
                                  className={cn(
                                    'flex min-w-0 items-center gap-1 rounded-xs border border-dashed px-1 text-[10px] leading-none',
                                    ghostMark?.chip ?? 'border-slate-400 bg-slate-50 text-slate-700',
                                  )}
                                >
                                  {/*
                                    La bandera sustituye al interrogante que había, y no se suma a
                                    él: en un día de 132 px el chip ya truncaba su texto, así que
                                    cada icono se paga con letras. La bandera dice lo que el texto
                                    no cabe a decir —**ese día es la fecha de entrega que publica
                                    GLPI** (Internal TTR)— y el resto lo sigue diciendo el
                                    «Sin estimación». Lleva `aria-label` y no solo el título,
                                    porque la regla es que se vea sin tooltip.
                                  */}
                                  <GhostIcon
                                    data-slot="timeline-unscheduled-commitment"
                                    className={cn('size-3 shrink-0', ghostMark?.flag)}
                                    aria-label={
                                      ghostMark ? ghostMark.label : 'Fecha de entrega comprometida en GLPI'
                                    }
                                  />
                                  <span className="truncate">
                                    {ghost.workItemId} · {ghost.cause}
                                  </span>
                                </span>
                                )
                              },
                            )}
                          </div>
                        )}

                        <div className="relative border-t border-border" style={{ height: bodyHeight }}>
                          {/* La hora se lee en el rail; aquí la línea marca el límite, más fuerte
                              que la de media hora, que solo aparece cuando hay alto para verla. */}
                          {hourMarks.map((mark) => (
                            <div
                              key={mark}
                              className="absolute inset-x-0 border-t border-border"
                              style={{ top: ((mark - axis.startMinutes) / 60) * hourHeight }}
                            />
                          ))}
                          {halfMarks.map((mark) => (
                            <div
                              key={mark}
                              className="absolute inset-x-0 border-t border-border/40"
                              style={{ top: ((mark - axis.startMinutes) / 60) * hourHeight }}
                            />
                          ))}

                          {(resourceByDate.get(day) ?? []).map((item) => (
                            <Block
                              key={`${item.workItemId}-${item.startsAt}`}
                              item={item}
                              axis={axis}
                              hourHeight={hourHeight}
                              state={blockState(item, states)}
                              risk={risks?.[item.workItemId]}
                              position={positions.get(`${item.workItemId}@${item.startsAt}`)}
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
    </div>
  )
}
