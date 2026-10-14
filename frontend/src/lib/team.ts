import type { DeveloperDeclarationsResponse } from '@/types/declarations'
import type { DeveloperPlanningMetrics } from '@/types/planningMetrics'
import type { RenegotiationItem } from '@/types/renegotiations'
import type { TeamPerson, TeamPersonSource } from '@/types/team'

/**
 * De dónde sale una fila de la tabla del equipo.
 *
 * Son los dos orígenes que publica el backend —el grupo de GLPI y las excepciones declaradas— más uno
 * que **solo existe aquí**: la fila de alguien que no está en el padrón y aparece porque tiene un plan
 * vigente. No se inventa para rellenar: existe porque un plan que ya está guardado no puede
 * desaparecer de la pantalla por no estar en el catálogo, y nombrar esa procedencia es lo que permite
 * distinguirla de un miembro del equipo.
 */
export type TeamMemberSource = TeamPersonSource | 'PLAN'

/**
 * Una persona del equipo, con lo que el sistema sabe de ella hoy.
 *
 * **La persona ya no es su plan.** Antes esta fila *era* un plan vigente —heredaba sus campos— y por
 * eso quien no tenía plan no aparecía. Ahora la fila es una persona del padrón y el plan es un dato
 * suyo que puede faltar: `plan` en nulo significa que esa persona está en el equipo y hoy no tiene
 * nada planificado, que es un hecho distinto de no existir.
 *
 * Nada de lo que hay aquí se calcula: el nombre, el identificador de GLPI y la vigencia los publica
 * `/api/team`; la capacidad, los desplazamientos y las fechas, `/api/planning/metrics`; los tickets,
 * la declaración del técnico; y el estado de cada renegociación lo decide el backend al leer. Esta
 * capa solo los cruza por identificador.
 *
 * Nulo no es cero. `name`, `tickets` y `pendingRenegotiations` vienen en nulo cuando esa lectura no
 * respondió o no se pidió, y eso es un hecho distinto de «no tiene ninguno»: la vista tiene que poder
 * decirlo sin afirmar lo que no sabe.
 */
export interface TeamMember {
  /** El login con el que el sistema nombra a esta persona. */
  developerId: string
  /** Su identificador en GLPI, o nulo si no tiene cuenta o no está en el padrón. */
  glpiId: number | null
  /** El nombre que GLPI publica para esta persona, o nulo si no lo publica. */
  name: string | null
  /** Si el padrón la da por vigente. */
  active: boolean
  sourceType: TeamMemberSource
  /** Su plan vigente, o nulo si hoy no tiene ninguno. */
  plan: DeveloperPlanningMetrics | null
  /** Tickets que GLPI tiene asignados, o nulo si esa lectura no se pidió o no respondió. */
  tickets: number | null
  /** Renegociaciones en PENDIENTE_DE_ACUERDO, o nulo si la lista no se pudo leer. */
  pendingRenegotiations: number | null
}

/** El nombre de la persona, con su identificador como respaldo.
 *
 * El respaldo es para poder ordenar y para no dejar una celda vacía cuando no hay nombre —el
 * identificador es un dato, aunque no sea el bueno para reconocer a alguien—. Quien pinta la celda
 * comprueba `name` para decir que ese respaldo es lo que es.
 */
export function personName(member: TeamMember): string {
  return member.name ?? member.developerId
}

/**
 * Las claves con las que el resto del sistema puede haberse referido a esta persona.
 *
 * El sistema la nombra por su login, pero un plan se guarda con **lo que se tecleó al pedirlo**, y eso
 * puede haber sido su número de GLPI. Cruzar por las dos es lo que evita que una misma persona aparezca
 * dos veces —una fila por clave— o que se quede sin sus tickets por haberlos pedido con la otra.
 */
function keysOf(person: TeamPerson): string[] {
  return person.glpiId === null ? [person.developerId] : [person.developerId, String(person.glpiId)]
}

