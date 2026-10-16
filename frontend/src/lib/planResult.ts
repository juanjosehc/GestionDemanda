import { remainingState } from '@/lib/capacity'
import type { PlanningCapacity } from '@/types/planningMetrics'
import type { RenegotiationItem } from '@/types/renegotiations'
import type { RescheduleEvent } from '@/types/planningMetrics'
import type {
  PlanConflict,
  PlanningInputResponse,
  PlanSnapshotResponse,
} from '@/types/planning'
import type { IncidentSeverity, TimelineCapacity, TimelineItem, WorkItemType } from '@/types/timeline'

/**
 * El resultado de un plan guardado, contado a partir de lo que el backend ya publica.
 *
 * **No recalcula el plan y no reclasifica nada.** El motor no corre aqui: lo que hace este modulo es
 * repartir en cajas los elementos que las cuatro lecturas publican, sumar las longitudes de las listas
 * y sumar la capacidad dia a dia. Ninguna cifra se deriva de una regla del motor reescrita en el
 * navegador, que es lo que la decision 87 prohibe.
 *
 * La particion sale de reconocer en que lista aparece cada elemento, y las cuatro cajas son mutuamente
 * excluyentes por construccion:
 *
 * - **Fuera**: esta en `conflicts`. Un requerimiento que no cupo en el horizonte no tiene asignacion.
 * - **Desplazado**: tiene asignacion **y** un evento de reprogramacion. Sigue en la agenda: se movio.
 * - **Planificado**: tiene asignacion y ningun evento. Quedo donde se comprometio.
 * - **Excluido**: entro en la foto y no tiene ni asignacion ni conflicto. El motor lo filtro por su
 *   estado —resuelto o finalizado— y eso **solo** se puede saber teniendo la foto de la entrada.
 *
 * Con la foto presente, `considerados = planificados + desplazados + fuera + excluidos` se cumple por
 * construccion, porque las asignaciones y los conflictos salen de los mismos elementos que entraron.
 */

/**
 * En que caja cayo un elemento. Son los cuatro desenlaces que el motor puede producir sobre algo que
 * entro, y el quinto —la renegociacion— no esta aqui a proposito: **el motor no la produce**.
 */
export type PlanVerdict = 'PLANIFICADO' | 'DESPLAZADO' | 'FUERA' | 'EXCLUIDO'

/** Un elemento del plan, con lo que se sabe de el y por que acabo donde acabo. */
export interface PlanElement {
  workItemId: string
  /** Nulo solo si el elemento no aparece en ninguna lista con tipo. */
  workItemType: WorkItemType | null
  verdict: PlanVerdict
  /** Estimacion de la foto. Nula cuando la entrada no consta y el elemento no tiene tramo. */
  estimatedHours: number | null
  /** Lo comprometido para este elemento, sumado sobre sus dias. Cero si no se ubico. */
  allocatedHours: number
  /** Fecha compromiso: la de la foto, o la del tramo cuando la foto no consta. */
  committedDate: string | null
  severity: IncidentSeverity | null
  /** El evento que lo movio. Trae la regla aplicada, la severidad y el motivo del motor. */
  reschedule: RescheduleEvent | null
  /** El conflicto que lo dejo fuera. Trae el motivo que redacto el motor. */
  conflict: PlanConflict | null
  /**
   * El acuerdo humano sobre **este** desplazamiento, si lo hay.
   *
   * **Es un eje aparte del veredicto**, no un quinto valor: un desplazado puede estar pendiente o
   * acordado, y eso lo dice `GET /api/renegotiations`, no el plan. El motor solo emite el evento.
   *
   * Nulo significa «no consta un acuerdo para este plan», que no es «no hay acuerdo»: cuando
   * `agreementsKnown` es falso, la lectura de acuerdos habla del plan vigente y no de este.
   */
  renegotiation: RenegotiationItem | null
}

