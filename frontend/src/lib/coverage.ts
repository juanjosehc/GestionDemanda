import { isActive } from '@/lib/incidents'
import { PENDING_GROUP } from '@/lib/pending'
import type { PendingCause, PendingGroup, PendingItem } from '@/lib/pending'
import type { DeveloperDeclarationsResponse } from '@/types/declarations'

/**
 * La cobertura del plan, persona a persona.
 *
 * **No clasifica nada.** Cada ticket ya llega clasificado por el backend en `declarationStatus` y
 * cada pendiente ya llega con su causa desde `lib/pending.ts`; esta capa solo cuenta lo que esas dos
 * lecturas dicen. Escribir aquí una segunda regla —mirar si hay estimación o compromiso— dejaría dos
 * sitios que cambian cuando el validador cambie, y la pantalla podría decir de una persona algo que
 * el plan después desmiente.
 *
 * **La pregunta que responde no es «cuánto trabajo hay» sino «cuánto de ese trabajo puede llegar al
 * plan».** Por eso separa las cuatro cifras que el gestor necesita: los tickets activos, los que ya
 * tienen algo declarado, los que se pueden planificar hoy y los que el plan vigente ya coloca.
 */

/** Todos los estados en los que la declaración dice algo. `NO_TRADUCIBLE` no es uno de ellos. */
const DECLARED_STATUSES: ReadonlySet<string> = new Set([
  'PLANIFICABLE',
  'SIN_ESTIMACION',
  'SIN_COMPROMISO',
])

/** La cobertura de una persona, contada sobre sus tickets activos. */
export interface DeveloperCoverage {
  developerId: string
  /** El nombre que publicó GLPI al leer la declaración. Nulo si el usuario no tiene nombre usable. */
  name: string | null
  /** Tickets activos. Es el denominador de todo lo demás. */
  active: number
  /**
   * Tickets con algo declarado —estimación, compromiso o ambos— según el backend.
   *
   * **No es «planificable»**, y por eso son dos columnas: uno puede tener la fecha compromiso y
   * faltarle las horas. `NO_TRADUCIBLE` queda fuera porque no es un problema de declaración: el
   * ticket no se puede ni leer.
   */
  declared: number
  /** Tickets que hoy tienen lo necesario para entrar al plan. */
  planificable: number
  /** Tickets activos que el plan vigente ya coloca y que no arrastran ningún pendiente. */
  covered: number
  /** Tickets activos que no están en el plan, o que están en una fecha que nadie acordó. */
  pending: number
  /** De esos pendientes, los que se desbloquean declarando (grupo P1). Es el impacto de una llamada. */
  blockedByInformation: number
  /**
   * Dónde queda la persona si se completan las declaraciones que faltan.
   *
   * **No es una predicción del motor, es una resta del trabajo demostrable**: lo que hoy está en el
   * plan más lo que solo espera información. La capacidad y las reglas de colocación pueden reducirlo;
   * lo que no puede es aumentar, porque un ticket sin declarar no es planificable de ninguna forma.
   */
  potential: number
  /** El desglose exacto por causa, para poder decir por qué y no solo cuánto. */
  causes: Record<PendingCause, number>
}

/** Medida global del equipo: la suma de las filas, sin promediar porcentajes. */
export interface CoverageTotals {
  active: number
  declared: number
  planificable: number
  covered: number
  pending: number
  blockedByInformation: number
  /** Dónde queda el equipo si se completan las declaraciones que faltan. `covered + P1`. */
  potential: number
  /** `covered / active`. Cero cuando no hay tickets activos, que es un hecho y no un 100 %. */
  rate: number
  /** `potential / active`. Mide la distancia que una semana de llamadas puede recorrer. */
  potentialRate: number
}

const NO_CAUSES: Readonly<Record<PendingCause, number>> = {
  SIN_ESTIMACION: 0,
  SIN_COMPROMISO: 0,
  SIN_DECLARACION: 0,
  NO_TRADUCIBLE: 0,
  FUERA_POR_CAPACIDAD: 0,
  SIN_ACUERDO: 0,
  NO_INCLUIDO_EN_EL_PLAN: 0,
}

const PERCENT = new Intl.NumberFormat('es-CO', {
  style: 'percent',
  maximumFractionDigits: 1,
})

/** Un porcentaje con un decimal como máximo: «3,5 %», no «4 %». */
export function formatPercent(rate: number): string {
  return PERCENT.format(rate)
}

/**
 * La cobertura de una persona, o nulo si no se leyó su declaración.
 *
 * **Nulo y no una fila en cero.** Una persona cuya lectura falló no tiene «cero pendientes»: no se
 * sabe cuántos tiene, y pintarla en cero afirmaría que está cubierta. Quien llama descarta el nulo y
 * cuenta a esa persona como no leída, que es el mismo trato que ya da la capa de pendientes.
 */
export function coverageOf(
  developerId: string,
  declaration: DeveloperDeclarationsResponse | undefined,
  pending: readonly PendingItem[],
): DeveloperCoverage | null {
  if (!declaration) {
    return null
  }

  // El backend ya devuelve solo activos; `isActive` se aplica igual porque es la misma puerta que
  // usa la capa de pendientes y las dos cifras tienen que contar exactamente los mismos tickets.
  const active = declaration.items.filter(isActive)
  const causes: Record<PendingCause, number> = { ...NO_CAUSES }

  for (const item of pending) {
    causes[item.cause] += 1
  }

  const blockedByInformation = pending.filter(
    (item) => PENDING_GROUP[item.cause] === 'P1',
  ).length

  return {
    developerId,
    name: declaration.developer.name,
    active: active.length,
    declared: active.filter((item) => DECLARED_STATUSES.has(item.declarationStatus)).length,
    planificable: active.filter((item) => item.declarationStatus === 'PLANIFICABLE').length,
    // Todo ticket sin causa pendiente está dentro del plan con su fecha en pie. La resta es válida
    // porque las dos listas salen de la misma lectura y ya pasaron por `isActive`.
    covered: Math.max(active.length - pending.length, 0),
    pending: pending.length,
    blockedByInformation,
    // Lo que ya está en el plan más lo que solo espera una declaración. Es la respuesta a «y si se
    // completan las que faltan», y no una promesa del motor: la capacidad puede recortarla.
    potential: Math.max(active.length - pending.length, 0) + blockedByInformation,
    causes,
  }
}

