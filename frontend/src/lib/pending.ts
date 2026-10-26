import { declarationPath, planningPath, renegotiationPath } from '@/routes/navigation'
import { isActive } from '@/lib/incidents'
import type { DeclarationItem, DeclarationStatus, DeveloperDeclarationsResponse } from '@/types/declarations'
import type { RenegotiationsResponse } from '@/types/renegotiations'
import type { TeamConflict, TimelineItem } from '@/types/timeline'

/**
 * El trabajo que existe y no está colocado en el plan vigente de nadie.
 *
 * **Es la tercera capa del timeline**, la que la vista no podía enseñar: los tramos dicen lo que el
 * motor planeó, y esto dice lo que quedó fuera. Se arma cruzando tres lecturas que ya existían —los
 * tickets que GLPI tiene asignados a cada persona, los tramos del plan vigente y los conflictos que
 * el propio motor publicó— sin pedirle nada nuevo al backend ni recalcular ningún plan.
 *
 * **Nada de aquí decide qué es planificable.** Esa clasificación la publica el backend en
 * `declarationStatus`, y esta capa solo la lee: un ticket está pendiente porque el backend dijo que
 * no entra al plan, no porque aquí se mire si tiene estimación o compromiso.
 *
 * **Nada de aquí decide qué no cupo.** Eso lo dice el motor en `conflicts`, y esta capa solo lo
 * indexa. Es la única forma de separar el trabajo que el plan rechazó del que nunca llegó a su
 * entrada: el plan guarda lo que recibió y lo que rechazó, no lo que nunca le dieron.
 */

/**
 * El grupo al que pertenece un pendiente. Son las cuatro preguntas que la fase separa.
 *
 * - `P1` — **el trabajo no tiene información suficiente.** No se puede planificar todavía: le falta
 *   una estimación, un compromiso o que GLPI lo entregue de forma legible.
 * - `P2` — **el trabajo sí llegó al motor y no cupo.** Hay una decisión de capacidad detrás: el
 *   plan vigente lo recibió, lo intentó colocar y lo dejó fuera con su motivo.
 * - `P3` — **el trabajo está desplazado y sin acuerdo.** Está en el plan, pero en una fecha que
 *   nadie aceptó todavía.
 * - `P4` — **el trabajo no entró en la última planificación.** Es planificable hoy, no está en el
 *   plan y el motor no lo rechazó: no estaba en su entrada cuando el plan se calculó.
 *
 * **P2 y P4 se veían iguales antes y son hechos distintos.** El primero es una decisión del motor
 * sobre trabajo que conoció; el segundo es trabajo que el motor nunca vio. El plan no guarda el
 * trabajo que no recibió, así que esta distinción solo se puede hacer con las dos listas: la de
 * conflictos y la de tramos.
 */
export type PendingGroup = 'P1' | 'P2' | 'P3' | 'P4'

/**
 * Por qué un ticket está pendiente, dicho con la causa y no con el grupo.
 *
 * **Es lo que la pantalla enseña en cada fila.** «Pendiente» no es una respuesta: la pregunta del
 * gestor es qué falta, y las cinco causas que puede leer son «Sin estimación», «Sin compromiso»,
 * «Sin acuerdo», «Fuera por capacidad» y «No incluido en el último plan».
 *
 * Las cuatro primeras —las de información— son **exactamente el `declarationStatus` del backend** y
 * no una traducción propia: si mañana el validador distingue un caso nuevo, esta capa lo mostrará
 * con el rótulo que se le dé sin volver a decidir nada. Las otras tres las decide el plan o la
 * renegociación, y también llegan decididas.
 */
export type PendingCause =
  | Exclude<DeclarationStatus, 'PLANIFICABLE'>
  | 'FUERA_POR_CAPACIDAD'
  | 'SIN_ACUERDO'
  | 'NO_INCLUIDO_EN_EL_PLAN'

/** El grupo de cada causa. Es la única tabla que los cruza, y por eso no se guarda dos veces. */
export const PENDING_GROUP: Record<PendingCause, PendingGroup> = {
  SIN_ESTIMACION: 'P1',
  SIN_COMPROMISO: 'P1',
  SIN_DECLARACION: 'P1',
  NO_TRADUCIBLE: 'P1',
  FUERA_POR_CAPACIDAD: 'P2',
  SIN_ACUERDO: 'P3',
  NO_INCLUIDO_EN_EL_PLAN: 'P4',
}