/** Lo que produjo el motor, contado. */
export interface PlanOutcome {
  /**
   * Cuantos elementos recibio el motor. **Nulo cuando la entrada no consta**, y nulo no es cero: un
   * cero afirmaria que no entro nada, y lo que pasa es que nadie lo registro.
   */
  considered: number | null
  planned: number
  displaced: number
  out: number
  /** El residuo: entraron y el motor no los uso. Nulo cuando no hay foto con la que calcularlo. */
  excluded: number | null
  /** Sumado sobre toda la ventana del plan. */
  capacity: PlanningCapacity
  /** Dias laborables que quedaron exactamente a cero: el siguiente requerimiento desplaza a otro. */
  saturatedDays: number
  /** Dias que quedaron por debajo de cero: el plan contradice su propio contexto. */
  overDays: number
  /**
   * Si la lectura de acuerdos habla de este plan.
   *
   * `GET /api/renegotiations` recorre el plan **vigente** de cada desarrollador, asi que al mirar un
   * plan antiguo sus filas son de otro desplazamiento y no se atan. Cuando esto es falso y hay
   * desplazados, la pantalla tiene que decir que no consta un acuerdo **para este plan** en vez de
   * pintar un cero que se leeria como «nadie ha hecho nada».
   */
  agreementsKnown: boolean
  /** Todos los elementos, los problematicos primero. */
  elements: readonly PlanElement[]
}

/** Las cuatro lecturas de las que sale el resultado. */
export interface PlanSources {
  snapshot: PlanSnapshotResponse
  /** Nula cuando el plan no tiene foto de entrada registrada. */
  input: PlanningInputResponse | null
  /** Los tramos de la agenda, para las horas y la fecha compromiso de lo que si se ubico. */
  items: readonly TimelineItem[]
  /** La capacidad dia a dia, tal como la publica el timeline. */
  capacity: readonly TimelineCapacity[]
  /** Los acuerdos humanos, de `GET /api/renegotiations`. */
  renegotiations: readonly RenegotiationItem[]
}

/** El orden en que se enseñan: primero lo que no salio como se acordo. */
const ORDER: Record<PlanVerdict, number> = {
  FUERA: 0,
  DESPLAZADO: 1,
  EXCLUIDO: 2,
  PLANIFICADO: 3,
}

function sumBy<T>(rows: readonly T[], of: (row: T) => number): number {
  return rows.reduce((total, row) => total + of(row), 0)
}

/** El primer valor no nulo, en el orden en que se le pasa. Las fuentes van de la mas fiel a la menos. */
function firstOf<T>(...values: readonly (T | null | undefined)[]): T | null {
  return values.find((value): value is T => value !== null && value !== undefined) ?? null
}

/**
 * Reparte los elementos de un plan guardado en sus cuatro cajas y suma la capacidad.
 *
 * El universo de elementos es la union de lo que entro, lo que se ubico y lo que quedo fuera: si la
 * foto falta, el universo son las otras dos, y los excluidos dejan de ser contables.
 */
