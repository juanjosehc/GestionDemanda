import type { DeclarationItem } from '@/types/declarations'
import type { DeveloperDeclarationsResponse } from '@/types/declarations'
import type { RenegotiationsResponse, RenegotiationStatus } from '@/types/renegotiations'
import type { TeamPerson } from '@/types/team'
import type { TimelineItem, TimelineItemStatus } from '@/types/timeline'

/**
 * Los estados del dominio que significan que el ticket ya no es carga.
 *
 * **El dueño de esta exclusión es el backend**, y aquí se repite a propósito. `activeTicketsOf` pide a
 * GLPI por el grupo de estados `12=1,2,3,4` y vuelve a filtrar en cliente, así que un ticket resuelto o
 * cerrado no debería llegar nunca hasta aquí. Esta guarda existe porque el brief fija la regla como
 * **garantía de pantalla** —«NO mostrar: Cerrado, Resuelto»— y el coste de las dos líneas es menor que
 * el de una lista de trabajo que un día enseñe trabajo terminado sin que nadie lo note.
 *
 * Los nombres son los del dominio ya traducido, no los códigos de GLPI: `RESUELTO` cubre los estados 5
 * y 6 de una incidencia, y `FINALIZADO` los de un requerimiento. Ver `GlpiContract.REST_V1`.
 *
 * Un estado nulo **no** se descarta: significa que el tipo o el estado no se pudieron traducir, y de eso
 * no se sigue que el ticket esté cerrado.
 */
const FINAL_STATUSES: ReadonlySet<string> = new Set(['RESUELTO', 'FINALIZADO'])

/** Si este ticket sigue siendo carga de trabajo. */
export function isActive(item: DeclarationItem): boolean {
  return item.status === null || !FINAL_STATUSES.has(item.status)
}

/**
 * Una fila de la tabla: un ticket activo, y la persona a la que GLPI se lo tiene asignado.
 *
 * **De quién es el ticket no se deduce: se sabe por construcción.** Cada respuesta es la de una
 * persona, así que emparejar la respuesta con su persona es lo único que hace falta para llenar la
 * columna, y un ticket asignado a dos personas aparece en las dos —cada una lo tiene como carga— sin
 * que haya que inventar una regla de propiedad.
 */
export interface IncidentRow {
  /** El login de la persona a la que se le preguntó por este ticket. */
  developerId: string
  /** Su nombre tal como lo publica el padrón, con el login de respaldo. */
  personName: string
  /** El ticket, ya clasificado por el backend. */
  item: DeclarationItem
  /** Lo que el plan y la renegociación dicen de este ticket, sin recalcular nada. */
  facts: IncidentFacts
}

/**
 * Lo que el plan y la renegociación dicen de un ticket.
 *
 * **Son dos lecturas distintas y por eso no se funden.** `planStatus` sale de los tramos del plan
 * vigente —lo que el motor colocó— y `agreement` de la renegociación —el estado que el backend ya
 * calculó—. Un ticket desplazado sin acuerdo es `DESPLAZADO` + `PENDIENTE_DE_ACUERDO`, y esas dos
 * columnas son las que dejan ver qué está colocado y qué espera una fecha.
 *
 * **`undefined` no es `null`.** `null` es un hecho —el ticket no tiene tramo en el plan, o no tiene
 * acuerdo registrado—; `undefined` es que la lectura todavía no llegó o falló. Pintar «Sin plan» sin
 * haber leído el plan sería afirmarlo, y la tabla dice `—` en ese caso.
 */
export interface IncidentFacts {
  planStatus: TimelineItemStatus | null | undefined
  agreement: RenegotiationStatus | null | undefined
}

/** Los hechos de un ticket, tal como los entrega quien ya leyó el plan y la renegociación. */
export type IncidentFactsOf = (developerId: string, workItemId: string) => IncidentFacts

const NO_FACTS: IncidentFacts = { planStatus: undefined, agreement: undefined }