/** El grupo en palabras: lo que se lee en el resumen del panel. */
export const PENDING_GROUP_LABEL: Record<PendingGroup, string> = {
  P1: 'Falta información',
  P2: 'Fuera por capacidad',
  P3: 'Sin acuerdo',
  P4: 'No incluido en el último plan',
}

/** La causa en palabras. Es el rótulo de cada fila. */
export const PENDING_CAUSE_LABEL: Record<PendingCause, string> = {
  SIN_ESTIMACION: 'Sin estimación',
  SIN_COMPROMISO: 'Sin compromiso',
  SIN_DECLARACION: 'Sin declaración',
  NO_TRADUCIBLE: 'No traducible',
  FUERA_POR_CAPACIDAD: 'Fuera por capacidad',
  SIN_ACUERDO: 'Sin acuerdo',
  NO_INCLUIDO_EN_EL_PLAN: 'No incluido en el último plan',
}

/**
 * Qué hacer con cada causa. Va debajo del rótulo, en el panel y en el título del enlace.
 *
 * Las cuatro de información mandan a declarar porque **es lo único que las desbloquea**: sin
 * estimación el motor no sabe cuánto ocupa, y sin compromiso no sabe para cuándo. «No incluido en el
 * último plan» no se arregla declarando —ya está declarado—, se arregla generando el plan otra vez;
 * por eso su texto lo dice y su enlace no es el mismo que el de declarar.
 */
export const PENDING_CAUSE_DETAIL: Record<PendingCause, string> = {
  SIN_ESTIMACION: 'GLPI lo tiene asignado y le faltan las horas: el motor no sabe cuánto ocupa.',
  SIN_COMPROMISO: 'Tiene horas, pero nadie fijó para cuándo: el motor no sabe dónde colocarlo.',
  SIN_DECLARACION: 'GLPI lo tiene asignado y no tiene ni horas ni fecha compromiso.',
  NO_TRADUCIBLE: 'GLPI lo entrega con un tipo que el contrato no conoce; no se puede clasificar.',
  FUERA_POR_CAPACIDAD: 'Sí entró al motor y no cupo: el plan vigente lo dejó fuera por capacidad.',
  SIN_ACUERDO: 'El plan lo movió de fecha y todavía nadie acordó la fecha nueva.',
  NO_INCLUIDO_EN_EL_PLAN: 'Es planificable y el plan vigente no lo tiene; no estaba cuando se calculó.',
}

/** Un ticket activo que hoy no está en el plan de su técnico. */
export interface PendingItem {
  /** El login del técnico, tal como lo nombra el timeline. */
  developerId: string
  workItemId: string
  title: string
  /** Nulo si el tipo que trajo GLPI no está en el contrato. */
  type: DeclarationItem['type']
  /** Por qué está pendiente. El grupo se deriva con {@link PENDING_GROUP}. */
  cause: PendingCause
  /** El estado que publicó el backend, para poder contrastar la causa con su origen. */
  declarationStatus: DeclarationStatus
  /**
   * La prioridad cruda de GLPI, 1..5, tal como la publicó el backend.
   *
   * **Se copia, no se traduce.** El motor todavía no ha normalizado prioridades, y ordenar la lista de
   * llamadas no es motivo para inventar una escala: la pantalla usa el número tal como llega. Nula si
   * GLPI no la dio.
   */
  priority: number | null
  /** Cuándo lo creó GLPI. A igual impacto, el más viejo va primero. Nulo si no lo publicó. */
  createdAt: string | null
}

const NADA: ReadonlySet<string> = new Set()

/**
 * Por qué este ticket está pendiente, o nulo si no lo está.
 *
 * **El orden es una jerarquía declarada y se lee de arriba abajo.**
 *
 * 1. **Sin información.** Un ticket que no se puede planificar está pendiente aunque su
 *    identificador aparezca en un plan viejo: lo que hay ahí es un resto, y sin el dato no hay nada
 *    que colocar. Hablar de capacidad sería hablar de un paso que todavía no se puede dar.
 * 2. **Fuera del plan.** Si es planificable y no tiene tramo, la pregunta es si el motor lo rechazó
 *    (`conflicts`) o nunca lo recibió. Son dos causas distintas y hay que decirlas distintas.
 * 3. **Sin acuerdo.** Está en el plan, desplazado y esperando una fecha. Es el único que se da
 *    **dentro** del plan; se comprueba al final porque si algo no está colocado, no hay fecha que
 *    acordar.
 *
 * El orden deja una sola acción posible por fila: declarar, replanificar o acordar.
 */
