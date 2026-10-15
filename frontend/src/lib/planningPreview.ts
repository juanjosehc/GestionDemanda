import { isActive } from '@/lib/incidents'
import type {
  DeclarationItem,
  DeclarationStatus,
  DeveloperDeclarationsResponse,
} from '@/types/declarations'
import type { TeamPerson } from '@/types/team'

/**
 * El estado de entrada del motor, contado.
 *
 * **Las cinco cuentas son un reparto, no un desglose.** `DeclarationStatus` es una particion de cinco
 * valores mutuamente excluyentes —el backend la deriva en un solo sitio, `statusOf`—, asi que un ticket
 * cae en una y solo una: los cinco numeros suman los tickets activos. Es **lo contrario** del desglose
 * de la tabla de Incidentes, donde las cuentas se solapan a proposito y hay que advertirlo; por eso
 * `declarationBreakdown` no se reutiliza aqui: daria cifras que no cuadran con la tabla de al lado.
 *
 * El tipo es un mapa **total** sobre el enum, como `DECLARATION_VARIANTS`: añadir un estado en el
 * backend sin darle cajon no compila.
 */
export type StatusCounts = Record<DeclarationStatus, number>

/**
 * Lo que se sabe de una persona de la vista.
 *
 * `active` es el numero de tickets que el motor veria por ella, y `counts` su reparto. `unreadable`
 * distingue «no tiene trabajo» de «no se le pudo leer el trabajo»: una respuesta que no llego deja
 * todos los numeros en cero, y sin esta bandera esa persona se leeria como alguien sin carga, que es
 * afirmar algo que nadie comprobo.
 */
export interface PersonEntry {
  developerId: string
  /** Su nombre tal como lo publica el padron, con el login de respaldo. */
  personName: string
  active: number
  counts: StatusCounts
  /** Los activos que el motor no planificara: todo lo que no es `PLANIFICABLE`. */
  blocked: number
  /**
   * Los que se arreglan declarando: sin estimacion, sin compromiso o sin declaracion ninguna.
   *
   * **`NO_TRADUCIBLE` queda fuera a proposito.** Un ticket que el contrato no sabe traducir no se
   * arregla rellenando un campo —le falta el tipo o el estado, y eso lo decide GLPI—, asi que meterlo
   * aqui mandaria a alguien a declarar lo que no se puede declarar.
   */
  declarable: number
  /** Su lectura no llego: los numeros de arriba no son un hecho, son la ausencia de uno. */
  unreadable: boolean
}

/**
 * El resumen de la vista: la suma de las filas, mas lo que las filas no pueden decir.
 *
 * `people` es la vista entera y `read` los que respondieron, asi que `unreadable` se cuenta sin
 * recorrer nada. `withReadyWork` y `needingDeclarations` son las dos respuestas del brief que se
 * contestan por persona —quien tiene trabajo listo y quien tiene que declarar— y viven aqui para que
 * la frase del veredicto no tenga que contar por su cuenta.
 */
export interface EntrySummary {
  /** Las personas de la vista, se hayan leido o no. */
  people: number
  /** Las que respondieron. */
  read: number
  unreadable: number
  active: number
  counts: StatusCounts
  blocked: number
  declarable: number
  /** Personas con al menos un ticket planificable. */
  withReadyWork: number
  /** Personas con al menos un ticket que se arregla declarando. */
  needingDeclarations: number
}

/**
 * El veredicto de la vista previa, en cuatro ramas excluyentes.
 *
 * Son **tokens y no prosa**: la frase que cada uno lee vive en la pantalla, como el resto de los
 * textos, y aqui solo se decide cual toca. Se elige en este orden y el orden importa: sin lecturas no
 * se puede afirmar nada, y sin trabajo activo no hay nada que planificar aunque haya personas.
 */
export type PlanVerdict = 'sin-lectura' | 'sin-trabajo' | 'nada-planificable' | 'planificable'

/** Los cinco cajones, en cero. Se copia en vez de compartirse: un objeto compartido se mutaria. */
function emptyCounts(): StatusCounts {
  return {
    PLANIFICABLE: 0,
    SIN_ESTIMACION: 0,
    SIN_COMPROMISO: 0,
    SIN_DECLARACION: 0,
    NO_TRADUCIBLE: 0,
  }
}

/**
 * Los tickets activos de una persona, repartidos en sus cinco cajones.
 *
 * **Se cuenta lo activo y no lo que llego.** El endpoint devuelve el trabajo sin resolver —GLPI ya
 * filtra por el grupo de estados 1 a 4—, pero un ticket resuelto o cerrado se descarta con `isActive`,
 * la misma guarda de pantalla que la tabla de Incidentes: la vista previa no puede prometerle al motor
 * un elemento que el motor no va a mirar.
 *
 * El estado **se lee, no se recalcula**: mirar `estimatedHours` o `committedDate` para deducir que
 * falta algo seria una segunda version de la regla que el backend ya aplico.
 */