/**
 * Las filas del equipo: los tickets activos de cada persona, con su dueño al lado.
 *
 * Las dos listas van **en el mismo orden** y se emparejan por posición —el contrato que `useQueries`
 * garantiza, y la misma convención que `knownTickets`—. Una respuesta que falta (consulta en vuelo,
 * `404` de GLPI, ruta caída) deja a esa persona **fuera**, sin inventarle filas: no es lo mismo no
 * tener tickets que no haberse podido leer.
 *
 * El nombre se toma del padrón y no de la respuesta de la declaración, por el mismo motivo que en la
 * tabla del equipo: el padrón responde por todas las personas, y aquí solo se pregunta por los tickets.
 */
export function toIncidentRows(
  people: readonly TeamPerson[],
  declarations: readonly (DeveloperDeclarationsResponse | undefined)[],
  factsOf: IncidentFactsOf = () => NO_FACTS,
): IncidentRow[] {
  const rows: IncidentRow[] = []

  people.forEach((person, index) => {
    const declaration = declarations[index]

    if (!declaration) {
      return
    }

    for (const item of declaration.items) {
      if (isActive(item)) {
        rows.push({
          developerId: person.developerId,
          personName: person.name ?? person.developerId,
          item,
          facts: factsOf(person.developerId, item.workItemId),
        })
      }
    }
  })

  return rows
}

/**
 * El puesto de un tipo en el orden por defecto: primero lo que interrumpe.
 *
 * Un incidente es trabajo que ya está pasando —algo dejó de funcionar— y un requerimiento es trabajo
 * planificable, que espera a que alguien lo planifique. El brief fija ese orden como primera clave y
 * es el que separa lo urgente de lo importante. Un tipo que no se pudo traducir va al final: no es
 * ninguna de las dos cosas, y ponerlo arriba sería afirmar que es lo más urgente.
 */
const TYPE_RANK: Readonly<Record<string, number>> = { INCIDENTE: 0, REQUERIMIENTO: 1 }

function rankOf(item: DeclarationItem): number {
  return item.type === null ? 2 : (TYPE_RANK[item.type] ?? 2)
}

/**
 * El orden por defecto de la tabla, en tres claves y sin depender de cómo llegó la lista.
 *
 * 1. **Incidentes antes que requerimientos** (ver {@link TYPE_RANK}).
 * 2. **Prioridad descendente.** En la escala de GLPI el 5 es «muy alta», así que lo más urgente queda
 *    arriba. Una prioridad nula ordena como `-1` y cae al final, a la vista, en vez de confundirse con
 *    una prioridad baja: no es lo mismo.
 * 3. **Fecha de apertura ascendente.** A igual tipo y prioridad, lo que lleva más tiempo abierto es lo
 *    que más ha esperado, y eso es lo que convierte la tabla en una lista de trabajo y no en un
 *    historial. Es la única fecha que esta ruta publica de GLPI. Una fecha ilegible va al final.
 *
 * El desempate final es el identificador —y, si el mismo ticket lo comparten dos personas, también el
 * de la persona—: sin él, dos filas iguales podrían intercambiarse entre ordenaciones y la tabla se
 * vería distinta sin que nada hubiera cambiado.
 */
export function sortIncidents(rows: readonly IncidentRow[]): IncidentRow[] {
  return [...rows].sort((left, right) => {
    const byType = rankOf(left.item) - rankOf(right.item)

    if (byType !== 0) {
      return byType
    }

    const byPriority = (right.item.priority ?? -1) - (left.item.priority ?? -1)

    if (byPriority !== 0) {
      return byPriority
    }

    if (left.item.createdAt !== right.item.createdAt) {
      if (left.item.createdAt === null) {
        return 1
      }
      if (right.item.createdAt === null) {
        return -1
      }

      const byDate = left.item.createdAt.localeCompare(right.item.createdAt)

      if (byDate !== 0) {
        return byDate
      }
    }

    const byTicket = left.item.workItemId.localeCompare(right.item.workItemId)

    return byTicket !== 0 ? byTicket : left.developerId.localeCompare(right.developerId)
  })
}

