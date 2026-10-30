import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Flag,
  Gauge,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { StatCard } from '@/components/dashboard/StatCard'
import { CapacityGantt } from '@/components/gantt/CapacityGantt'
import { RISK, RISK_ORDER, STATES, STATE_ORDER } from '@/lib/timelineVisuals'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { declarationsByDeveloper, useTeamDeclarationsBatch } from '@/hooks/useDeclarations'
import { useRenegotiations } from '@/hooks/useRenegotiations'
import { useTeam } from '@/hooks/useTeam'
import { useTeamTimeline } from '@/hooks/useTeamTimeline'
import {
  BAND,
  CAPACITY_VIEWS,
  barsOf,
  commitmentsOf,
  daysBetween,
  formatPercent,
  loadOf,
  occupancyBand,
  pendingDaysOf,
  periodEnd,
  periodLabel,
  periodStart,
  riskCountsOf,
  shiftPeriod,
  summaryOf,
  titlesOf,
  unestimatedCount,
} from '@/lib/gantt/capacity'
import { agreementStates } from '@/lib/renegotiations'
import {
  formatHours,
  localTodayIso,
  teamAgenda,
  timelineDays,
  unscheduledOf,
  weekAnchor,
} from '@/lib/timeline'
import { cn } from '@/lib/utils'
import type { CapacityRow } from '@/components/gantt/CapacityGantt'
import type { CapacityView, OccupancyBand } from '@/lib/gantt/capacity'
import type { TeamPerson } from '@/types/team'

/** La leyenda de bandas, en orden. Es la misma escala que pinta cada fila. */
const BANDS: readonly { band: OccupancyBand; range: string }[] = [
  { band: 'libre', range: 'hasta 59 %' },
  { band: 'normal', range: '60 – 89 %' },
  { band: 'lleno', range: '90 – 100 %' },
  { band: 'sobre', range: '101 – 120 %' },
  { band: 'critico', range: 'más de 120 %' },
  { band: 'sin-plan', range: 'sin plan en el periodo' },
]

/**
 * El nombre de cada persona, por todo lo que el padrón sabe de ella.
 *
 * El plan se guarda **con lo que se tecleó al pedirlo**, así que puede venir por login o por número
 * de GLPI; el cruce a login lo hace `teamAgenda`, y aquí solo queda resolver el nombre legible. La
 * declaración rellena el hueco de quien el padrón no nombra.
 */
function namesOf(
  people: readonly TeamPerson[],
  declarations: Readonly<Record<string, { name: string | null }>>,
): Record<string, string> {
  const names: Record<string, string> = {}

  for (const [developerId, declaration] of Object.entries(declarations)) {
    if (declaration.name) {
      names[developerId] = declaration.name
    }
  }

  for (const person of people) {
    if (person.name) {
      names[person.developerId] = person.name
    }
  }

  return names
}

/**
 * Capacidad del equipo: el Gantt de ocupación para quien coordina.
 *
 * **Responde una sola pregunta: qué tan ocupado está el equipo.** No cuándo se entrega un ticket, ni
 * por qué se renegoció, ni qué desplazamiento ocurrió — eso vive en el Timeline, que esta pantalla
 * no duplica ni resume.
 *
 * **Es de solo lectura.** No recalcula el plan, no lo modifica y no persiste nada: las horas
 * disponibles y ocupadas son las que el motor ya publicó en la capacidad diaria de cada recurso
 * (`GET /api/planning/team/timeline`), y lo único que esta vista hace es recortarlas al periodo que
 * se está mirando y sumarlas. Los nombres salen del padrón (`GET /api/team`) y el título corto de
 * cada barra, de la declaración que ya existe.
 *
 * **No hay una fuente de datos nueva.** Son las tres lecturas que el Timeline del equipo ya usa.
 */