function causeFor(
  item: DeclarationItem,
  planned: ReadonlySet<string>,
  agreements: ReadonlySet<string>,
  conflicts: ReadonlySet<string>,
): PendingCause | null {
  if (item.declarationStatus !== 'PLANIFICABLE') {
    return item.declarationStatus
  }

  if (!planned.has(item.workItemId)) {
    // El conflicto lo puso el motor al calcular; su ausencia y la de un tramo significan que el
    // trabajo no estaba en la entrada de ese plan.
    return conflicts.has(item.workItemId) ? 'FUERA_POR_CAPACIDAD' : 'NO_INCLUIDO_EN_EL_PLAN'
  }

  return agreements.has(item.workItemId) ? 'SIN_ACUERDO' : null
}

/**
 * Los pendientes de una persona.
 *
 * **Una declaración que falta —consulta en vuelo, `404` de GLPI, ruta caída— deja la lista vacía, no
 * llena de pendientes.** No es lo mismo no tener nada pendiente que no haberse podido leer, y quien
 * pinta tiene que poder distinguirlo: por eso el vacío de aquí significa «no se sabe», y el panel
 * dice «sin dato» mirando el estado de la consulta, no esta lista.
 *
 * Solo entran **tickets activos**: un ticket resuelto o cerrado no es trabajo pendiente y no tiene
 * por qué ensuciar la capa. La exclusión la decide `isActive`, que es de quien ya era.
 */
export function pendingOf(
  developerId: string,
  declaration: DeveloperDeclarationsResponse | undefined,
  planned: ReadonlySet<string>,
  agreements: ReadonlySet<string> = NADA,
  conflicts: ReadonlySet<string> = NADA,
): PendingItem[] {
  if (!declaration) {
    return []
  }

  const pending: PendingItem[] = []

  for (const item of declaration.items) {
    if (!isActive(item)) {
      continue
    }

    const cause = causeFor(item, planned, agreements, conflicts)

    if (cause) {
      pending.push({
        developerId,
        workItemId: item.workItemId,
        title: item.title,
        type: item.type,
        cause,
        declarationStatus: item.declarationStatus,
        priority: item.priority,
        createdAt: item.createdAt,
      })
    }
  }

  return pending
}

/**
 * Los identificadores que sí están en el plan, por técnico.
 *
 * **Es la única forma de saber qué quedó fuera, y por eso se calcula sobre los tramos del timeline**
 * —lo que el motor colocó— y no sobre las asignaciones: un requerimiento desplazado sigue teniendo su
 * asignación y sus tramos, así que mirar los tramos es mirar el plan tal como quedó.
 */
export function plannedByDeveloper(
  items: readonly TimelineItem[],
): Record<string, Set<string>> {
  const planned: Record<string, Set<string>> = {}

  for (const item of items) {
    let own = planned[item.developerId]

    if (!own) {
      own = new Set()
      planned[item.developerId] = own
    }

    own.add(item.workItemId)
  }

  return planned
}

/**
 * Qué tickets el motor rechazó, por técnico.
 *
 * **Es lo que separa P2 de P4, y no se puede deducir de ninguna otra lectura.** Un ticket
 * planificable sin tramo está fuera del plan; si además está aquí, el motor lo conoció y lo dejó
 * fuera por capacidad; si no está, el plan nunca lo recibió.
 *
 * El texto del conflicto no se copia aquí: viaja en `conflicts` y el panel de conflictos ya lo
 * enseña. Esta función solo lo indexa por persona y ticket, que es como lo pregunta la capa.
 */
export function conflictsByDeveloper(
  conflicts: readonly TeamConflict[],
): Record<string, Set<string>> {
  const byDeveloper: Record<string, Set<string>> = {}

  for (const conflict of conflicts) {
    let own = byDeveloper[conflict.developerId]

    if (!own) {
      own = new Set()
      byDeveloper[conflict.developerId] = own
    }

    own.add(conflict.workItemId)
  }

  return byDeveloper
}