/** Valor de un filtro sin aplicar. No es ninguna persona ni ningún estado: es la ausencia de filtro. */
export const ANY = ''

/** Los dos valores del filtro de declaración: el ticket está listo para planificarse, o le falta algo. */
export const DECLARED = 'DECLARADO'
export const PENDING = 'PENDIENTE'

/**
 * Los valores del filtro de planificación, en una sola escala.
 *
 * **`CON_PLAN` y `SIN_PLAN` no son un estado más: son la pregunta de pertenencia**, y por eso
 * comparten el mismo control con `PLANIFICADO` y `DESPLAZADO` —que sí son los dos estados del
 * tramo—. Así el gestor elige una cosa a la vez y no puede pedir «con plan» y «sin plan» juntos,
 * que es la clase de combinación que solo produce una tabla vacía.
 */
export const WITH_PLAN = 'CON_PLAN'
export const WITHOUT_PLAN = 'SIN_PLAN'
export const PLANNED = 'PLANIFICADO'
export const DISPLACED = 'DESPLAZADO'

/** Los dos valores del estado de renegociación, tal como los publica el backend. */
export const PENDING_AGREEMENT = 'PENDIENTE_DE_ACUERDO'
export const AGREED = 'ACORDADA'

export interface IncidentFilters {
  person: string
  type: string
  status: string
  declaration: string
  planning: string
  renegotiation: string
}

export const NO_FILTERS: IncidentFilters = {
  person: ANY,
  type: ANY,
  status: ANY,
  declaration: ANY,
  planning: ANY,
  renegotiation: ANY,
}

/**
 * Los dos modos de la vista: solo el equipo operativo, o todo Desarrollo N2.
 *
 * Vive aquí y no en la página porque **la dirección lo lleva**: el enlace de vuelta desde la
 * declaración tiene que poder reconstruir la vista tal como estaba, y quien escribe esa dirección es
 * `navigation.ts`, que no puede importar de una página.
 */
export type TeamViewMode = 'operativo' | 'todos'

/**
 * El nombre de cada filtro en la dirección, y el del modo.
 *
 * En español, como el resto de las rutas. Son **los únicos sitios donde se escriben**: el que los pone
 * y el que los lee son las funciones de abajo.
 */
const PARAM_OF: Readonly<Record<keyof IncidentFilters, string>> = {
  person: 'persona',
  type: 'tipo',
  status: 'estado',
  declaration: 'declaracion',
  planning: 'planificacion',
  renegotiation: 'renegociacion',
}

const MODE_PARAM = 'modo'

/** El valor del modo que no es el de por defecto, y por eso es el único que viaja. */
const ALL_TEAM: TeamViewMode = 'todos'

/**
 * Los filtros que trae una dirección, para sembrar la vista con ellos.
 *
 * **No se validan aquí.** Un valor que la tabla no conozca llega al `<select>` sin opción que case, la
 * tabla sale vacía y se lee «Ningún ticket coincide con los filtros», que es exactamente lo que
 * significa. Validarlo contra las opciones exigiría tener las filas ya leídas, y la siembra ocurre
 * antes de que lleguen.
 */
export function filtersFromParams(params: URLSearchParams): IncidentFilters {
  const filters = { ...NO_FILTERS }

  for (const field of Object.keys(PARAM_OF) as (keyof IncidentFilters)[]) {
    filters[field] = params.get(PARAM_OF[field]) ?? ANY
  }

  return filters
}

/** El modo que trae una dirección. Cualquier cosa que no sea «todos» es el de por defecto. */
export function modeFromParams(params: URLSearchParams): TeamViewMode {
  return params.get(MODE_PARAM) === ALL_TEAM ? ALL_TEAM : 'operativo'
}

/**
 * El modo, en la direccion, y solo cuando no es el de por defecto.
 *
 * Es el espejo de `modeFromParams`: lo que uno escribe el otro lo lee. Existe porque la vista previa
 * del estado de entrada tambien conserva su conmutador en la vuelta —su enlace a la declaracion
 * devuelve a la misma vista—, y componer `?modo=todos` a mano en una pantalla seria el segundo sitio
 * donde se escribe ese nombre.
 */