export function TeamCapacity() {
  const timeline = useTeamTimeline()
  const team = useTeam()
  // La misma lectura de acuerdos que el Timeline: es lo que da el color de cada barra.
  const renegotiations = useRenegotiations()

  const [view, setView] = useState<CapacityView>('semana')

  /**
   * El ancla del periodo, o nulo mientras nadie navegue.
   *
   * Nulo significa «donde abriría la agenda»: hoy si la ventana de los planes lo contiene y si no
   * el primer día que sí. Se resuelve con `weekAnchor`, que ya es la regla del Timeline, en vez de
   * dejar la vista en una semana que ningún plan cubre.
   */
  const [anchor, setAnchor] = useState<string | null>(null)

  const people = useMemo(
    () => (team.data?.people ?? []).filter((person) => person.operational),
    [team.data],
  )

  const developerIds = useMemo(() => people.map((person) => person.developerId), [people])

  // La misma composición que el Timeline: cruza padrón y planes y devuelve una fila por persona.
  const agenda = useMemo(() => teamAgenda(people, timeline.data), [people, timeline.data])

  const declarations = useTeamDeclarationsBatch(developerIds)
  const declarationsById = useMemo(
    () => declarationsByDeveloper(declarations.data),
    [declarations.data],
  )

  const names = useMemo(
    () =>
      namesOf(
        team.data?.people ?? [],
        Object.fromEntries(
          Object.entries(declarationsById).map(([id, declaration]) => [
            id,
            { name: declaration.developer.name },
          ]),
        ),
      ),
    [team.data, declarationsById],
  )

  const titles = useMemo(() => titlesOf(declarationsById), [declarationsById])
  const missingEstimation = useMemo(() => unestimatedCount(declarationsById), [declarationsById])

  const today = localTodayIso()

  // La ventana completa de los planes vigentes, que es la única que tiene capacidad declarada.
  const windowDays = useMemo(
    () => timelineDays(timeline.data?.resources ?? [], timeline.data?.items ?? []),
    [timeline.data],
  )

  const currentAnchor = anchor ?? weekAnchor(windowDays, today)
  const start = periodStart(view, currentAnchor)
  const end = periodEnd(view, currentAnchor)
  const days = useMemo(() => daysBetween(start, end), [start, end])

  const rows = useMemo<CapacityRow[]>(
    () =>
      agenda.resources.map((resource) => ({
        developerId: resource.developerId,
        name: names[resource.developerId] ?? resource.developerId,
        load: loadOf(resource.developerId, resource, days, agenda.items),
      })),
    [agenda, days, names],
  )

  /**
   * El color de cada barra: el plan pone el estado y el acuerdo lo matiza.
   *
   * Se resuelve con las mismas dos piezas del Timeline —`agreementStates` y `blockState`— y no con
   * una regla propia, que es lo que garantiza que un ticket desplazado sea ámbar en las dos vistas.
   */
  const states = useMemo(() => agreementStates(renegotiations.data), [renegotiations.data])

  // Cuando vence cada ticket —el Internal TTR que publica GLPI— y cuánto apremia.
  const commitments = useMemo(() => commitmentsOf(declarationsById, today), [declarationsById, today])

  const bars = useMemo(
    () => barsOf(agenda.items, days, { states, commitments }),
    [agenda, days, states, commitments],
  )

  /**
   * Los tickets con fecha en GLPI y sin horas.
   *
   * No están en el plan y no tienen tramo, así que no salen de la agenda: salen de la declaración,
   * que es la lectura que ya usa la capa de pendientes del Timeline. Se recortan al periodo visible
   * porque fuera de él no hay columna donde ponerlos.
   */
  const plannedTickets = useMemo(
    () => new Set(agenda.items.map((item) => item.workItemId)),
    [agenda],
  )
  const pending = useMemo(
    () =>
      pendingDaysOf(
        unscheduledOf(declarationsById, plannedTickets, { from: start, to: end }),
        days,
      ),
    [declarationsById, plannedTickets, start, end, days],
  )

  const risks = useMemo(() => riskCountsOf(commitments, days), [commitments, days])

  const summary = useMemo(() => summaryOf(rows.map((row) => row.load)), [rows])

  function goToToday() {
    const from = timeline.data?.from ?? null
    const to = timeline.data?.to ?? null
    setAnchor(from && to && today >= from && today <= to ? today : null)
  }

  if (timeline.isPending && !timeline.data) {
    return <CapacitySkeleton />
  }

  if (timeline.isError) {
    return (
      <EmptyState
        tone="danger"
        icon={AlertTriangle}
        title="No fue posible leer la capacidad del equipo"
        detail={timeline.error instanceof Error ? timeline.error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={() => void timeline.refetch()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  if (!timeline.data?.from) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No hay ningún plan vigente"
        detail="La capacidad del equipo se lee de los planes guardados. Cuando se genere el primero, esta vista tendrá qué mostrar."
      />
    )
  }

  const averageBand = occupancyBand(summary.percent)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Periodo anterior"
            onClick={() => setAnchor(shiftPeriod(view, currentAnchor, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Periodo siguiente"
            onClick={() => setAnchor(shiftPeriod(view, currentAnchor, 1))}
          >
            <ChevronRight />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday}>
            Hoy
          </Button>

          <p data-slot="capacity-period" className="ml-2 text-sm font-medium">
            {periodLabel(view, start)}
          </p>
        </div>

        <div
          role="group"
          aria-label="Escala del periodo"
          className="inline-flex w-fit rounded-md border border-border bg-card p-0.5"
        >
          {CAPACITY_VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              onClick={() => setView(option.value)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                view === option.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Ocupación promedio"
          icon={Gauge}
          value={summary.percent === null ? '—' : formatPercent(summary.percent)}
          hint={`${BAND[averageBand].label} · ${formatHours(summary.occupiedHours)} de ${formatHours(summary.availableHours)} h · ${summary.covered} ${summary.covered === 1 ? 'persona con plan' : 'personas con plan'}`}
          tone={averageBand === 'critico' || averageBand === 'sobre' ? 'danger' : 'primary'}
        />

        <StatCard
          label="Desarrolladores sobrecargados"
          icon={AlertTriangle}
          value={summary.overloaded}
          hint="Por encima del 100 % de su capacidad"
          tone={summary.overloaded > 0 ? 'danger' : 'success'}
        />

        <StatCard
          label="Tickets sin estimación"
          icon={ClipboardList}
          value={declarations.isPending ? '—' : missingEstimation}
          hint="Tickets activos sin horas declaradas"
          tone={missingEstimation > 0 ? 'warning' : 'success'}
        />

        <StatCard
          label="Capacidad libre"
          icon={CalendarClock}
          value={`${formatHours(summary.remainingHours)} h`}
          hint="Suma del restante del equipo en el periodo"
          tone={summary.remainingHours < 0 ? 'danger' : 'primary'}
        />
      </div>

      <div
        data-slot="capacity-risks"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5"
      >
        <span
          title="Cuenta solo los compromisos del periodo que vencen dentro del horizonte de tres días del Timeline. Las demás entregas se ven en su barra, en verde."
          className="mr-1 text-xs font-medium text-muted-foreground"
        >
          Compromisos en el periodo
        </span>

        {RISK_ORDER.map((key) => {
          const risk = RISK[key]
          const Icon = risk.icon
          const count = risks[key]

          return (
            <span
              key={key}
              data-slot="capacity-risk"
              data-risk={key}
              data-count={count}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium',
                count > 0 ? risk.chip : 'border-border bg-muted text-muted-foreground',
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {risk.label}
              <span className="tabular-nums font-semibold">{count}</span>
            </span>
          )
        })}

        <span className="ml-auto text-[11px] text-muted-foreground">
          Fecha de entrega que publica GLPI (Internal TTR)
        </span>
      </div>

      <CapacityGantt
        rows={rows}
        bars={bars}
        pending={pending}
        days={days}
        view={view}
        today={today}
        titles={titles}
      />

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <LegendRow label="Ocupación">
          {BANDS.map(({ band, range }) => (
            <li key={band} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', BAND[band].dot)} aria-hidden="true" />
              <span>
                <span className="font-medium text-foreground">{BAND[band].label}</span> · {range}
              </span>
            </li>
          ))}
        </LegendRow>

        {/* Los estados son los del Timeline, leídos de su misma tabla: no se redefinen aquí. */}
        <LegendRow label="Estado del trabajo">
          {STATE_ORDER.map((state) => (
            <li key={state} className="flex items-center gap-1.5">
              <span
                className={cn('size-2.5 rounded-sm border', STATES[state].block)}
                aria-hidden="true"
              />
              <span>{STATES[state].label}</span>
            </li>
          ))}
        </LegendRow>

        <LegendRow label="Entrega">
          {RISK_ORDER.map((key) => {
            const Icon = RISK[key].icon

            return (
              <li key={key} className="flex items-center gap-1.5">
                <Icon className={cn('size-3', RISK[key].flag)} aria-hidden="true" />
                <span>{RISK[key].label}</span>
              </li>
            )
          })}
          <li className="flex items-center gap-1.5">
            <Flag className="size-3 text-emerald-600" aria-hidden="true" />
            <span>Entrega con margen</span>
          </li>
        </LegendRow>

        <p className="shrink-0">Vista de lectura: no recalcula ni modifica el plan.</p>
      </div>
    </div>
  )
}

/** Una fila de leyenda: qué eje describe a la izquierda y sus marcas a la derecha. */
function LegendRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 lg:flex-row lg:items-baseline lg:gap-3">
      <span className="w-36 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </span>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">{children}</ul>
    </div>
  )
}

/** Esqueleto de la carga: la misma rejilla que el contenido, para que no haya salto de altura. */
function CapacitySkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-96" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>

      <Skeleton className="h-96 w-full" />
    </div>
  )
}