/**
 * Los tickets que sí llegaron, por identificador.
 *
 * Las dos listas van **en el mismo orden** y se emparejan por posición: es el contrato que
 * `useQueries` garantiza —devuelve una respuesta por consulta, en el orden en que se pidieron—, y por
 * eso vive junto al único sitio que lo produce en vez de dispersarse por la tabla.
 *
 * Una respuesta que falta —consulta en vuelo, `404` de GLPI, ruta caída— deja a esa persona fuera del
 * mapa, y quien la lea la verá como «sin dato». Meterla con ceros afirmaría que no tiene tickets.
 *
 * **El nombre no se toma de aquí.** Lo publica el padrón, que es la lectura del equipo entero y
 * responde por todas las personas; la declaración solo se pide por los tickets, y solo por quienes
 * tienen plan vigente.
 */
export function knownTickets(
  developerIds: readonly string[],
  declarations: readonly (DeveloperDeclarationsResponse | undefined)[],
): Record<string, number | undefined> {
  const tickets: Record<string, number | undefined> = {}

  developerIds.forEach((developerId, index) => {
    const declaration = declarations[index]

    if (declaration) {
      tickets[developerId] = declaration.items.length
    }
  })

  return tickets
}

/** Las renegociaciones abiertas de cada persona, contadas sobre la lista entera. */
function countPending(renegotiations: readonly RenegotiationItem[] | null): Record<string, number> {
  const pending: Record<string, number> = {}

  for (const item of renegotiations ?? []) {
    if (item.status === 'PENDIENTE_DE_ACUERDO') {
      pending[item.developerId] = (pending[item.developerId] ?? 0) + 1
    }
  }

  return pending
}

/**
 * Las filas del equipo: las personas del padrón, cada una con lo que se sabe de ella.
 *
 * **Quién aparece lo decide el padrón**, que es lo que cambió: antes lo decidía la fotografía
 * operativa y por eso una persona sin plan vigente no existía para esta pantalla. Ahora aparece
 * aunque no tenga plan, y su plan —si lo tiene— se le cuelga del identificador.
 *
 * El plan se busca por el identificador de la persona y, si no está, por su número de GLPI. Son las
 * dos formas en que un plan se puede haber calculado: tecleando el login o tecleando el número, y el
 * sistema registra el plan con lo que se tecleó. Sin la segunda búsqueda, un plan pedido por número
 * aparecería como una segunda fila de la misma persona.
 *
 * Los planes que no reclama nadie se añaden al final y **no se descartan**: un plan guardado que
 * desaparece de la pantalla es peor que una fila con una procedencia incómoda. Se marcan como
 * `PLAN`, que es exactamente lo que son —alguien a quien solo se conoce por su plan—, y quedan al
 * final para que no se confundan con el equipo que GLPI sí publica.
 *
 * Las pendientes se cuentan aquí sobre la lista entera, que es **una sola respuesta** con el
 * `developerId` en cada fila: agrupar es leer un campo que ya viaja, no pedir una lista por técnico
 * ni volver a decidir qué significa «pendiente» —eso lo decidió el backend y viaja en `status`—.
 *
 * La lista en nulo significa que no se pudo leer, y entonces el pendiente de todos queda sin dato.
 * Una lista vacía es otra cosa: significa que no hay ninguna renegociación abierta.
 */