export function modeQuery(mode: TeamViewMode): string {
  return mode === ALL_TEAM ? `${MODE_PARAM}=${ALL_TEAM}` : ''
}

/**
 * Los filtros y el modo, en una sola cadena de consulta.
 *
 * **Solo viaja lo que no está en su valor por defecto**, así que la vista sin tocar se escribe como la
 * ruta pelada y no como una dirección con cuatro huecos. El modo va con su nombre y no con un
 * booleano: es el valor que el conmutador usa y el que `modeFromParams` sabe leer.
 *
 * La usa el enlace de vuelta. Lo que se guarda es **a dónde volver**, no el estado de la pantalla: por
 * eso se compone en el momento del clic, con lo que hay vivo en ese instante.
 */
export function incidentsQuery(filters: IncidentFilters, mode: TeamViewMode): string {
  const params = new URLSearchParams()

  for (const field of Object.keys(PARAM_OF) as (keyof IncidentFilters)[]) {
    if (filters[field] !== ANY) {
      params.set(PARAM_OF[field], filters[field])
    }
  }
  if (mode !== 'operativo') {
    params.set(MODE_PARAM, mode)
  }

  return params.toString()
}

/**
 * En cuál de los dos lados del filtro de declaración cae un ticket.
 *
 * **`PLANIFICABLE` es el único estado que significa que no falta nada**: es el que el backend emite
 * cuando el ticket es traducible y tiene estimación y compromiso. Todo lo demás —falta la estimación,
 * falta el compromiso, no hay nada declarado, o el ticket no se pudo traducir— cae en `PENDIENTE`, que
 * es la respuesta a «¿qué tickets necesitan declaración?».
 *
 * El estado se lee, no se recalcula: mirar `estimatedHours` o `committedDate` para deducirlo sería una
 * segunda versión de la regla que el backend ya aplicó.
 */
export function declarationSideOf(item: DeclarationItem): string {
  return item.declarationStatus === 'PLANIFICABLE' ? DECLARED : PENDING
}

/**
 * Los filtros, aplicados en memoria sobre las filas ya recibidas.
 *
 * No hay una petición por filtro: las filas ya están todas en pantalla y filtrar en el servidor
 * convertiría una selección de la interfaz en tráfico contra el backend. Es el mismo trato que los
 * filtros de las alertas.
 */
export function filterIncidents(
  rows: readonly IncidentRow[],
  filters: IncidentFilters,
): IncidentRow[] {
  return rows.filter(
    (row) =>
      (filters.person === ANY || row.developerId === filters.person) &&
      (filters.type === ANY || row.item.type === filters.type) &&
      (filters.status === ANY || row.item.status === filters.status) &&
      (filters.declaration === ANY || declarationSideOf(row.item) === filters.declaration) &&
      matchesPlanning(row.facts, filters.planning) &&
      (filters.renegotiation === ANY || row.facts.agreement === filters.renegotiation),
  )
}

/**
 * El filtro de planificación, con la diferencia entre «sin plan» y «no se sabe».
 *
 * **`SIN_PLAN` exige `null`, no «falsy».** Mientras el plan no se ha leído, `planStatus` es
 * `undefined`; tratarlo como «sin plan» afirmaría un hecho que no se ha comprobado y haría que la
 * tabla cambiara de contenido al llegar la lectura. Un estado desconocido solo pasa el filtro vacío.
 */
function matchesPlanning(facts: IncidentFacts, value: string): boolean {
  if (value === ANY) {
    return true
  }

  if (value === WITH_PLAN) {
    return facts.planStatus === PLANNED || facts.planStatus === DISPLACED
  }

  if (value === WITHOUT_PLAN) {
    return facts.planStatus === null
  }

  return facts.planStatus === value
}

