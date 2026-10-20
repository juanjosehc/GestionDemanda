import { blockKey, itemDate, minutesOfDay } from '@/lib/timeline'
import type {
  IncidentSeverity,
  TimelineCapacity,
  TimelineItem,
  TimelineResource,
  WorkItemType,
} from '@/types/timeline'

/**
 * La simulación de un incidente, entera, en memoria.
 *
 * **No es planificación.** No llama al motor, no pide nada al backend y no guarda nada: toma la
 * agenda que la pantalla ya tiene y responde qué pasaría *si* ese incidente existiera. Al recargar
 * desaparece porque nunca salió de aquí. Escribir esta cuenta en el backend habría convertido una
 * demostración en un plan de verdad, con las mismas escrituras que la fase prohíbe tocar.
 *
 * **La capacidad no se recalcula.** Se parte de la que el plan ya publica (`remainingHours`), que
 * es la que la rejilla pinta. El incidente resta de ahí; si no cabe, los tramos que se moverían se
 * eligen por el final del día, que es el orden en que un motor desplaza: primero lo que se puede
 * entregar más tarde.
 */

/** Lo que el gestor elige para el incidente. */
export interface SimulationInput {
  developerId: string
  /** Día local en formato ISO (yyyy-MM-dd). */
  date: string
  hours: number
  severity: IncidentSeverity
}

/** Un tramo que la simulación movería, con la fecha propuesta. */
export interface DisplacedBlock {
  /** La misma clave con la que la rejilla reconoce el bloque: `workItemId@startsAt`. */
  key: string
  workItemId: string
  workItemType: WorkItemType
  startsAt: string
  durationHours: number
  /** El siguiente día hábil de la ventana, o `null` si no queda ninguno. */
  newDate: string | null
}

export interface SimulationResult {
  input: SimulationInput
  /** Capacidad publicada para ese día, tal como la entrega el plan. */
  availableHours: number
  /** Lo que ya ocupan los tramos reales ese día. */
  occupiedHours: number
  /** Lo que quedaba antes del incidente. */
  remainingBefore: number
  /** Lo que quedaría después; negativo si ni moviendo el día entero cabe. */
  remainingAfter: number
  displaced: DisplacedBlock[]
  /** Requerimientos afectados: son los que necesitarían una fecha nueva acordada. */
  renegotiable: string[]
  /** Qué impide simular, si algo lo impide. */
  error: string | null
}

const round = (value: number): number => Math.round(value * 10) / 10

const EMPTY = {
  availableHours: 0,
  occupiedHours: 0,
  remainingBefore: 0,
  remainingAfter: 0,
  displaced: [] as DisplacedBlock[],
  renegotiable: [] as string[],
}

/** El siguiente día con jornada después de `date`, o `null` si la ventana no tiene ninguno. */
function nextWorkingDate(resource: TimelineResource, date: string): string | null {
  return (
    resource.capacity
      .filter((capacity) => capacity.date > date && capacity.availableHours > 0)
      .map((capacity) => capacity.date)
      .sort()[0] ?? null
  )
}

/**
 * Calcula qué haría un incidente sobre la agenda de una persona.
 *
 * Devuelve un resultado también cuando no se puede simular —fecha fuera de la ventana, día no
 * laborable, duración inválida—: la pantalla necesita el motivo, y un `null` la dejaría sin nada
 * que decir. El error viaja en el resultado y el resto queda en cero.
 */
export function simulateIncident(
  resources: readonly TimelineResource[],
  items: readonly TimelineItem[],
  input: SimulationInput,
): SimulationResult {
  const capacity: TimelineCapacity | undefined = resources
    .find((resource) => resource.developerId === input.developerId)
    ?.capacity.find((row) => row.date === input.date)

  const resource = resources.find((entry) => entry.developerId === input.developerId)

  if (!resource) {
    return { ...EMPTY, input, error: 'Ese técnico no está en el equipo operativo.' }
  }

  if (!capacity) {
    return { ...EMPTY, input, error: 'Esa fecha está fuera de la ventana del plan.' }
  }

  if (capacity.availableHours <= 0) {
    return {
      ...EMPTY,
      input,
      availableHours: capacity.availableHours,
      occupiedHours: capacity.occupiedHours,
      remainingBefore: capacity.remainingHours,
      remainingAfter: capacity.remainingHours,
      error: 'Ese día no es laborable para esa persona.',
    }
  }

  if (!Number.isFinite(input.hours) || input.hours <= 0) {
    return {
      ...EMPTY,
      input,
      availableHours: capacity.availableHours,
      occupiedHours: capacity.occupiedHours,
      remainingBefore: capacity.remainingHours,
      remainingAfter: capacity.remainingHours,
      error: 'La duración debe ser mayor que cero.',
    }
  }

  // Los tramos del día, en orden de inicio, para quitar primero los últimos.
  const day = items
    .filter((item) => item.developerId === input.developerId && itemDate(item) === input.date)
    .slice()
    .sort((left, right) => minutesOfDay(left.startsAt) - minutesOfDay(right.startsAt))

  const remainingBefore = capacity.remainingHours
  const needed = round(input.hours - remainingBefore)
  const nextDate = nextWorkingDate(resource, input.date)

  const displaced: DisplacedBlock[] = []
  let freed = 0

  if (needed > 0) {
    for (let index = day.length - 1; index >= 0 && freed < needed; index -= 1) {
      const item = day[index]
      if (!item) {
        continue
      }

      freed = round(freed + item.durationHours)
      displaced.unshift({
        key: blockKey(item),
        workItemId: item.workItemId,
        workItemType: item.workItemType,
        startsAt: item.startsAt,
        durationHours: item.durationHours,
        newDate: nextDate,
      })
    }
  }

  return {
    input,
    availableHours: capacity.availableHours,
    occupiedHours: capacity.occupiedHours,
    remainingBefore,
    remainingAfter: round(remainingBefore - input.hours + freed),
    displaced,
    renegotiable: displaced
      .filter((block) => block.workItemType === 'REQUERIMIENTO')
      .map((block) => block.workItemId),
    error: null,
  }
}
