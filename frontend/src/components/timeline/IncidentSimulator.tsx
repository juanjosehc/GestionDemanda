import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { simulateIncident } from '@/lib/simulation'
import { countOf, formatDay, formatHours } from '@/lib/timeline'
import type { SimulationResult } from '@/lib/simulation'
import type { IncidentSeverity, TimelineItem, TimelineResource } from '@/types/timeline'
import type { FormEvent } from 'react'

/**
 * El simulador de incidentes: una demostración que vive y muere en esta pantalla.
 *
 * **No escribe nada.** El resultado es una cuenta hecha aquí, sobre la agenda que el Timeline ya
 * cargó; al recargar no existe porque nunca se guardó. La pantalla lo dice en el propio panel para
 * que nadie confunda una demostración con un plan.
 *
 * **Sirve para lo único que una demo tiene que demostrar**: que un incidente consume capacidad y
 * que ese consumo desplaza trabajo, sin tocar el plan real ni la base de datos.
 */

const FIELD_CLASS =
  'h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

const SEVERITIES: readonly IncidentSeverity[] = ['ALTO', 'MEDIO', 'BAJO']

/** La duración con la que abre el simulador. */
const DEFAULT_HOURS = 4

/**
 * El día con el que abre el simulador para una persona.
 *
 * El primer día de la ventana es el más antiguo del plan —julio, sin trabajo— y un incidente de 4 h
 * cabía de sobra: la demostración se quedaba en «no desplaza nada», que es justo lo que no
 * demuestra.
 *
 * Se recorre la agenda de esa persona, día con día, simulando el incidente por defecto, y se elige
 * el primero cuyo desplazamiento incluya un **requerimiento**: es la única cadena que la demo tiene
 * que enseñar entera —incidente, tramo movido y acuerdo pendiente—. Desplazar solo un incidente no
 * produce ninguna renegociación y deja la demostración a medias. Si no hay ninguno, se cae al primer
 * día donde el incidente no quepa y, en último término, al primero de la ventana.
 */
function defaultDate(
  resources: readonly TimelineResource[],
  days: readonly string[],
  items: readonly TimelineItem[],
  developerId: string,
): string {
  const rows = (resources.find((resource) => resource.developerId === developerId)?.capacity ?? [])
    .filter((row) => row.availableHours > 0 && row.occupiedHours > 0 && days.includes(row.date))
    .sort((left, right) => left.date.localeCompare(right.date))

  const conRequerimiento = rows.find((row) =>
    simulateIncident(resources, items, {
      developerId,
      date: row.date,
      hours: DEFAULT_HOURS,
      severity: 'ALTO',
    }).displaced.some((block) => block.workItemType === 'REQUERIMIENTO'),
  )

  return (
    conRequerimiento?.date ??
    (rows.find((row) => row.remainingHours < DEFAULT_HOURS) ?? rows[0])?.date ??
    days[0] ??
    ''
  )
}

interface PersonOption {
  developerId: string
  name: string
}

interface IncidentSimulatorProps {
  /** Las personas del equipo, con el nombre que la pantalla ya resuelve. */
  people: readonly PersonOption[]
  /** Las columnas del eje: la fecha se elige de ahí, no de un calendario aparte. */
  days: readonly string[]
  resources: readonly TimelineResource[]
  items: readonly TimelineItem[]
  /** La simulación viva, o `null` si no hay ninguna. La rejilla pinta esta, no una copia. */
  result: SimulationResult | null
  onChange: (result: SimulationResult | null) => void
}

