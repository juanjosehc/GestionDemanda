import { ChartGantt } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { DeclarationForm } from '@/components/declarations/DeclarationForm'
import { CommitmentSummary } from '@/components/timeline/CommitmentSummary'
import { DisplacementCause } from '@/components/timeline/DisplacementCause'
import { IncidentSimulator } from '@/components/timeline/IncidentSimulator'
import { TimelineGrid } from '@/components/timeline/TimelineGrid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SidePanel } from '@/components/ui/side-panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useAlerts } from '@/hooks/useAlerts'
import { useTeam } from '@/hooks/useTeam'
import { declarationsByDeveloper, useTeamDeclarationsBatch } from '@/hooks/useDeclarations'
import { useRenegotiations } from '@/hooks/useRenegotiations'
import { useTeamTimeline } from '@/hooks/useTeamTimeline'
import { SEVERITY_VARIANTS } from '@/lib/alerts'
import {
  coverageByGroup,
  coverageTotals,
  formatPercent,
  priorityOrder,
  priorityTickets,
  teamCoverage,
} from '@/lib/coverage'
import {
  PENDING_CAUSE_DETAIL,
  PENDING_CAUSE_LABEL,
  PENDING_GROUP_LABEL,
  conflictsByDeveloper,
  pendingAgreements,
  pendingCounts,
  pendingGroups,
  pendingPath,
  plannedByDeveloper,
  teamPending,
} from '@/lib/pending'
import { AGREEMENT_ORIGIN_BADGE, agreementOrigin, agreementStates } from '@/lib/renegotiations'
import { NO_ROW_FILTERS, filterRows, hasFilters } from '@/lib/timelineFilters'
import {
  blockKey,
  commitmentRisksOf,
  countOf,
  formatDay,
  formatHours,
  formatTime,
  localTodayIso,
  teamAgenda,
  timelineDays,
  unscheduledOf,
} from '@/lib/timeline'
import {
  alertDetailPath,
  calendarPath,
  comparisonPath,
  declarationPath,
  planningPath,
  renegotiationPath,
  ROUTES,
} from '@/routes/navigation'
import type { BadgeVariant } from '@/components/ui/badge'
import type { CoverageTotals, DeveloperCoverage } from '@/lib/coverage'
import type { SimulationResult } from '@/lib/simulation'
import type { TeamRowFilters, TeamRowSignals } from '@/lib/timelineFilters'
import type { ReactNode } from 'react'
import type { DeclarationItem, DeveloperDeclarationsResponse } from '@/types/declarations'
import type { PendingCause, PendingGroup, PendingItem } from '@/lib/pending'
import type { OperationalAlert } from '@/types/alerts'
import type { RenegotiationItem } from '@/types/renegotiations'
import type { TeamPerson } from '@/types/team'
import type { TeamConflict, TimelineItem, WorkItemType } from '@/types/timeline'

/**
 * El nombre de cada persona, indexado por todo con lo que se la puede nombrar.
 *
 * Primero las declaraciones y después el padrón, que sobrescribe: es la lectura del equipo y por
 * tanto la que manda; la declaración solo rellena las filas que el padrón no conoce.
 */
function namesOf(
  people: readonly TeamPerson[],
  declarations: readonly (DeveloperDeclarationsResponse | undefined)[],
): Record<string, string> {
  const byKey: Record<string, string> = {}

  for (const declaration of declarations) {
    const developer = declaration?.developer

    if (developer?.name) {
      byKey[developer.id] = developer.name
    }
  }

  for (const person of people) {
    if (!person.name) {
      continue
    }

    byKey[person.developerId] = person.name

    if (person.glpiId !== null) {
      byKey[String(person.glpiId)] = person.name
    }
  }

  return byKey
}

/**
 * Las palabras con las que se puede encontrar a una persona sin mirar la rejilla.
 *
 * Se indexa lo que la pantalla ya tiene: su login, su nombre, su número de GLPI y, de cada tramo y
 * cada pendiente, el identificador del ticket. El **texto de un ticket planificado no viaja** en la
 * agenda —solo su identificador y tipo—, así que buscar por texto encuentra los pendientes, que sí
 * traen título, y no los tramos; el tooltip del tramo sigue diciendo todo lo que el plan sabe de él.
 */
function searchTextOf(
  developerId: string,
  person: TeamPerson | undefined,
  own: readonly TimelineItem[],
  ownPending: readonly PendingItem[],
): string {
  return [
    developerId,
    person?.name ?? '',
    person?.glpiId === null || person?.glpiId === undefined ? '' : String(person.glpiId),
    ...own.flatMap((item) => [
      item.workItemId,
      item.workItemType === 'INCIDENTE' ? 'incidente' : 'requerimiento',
      item.planningStatus.toLowerCase(),
      item.severity ?? '',
      item.displacement?.incidentId ?? '',
    ]),
    ...ownPending.flatMap((item) => [item.workItemId, item.title]),
  ]
    .join(' ')
    .toLowerCase()
}

/**
 * El color de cada causa.
 *
 * **Los colores separan las tres familias, no cada causa.** Lo que falta por información va en
 * ámbar —se arregla declarando—, lo que el motor dejó fuera por capacidad va en azul, el acuerdo
 * pendiente en rojo —es lo único que ya tiene trabajo colocado en una fecha que nadie aceptó— y lo
 * que no entró en el último plan en gris, porque no es un fallo de nadie sino un plan viejo.
 */
const CAUSE_BADGE: Record<PendingCause, BadgeVariant> = {
  SIN_ESTIMACION: 'warning',
  SIN_COMPROMISO: 'warning',
  SIN_DECLARACION: 'warning',
  NO_TRADUCIBLE: 'warning',
  FUERA_POR_CAPACIDAD: 'info',
  SIN_ACUERDO: 'danger',
  NO_INCLUIDO_EN_EL_PLAN: 'secondary',
}

/** El color de cada grupo en el resumen: los mismos cuatro colores, unidos. */
const GROUP_BADGE: Record<PendingGroup, BadgeVariant> = {
  P1: 'warning',
  P2: 'info',
  P3: 'danger',
  P4: 'secondary',
}

const GROUPS: readonly PendingGroup[] = ['P1', 'P2', 'P3', 'P4']

/** Cuántos tickets enseña la lista accionable. El resto sigue en «Trabajo pendiente», completo. */
const TICKETS_SHOWN = 8

/**
 * La pantalla con la que abre la aplicación: la agenda de todo el equipo.
 *
 * Responde de una sola vez las cuatro preguntas que antes obligaban a recorrer cuatro pantallas
 * —quién tiene trabajo, en qué está, cuánto le queda libre y qué sigue pendiente—, y no pide nada a
 * cambio: ni un plan, ni un identificador, ni una selección. **Esa es toda la fase.**
 *
 * **Reutiliza el dominio entero y no lo repite.** La capacidad, los tramos y los días no laborables
 * los calcula el motor y los publica el backend; esta pantalla los pinta con el mismo `TimelineGrid`
 * que dibuja la agenda de un plan, que ya era multi-recurso y solo se usaba con uno. Lo único que
 * añade es el cruce que la rejilla no puede hacer sola: los nombres, que vienen del padrón, y el
 * trabajo pendiente, que sale de la declaración de cada técnico.
 *
 * **Es también donde se trabaja.** Un tramo se puede elegir, y el detalle que abre —un panel lateral
 * que no mueve la agenda— trae su causa, la que el plan auditó al moverlo, y las acciones que
 * tienen sentido desde una barra: declarar el ticket, renegociar su fecha, abrir el plan del que
 * salió y compararlo. Todas van a las pantallas que ya existían; aquí no hay un formulario nuevo.
 *
 * **Las tres lecturas son independientes y ninguna bloquea a las otras.** La rejilla se pinta con
 * los planes guardados, que son datos del propio sistema; los pendientes consultan GLPI y las
 * renegociaciones, la API del propio backend. Si GLPI no contesta, la agenda sigue en pie y el panel
 * de pendientes dice que no se pudo leer —el mismo reparto que ya hace el tablero, que por eso sigue
 * funcionando cuando GLPI cae—.
 */