export function statusCounts(items: readonly DeclarationItem[]): StatusCounts {
  const counts = emptyCounts()

  for (const item of items) {
    if (isActive(item)) {
      counts[item.declarationStatus] += 1
    }
  }

  return counts
}

/** Los cajones que se arreglan declarando: todo menos lo planificable y lo intraduducible. */
function declarableOf(counts: StatusCounts): number {
  return counts.SIN_ESTIMACION + counts.SIN_COMPROMISO + counts.SIN_DECLARACION
}

/**
 * Una fila por persona de la vista, con su trabajo contado.
 *
 * Las dos listas van **en el mismo orden** y se emparejan por posicion —el contrato que `useQueries`
 * garantiza, la misma convencion que `toIncidentRows`—. Una respuesta que falta deja a esa persona
 * con sus numeros en cero **y con `unreadable` en verdadero**: es lo que impide que un fallo de lectura
 * se lea como una persona sin carga.
 *
 * El orden es **bloqueadores descendente y despues nombre**, con el login como ultimo desempate. Quien
 * mas tiene atascado va arriba, que es lo que se viene a mirar; y el desempate existe por el mismo
 * motivo que en la tabla de Incidentes: sin el, dos filas iguales podrian intercambiarse entre
 * ordenaciones y la tabla se veria distinta sin que nada hubiera cambiado.
 */
export function personEntries(
  people: readonly TeamPerson[],
  declarations: readonly (DeveloperDeclarationsResponse | undefined)[],
): PersonEntry[] {
  const entries = people.map((person, index): PersonEntry => {
    const declaration = declarations[index]
    const counts = declaration ? statusCounts(declaration.items) : emptyCounts()
    const active = Object.values(counts).reduce((total, count) => total + count, 0)

    return {
      developerId: person.developerId,
      personName: person.name ?? person.developerId,
      active,
      counts,
      blocked: active - counts.PLANIFICABLE,
      declarable: declarableOf(counts),
      unreadable: declaration === undefined,
    }
  })

  return entries.sort((left, right) => {
    const byBlocked = right.blocked - left.blocked

    if (byBlocked !== 0) {
      return byBlocked
    }

    const byName = left.personName.localeCompare(right.personName)

    return byName !== 0 ? byName : left.developerId.localeCompare(right.developerId)
  })
}

/**
 * El resumen de la vista: la suma de las filas.
 *
 * Suma las entradas en vez de recorrer los tickets otra vez, asi que **cuadra por construccion** con
 * la tabla de debajo: no hay forma de que el titular y las filas digan cosas distintas. `read` cuenta
 * las entradas legibles y `people` las de la vista —`entries.length` y no un parametro—, que es lo que
 * deja contar las que no respondieron.
 */
export function entrySummary(entries: readonly PersonEntry[]): EntrySummary {
  const counts = emptyCounts()
  let read = 0
  let active = 0
  let declarable = 0
  let withReadyWork = 0
  let needingDeclarations = 0

  for (const entry of entries) {
    if (entry.unreadable) {
      continue
    }

    read += 1
    active += entry.active
    declarable += entry.declarable

    if (entry.counts.PLANIFICABLE > 0) {
      withReadyWork += 1
    }
    if (entry.declarable > 0) {
      needingDeclarations += 1
    }

    for (const status of Object.keys(counts) as DeclarationStatus[]) {
      counts[status] += entry.counts[status]
    }
  }

  return {
    people: entries.length,
    read,
    unreadable: entries.length - read,
    active,
    counts,
    blocked: active - counts.PLANIFICABLE,
    declarable,
    withReadyWork,
    needingDeclarations,
  }
}

/**
 * La respuesta a «¿que pasara si genero el plan ahora?», en una de cuatro ramas.
 *
 * Se elige **de lo que se sabe hacia lo que se puede afirmar**, y por eso el orden es este:
 *
 * 1. **`sin-lectura`** — no respondio nadie. No se puede decir nada del motor, y decirlo seria
 *    inventarlo.
 * 2. **`sin-trabajo`** — respondieron y ninguno tiene un ticket sin resolver. Una lista vacia es un
 *    hecho, no un hueco.
 * 3. **`nada-planificable`** — hay trabajo activo y **nada** de el es planificable: el plan saldria
 *    vacio. Es la rama que el brief pide distinguir de la anterior, porque se parece a ella y no es lo
 *    mismo: aqui si hay carga, y esta bloqueada.
 * 4. **`planificable`** — hay al menos un elemento que el motor va a mirar.
 *
 * **No se pronuncia sobre el resultado**: cuantos elementos quepan en el horizonte y cuales desplacen a
 * cuales lo decide el motor con las reglas vigentes, y eso solo se sabe despues de calcular.
 */
export function verdictOf(summary: EntrySummary): PlanVerdict {
  if (summary.read === 0) {
    return 'sin-lectura'
  }

  if (summary.active === 0) {
    return 'sin-trabajo'
  }

  return summary.counts.PLANIFICABLE > 0 ? 'planificable' : 'nada-planificable'
}