export function toTeamMembers(
  people: readonly TeamPerson[],
  byDeveloper: readonly DeveloperPlanningMetrics[],
  known: Readonly<Record<string, number | undefined>>,
  renegotiations: readonly RenegotiationItem[] | null,
): TeamMember[] {
  const pending = countPending(renegotiations)
  const byId = new Map<string, DeveloperPlanningMetrics>()

  for (const developer of byDeveloper) {
    byId.set(developer.developerId, developer)
  }

  const claimed = new Set<string>()

  const fromCatalog = people.map((person) => {
    // El plan se guarda con el identificador que se tecleó al pedirlo: el login o el número. Por eso
    // se busca por los dos, y el número solo cuando la persona tiene uno.
    const plan =
      keysOf(person)
        .map((key) => byId.get(key))
        .find((found) => found !== undefined) ?? null

    if (plan) {
      claimed.add(plan.developerId)
    }

    // Los tickets y las renegociaciones se pidieron y se guardaron con **la clave del plan**, no con el
    // login: preguntarlos por el login de alguien cuyo plan se pidió por su número daría «sin dato» en
    // una lectura que sí respondió. Sin plan no se preguntó nada, y la clave propia da lo mismo.
    const key = plan?.developerId ?? person.developerId

    return {
      developerId: person.developerId,
      glpiId: person.glpiId,
      name: person.name,
      active: person.active,
      sourceType: person.sourceType,
      plan,
      tickets: known[key] ?? null,
      pendingRenegotiations: renegotiations === null ? null : (pending[key] ?? 0),
    }
  })

  const fromPlanOnly = byDeveloper
    .filter((developer) => !claimed.has(developer.developerId))
    .map((developer) => ({
      developerId: developer.developerId,
      glpiId: null,
      name: null,
      // El padrón no dijo nada de esta persona; no hay nada que marcar como retirado.
      active: true,
      sourceType: 'PLAN' as const,
      plan: developer,
      tickets: null,
      pendingRenegotiations: renegotiations === null ? null : (pending[developer.developerId] ?? 0),
    }))

  return [...fromCatalog, ...fromPlanOnly]
}

/** Columnas por las que se puede ordenar la tabla del equipo. */
export type TeamSortKey =
  | 'name'
  | 'developerId'
  | 'tickets'
  | 'displacedRequirements'
  | 'pendingRenegotiations'
  | 'availableHours'
  | 'occupiedHours'
  | 'remainingHours'

export type SortDirection = 'asc' | 'desc'

/**
 * De dónde sale el valor de cada columna ordenable.
 *
 * La tabla mapea clave a valor en un solo sitio: añadir una columna sin decir por qué se ordena no
 * compila, y ninguna vista escribe el nombre del campo a mano.
 *
 * Lo que no se pudo leer ordena como `-1`, no como `0`. Un cero es un hecho —no tiene tickets— y `-1`
 * es la falta de dato: al ordenar ascendente la fila sin dato queda arriba, a la vista, en vez de
 * confundirse con las que sí se leyeron y no tienen nada. **Una persona sin plan vigente también
 * ordena como `-1` en las tres columnas de capacidad**: no tiene cero horas, no tiene ninguna.
 */
const SORT_ACCESSORS: Record<TeamSortKey, (member: TeamMember) => string | number> = {
  name: (member) => personName(member),
  developerId: (member) => member.developerId,
  tickets: (member) => member.tickets ?? -1,
  displacedRequirements: (member) => member.plan?.displacedRequirements ?? -1,
  pendingRenegotiations: (member) => member.pendingRenegotiations ?? -1,
  availableHours: (member) => member.plan?.capacity.availableHours ?? -1,
  occupiedHours: (member) => member.plan?.capacity.occupiedHours ?? -1,
  remainingHours: (member) => member.plan?.capacity.remainingHours ?? -1,
}

/**
 * Ordena las filas del equipo por una columna, sobre una copia.
 *
 * Ordenar es una **acción del usuario**: el orden por defecto es el que entregó el backend —por
 * `developerId`, con la vigencia ya resuelta— y solo cambia cuando alguien lo pide. La vista no
 * re-agrupa ni recalcula nada: mueve filas.
 *
 * Los números se comparan como números. Compararlos como texto ordenaría «10» antes que «5», que es
 * el error que esta función existe para no tener.
 */
export function sortTeam(
  members: readonly TeamMember[],
  key: TeamSortKey,
  direction: SortDirection,
): TeamMember[] {
  const valueOf = SORT_ACCESSORS[key]
  const sign = direction === 'asc' ? 1 : -1

  return [...members].sort((left, right) => {
    const a = valueOf(left)
    const b = valueOf(right)
    const compared = typeof a === 'string' ? a.localeCompare(b as string) : a - (b as number)

    // El desempate es el identificador: sin él, dos filas con la misma cifra podrían intercambiarse
    // entre ordenaciones y la tabla se vería distinta sin que nada hubiera cambiado.
    return compared !== 0 ? compared * sign : left.developerId.localeCompare(right.developerId)
  })
}