export function TeamTimeline() {
  const timeline = useTeamTimeline()
  const team = useTeam()
  const renegotiations = useRenegotiations()
  const alerts = useAlerts()

  /*
   * La dirección **siembra** la vista, una sola vez: `tecnico` deja la fila de esa persona y `ticket`
   * abre su detalle. Es lo que hace que la acción «Ver el Timeline» de Tickets no aterrice en la
   * agenda entera con el gestor buscando a mano. Como en Incidents, el estado local sigue mandando
   * después: si la dirección gobernara, cada pulsación sería una navegación.
   */
  const [searchParams] = useSearchParams()

  const [selected, setSelected] = useState<string | null>(null)

  /*
   * El ticket señalado por la dirección, si lo hay.
   *
   * **El panel se abre por clave de tramo, y la dirección no la conoce**: un ticket puede tener más
   * de un tramo y la dirección solo lleva su identificador. Se guarda el ticket y se resuelve cuando
   * la agenda llega —se abre el primero de sus tramos—; cerrar lo limpia, para que el panel no se
   * vuelva a abrir solo en el siguiente render.
   */
  const [ticket, setTicket] = useState<string | null>(() => searchParams.get('ticket'))

  /*
   * El detalle dejó de ser una caja debajo de la agenda y pasó a ser un panel fijo a la derecha:
   * pulsar un tramo lo abre sin mover la página, y pulsar otro cambia su contenido. El foco vuelve
   * al tramo desde el que se abrió —o al último que se pulsó— al cerrar, para que el teclado no se
   * quede perdido en el body.
   */
  const openerRef = useRef<HTMLElement | null>(null)
  const openDetail = useCallback((item: TimelineItem) => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTicket(null)
    setSelected(blockKey(item))
  }, [])
  const closeDetail = useCallback(() => {
    setSelected(null)
    setTicket(null)
    openerRef.current?.focus()
  }, [])

  /**
   * A quién se está mirando dentro de un panel, cuando se llegó desde su fila de cobertura.
   *
   * **No es un filtro del equipo, es un foco.** La cobertura dice «Ana tiene 6 pendientes»; el
   * botón de su fila lleva a esos seis dentro del panel que ya existe, en vez de dejar al gestor
   * buscando su nombre entre todas las personas. Se limpia desde el propio panel y no cambia
   * ninguna lectura: los grupos ya estaban calculados.
   */
  const [focus, setFocus] = useState<{ developerId: string; panel: 'pendientes' | 'acuerdos' } | null>(
    null,
  )

  function focusOn(developerId: string, panel: 'pendientes' | 'acuerdos') {
    setFocus({ developerId, panel })

    // El panel se redibuja filtrado en el siguiente cuadro; hasta entonces la altura es la de
    // antes. `scrollIntoView` no existe en jsdom, de ahí la llamada opcional.
    window.requestAnimationFrame(() => {
      document.getElementById(panel)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    })
  }

  /**
   * Qué filas se ven. **Filtra la pantalla, no la lectura**: la agenda sigue entera en memoria y los
   * paneles de abajo siguen contando al equipo completo, porque la pregunta «qué le falta al equipo»
   * no cambia porque uno esté buscando a Ana.
   */
  const [filters, setFilters] = useState<TeamRowFilters>(() => ({
    ...NO_ROW_FILTERS,
    developerId: searchParams.get('tecnico') ?? NO_ROW_FILTERS.developerId,
  }))

  /**
   * El incidente de demostración, si lo hay.
   *
   * Vive aquí y solo aquí: no se guarda, no se envía y se pierde al recargar. `null` es el estado
   * normal de la pantalla.
   */
  const [simulation, setSimulation] = useState<SimulationResult | null>(null)

  /**
   * Las filas del timeline son **las personas del equipo operativo**, no los planes.
   *
   * Es el cambio de esta fase. Antes la lista salía de `timeline.data.resources` —una fila por
   * técnico con plan— y por eso quien no había planificado no existía para la pantalla. Ahora el
   * padrón decide quién aparece y el plan solo rellena su fila. `teamAgenda` hace el cruce por login
   * y por número de GLPI, porque un plan se guarda con lo que se tecleó al pedirlo.
   */
  const people = useMemo(
    () => (team.data?.people ?? []).filter((person) => person.operational),
    [team.data],
  )

  const developerIds = useMemo(() => people.map((person) => person.developerId), [people])

  const agenda = useMemo(() => teamAgenda(people, timeline.data), [people, timeline.data])

  // Quién tiene plan de verdad. Una fila del equipo sin capacidad es una persona sin plan.
  const withPlan = agenda.resources.filter((resource) => resource.capacity.length > 0).length

  // **Una sola lectura para todo el equipo.** La capa de pendientes pregunta por todas las personas a
  // la vez, y una petición por fila hacía que el coste de abrir el timeline creciera con el número de
  // planes vigentes. El lote devuelve lo mismo, clasificado por el mismo backend.
  const declarations = useTeamDeclarationsBatch(developerIds)

  /**
   * El nombre de cada persona, por las dos claves con las que se la puede nombrar.
   *
   * El sistema la nombra por su login, pero un plan se guarda **con lo que se tecleó al pedirlo**, y
   * eso puede haber sido su número de GLPI. Cruzar por las dos es lo que evita que una misma persona
   * salga sin nombre por haber pedido el plan con la otra —la misma precaución que ya toma la tabla
   * del equipo—.
   *
   * **El padrón no lo tiene todo**: un plan guardado puede mencionar a alguien que no está en el
   * grupo. La declaración sí devuelve el nombre de a quién se le pregunta, así que sirve de relleno
   * para esas filas; cuando las dos saben el nombre, manda el padrón, que es la lectura del equipo.
   */
  // Por identificador y no por posición: un desconocido se cae de la respuesta y emparejar por
  // índice le daría a una persona los tickets de la siguiente.
  const declarationsById = declarationsByDeveloper(declarations.data)
  const names = namesOf(team.data?.people ?? [], Object.values(declarationsById))

  const planned = useMemo(() => plannedByDeveloper(agenda.items), [agenda])

  // Qué tickets esperan acuerdo, por técnico. No se deduce aquí —el backend ya calcula si el
  // desplazamiento vigente está cubierto—, solo se indexa.
  const agreements = useMemo(() => pendingAgreements(renegotiations.data), [renegotiations.data])

  // Cuántos acuerdos esperan a cada persona. Sale de la misma lectura que ya indexa el panel de
  // pendientes; el panel de acuerdos lo usa para enseñar el contador de cada fila.
  const agreementCounts = useMemo(
    () => Object.fromEntries(Object.entries(agreements).map(([id, set]) => [id, set.size])),
    [agreements],
  )

  // Qué tickets rechazó el motor. Es lo único que separa «sí llegó y no cupo» de «no entró en la
  // última planificación»: el plan guarda sus conflictos, no el trabajo que nunca recibió.
  const conflicts = useMemo(() => conflictsByDeveloper(agenda.conflicts), [agenda])

  // La fila de renegociación de cada elemento, para el detalle de un tramo.
  const agreementByItem = useMemo(
    () => new Map((renegotiations.data?.items ?? []).map((item) => [item.workItemId, item])),
    [renegotiations.data],
  )

  // El color de cada bloque: el plan pone el estado y el acuerdo lo matiza. Se calcula una vez para
  // toda la rejilla, que es lo que impide que dos tramos del mismo ticket salgan de colores distintos.
  const statesByItem = useMemo(() => agreementStates(renegotiations.data), [renegotiations.data])

  /**
   * Los tickets que tienen día en GLPI y ningún tramo porque nadie declaró las horas.
   *
   * **No salen del plan, porque no están en el plan.** Sale de la declaración, que es la misma
   * lectura que ya alimenta el panel de pendientes: cruzar aquí las dos evita una petición más y,
   * sobre todo, evita que la rejilla invente un tramo de cero horas para poder pintarlos.
   */
  const plannedTickets = useMemo(
    () => new Set(agenda.items.map((item) => item.workItemId)),
    [agenda],
  )
  const unscheduled = useMemo(
    () => unscheduledOf(declarationsById, plannedTickets, { from: null, to: null }),
    [declarationsById, plannedTickets],
  )

  /*
   * El riesgo de cada ticket, medido contra el día del navegador.
   *
   * Se calcula sobre **todo** el equipo y no sobre lo visible: los contadores de la cabecera son del
   * horizonte entero, mientras la rejilla enseña una semana. Un contador que se moviera al filtrar
   * diría «no hay vencidos» de un equipo que sí los tiene.
   */
  const commitmentRisks = useMemo(
    () => commitmentRisksOf(declarationsById, localTodayIso()),
    [declarationsById],
  )

  // El lote indexa por identificador, así que las listas se alinean aquí antes de entrar: `teamPending`
  // sigue emparejando por posición, y una persona que GLPI no conoce deja su hueco vacío en vez de
  // desplazar a las siguientes.
  const pending = teamPending(
    developerIds,
    developerIds.map((developerId) => declarationsById[developerId]),
    planned,
    agreements,
    conflicts,
  )
  const counts = pendingCounts(pending)
  const summary = pendingGroups(pending)

  /**
   * A dónde lleva el chip «N pendientes» de cada fila.
   *
   * Con **un solo** pendiente el chip es un enlace al sitio donde se resuelve, con el ticket ya
   * puesto: la misma ruta que la fila del panel, para no tener dos formas de llegar al mismo sitio.
   * Con varios no hay un ticket único que abrir, así que el chip filtra el panel de pendientes por
   * esa persona (`onPendingSelect`), que es donde están todos con su causa.
   */
  const pendingLinks = Object.fromEntries(
    pending
      .filter((item) => counts[item.developerId] === 1)
      .map((item) => [item.developerId, pendingPath(item, ROUTES.teamTimeline)]),
  )

  /**
   * La cobertura del plan, persona a persona.
   *
   * Sale de las mismas dos lecturas que la capa de pendientes —la declaración del equipo y los
   * tramos del plan— y no pregunta nada nuevo: **clasificar es del backend**, aquí solo se cuenta lo
   * que él ya decidió. Es la vista que contesta «qué impide que el equipo tenga plan» y «a quién
   * llamar primero», sin obligar al gestor a sumar filas del panel de pendientes a mano.
   */
  const coverageRows = teamCoverage(developerIds, declarationsById, pending)
  const coverage = coverageTotals(coverageRows)
  const coverageGroups = coverageByGroup(coverageRows)

  // La lista de tickets que una llamada desbloquea, en el orden en que conviene trabajarlos. Es el
  // paso siguiente a «llama a esta persona»: qué se le pide exactamente y por dónde empezar.
  const tickets = priorityTickets(pending, coverageRows)

  // Cuántos desbloquea una declaración, por persona: la rejilla lo enseña junto a «Sin plan».
  const recoverableCounts = Object.fromEntries(
    coverageRows.map((row) => [row.developerId, row.blockedByInformation]),
  )

  // A dónde lleva el nombre de cada fila: a su declaración, que es donde están los tickets que
  // faltan y lo que le falta a cada uno. Es el paso de «cuántos» a «cuáles» sin salir del timeline.
  // Abre la persona en lote: desde aquí la unidad de trabajo es la persona entera, no un ticket.
  const nameLinks = Object.fromEntries(
    coverageRows.map((row) => [
      row.developerId,
      declarationPath({
        developerId: row.developerId,
        from: ROUTES.teamTimeline,
        batch: true,
      }),
    ]),
  )

  // Quién tiene plan vigente, por identificador: es la columna «Plan» de la cobertura y la misma
  // señal que pinta «Sin plan» en la rejilla.
  const plannedIds = useMemo(
    () =>
      new Set(
        agenda.resources
          .filter((resource) => resource.capacity.length > 0)
          .map((resource) => resource.developerId),
      ),
    [agenda],
  )

  /*
   * Las señales de cada fila, para buscar y filtrar.
   *
   * Se arman con lo que la pantalla ya tiene —el plan, los pendientes, los acuerdos y la cobertura—
   * y no piden nada nuevo. Todo lo que una fila deja ver se puede buscar: login, nombre, GLPI y los
   * identificadores de sus tickets y pendientes; y todo lo que ya se cuenta en la fila se puede
   * filtrar, porque el filtro no inventa una señal, solo la usa para esconder filas.
   */
  const rowSignals: TeamRowSignals[] = agenda.resources.map((resource) => {
    const developerId = resource.developerId
    const person = (team.data?.people ?? []).find((entry) => entry.developerId === developerId)
    const own = agenda.items.filter((item) => item.developerId === developerId)
    const ownPending = pending.filter((item) => item.developerId === developerId)
    const coverage = coverageRows.find((row) => row.developerId === developerId)

    const types = new Set<WorkItemType>(own.map((item) => item.workItemType))

    for (const item of ownPending) {
      if (item.type) {
        types.add(item.type)
      }
    }

    return {
      developerId,
      name: person?.name ?? null,
      glpiId: person?.glpiId ?? null,
      hasPlan: plannedIds.has(developerId),
      pending: counts[developerId] ?? 0,
      agreements: agreementCounts[developerId] ?? 0,
      displacements: own.filter((item) => item.planningStatus === 'DESPLAZADO').length,
      plannable: coverage?.planificable ?? 0,
      recoverable: recoverableCounts[developerId] ?? 0,
      types,
      searchText: searchTextOf(developerId, person, own, ownPending),
    }
  })

  const shownIds = new Set(filterRows(rowSignals, filters).map((row) => row.developerId))

  // La persona simulada no se esconde por un filtro: se acaba de pedir ver su incidente, y esconder
  // su fila dejaría al gestor con un simulador que no enseña nada.
  if (simulation && !simulation.error) {
    shownIds.add(simulation.input.developerId)
  }

  const shownResources = agenda.resources.filter((resource) => shownIds.has(resource.developerId))

  // El nombre con el que la pantalla nombra a cada persona, para los controles que la listan.
  const peopleOptions = people.map((person) => ({
    developerId: person.developerId,
    name: names[person.developerId] ?? person.name ?? person.developerId,
  }))

  /*
   * La simulación tal como la pinta la rejilla: un mapa de claves de tramo a fecha propuesta. Se
   * arma aquí para que la rejilla no tenga que conocer el resultado completo, y se omite si la
   * simulación no pudo calcularse —un error no tiene tramos que marcar—.
   */
  const simulationLayer =
    simulation && !simulation.error
      ? {
          developerId: simulation.input.developerId,
          date: simulation.input.date,
          hours: simulation.input.hours,
          severity: simulation.input.severity,
          availableHours: simulation.availableHours,
          remainingAfter: simulation.remainingAfter,
          displaced: new Map(
            simulation.displaced.map((block) => [block.key, block.newDate] as const),
          ),
        }
      : undefined

  const readingPending = declarations.isPending
  // Un fallo del lote deja a todas las personas sin leer; los desconocidos son un 404 por persona que
  // viaja dentro de la respuesta y no un fallo de la lectura.
  const unread = declarations.isError
    ? developerIds.length
    : (declarations.data?.unknownDevelopers.length ?? 0)
  const readingAgreements = renegotiations.isPending

  // Las dos lecturas son necesarias: el timeline pone el trabajo y el padrón pone las filas.
  if ((timeline.isPending && !timeline.data) || (team.isPending && !team.data)) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (team.isError) {
    return (
      <EmptyState
        tone="danger"
        icon={ChartGantt}
        title="No fue posible cargar el equipo"
        detail={team.error instanceof Error ? team.error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={() => void team.refetch()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  if (timeline.isError) {
    return (
      <EmptyState
        tone="danger"
        icon={ChartGantt}
        title="No fue posible cargar la agenda del equipo"
        detail={timeline.error instanceof Error ? timeline.error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={() => void timeline.refetch()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  /*
   * Sin días no hay rejilla que dibujar, y eso no es «no hay equipo»: las filas son las personas y
   * están todas contadas abajo. Significa que ningún plan vigente aporta una ventana, y sin ventana
   * no hay columnas —inventarlas afirmaría una jornada que nadie publicó—.
   */
  /*
   * Las columnas del eje, con una regla que no se ve: **un ticket sin horas también abre su día.**
   * Su fecha no está en ninguna capacidad —no hay plan que la cubra—, así que si las columnas
   * salieran solo de la capacidad y de los tramos, el 68428 caería en una fecha sin columna y
   * desaparecería de la vista, que es exactamente lo que la Fase 67 viene a impedir.
   */
  const days = [
    ...new Set([...timelineDays(agenda.resources, agenda.items), ...unscheduled.map((item) => item.date)]),
  ].sort()
  const firstDay = days[0]
  const lastDay = days[days.length - 1]

  if (!firstDay || !lastDay) {
    return (
      <EmptyState
        icon={ChartGantt}
        title="El equipo no tiene planes todavía"
        detail={`El equipo operativo tiene ${people.length} ${people.length === 1 ? 'persona' : 'personas'} y ninguna tiene un plan vigente. En cuanto haya al menos uno, todo el equipo aparece aquí: quien tenga plan, con su capacidad y su trabajo; quien no, marcado «Sin plan».`}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTES.planning}>Generar un plan</Link>
          </Button>
        }
      />
    )
  }

  const groups = developerIds
    .map((developerId) => ({
      developerId,
      items: pending.filter((item) => item.developerId === developerId),
    }))
    .filter((group) => group.items.length > 0)

  /*
   * El tramo abierto: el que se pulsó o, si la dirección trajo un ticket, el primero de sus tramos.
   * Un ticket que el plan no colocó no tiene tramo y no abre panel —la vista queda filtrada por su
   * persona, que es lo que se puede enseñar de él aquí—.
   */
  const selectedItem =
    agenda.items.find((item) => blockKey(item) === selected) ??
    (selected === null && ticket !== null
      ? (agenda.items.find((item) => item.workItemId === ticket) ?? null)
      : null)

  // Quién quedó fuera del equipo, por su identificador: quien no está en el padrón no tiene fila, y
  // la pantalla lo dice en vez de esconder el trabajo sin nombrarlo.
  const outsideIds = [...new Set(agenda.outside.items.map((item) => item.developerId))].sort()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {people.length} {people.length === 1 ? 'persona del equipo' : 'personas del equipo'} ·{' '}
            {withPlan} con plan
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {formatDay(firstDay)} — {formatDay(lastDay)}
          </p>
        </div>

        <p className="text-xs text-muted-foreground tabular-nums">
          {agenda.items.length} tramos ·{' '}
          {readingPending ? 'leyendo pendientes…' : `${pending.length} pendientes`}
          {agenda.conflicts.length > 0 && ` · ${agenda.conflicts.length} sin hueco`}
        </p>
      </div>

      {/*
        Los contadores van antes del calendario y no dentro: responden «qué tan mal está el
        compromiso del equipo» recorriendo todas las semanas, y la rejilla de abajo solo puede
        enseñar la que está en pantalla.
      */}
      <CommitmentSummary risks={commitmentRisks} withoutEstimate={unscheduled.length} />

      <TimelineToolbar
        filters={filters}
        onChange={setFilters}
        people={peopleOptions}
        total={agenda.resources.length}
        shown={shownResources.length}
      />

      {/*
        La demostración, encima de la agenda que explica: se elige a una persona y un día, y el
        incidente se ve sobre la rejilla real. Con un solo scroll vertical, la agenda mide varios
        miles de píxeles; un panel de control al final de ella sería un panel que nadie encuentra.
        Nada de lo que hace aquí sale de esta pantalla.
      */}
      <IncidentSimulator
        people={peopleOptions}
        days={days}
        resources={agenda.resources}
        items={agenda.items}
        result={simulation}
        onChange={setSimulation}
      />

      <TimelineGrid
        resources={shownResources}
        items={agenda.items}
        names={names}
        pending={counts}
        recoverable={recoverableCounts}
        pendingLinks={pendingLinks}
        onPendingSelect={(developerId) => focusOn(developerId, 'pendientes')}
        nameLinks={nameLinks}
        label="Agenda del equipo"
        // Las columnas salen del equipo completo, no de las filas visibles: al filtrar, la ventana
        // no se acorta y las fechas no se mueven con cada tecla.
        dayColumns={days}
        // Abre compacta: aquí la pregunta es «quién», y con una fila por persona caben varias de un
        // vistazo. La agenda de un plan tiene una sola fila y abre normal.
        initialZoom={0}
        onSelect={openDetail}
        selected={selected}
        simulation={simulationLayer}
        states={statesByItem}
        unscheduled={unscheduled}
        risks={commitmentRisks}
      />

      {/*
        El trabajo de quien no está en el equipo no se dibuja, pero tampoco se esconde: son los
        identificadores que el padrón no publica —hoy tres demo y un usuario de GLPI fuera del
        grupo— y su plan sigue guardado. Decirlo aquí es lo que separa «el equipo está completo» de
        «hay filas que esta pantalla decidió no pintar».
      */}
      {outsideIds.length > 0 && (
        <p className="text-xs text-muted-foreground" data-slot="timeline-outside">
          Sin fila por no estar en el equipo operativo:{' '}
          {countOf(agenda.outside.items.length, 'tramo', 'tramos')}
          {agenda.outside.conflicts.length > 0 &&
            ` y ${countOf(agenda.outside.conflicts.length, 'conflicto', 'conflictos')}`}{' '}
          de {outsideIds.join(', ')}.
        </p>
      )}

      <CoveragePanel
        rows={coverageRows}
        totals={coverage}
        groups={coverageGroups}
        names={names}
        withPlan={plannedIds}
        tickets={tickets}
        agreementCounts={agreementCounts}
        reading={readingPending}
        failed={declarations.isError}
        unread={unread}
        onFocusPending={(developerId) => focusOn(developerId, 'pendientes')}
        onFocusAgreements={(developerId) => focusOn(developerId, 'acuerdos')}
      />

      {selectedItem && (
        <ItemDetail
          /*
            `key` por tramo: cambiar de ticket remonta el panel y devuelve su estado local —la
            declaración abierta— al detalle. Sin clave, volver al tramo anterior reabriría un
            formulario a medio escribir.
          */
          key={selectedItem.workItemId}
          item={selectedItem}
          name={names[selectedItem.developerId] ?? selectedItem.developerId}
          coverage={coverageRows.find((row) => row.developerId === selectedItem.developerId)}
          renegotiation={agreementByItem.get(selectedItem.workItemId)}
          /*
            La misma fila de declaración que ya cargó la capa de pendientes: es lo que el formulario
            necesita para saber si crea o reemplaza. No se pide otra lectura ni se inventa el estado;
            si la lectura de esa persona no llegó, el panel enlaza a `/declaraciones` como antes.
          */
          declarationItem={declarationsById[selectedItem.developerId]?.items.find(
            (declaration) => declaration.workItemId === selectedItem.workItemId,
          )}
          conflicts={agenda.conflicts.filter(
            (conflict) =>
              conflict.developerId === selectedItem.developerId &&
              conflict.workItemId === selectedItem.workItemId,
          )}
          onClose={closeDetail}
        />
      )}

      <ConflictPanel conflicts={agenda.conflicts} names={names} />

      {/*
        La salud operativa y los acuerdos viven aquí desde la Fase 50. Eran las dos pantallas que el
        gestor abría en medio del trabajo, y las dos contestan una pregunta sobre el equipo que ya
        está en pantalla: qué condiciones exigen atención y a quién le falta aceptar una fecha. Se
        enlazan al centro de alertas y a renegociaciones, pero el diagnóstico se lee sin salir.
      */}
      <AlertPanel
        alerts={alerts.data?.alerts ?? []}
        generatedAt={alerts.data?.generatedAt ?? ''}
        reading={alerts.isPending && !alerts.data}
        failed={alerts.isError}
      />

      <AgreementPanel
        items={renegotiations.data?.items ?? []}
        names={names}
        reading={readingAgreements}
        failed={renegotiations.isError}
        focus={focus?.panel === 'acuerdos' ? focus.developerId : null}
        onClearFocus={() => setFocus(null)}
      />

      <PendingPanel
        groups={groups}
        names={names}
        total={pending.length}
        summary={summary}
        reading={readingPending || readingAgreements}
        unread={unread}
        focus={focus?.panel === 'pendientes' ? focus.developerId : null}
        onClearFocus={() => setFocus(null)}
      />
    </div>
  )
}

interface TimelineToolbarProps {
  filters: TeamRowFilters
  onChange: (filters: TeamRowFilters) => void
  people: readonly { developerId: string; name: string }[]
  /** Cuántas personas tiene el equipo, para poder decir «3 de 12». */
  total: number
  /** Cuántas quedan visibles con los filtros puestos. */
  shown: number
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'secondary' : 'ghost'}
      aria-pressed={active}
      className="h-7 px-2 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/**
 * Buscar y filtrar la agenda del equipo.
 *
 * **Filtra filas, no tramos.** Buscar un ticket lleva a la persona que lo tiene y deja ver todo su
 * trabajo, que es el contexto con el que se decide; esconder los demás tramos de esa persona
 * convertiría la búsqueda en una segunda vista.
 *
 * **Los filtros son lo que la fila ya dice.** Cada uno se apoya en una señal que la rejilla ya
 * enseña —plan, pendientes, acuerdos, desplazamientos, cobertura—; ninguno deduce nada nuevo. Por
 * eso no hay «TIA» —ese atributo no existe en el dominio— ni «con alertas» por persona: las alertas
 * que el backend publica son del equipo o de un ticket, no de una fila. Los dos están anotados en la
 * documentación como límites, no disimulados como filtros vacíos.
 */
function TimelineToolbar({ filters, onChange, people, total, shown }: TimelineToolbarProps) {
  const active = hasFilters(filters)

  function set(patch: Partial<TeamRowFilters>) {
    onChange({ ...filters, ...patch })
  }

  return (
    <section
      data-slot="timeline-toolbar"
      aria-label="Buscar y filtrar la agenda"
      className="space-y-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filters.query}
          onChange={(event) => set({ query: event.target.value })}
          placeholder="Buscar persona, login, GLPI o ticket…"
          aria-label="Buscar por persona, login, GLPI o ticket"
          className="h-8 w-72 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />

        <select
          value={filters.developerId}
          onChange={(event) => set({ developerId: event.target.value })}
          aria-label="Persona"
          className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="TODOS">Todas las personas</option>
          {people.map((person) => (
            <option key={person.developerId} value={person.developerId}>
              {person.name} · {person.developerId}
            </option>
          ))}
        </select>

        <p
          data-slot="timeline-filter-count"
          className="ml-auto text-xs tabular-nums text-muted-foreground"
        >
          {active ? `${shown} de ${total} personas` : `${total} personas`}
        </p>

        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onChange(NO_ROW_FILTERS)}
          >
            Limpiar
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Tipo de trabajo"
          className="flex gap-0.5 rounded-md border border-border p-0.5"
        >
          <Chip
            active={filters.type === 'INCIDENTE'}
            onClick={() => set({ type: filters.type === 'INCIDENTE' ? 'TODOS' : 'INCIDENTE' })}
          >
            Incidentes
          </Chip>
          <Chip
            active={filters.type === 'REQUERIMIENTO'}
            onClick={() =>
              set({ type: filters.type === 'REQUERIMIENTO' ? 'TODOS' : 'REQUERIMIENTO' })
            }
          >
            Requerimientos
          </Chip>
        </div>

        <div
          role="group"
          aria-label="Plan"
          className="flex gap-0.5 rounded-md border border-border p-0.5"
        >
          <Chip
            active={filters.plan === 'CON'}
            onClick={() => set({ plan: filters.plan === 'CON' ? 'TODOS' : 'CON' })}
          >
            Con plan
          </Chip>
          <Chip
            active={filters.plan === 'SIN'}
            onClick={() => set({ plan: filters.plan === 'SIN' ? 'TODOS' : 'SIN' })}
          >
            Sin plan
          </Chip>
        </div>

        <div
          role="group"
          aria-label="Señales de la fila"
          className="flex flex-wrap gap-0.5 rounded-md border border-border p-0.5"
        >
          <Chip
            active={filters.withPending}
            onClick={() => set({ withPending: !filters.withPending })}
          >
            Con pendientes
          </Chip>
          <Chip
            active={filters.withAgreements}
            onClick={() => set({ withAgreements: !filters.withAgreements })}
          >
            Con acuerdos
          </Chip>
          <Chip
            active={filters.withDisplacements}
            onClick={() => set({ withDisplacements: !filters.withDisplacements })}
          >
            Con desplazamientos
          </Chip>
          <Chip
            active={filters.plannableOnly}
            onClick={() => set({ plannableOnly: !filters.plannableOnly })}
          >
            Planificables
          </Chip>
          <Chip
            active={filters.recoverableOnly}
            onClick={() => set({ recoverableOnly: !filters.recoverableOnly })}
          >
            Recuperables
          </Chip>
        </div>
      </div>
    </section>
  )
}

interface ItemDetailProps {
  item: TimelineItem
  /** El nombre de la persona, el mismo que usa la rejilla. */
  name: string
  /** La cobertura de esa persona, si su declaración se pudo leer. Es la fila que ya calculó la tabla. */
  coverage: DeveloperCoverage | undefined
  /** La renegociación del elemento, si el plan lo desplazó y la lectura llegó. */
  renegotiation: RenegotiationItem | undefined
  /**
   * La fila de declaración del ticket, de la misma lectura que ya alimenta la cobertura.
   *
   * Es lo que permite declarar dentro del panel sin duplicar el formulario: `DeclarationForm` decide
   * entre crear y reemplazar con `declaration`, y el título y el estado llegan ya clasificados por el
   * backend. Cuando la lectura de esa persona falló, no hay fila y el panel enlaza a la pantalla.
   */
  declarationItem: DeclarationItem | undefined
  /** Los conflictos del mismo elemento, si los hubiera. */
  conflicts: readonly TeamConflict[]
  onClose: () => void
}

/**
 * El detalle de un tramo, como panel lateral.
 *
 * **Es un panel fijo, no una caja en el flujo.** Antes se pintaba debajo de la agenda y el gestor
 * tenía que bajar hasta él; al cerrarlo, la página volvía a su sitio. Ahora se abre a la derecha
 * —`fixed`, fuera del flujo— así que la rejilla no se mueve, y pulsar otro tramo cambia el contenido
 * del mismo panel en vez de tener que cerrarlo primero. **Se eligió panel lateral y no modal**: un
 * modal tapa la agenda y bloquea justo el clic con el que se cambia de ticket.
 *
 * **No calcula nada.** La causa es el evento que el plan auditó al moverlo —fecha original, fecha
 * nueva, regla, incidente y motivo—, el estado de la renegociación es el que el backend publica al
 * leer y la cobertura es la fila que la tabla de cobertura ya calculó. Esta sección solo pinta y
 * ofrece las acciones que llevan a pantallas existentes.
 *
 * **Cada acción aparece solo si el dato la sostiene.** «Renegociar» no está en los tramos que no se
 * movieron, porque la pantalla de renegociaciones no tendría nada que enseñar: una acción visible que
 * lleva a una lista vacía enseña a desconfiar de la pantalla entera.
 */
function ItemDetail({
  item,
  name,
  coverage,
  renegotiation,
  declarationItem,
  conflicts,
  onClose,
}: ItemDetailProps) {
  const displaced = item.planningStatus === 'DESPLAZADO'

  // La declaración sustituye al detalle dentro del mismo panel; cerrarla —o guardarla— devuelve al
  // detalle sin mover la agenda. El estado es local y muere con el tramo gracias a la `key`.
  const [declaring, setDeclaring] = useState(false)

  return (
    <SidePanel
      labelledBy="detalle-tramo"
      closeLabel="Cerrar detalle"
      onClose={onClose}
      header={
        <>
          <h2 id="detalle-tramo" className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>{item.workItemType === 'INCIDENTE' ? 'Incidente' : 'Requerimiento'}</span>
            <span className="font-mono">{item.workItemId}</span>
            <Badge variant={displaced ? 'warning' : 'info'}>
              {displaced ? 'Desplazado' : 'Planificado'}
            </Badge>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {name} · {formatDay(item.startsAt.slice(0, 10))} · {formatTime(item.startsAt)}–
            {formatTime(item.endsAt)} · {formatHours(item.durationHours)} h de{' '}
            {formatHours(item.estimatedHours)} h estimadas
            {item.committedDate && ` · compromiso ${formatDay(item.committedDate)}`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Plan <span className="font-mono">{item.sourcePlanId}</span>
          </p>
        </>
      }
    >
      {declaring && declarationItem ? (
        /*
          El mismo formulario de la pantalla de Declaración. Lee la declaración fresca antes de
          escribir cuando ya existe y valida con el backend; aquí solo cambia el sitio donde se
          enseña. Al guardar se cierra solo y el panel vuelve al detalle.
        */
        <DeclarationForm item={declarationItem} stacked onClose={() => setDeclaring(false)} />
      ) : (
        <div className="space-y-3">
        {/* Las acciones van justo bajo la cabecera: lo que se va a hacer queda a la vista sin bajar
            por el resto del detalle. */}
        <div className="flex flex-wrap gap-2">
          {/*
            Declarar se queda en el panel: es un ticket, y el formulario ya existe. Solo cuando la
            lectura de la persona no llegó —y por tanto no se sabe si el ticket ya tiene declaración—
            se enlaza a la pantalla, que vuelve a leer antes de escribir. Las dos rutas acaban en el
            mismo `DeclarationForm` y en el mismo servicio; no hay una segunda lógica.
          */}
          {declarationItem ? (
            <Button variant="outline" size="sm" onClick={() => setDeclaring(true)}>
              Declarar
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link
                to={declarationPath({
                  developerId: item.developerId,
                  workItemId: item.workItemId,
                  from: ROUTES.teamTimeline,
                })}
              >
                Declarar
              </Link>
            </Button>
          )}

          {/* La generación del plan ya sabe pedir el técnico por la dirección. */}
          <Button asChild variant="ghost" size="sm">
            <Link to={planningPath(item.developerId)}>Generar plan</Link>
          </Button>

          {(item.displacement || renegotiation) && (
            <Button asChild variant="outline" size="sm">
              <Link to={renegotiationPath(item.workItemId)}>Renegociar</Link>
            </Button>
          )}

          <Button asChild variant="ghost" size="sm">
            <Link to={calendarPath(item.sourcePlanId)}>Abrir detalle</Link>
          </Button>

          {/*
            Comparar vive en el calendario y sigue viviendo ahi: no se trae la pantalla, se enlaza.
            Lo que cambia es desde donde se llega —de una barra del timeline en vez de la lista de
            planes—, que es lo que convierte la comparacion en un modo del timeline.
          */}
          <Button asChild variant="ghost" size="sm">
            <Link to={comparisonPath(item.sourcePlanId)}>Comparar</Link>
          </Button>
        </div>

        {coverage && (
          <p data-slot="item-coverage" className="text-xs text-muted-foreground">
            Cobertura de {name}: {coverage.covered} de {coverage.active} tickets activos en el plan ·{' '}
            {coverage.pending} pendientes · {coverage.blockedByInformation} recuperables declarando.
          </p>
        )}

        {item.displacement && (
          <DisplacementCause
            originalDate={item.displacement.originalDate}
            newDate={item.displacement.newDate}
            appliedRule={item.displacement.appliedRule}
            incidentId={item.displacement.incidentId}
            severity={item.displacement.incidentSeverity}
            reason={item.displacement.reason}
          />
        )}

        {renegotiation && (
          <p
            data-slot="item-renegotiation"
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <Badge
              variant={renegotiation.status === 'ACORDADA' ? 'success' : 'warning'}
              data-slot="item-renegotiation-status"
              data-source={renegotiation.renegotiation?.source ?? ''}
            >
              {renegotiation.status === 'ACORDADA'
                ? AGREEMENT_ORIGIN_BADGE[agreementOrigin(renegotiation.renegotiation?.source)]
                : 'Pendiente de acuerdo'}
            </Badge>
            {renegotiation.renegotiation ? (
              <>
                <span>Fecha acordada: {formatDay(renegotiation.renegotiation.agreedDate)}</span>
                <span className="text-muted-foreground">
                  por {renegotiation.renegotiation.agreedBy}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Todavía no hay una fecha acordada.</span>
            )}
          </p>
        )}

        {conflicts.length > 0 && (
          <p data-slot="item-conflict" className="flex flex-wrap items-baseline gap-2 text-xs">
            <Badge variant="danger">Sin hueco</Badge>
            <span className="text-muted-foreground">{conflicts[0]?.reason}</span>
          </p>
        )}
        </div>
      )}
    </SidePanel>
  )
}

interface CoveragePanelProps {
  rows: readonly DeveloperCoverage[]
  totals: CoverageTotals
  /** Los pendientes por grupo, sumados de las filas. Es «qué impide planificar», en una línea. */
  groups: Record<PendingGroup, number>
  names: Readonly<Record<string, string>>
  /** Quién tiene plan vigente: la columna «Plan» y la misma señal que pinta «Sin plan» arriba. */
  withPlan: ReadonlySet<string>
  /** Los tickets que una llamada desbloquea, ya ordenados por `coverage.priorityTickets`. */
  tickets: readonly PendingItem[]
  /** Acuerdos que esperan a cada persona: enciende la acción «Acuerdos» solo donde hay alguno. */
  agreementCounts: Readonly<Record<string, number>>
  reading: boolean
  /** La lectura del lote falló entera: sin declaración no hay cobertura que afirmar. */
  failed: boolean
  unread: number
  /** Lleva al panel de pendientes filtrado por esta persona. No navega: filtra lo ya calculado. */
  onFocusPending: (developerId: string) => void
  /** Lleva al panel de acuerdos filtrado por esta persona. */
  onFocusAgreements: (developerId: string) => void
}

/** El desglose de una fila en palabras: «6 sin declaración · 2 sin estimación». */
function causeSummary(row: DeveloperCoverage): string {
  return (Object.entries(row.causes) as [PendingCause, number][])
    .filter(([, count]) => count > 0)
    .map(([cause, count]) => `${count} ${PENDING_CAUSE_LABEL[cause].toLowerCase()}`)
    .join(' · ')
}

/**
 * La vista operativa de cobertura: qué trabajo impide que el equipo tenga plan.
 *
 * **Es la pregunta que el Timeline no contestaba.** La rejilla dice quién tiene trabajo y el panel
 * de pendientes enumera uno a uno los tickets que no están en el plan; ninguno de los dos dice
 * cuánto de todo eso es *potencialmente planificable* y a quién desbloquea más una llamada. Esta
 * tabla lo dice por persona, ordenada por impacto, y enlaza cada nombre con su declaración.
 *
 * **No recalcula ninguna causa.** Todo sale de `declarationStatus` —decidido por el mismo validador
 * que alimenta el motor— y de las causas que ya publica `lib/pending.ts`. Si el validador cambia,
 * esta tabla cambia sola.
 *
 * **No enseña una cobertura que no se leyó.** Con la lectura fallida dice que no se puede afirmar;
 * con lecturas parciales cuenta las personas sin leer y no las pinta en cero.
 */
function CoveragePanel({
  rows,
  totals,
  groups,
  names,
  withPlan,
  tickets,
  agreementCounts,
  reading,
  failed,
  unread,
  onFocusPending,
  onFocusAgreements,
}: CoveragePanelProps) {
  const ranked = priorityOrder(rows)
  // La lista de llamadas: todo el que desbloquea algo declarando, en orden de impacto. Antes eran
  // tres; el gestor necesita el resto para el día siguiente, y el orden ya está calculado.
  const call = ranked.filter((row) => row.blockedByInformation > 0)
  // Los primeros tickets de la lista ordenada. Los demás siguen en el panel de pendientes.
  const topTickets = tickets.slice(0, TICKETS_SHOWN)
  const idle = ranked.filter((row) => row.active === 0)
  const withoutPlan = rows.filter((row) => !withPlan.has(row.developerId)).length

  return (
    <section
      aria-labelledby="cobertura"
      data-slot="coverage-panel"
      className="rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="cobertura" className="text-sm font-medium">
          Cobertura del plan
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums" data-slot="coverage-total">
          {reading ? (
            'Leyendo…'
          ) : failed ? (
            'Sin dato'
          ) : (
            <>
              {totals.covered} de {totals.active} tickets activos en el plan (
              {formatPercent(totals.rate)})
              <span data-slot="coverage-potential">
                {' · '}
                {countOf(
                  totals.blockedByInformation,
                  'recuperable mediante declaración',
                  'recuperables mediante declaración',
                )}
                {' · '}cobertura potencial {totals.potential} de {totals.active} (
                {formatPercent(totals.potentialRate)})
              </span>
            </>
          )}
          {unread > 0 && ` · ${unread} sin leer`}
        </p>
      </div>

      {/*
        La pregunta que el panel no contestaba: qué universo recibe el motor. Antes el plan leía el
        histórico cerrado y declaración leía los activos, así que el motor descartaba tickets que
        nadie había visto; desde la Fase 51 los dos leen lo mismo y esta línea lo dice con las cifras
        que ya están calculadas arriba. No es un cálculo nuevo: es la resta entre lo activo y lo
        planificable.
      */}
      {!reading && !failed && totals.active > 0 && (
        <p data-slot="coverage-engine" className="mt-2 text-xs text-muted-foreground">
          El motor recibe los mismos {totals.active} tickets activos que lista Declaración.{' '}
          {totals.planificable} llegan planificables —con estimación y compromiso— y{' '}
          {totals.active - totals.planificable}{' '}
          {totals.active - totals.planificable === 1 ? 'se descarta' : 'se descartan'} antes de
          planificar por falta de información o porque GLPI no los entrega de una forma que el
          contrato pueda leer. El motivo de cada uno está en «Trabajo pendiente».
        </p>
      )}

      {failed ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No se pudo leer la declaración del equipo: la cobertura no se puede afirmar.
        </p>
      ) : reading ? (
        <Skeleton className="mt-3 h-12 w-full" />
      ) : (
        <>
          {/*
            El resumen por grupo es el mismo que el del panel de pendientes, y no una segunda
            clasificación: lo que impide planificar es «falta información», y esa respuesta se lee
            antes de mirar ninguna fila.
          */}
          {totals.active > 0 && (
            <ul data-slot="coverage-causes" className="mt-2 flex flex-wrap items-center gap-1.5">
              {GROUPS.filter((group) => groups[group] > 0).map((group) => (
                <li key={group}>
                  <Badge variant={GROUP_BADGE[group]}>
                    {PENDING_GROUP_LABEL[group]}: {groups[group]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}

          {call.length > 0 && (
            <div data-slot="coverage-priority" className="mt-3 text-xs">
              <p className="font-medium">Llamar hoy a</p>
              <ol className="mt-1 space-y-1">
                {call.map((row, index) => (
                  <li
                    key={row.developerId}
                    className="flex flex-wrap items-baseline gap-x-2"
                    data-developer-id={row.developerId}
                  >
                    <span className="w-4 text-right tabular-nums text-muted-foreground">
                      {index + 1}.
                    </span>
                    <Link
                      to={declarationPath({
                        developerId: row.developerId,
                        from: ROUTES.teamTimeline,
                        batch: true,
                      })}
                      title={`Abrir los tickets pendientes de ${names[row.developerId] ?? row.developerId} para declararlos en lote.`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {names[row.developerId] ?? row.name ?? row.developerId}
                    </Link>{' '}
                    <span className="text-muted-foreground">
                      {countOf(
                        row.blockedByInformation,
                        'ticket bloqueado',
                        'tickets bloqueados',
                      )}{' '}
                      · quedaría en {row.potential} de {row.active}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/*
            La lista de tickets es el paso siguiente a la de personas: la llamada no se cierra con
            «declara tus tickets», se cierra con cuáles y en qué orden. Los primeros son los que solo
            esperan un dato, y el resto sigue completo en «Trabajo pendiente».
          */}
          {topTickets.length > 0 && (
            <div data-slot="priority-tickets" className="mt-3">
              <p className="text-xs font-medium">Tickets que desbloquea una declaración</p>
              <ul className="mt-1 space-y-1">
                {topTickets.map((item) => (
                  <li key={`${item.developerId}-${item.workItemId}`}>
                    <Link
                      to={declarationPath({
                        developerId: item.developerId,
                        workItemId: item.workItemId,
                        from: ROUTES.teamTimeline,
                      })}
                      title={`${PENDING_CAUSE_DETAIL[item.cause]} Abrir la declaración.`}
                      data-slot="priority-ticket"
                      className="flex flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Badge variant={CAUSE_BADGE[item.cause]}>
                        {PENDING_CAUSE_LABEL[item.cause]}
                      </Badge>
                      <span className="font-mono">{item.workItemId}</span>
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="text-muted-foreground">
                        {names[item.developerId] ?? item.developerId}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {tickets.length > topTickets.length && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {tickets.length - topTickets.length} más en «Trabajo pendiente».
                </p>
              )}
            </div>
          )}

          {/*
            `relative` no es decorativo: el `<caption class="sr-only">` de la tabla es
            `position:absolute`, y sin un ancestro posicionado su bloque contenedor es el documento.
            Un elemento absoluto no lo recorta el `overflow` de `main`, así que su posición —el
            final de una página de casi 4.000 px— alargaba el área desplazable del documento y
            dejaba ~1.000 px de scroll fantasma por debajo de la aplicación.
          */}
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full min-w-max text-xs">
              <caption className="sr-only">
                Cobertura por persona: tickets activos, con declaración, planificables, pendientes,
                recuperables mediante declaración y en el plan, con las acciones de su fila.
                Ordenada por impacto.
              </caption>
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-4 font-medium">
                    Persona
                  </th>
                  {/*
                    Las acciones nacen aquí desde la Fase 50. Antes esta tabla decía cuánto le
                    falta a cada persona y el gestor tenía que ir al menú a resolverlo; ahora cada
                    fila ofrece el paso siguiente sin salir del Timeline. «Declarar» y «Generar
                    plan» navegan a las pantallas que ya existían —con el técnico puesto—;
                    «Pendientes» y «Acuerdos» filtran los paneles de abajo.
                  */}
                  <th scope="col" className="py-1 pr-4 font-medium">
                    Acciones
                  </th>
                  <th scope="col" className="py-1 pr-4 font-medium">
                    Plan
                  </th>
                  <th scope="col" className="py-1 pr-4 text-right font-medium">
                    Activos
                  </th>
                  <th scope="col" className="py-1 pr-4 text-right font-medium">
                    Declarados
                  </th>
                  <th scope="col" className="py-1 pr-4 text-right font-medium">
                    Planificables
                  </th>
                  <th scope="col" className="py-1 pr-4 text-right font-medium">
                    Pendientes
                  </th>
                  <th scope="col" className="py-1 pr-4 text-right font-medium">
                    Recuperables
                  </th>
                  <th scope="col" className="py-1 pr-4 text-right font-medium">
                    En el plan
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Cobertura
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row) => (
                  <tr
                    key={row.developerId}
                    data-slot="coverage-row"
                    data-developer-id={row.developerId}
                    data-blocked={row.blockedByInformation}
                    className="border-t border-border align-top"
                  >
                    <td className="py-1 pr-4">
                      <Link
                        to={declarationPath({
                          developerId: row.developerId,
                          from: ROUTES.teamTimeline,
                          batch: true,
                        })}
                        title={`Abrir los tickets pendientes de ${names[row.developerId] ?? row.name ?? row.developerId} para declararlos en lote.`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {names[row.developerId] ?? row.name ?? row.developerId}
                      </Link>
                      {row.pending > 0 && (
                        <span className="block text-[10px] text-muted-foreground">
                          {causeSummary(row)}
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-4">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <Link
                          to={declarationPath({
                            developerId: row.developerId,
                            from: ROUTES.teamTimeline,
                            batch: true,
                          })}
                          title={`Declarar lo que le falta a ${names[row.developerId] ?? row.name ?? row.developerId}.`}
                          data-slot="coverage-declare"
                          className="underline-offset-2 hover:underline"
                        >
                          Declarar
                        </Link>
                        <Link
                          to={planningPath(row.developerId)}
                          title={`Abrir la planificación de ${names[row.developerId] ?? row.name ?? row.developerId} con el técnico ya puesto.`}
                          data-slot="coverage-plan"
                          className="underline-offset-2 hover:underline"
                        >
                          Generar plan
                        </Link>
                        {row.pending > 0 && (
                          <button
                            type="button"
                            onClick={() => onFocusPending(row.developerId)}
                            title="Ver abajo los tickets pendientes de esta persona."
                            data-slot="coverage-pending"
                            className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Pendientes
                          </button>
                        )}
                        {(agreementCounts[row.developerId] ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => onFocusAgreements(row.developerId)}
                            title="Ver abajo los acuerdos que esta persona todavía no aceptó."
                            data-slot="coverage-agreements"
                            className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Acuerdos
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-1 pr-4">
                      {withPlan.has(row.developerId) ? (
                        'Con plan'
                      ) : (
                        <Badge variant="secondary">Sin plan</Badge>
                      )}
                    </td>
                    <td className="py-1 pr-4 text-right tabular-nums">{row.active}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{row.declared}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{row.planificable}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{row.pending}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">
                      {row.blockedByInformation}
                    </td>
                    <td className="py-1 pr-4 text-right tabular-nums">
                      {row.covered} de {row.active}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {row.active === 0 ? '—' : formatPercent(row.covered / row.active)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {idle.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {countOf(idle.length, 'persona sin tickets activos', 'personas sin tickets activos')}:{' '}
              {idle.map((row) => names[row.developerId] ?? row.name ?? row.developerId).join(', ')}.
            </p>
          )}

          {withoutPlan > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {countOf(
                withoutPlan,
                'persona del equipo sin plan vigente',
                'personas del equipo sin plan vigente',
              )}
              .
            </p>
          )}
        </>
      )}
    </section>
  )
}

interface ConflictPanelProps {
  conflicts: readonly TeamConflict[]
  names: Readonly<Record<string, string>>
}

/**
 * El trabajo que el motor no pudo ubicar.
 *
 * No tiene tramo y por eso no se puede pintar en la rejilla: aparece aquí, con el motivo que el motor
 * redactó al calcular. Es la mitad de la capa de pendientes que la declaración no puede ver —un
 * ticket puede estar perfectamente declarado y aun así no caber— y sin esta lista la pantalla diría
 * «sin capacidad» sin poder decir por qué.
 */
function ConflictPanel({ conflicts, names }: ConflictPanelProps) {
  if (conflicts.length === 0) {
    return null
  }

  return (
    <section
      aria-labelledby="sin-hueco"
      data-slot="conflict-panel"
      className="rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="sin-hueco" className="text-sm font-medium">
          Trabajo que no cupo en el plan
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">{conflicts.length} en el equipo</p>
      </div>

      <ul className="mt-2 space-y-1 text-xs">
        {conflicts.map((conflict) => (
          <li
            key={`${conflict.developerId}-${conflict.workItemId}`}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            <span className="font-medium">{names[conflict.developerId] ?? conflict.developerId}</span>
            <span className="font-mono">{conflict.workItemId}</span>
            <span className="text-muted-foreground">{conflict.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Los pendientes de una persona, ya listos para pintar con su nombre. */
interface DeveloperPending {
  developerId: string
  items: PendingItem[]
}

interface PendingPanelProps {
  groups: DeveloperPending[]
  /** El nombre de cada persona, el mismo que usa la rejilla. Sin él se enseña el identificador. */
  names: Readonly<Record<string, string>>
  total: number
  /** Cuántos pendientes hay en cada grupo. Es la respuesta de una línea a «información o capacidad». */
  summary: Record<PendingGroup, number>
  reading: boolean
  /** Cuántas personas se preguntaron y no se pudieron leer. */
  unread: number
  /** La persona a la que se llegó desde su fila de cobertura, o nula para ver el equipo entero. */
  focus: string | null
  onClearFocus: () => void
}

/**
 * La tercera capa, en lista.
 *
 * La rejilla avisa de **dónde** hay pendientes —el distintivo de la fila—, pero no de cuáles: son
 * tickets que todavía no tienen tramo y por eso no se pueden pintar en una columna. Este panel los
 * pone uno a uno y enlaza al sitio donde se arreglan: la declaración del ticket, o la renegociación
 * cuando lo que falta es un acuerdo.
 */
function PendingPanel({
  groups,
  names,
  total,
  summary,
  reading,
  unread,
  focus,
  onClearFocus,
}: PendingPanelProps) {
  // El foco no vuelve a pedir nada: filtra los grupos que ya se calcularon con la lectura del lote.
  const visible = focus === null ? groups : groups.filter((group) => group.developerId === focus)
  const focusedName = focus === null ? null : (names[focus] ?? focus)

  return (
    <section
      aria-labelledby="pendientes"
      className="rounded-lg border border-border p-4"
      data-slot="pending-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="pendientes" className="text-sm font-medium">
          Trabajo pendiente
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {reading ? 'Leyendo…' : `${total} en el equipo`}
          {unread > 0 && ` · ${unread} sin leer`}
        </p>
      </div>

      {/*
        El resumen por grupo es la respuesta a la pregunta del gestor: cuánto es falta de información
        y cuánto es falta de capacidad. Sin él habría que abrir las filas para saberlo, y la pantalla
        volvería a enseñar una sola cifra de «pendientes» sin decir de qué.
      */}
      {!reading && total > 0 && (
        <ul
          data-slot="pending-summary"
          className="mt-2 flex flex-wrap items-center gap-1.5"
        >
          {GROUPS.filter((group) => summary[group] > 0).map((group) => (
            <li key={group}>
              <Badge variant={GROUP_BADGE[group]}>
                {PENDING_GROUP_LABEL[group]}: {summary[group]}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {focusedName !== null && (
        <p data-slot="pending-focus" className="mt-2 text-xs">
          Solo los pendientes de <span className="font-medium">{focusedName}</span>.{' '}
          <button
            type="button"
            onClick={onClearFocus}
            className="underline underline-offset-2 hover:text-muted-foreground"
          >
            Ver todo el equipo
          </button>
        </p>
      )}

      {reading ? (
        <Skeleton className="mt-3 h-12 w-full" />
      ) : visible.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {/*
            Sin pendientes y sin nada sin leer, todo lo que GLPI tiene asignado está dentro del plan.
            Con lecturas fallidas el vacío no afirma eso, y por eso las dos frases son distintas. La
            tercera es el foco: llegar a una persona no puede afirmar que el equipo esté completo.
          */}
          {focusedName !== null
            ? `${focusedName} no tiene trabajo pendiente.`
            : unread === 0
              ? 'Todo el trabajo asignado está dentro del plan vigente.'
              : 'No se pudo leer la declaración de todas las personas; lo que falta no se puede afirmar.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-4">
          {visible.map((group) => (
            <li key={group.developerId}>
              <p className="text-xs font-medium">{names[group.developerId] ?? group.developerId}</p>

              <ul className="mt-1 space-y-1">
                {group.items.map((item) => (
                  <li key={item.workItemId}>
                    <Link
                      // Cada causa se arregla en un sitio distinto, y el enlace lo lleva ahí: lo que
                      // falta se declara, lo que espera una fecha se acuerda y lo que no entró en el
                      // plan se arregla volviendo a generarlo —no declarando lo que ya está declarado—.
                      to={pendingPath(item, ROUTES.teamTimeline)}
                      title={`${PENDING_CAUSE_DETAIL[item.cause]} ${
                        item.cause === 'SIN_ACUERDO'
                          ? 'Abrir la renegociación.'
                          : item.cause === 'NO_INCLUIDO_EN_EL_PLAN'
                            ? 'Abrir la planificación con el técnico ya puesto.'
                            : 'Abrir la declaración.'
                      }`}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Badge variant={CAUSE_BADGE[item.cause]}>
                        {PENDING_CAUSE_LABEL[item.cause]}
                      </Badge>
                      <span className="font-mono">{item.workItemId}</span>
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface AgreementPanelProps {
  /** Los desplazamientos con su estado, tal como los publica la API de renegociación. */
  items: readonly RenegotiationItem[]
  names: Readonly<Record<string, string>>
  reading: boolean
  /** La lectura de renegociaciones falló: los acuerdos pendientes no se pueden afirmar. */
  failed: boolean
  /** La persona a la que se llegó desde su fila de cobertura, o nula para ver el equipo entero. */
  focus: string | null
  onClearFocus: () => void
}

/**
 * Los acuerdos que faltan, dentro del Timeline.
 *
 * **No es un dominio nuevo.** Cada fila sale de `GET /api/renegotiations`, la misma lectura que ya
 * usa el detalle de un tramo, filtrada a `PENDIENTE_DE_ACUERDO`: el backend dice qué desplazamiento
 * sigue sin fecha aceptada y esta sección solo lo agrupa por persona. Registrar el acuerdo sigue
 * siendo la pantalla de Renegociación, que se abre con el ticket ya seleccionado.
 *
 * **Existe porque el gestor abría esa pantalla para descubrir a quién le toca**: la cola de
 * acuerdos es una pregunta sobre el equipo, y el equipo se está mirando aquí. El enlace al listado
 * completo se queda por si hay que trabajarla entera.
 */
function AgreementPanel({
  items,
  names,
  reading,
  failed,
  focus,
  onClearFocus,
}: AgreementPanelProps) {
  const pending = items.filter((item) => item.status === 'PENDIENTE_DE_ACUERDO')

  const byDeveloper = new Map<string, RenegotiationItem[]>()
  for (const item of pending) {
    const list = byDeveloper.get(item.developerId)

    if (list) {
      list.push(item)
    } else {
      byDeveloper.set(item.developerId, [item])
    }
  }

  const groups = [...byDeveloper.entries()].map(([developerId, list]) => ({
    developerId,
    items: list,
  }))
  const visible = focus === null ? groups : groups.filter((group) => group.developerId === focus)
  const focusedName = focus === null ? null : (names[focus] ?? focus)

  return (
    <section
      aria-labelledby="acuerdos"
      data-slot="agreement-panel"
      className="rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="acuerdos" className="text-sm font-medium">
          Acuerdos pendientes
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {reading ? 'Leyendo…' : failed ? 'Sin dato' : `${pending.length} en el equipo`}
          {' · '}
          <Link
            to={ROUTES.renegotiations}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Abrir renegociaciones
          </Link>
        </p>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Fechas que el plan movió y nadie aceptó todavía. Aquí se ve a quién le toca; el acuerdo se
        registra en la pantalla de renegociación, con el ticket ya seleccionado.
      </p>

      {focusedName !== null && (
        <p data-slot="agreement-focus" className="mt-2 text-xs">
          Solo los acuerdos de <span className="font-medium">{focusedName}</span>.{' '}
          <button
            type="button"
            onClick={onClearFocus}
            className="underline underline-offset-2 hover:text-muted-foreground"
          >
            Ver todo el equipo
          </button>
        </p>
      )}

      {reading ? (
        <Skeleton className="mt-3 h-12 w-full" />
      ) : failed ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No se pudo leer la renegociación: los acuerdos pendientes no se pueden afirmar.
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {focusedName !== null
            ? `${focusedName} no tiene acuerdos pendientes.`
            : 'No hay acuerdos pendientes: todo lo que el plan movió tiene una fecha aceptada.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {visible.map((group) => (
            <li key={group.developerId} data-developer-id={group.developerId}>
              <p className="text-xs font-medium">
                {names[group.developerId] ?? group.developerId}
                <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
                  ({group.items.length})
                </span>
              </p>

              <ul className="mt-1 space-y-1">
                {group.items.map((item) => {
                  const movement = item.events[item.events.length - 1] ?? null

                  return (
                    <li key={item.workItemId}>
                      <Link
                        to={renegotiationPath(item.workItemId)}
                        title="Abrir la renegociación con este ticket ya seleccionado."
                        data-slot="agreement-row"
                        className="flex flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Badge variant="danger">Sin acuerdo</Badge>
                        <span className="font-mono">{item.workItemId}</span>
                        {movement && (
                          <span className="text-muted-foreground">
                            {formatDay(movement.originalDate)} →{' '}
                            {formatDay(movement.rescheduledDate)}
                          </span>
                        )}
                        <span className="text-muted-foreground">Acordar →</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface AlertPanelProps {
  /** Las condiciones que hoy se cumplen, de más grave a menos, como las publica el backend. */
  alerts: readonly OperationalAlert[]
  generatedAt: string
  reading: boolean
  failed: boolean
}

/** Cuántas alertas enseña el panel. El resto sigue en el centro de alertas, completo. */
const ALERTS_SHOWN = 4

/**
 * La salud operativa del equipo, dentro del Timeline.
 *
 * **No evalúa nada.** Consume la misma lectura que el centro de alertas y pinta lo que llega, en el
 * orden en que llega: cada fila es una condición que el backend ya decidió que se cumple, con
 * cuántos elementos la cumplen. El desglose de una métrica se abre por `alertDetailPath`, que es el
 * mismo traductor que usa el centro, y solo cuando la ruta tiene pantalla.
 *
 * **No suma los `count`.** Las alertas clasifican y no particionan —un elemento puede producir
 * varias—, así que un total sería una cifra que nadie publicó.
 */
function AlertPanel({ alerts, generatedAt, reading, failed }: AlertPanelProps) {
  const shown = alerts.slice(0, ALERTS_SHOWN)

  return (
    <section
      aria-labelledby="alertas"
      data-slot="alert-panel"
      className="rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="alertas" className="text-sm font-medium">
          Salud operativa
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {reading ? (
            'Leyendo…'
          ) : failed ? (
            'Sin dato'
          ) : alerts.length === 0 ? (
            'Ninguna condición exige atención'
          ) : (
            `${alerts.length} ${alerts.length === 1 ? 'condición' : 'condiciones'}`
          )}
          {' · '}
          <Link to={ROUTES.alerts} className="underline underline-offset-2 hover:text-foreground">
            Centro de alertas
          </Link>
        </p>
      </div>

      {reading ? (
        <Skeleton className="mt-3 h-10 w-full" />
      ) : failed ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No se pudo leer el estado operativo. Las alertas de arriba siguen siendo válidas: esta
          lectura es independiente.
        </p>
      ) : alerts.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {generatedAt
            ? 'Se evaluaron las condiciones operativas y no se cumple ninguna: no es una respuesta incompleta, es el estado que una alerta existe para poder declarar.'
            : 'No se cumple ninguna condición operativa.'}
        </p>
      ) : (
        <>
          <ul className="mt-2 space-y-1 text-xs">
            {shown.map((alert) => {
              const detail = alertDetailPath(alert.detailUrl)

              return (
                <li
                  key={alert.type}
                  data-slot="alert-row"
                  data-severity={alert.severity}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                >
                  <Badge variant={SEVERITY_VARIANTS[alert.severity]}>{alert.severity}</Badge>
                  <span className="font-medium">{alert.condition}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {countOf(alert.count, 'elemento', 'elementos')}
                  </span>
                  {detail && (
                    <Link
                      to={detail}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Ver desglose →
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>

          {alerts.length > shown.length && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {alerts.length - shown.length} más en el centro de alertas.
            </p>
          )}
        </>
      )}
    </section>
  )
}