/**
 * Lo que el plan y la renegociación dicen de cada ticket, indexado para la tabla.
 *
 * **Las dos lecturas se pasan como llegaron, y `undefined` significa «no llegó».** No hay una
 * segunda consulta ni un recálculo: los tramos ya vienen del plan vigente y el estado de cada
 * acuerdo ya lo calculó el backend. Lo único que se decide aquí es **el estado del tramo cuando el
 * ticket tiene varios**: si alguno se desplazó, el ticket es `DESPLAZADO`, porque el plan lo movió y
 * eso es lo que hay que ver aunque otro tramo siga en su fecha.
 */
export function factsReader(
  items: readonly TimelineItem[] | undefined,
  renegotiations: RenegotiationsResponse | undefined,
): IncidentFactsOf {
  const plans = items === undefined ? undefined : new Map<string, TimelineItemStatus>()

  for (const item of items ?? []) {
    const key = `${item.developerId}|${item.workItemId}`
    const current = plans?.get(key)

    if (current === 'DESPLAZADO') {
      continue
    }

    plans?.set(key, item.planningStatus)
  }

  // El acuerdo es del ticket y no de la persona: un ticket compartido se acuerda una vez.
  const agreements =
    renegotiations === undefined
      ? undefined
      : new Map(renegotiations.items.map((item) => [item.workItemId, item.status]))

  return (developerId, workItemId) => ({
    planStatus:
      plans === undefined ? undefined : (plans.get(`${developerId}|${workItemId}`) ?? null),
    agreement: agreements === undefined ? undefined : (agreements.get(workItemId) ?? null),
  })
}

/**
 * Lo que hay en pantalla, contado por estado de declaración.
 *
 * **Las cifras se solapan y no se suman.** `pending` es todo lo que no es `PLANIFICABLE`, así que
 * `withoutEstimation` y `withoutGlpiDate` están **dentro** de él: un ticket sin estimación también
 * es un ticket pendiente y aparece en las dos cuentas. Lo que no cae en ninguna de las dos son
 * `SIN_DECLARACION` y `NO_TRADUCIBLE`, que están dentro de `pending` sin nombre propio. Es un
 * desglose, no un reparto, y quien lo pinte tiene que enseñarlo como tal.
 *
 * El estado **se lee, no se recalcula**: es el mismo trato que `declarationSideOf` y por el mismo
 * motivo. Mirar `estimatedHours` o `committedDate` para deducir si falta algo sería la segunda versión
 * de la regla que el backend ya aplicó.
 */
export interface DeclarationBreakdown {
  /** Los que no tienen nada pendiente: los `PLANIFICABLE`. */
  declared: number
  /** Todo lo demás. Es la respuesta a «¿cuántos necesitan declaración?». */
  pending: number
  /** Tienen fila y les falta la estimación. Cuentan también en `pending`. */
  withoutEstimation: number
  /**
   * Tienen fila y GLPI no les publica fecha con la que ubicarlos. Cuentan también en `pending`.
   *
   * Se llamó `withoutCommitment` hasta la Fase 77, cuando la fecha se declaraba. Desde que la
   * publica GLPI, lo que este parcial cuenta no es una declaración que falte sino un ticket al que
   * el sistema no puede ubicar: el nombre viejo describía una carencia que ya no existe.
   */
  withoutGlpiDate: number
}

export function declarationBreakdown(rows: readonly IncidentRow[]): DeclarationBreakdown {
  const breakdown: DeclarationBreakdown = {
    declared: 0,
    pending: 0,
    withoutEstimation: 0,
    withoutGlpiDate: 0,
  }

  for (const row of rows) {
    if (declarationSideOf(row.item) === DECLARED) {
      breakdown.declared += 1
    } else {
      breakdown.pending += 1
    }

    if (row.item.declarationStatus === 'SIN_ESTIMACION') {
      breakdown.withoutEstimation += 1
    }
    if (row.item.declarationStatus === 'SIN_COMPROMISO') {
      breakdown.withoutGlpiDate += 1
    }
  }

  return breakdown
}
