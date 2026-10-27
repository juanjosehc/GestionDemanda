import { AlertTriangle, CalendarClock, Clock, ClipboardList } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { CommitmentRisk } from '@/types/timeline'

/**
 * Los cuatro contadores con los que se abre la agenda del equipo.
 *
 * **No son notificaciones y no llevan a ninguna parte.** Son la lectura de un vistazo que la rejilla
 * no puede dar sola: en la semana visible caben siete días y lo que se pregona aquí está repartido
 * por todas las semanas del horizonte. Avisar de algo que no se puede ir a ver sería otra campana.
 *
 * **Los contadores se solapan a propósito.** Un ticket sin estimación que además está vencido suma
 * en «vencidos» y en «sin estimación», porque responden preguntas distintas: cuántas promesas se
 * incumplieron y cuánto trabajo no se puede planificar todavía. Un reparto en el que cada ticket
 * cupiera en una sola casilla obligaría a elegir cuál de los dos hechos esconder.
 *
 * El cero se pinta apagado y no se esconde: un contador que desaparece cuando llega a cero no se
 * puede usar para saber que está en cero.
 */
export function CommitmentSummary({
  risks,
  withoutEstimate,
}: {
  /** El riesgo de cada ticket, por identificador. Sale de `commitmentRisksOf`. */
  risks: Readonly<Record<string, CommitmentRisk>>
  /** Tickets con día de GLPI y sin horas: no entraron al plan. */
  withoutEstimate: number
}) {
  const counts = countRisks(risks)

  return (
    <dl
      data-slot="timeline-commitment-summary"
      aria-label="Estado de los compromisos del equipo"
      className="flex flex-wrap items-stretch gap-2"
    >
      <Counter
        risk="VENCIDA"
        label="Compromisos vencidos"
        value={counts.VENCIDA}
        icon={AlertTriangle}
      />
      <Counter risk="HOY" label="Entregas hoy" value={counts.HOY} icon={Clock} />
      <Counter risk="PROXIMA" label="Entregas próximas" value={counts.PROXIMA} icon={CalendarClock} />
      {/*
        «Sin estimación» no es un riesgo sino la falta del dato que lo permitiría calcular, y por eso
        va al final con su propio icono y en gris: es el trabajo que todavía no se puede colocar.
      */}
      <Counter
        label="Sin estimación"
        value={withoutEstimate}
        icon={ClipboardList}
        tone="border-dashed border-slate-400 bg-slate-50 text-slate-700"
      />
    </dl>
  )
}

/** Cuántos tickets hay en cada tramo de riesgo. `FUTURA` se cuenta y no se enseña. */
function countRisks(risks: Readonly<Record<string, CommitmentRisk>>) {
  const counts: Record<CommitmentRisk, number> = { VENCIDA: 0, HOY: 0, PROXIMA: 0, FUTURA: 0 }

  for (const risk of Object.values(risks)) {
    counts[risk] += 1
  }

  return counts
}

const TONE: Record<Exclude<CommitmentRisk, 'FUTURA'>, string> = {
  VENCIDA: 'border-red-500 bg-red-50 text-red-900',
  HOY: 'border-orange-500 bg-orange-50 text-orange-900',
  PROXIMA: 'border-amber-500 bg-amber-50 text-amber-900',
}

function Counter({
  risk,
  label,
  value,
  icon: Icon,
  tone,
}: {
  risk?: Exclude<CommitmentRisk, 'FUTURA'>
  label: string
  value: number
  icon: typeof AlertTriangle
  tone?: string
}) {
  const empty = value === 0

  return (
    <div
      data-slot="timeline-commitment-counter"
      data-risk={risk}
      data-empty={empty ? 'true' : undefined}
      className={cn(
        'flex min-w-32 flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5',
        empty ? 'border-border bg-background text-muted-foreground' : (tone ?? TONE[risk!]),
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="truncate text-[11px] leading-tight">{label}</dt>
        <dd className="text-base leading-tight font-semibold tabular-nums">
          {value}
          {/*
            El número no basta para quien no ve el color: el `aria-label` del grupo lleva la
            etiqueta y el valor juntos, así que el lector de pantalla lo anuncia como una frase y no
            como una cifra suelta.
          */}
          <span className="sr-only"> {label.toLowerCase()}</span>
        </dd>
      </div>
    </div>
  )
}