/**
 * Los pendientes de todo el equipo.
 *
 * Las dos listas van **en el mismo orden** y se emparejan por posición —el contrato que `useQueries`
 * garantiza, y la misma convención que `knownTickets` y `toIncidentRows`—. Una respuesta que falta
 * deja a esa persona sin pendientes, y el panel lo dice mirando su consulta.
 *
 * Cuando la respuesta llega del lote —una sola, indexada por identificador— el llamador alinea las
 * listas antes de entrar aquí, porque un desconocido se cae de la respuesta y desplazaría a los
 * siguientes.
 */
export function teamPending(
  developerIds: readonly string[],
  declarations: readonly (DeveloperDeclarationsResponse | undefined)[],
  planned: Readonly<Record<string, ReadonlySet<string>>>,
  agreements: Readonly<Record<string, ReadonlySet<string>>> = {},
  conflicts: Readonly<Record<string, ReadonlySet<string>>> = {},
): PendingItem[] {
  return developerIds.flatMap((developerId, index) =>
    pendingOf(
      developerId,
      declarations[index],
      planned[developerId] ?? NADA,
      agreements[developerId] ?? NADA,
      conflicts[developerId] ?? NADA,
    ),
  )
}

/**
 * Qué tickets esperan un acuerdo, por técnico.
 *
 * **El estado no se deduce aquí**: llega calculado por el backend en `PENDIENTE_DE_ACUERDO`, que ya
 * tiene en cuenta si el desplazamiento vigente está cubierto por un acuerdo registrado. Esta función
 * solo lo indexa por persona y ticket, que es la forma en la que la capa de pendientes lo pregunta.
 *
 * Una lectura que no llegó deja el mapa vacío: no se sabe qué hay pendiente de acordar, y la
 * pantalla dice «no se pudo leer» mirando el estado de la consulta, no esta lista.
 */
export function pendingAgreements(
  renegotiations: RenegotiationsResponse | undefined,
): Record<string, Set<string>> {
  const byDeveloper: Record<string, Set<string>> = {}

  for (const item of renegotiations?.items ?? []) {
    if (item.status !== 'PENDIENTE_DE_ACUERDO') {
      continue
    }

    let own = byDeveloper[item.developerId]

    if (!own) {
      own = new Set()
      byDeveloper[item.developerId] = own
    }

    own.add(item.workItemId)
  }

  return byDeveloper
}

/** Cuántos pendientes tiene cada persona, para el aviso de su fila en la rejilla. */
export function pendingCounts(items: readonly PendingItem[]): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const item of items) {
    counts[item.developerId] = (counts[item.developerId] ?? 0) + 1
  }

  return counts
}

/**
 * Cuántos pendientes hay en cada grupo, para el resumen del panel.
 *
 * Es la respuesta de una línea a la pregunta del gestor: cuánto es falta de información y cuánto es
 * falta de capacidad. Los cuatro grupos salen siempre, con cero si no tienen nada, para que el
 * resumen no cambie de forma según los datos.
 */
export function pendingGroups(
  items: readonly PendingItem[],
): Record<PendingGroup, number> {
  const counts: Record<PendingGroup, number> = { P1: 0, P2: 0, P3: 0, P4: 0 }

  for (const item of items) {
    counts[PENDING_GROUP[item.cause]] += 1
  }

  return counts
}

/**
 * El sitio donde se resuelve un pendiente, según su causa.
 *
 * **Está aquí y no en la pantalla porque lo usan dos sitios que tienen que coincidir**: la fila del
 * panel de pendientes —donde se ve el ticket y su causa— y el chip «N pendientes» de la fila de la
 * rejilla, que con un solo pendiente lleva directo a lo mismo. Lo que falta se declara, lo que
 * espera una fecha se acuerda y lo que no entró en el plan se arregla volviendo a generarlo: no
 * declarando lo que ya está declarado.
 */
export function pendingPath(item: PendingItem, from?: string): string {
  if (item.cause === 'SIN_ACUERDO') return renegotiationPath(item.workItemId)
  if (item.cause === 'NO_INCLUIDO_EN_EL_PLAN') return planningPath(item.developerId)
  return declarationPath({ developerId: item.developerId, workItemId: item.workItemId, from })
}