export function planOutcome(sources: PlanSources): PlanOutcome {
  const { snapshot, input, items, capacity, renegotiations } = sources

  const allocatedHours = new Map<string, number>()
  for (const allocation of snapshot.allocations) {
    allocatedHours.set(allocation.workItemId, (allocatedHours.get(allocation.workItemId) ?? 0) + allocation.hours)
  }

  const events = new Map<string, RescheduleEvent>()
  for (const event of snapshot.rescheduleEvents) {
    events.set(event.requirementId, event)
  }

  const conflicts = new Map<string, PlanConflict>()
  for (const conflict of snapshot.conflicts) {
    conflicts.set(conflict.workItemId, conflict)
  }

  const blocks = new Map<string, TimelineItem>()
  for (const item of items) {
    if (!blocks.has(item.workItemId)) {
      blocks.set(item.workItemId, item)
    }
  }

  // Solo los acuerdos **de este plan**. `GET /api/renegotiations` recorre el plan vigente de cada
  // desarrollador, asi que al mirar un plan antiguo sus filas hablan de otro desplazamiento: pegarlas
  // aqui pondria un acuerdo junto a unas fechas que no son las suyas. El `planId` viaja en la fila
  // justamente para poder atarla, y atarla mal es peor que no atarla.
  const agreements = new Map<string, RenegotiationItem>()
  for (const agreement of renegotiations) {
    if (agreement.planId === snapshot.planId) {
      agreements.set(agreement.workItemId, agreement)
    }
  }

  const incidentById = new Map((input?.incidents ?? []).map((one) => [one.id, one]))
  const requirementById = new Map((input?.requirements ?? []).map((one) => [one.id, one]))

  const ids = [
    ...(input?.requirements ?? []).map((one) => one.id),
    ...(input?.incidents ?? []).map((one) => one.id),
    ...snapshot.allocations.map((one) => one.workItemId),
    ...snapshot.conflicts.map((one) => one.workItemId),
  ]

  const elements: PlanElement[] = [...new Set(ids)].map((workItemId) => {
    const incident = incidentById.get(workItemId) ?? null
    const requirement = requirementById.get(workItemId) ?? null
    const block = blocks.get(workItemId) ?? null
    const conflict = conflicts.get(workItemId) ?? null
    const event = events.get(workItemId) ?? null
    const hours = allocatedHours.get(workItemId) ?? 0

    // El orden importa: un elemento en conflicto no tiene asignacion, asi que las dos ramas no pueden
    // solaparse; y sin asignacion ni conflicto, lo unico que pudo pasar es que el motor lo filtrara.
    const verdict: PlanVerdict = conflict
      ? 'FUERA'
      : hours > 0
        ? event
          ? 'DESPLAZADO'
          : 'PLANIFICADO'
        : 'EXCLUIDO'

    return {
      workItemId,
      workItemType: firstOf(
        incident ? 'INCIDENTE' : null,
        requirement ? 'REQUERIMIENTO' : null,
        block?.workItemType,
        conflict?.workItemType,
      ),
      verdict,
      estimatedHours: firstOf(incident?.estimatedHours, requirement?.estimatedHours, block?.estimatedHours),
      allocatedHours: hours,
      committedDate: firstOf(requirement?.plannedDate, block?.committedDate),
      severity: firstOf(incident?.severity, block?.severity),
      reschedule: event,
      conflict,
      renegotiation: agreements.get(workItemId) ?? null,
    }
  })

  // Un dia cerrado sin nada encima no es un dia saturado: es un sabado. Solo se cuentan los dias en los
  // que hubo jornada o hubo trabajo, que son los unicos donde el restante significa algo.
  const working = capacity.filter((day) => day.availableHours > 0 || day.occupiedHours > 0)

  const counted = (verdict: PlanVerdict) => elements.filter((one) => one.verdict === verdict).length

  return {
    considered: input ? input.incidents.length + input.requirements.length : null,
    planned: counted('PLANIFICADO'),
    displaced: counted('DESPLAZADO'),
    out: counted('FUERA'),
    excluded: input ? counted('EXCLUIDO') : null,
    capacity: {
      availableHours: sumBy(capacity, (day) => day.availableHours),
      occupiedHours: sumBy(capacity, (day) => day.occupiedHours),
      remainingHours: sumBy(capacity, (day) => day.remainingHours),
    },
    saturatedDays: working.filter((day) => remainingState(day.remainingHours) === 'full').length,
    overDays: working.filter((day) => remainingState(day.remainingHours) === 'over').length,
    agreementsKnown: renegotiations.some((one) => one.planId === snapshot.planId),
    elements: elements.sort(
      (a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.workItemId.localeCompare(b.workItemId),
    ),
  }
}

/** Las tres frases posibles sobre lo que produjo el motor. La prosa vive en la pantalla. */
export type PlanVerdictToken = 'sin-elementos' | 'nada-ubicado' | 'con-trabajo'

/**
 * Que se puede decir del resultado, en un token.
 *
 * **No hay token para «no consta la entrada»**: eso no es un veredicto sobre el plan sino un hueco en
 * su registro, y quien lo pinta lo sabe por `outcome.considered === null`. Mezclarlos obligaria a que
 * la frase mintiera sobre una de las dos cosas.
 */
export function verdictOf(outcome: PlanOutcome): PlanVerdictToken {
  if (outcome.elements.length === 0) return 'sin-elementos'
  if (outcome.planned + outcome.displaced === 0) return 'nada-ubicado'
  return 'con-trabajo'
}

/**
 * Los elementos que quedaron fuera, con el motivo del motor.
 *
 * Es lo que el brief llama «tickets descartados», y **no lo son**: los descartes del validador de GLPI
 * no se guardan con el plan y aqui no se inventan. Lo que si se puede nombrar es lo que no cupo.
 */
export function outside(outcome: PlanOutcome): readonly PlanElement[] {
  return outcome.elements.filter((one) => one.verdict === 'FUERA')
}

/** Los elementos que exigen un acuerdo humano: los desplazados que aun no lo tienen. */
export function awaitingAgreement(outcome: PlanOutcome): readonly PlanElement[] {
  return outcome.elements.filter((one) => one.verdict === 'DESPLAZADO' && one.renegotiation?.status === 'PENDIENTE_DE_ACUERDO')
}