/**
 * La cobertura de todo el equipo, en el orden en que llega el padrón.
 *
 * Las personas cuya declaración no se pudo leer se caen de la lista: la pantalla las cuenta aparte
 * con `unknownDevelopers`, que es la única forma de decir *cuáles* sin inventarles una fila.
 */
export function teamCoverage(
  developerIds: readonly string[],
  declarations: Readonly<Record<string, DeveloperDeclarationsResponse | undefined>>,
  pending: readonly PendingItem[],
): DeveloperCoverage[] {
  return developerIds.flatMap((developerId) => {
    const row = coverageOf(
      developerId,
      declarations[developerId],
      pending.filter((item) => item.developerId === developerId),
    )

    return row ? [row] : []
  })
}

/** La suma del equipo. Se suman tickets, no porcentajes: promediar filas daría un número falso. */
export function coverageTotals(rows: readonly DeveloperCoverage[]): CoverageTotals {
  const totals = rows.reduce(
    (sum, row) => ({
      active: sum.active + row.active,
      declared: sum.declared + row.declared,
      planificable: sum.planificable + row.planificable,
      covered: sum.covered + row.covered,
      pending: sum.pending + row.pending,
      blockedByInformation: sum.blockedByInformation + row.blockedByInformation,
      potential: sum.potential + row.potential,
    }),
    {
      active: 0,
      declared: 0,
      planificable: 0,
      covered: 0,
      pending: 0,
      blockedByInformation: 0,
      potential: 0,
    },
  )

  return {
    ...totals,
    rate: totals.active === 0 ? 0 : totals.covered / totals.active,
    potentialRate: totals.active === 0 ? 0 : totals.potential / totals.active,
  }
}

/** Cuántos pendientes hay en cada grupo, sumando las filas. Es el resumen de «qué lo impide». */
export function coverageByGroup(
  rows: readonly DeveloperCoverage[],
): Record<PendingGroup, number> {
  const groups: Record<PendingGroup, number> = { P1: 0, P2: 0, P3: 0, P4: 0 }

  for (const row of rows) {
    for (const [cause, count] of Object.entries(row.causes) as [PendingCause, number][]) {
      groups[PENDING_GROUP[cause]] += count
    }
  }

  return groups
}

/**
 * El orden operativo: primero quien desbloquea más trabajo declarando.
 *
 * **El impacto se mide en tickets que una llamada puede desbloquear**, no en tickets asignados. Una
 * persona con diez tickets y nueve bloqueados vale más para el gestor que una con un solo ticket,
 * aunque las dos estén «sin plan». El desempate por pendientes y luego por activos mantiene el orden
 * estable cuando el impacto es el mismo, y el identificador lo deja determinista entre pruebas.
 */
export function priorityOrder(rows: readonly DeveloperCoverage[]): DeveloperCoverage[] {
  return [...rows].sort(
    (a, b) =>
      b.blockedByInformation - a.blockedByInformation ||
      b.pending - a.pending ||
      b.active - a.active ||
      a.developerId.localeCompare(b.developerId),
  )
}

/**
 * Los tickets que una llamada desbloquea, del más barato al más caro.
 *
 * **Solo entran los que se arreglan declarando**, que son los del grupo P1 salvo `NO_TRADUCIBLE`: un
 * ticket que GLPI entrega con un tipo que el contrato no conoce no mejora porque alguien escriba sus
 * horas. Los demás —capacidad, acuerdo, plan viejo— no se resuelven en la pantalla de declaración y
 * ya tienen su propio panel.
 *
 * **El orden es el de la acción, no el del identificador.** Primero lo que le falta un solo dato
 * —estimar o comprometer—, porque es la llamada más corta; después lo que no tiene nada. A igual
 * esfuerzo manda la persona que desbloquea más, y dentro de ella la prioridad cruda de GLPI (5 antes
 * que 1) y la antigüedad, que es lo que lleva más tiempo esperando. El identificador cierra el orden
 * para que dos ejecuciones den la misma lista.
 */
export function priorityTickets(
  pending: readonly PendingItem[],
  rows: readonly DeveloperCoverage[],
): PendingItem[] {
  const leverage = new Map(rows.map((row) => [row.developerId, row.blockedByInformation]))
  const effort = (cause: PendingItem['cause']): number =>
    cause === 'SIN_ESTIMACION' || cause === 'SIN_COMPROMISO' ? 0 : 1

  return pending
    .filter((item) => PENDING_GROUP[item.cause] === 'P1' && item.cause !== 'NO_TRADUCIBLE')
    .sort(
      (a, b) =>
        effort(a.cause) - effort(b.cause) ||
        (leverage.get(b.developerId) ?? 0) - (leverage.get(a.developerId) ?? 0) ||
        (b.priority ?? 0) - (a.priority ?? 0) ||
        (a.createdAt ?? '9999').localeCompare(b.createdAt ?? '9999') ||
        a.workItemId.localeCompare(b.workItemId),
    )
}
