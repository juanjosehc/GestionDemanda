import type { DeclarationItem } from '@/types/declarations'
import type { DeveloperDeclarationsResponse } from '@/types/declarations'
import type { TeamPerson } from '@/types/team'

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
}

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

export interface IncidentFilters {
  person: string
  type: string
  status: string
  declaration: string
}

export const NO_FILTERS: IncidentFilters = {
  person: ANY,
  type: ANY,
  status: ANY,
  declaration: ANY,
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
      (filters.declaration === ANY || declarationSideOf(row.item) === filters.declaration),
  )
}