export function IncidentSimulator({
  people,
  days,
  resources,
  items,
  result,
  onChange,
}: IncidentSimulatorProps) {
  const [developerId, setDeveloperId] = useState(people[0]?.developerId ?? '')
  const [date, setDate] = useState(() =>
    defaultDate(resources, days, items, people[0]?.developerId ?? ''),
  )
  const [hours, setHours] = useState(String(DEFAULT_HOURS))
  const [severity, setSeverity] = useState<IncidentSeverity>('ALTO')

  const name = people.find((person) => person.developerId === developerId)?.name ?? developerId

  /** Los requerimientos desplazados: cada uno es un acuerdo pendiente. */
  const impacted =
    result?.displaced.filter((block) => block.workItemType === 'REQUERIMIENTO') ?? []

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onChange(
      simulateIncident(resources, items, {
        developerId,
        date,
        hours: Number(hours),
        severity,
      }),
    )
  }

  /*
   * Cambiar el formulario retira la simulación anterior. Una capa que ya no corresponde a lo que
   * dicen los campos sería una demostración que miente sobre lo que se está viendo.
   */
  function clear() {
    onChange(null)
  }

  return (
    <section
      aria-labelledby="simulador-incidente"
      data-slot="incident-simulator"
      className="rounded-lg border border-dashed border-red-300 bg-red-50/30 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="simulador-incidente" className="flex flex-wrap items-center gap-2 text-sm font-medium">
          Simulador de incidente <Badge variant="danger">DEMO</Badge>
        </h2>
        <p className="text-xs text-muted-foreground">
          Solo en memoria: no toca el plan, ni GLPI, ni la base de datos. Al recargar desaparece.
        </p>
      </div>

      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={submit}>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Desarrollador</span>
          <select
            value={developerId}
            onChange={(event) => {
              setDeveloperId(event.target.value)
              // La fecha acompaña a la persona: el día que demuestra algo para una puede ser un
              // día vacío para otra, y dejar la anterior haría fallar la demo sin explicar por qué.
              setDate(defaultDate(resources, days, items, event.target.value))
              clear()
            }}
            className={FIELD_CLASS}
          >
            {people.map((person) => (
              <option key={person.developerId} value={person.developerId}>
                {person.name} · {person.developerId}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Fecha</span>
          <input
            type="date"
            required
            min={days[0]}
            max={days[days.length - 1]}
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              clear()
            }}
            className={FIELD_CLASS}
          />
        </label>

        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Duración (h)</span>
          <input
            type="number"
            required
            min="0.5"
            max="24"
            step="0.5"
            value={hours}
            onChange={(event) => {
              setHours(event.target.value)
              clear()
            }}
            className="h-8 w-20 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Severidad</span>
          <select
            value={severity}
            onChange={(event) => {
              setSeverity(event.target.value as IncidentSeverity)
              clear()
            }}
            className={FIELD_CLASS}
          >
            {SEVERITIES.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>

        <Button type="submit" size="sm">
          Simular incidente
        </Button>

        {result && (
          <Button type="button" variant="outline" size="sm" onClick={clear}>
            Quitar simulación
          </Button>
        )}
      </form>

      {result?.error && (
        <p data-slot="simulation-error" className="mt-3 text-xs font-medium text-destructive">
          {result.error}
        </p>
      )}

      {result && !result.error && (
        <div data-slot="simulation-result" className="mt-3 space-y-1 text-xs">
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant="danger">SIMULADO</Badge>
            <span>
              {formatHours(result.input.hours)} h el {formatDay(result.input.date)} sobre{' '}
              <span className="font-medium">{name}</span>. Quedarían{' '}
              <span className="font-medium tabular-nums">
                {formatHours(result.remainingAfter)} h
              </span>{' '}
              libres de {formatHours(result.availableHours)}.
            </span>
          </p>

          {result.displaced.length === 0 && result.remainingAfter >= 0 ? (
            <p className="text-muted-foreground">
              Cabe en la capacidad restante: no desplaza ningún tramo.
            </p>
          ) : result.displaced.length > 0 ? (
            <>
              <p>
                Desplazaría {countOf(result.displaced.length, 'tramo', 'tramos')}
                {result.displaced[0]?.newDate
                  ? ` al ${formatDay(result.displaced[0].newDate)}:`
                  : ': no queda día hábil en la ventana.'}
              </p>
              <ul className="space-y-0.5">
                {result.displaced.map((block) => (
                  <li
                    key={block.key}
                    data-slot="simulation-displaced"
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="font-mono">{block.workItemId}</span>
                    <span className="text-muted-foreground">
                      {block.workItemType === 'INCIDENTE' ? 'Incidente' : 'Requerimiento'} ·{' '}
                      {formatHours(block.durationHours)} h
                    </span>
                    {block.workItemType === 'REQUERIMIENTO' && (
                      <Badge variant="warning">Posible renegociación</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {result.remainingAfter < 0 && (
            <p className="font-medium text-destructive">
              Ni moviendo todo el día cabe: faltan {formatHours(Math.abs(result.remainingAfter))} h.
            </p>
          )}

          {/*
            Lo que el desplazamiento produce: un acuerdo pendiente por cada requerimiento movido.
            No se crea nada en el backend —la lista de renegociaciones reales no cambia—, pero la
            demostración tiene que enseñar el eslabón completo: incidente, tramo movido y fecha que
            alguien tendría que acordar.
          */}
          {impacted.length > 0 && (
            <div
              data-slot="simulation-renegotiations"
              className="mt-2 space-y-1 rounded-md border border-red-200 bg-red-50/60 p-2"
            >
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <Badge variant="danger">DEMO</Badge>
                {countOf(impacted.length, 'renegociación simulada', 'renegociaciones simuladas')}{' '}
                · pendientes de acuerdo
              </p>
              <ul className="space-y-0.5">
                {impacted.map((block) => (
                  <li
                    key={block.key}
                    data-slot="simulation-renegotiation"
                    data-work-item={block.workItemId}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="font-mono">{block.workItemId}</span>
                    <span className="tabular-nums">
                      {formatDay(block.startsAt.slice(0, 10))} →{' '}
                      {block.newDate ? formatDay(block.newDate) : 'sin día hábil'}
                    </span>
                    <span className="text-muted-foreground">
                      causa: incidente DEMO {formatHours(result.input.hours)} h ·{' '}
                      {result.input.severity}
                    </span>
                    <Badge variant="warning">Pendiente de acuerdo · DEMO</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
