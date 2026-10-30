import { AlertTriangle, CheckCircle2, FilterX, Layers } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { IncidentTable } from '@/components/incidents/IncidentTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useTeamDeclarations } from '@/hooks/useDeclarations'
import { useRenegotiations } from '@/hooks/useRenegotiations'
import { useTeam } from '@/hooks/useTeam'
import { useTeamTimeline } from '@/hooks/useTeamTimeline'
import {
  AGREED,
  ANY,
  DECLARED,
  DISPLACED,
  PENDING,
  PENDING_AGREEMENT,
  PLANNED,
  WITH_PLAN,
  WITHOUT_PLAN,
  declarationBreakdown,
  factsReader,
  filterIncidents,
  filtersFromParams,
  modeFromParams,
  sortIncidents,
  toIncidentRows,
  type IncidentFilters,
  type IncidentRow,
  type TeamViewMode,
} from '@/lib/incidents'
import { declarationKeysFor } from '@/lib/team'
import { teamAgenda } from '@/lib/timeline'
import {
  declarationPath,
  incidentsPath,
  renegotiationPath,
  ticketTimelinePath,
} from '@/routes/navigation'
import type { TeamPerson } from '@/types/team'

/** Esqueleto de la carga: la misma forma que el contenido, para que no haya salto de altura. */
function IncidentsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/**
 * Las opciones del filtro de persona: el login como valor y el nombre como etiqueta.
 *
 * No se sacan de las filas sino del padrón visible: quien no tiene tickets hoy sigue siendo una
 * persona a la que se puede filtrar, y elegirla contesta «no tiene nada» con la tabla vacía en vez de
 * con la opción ausente —que se leería como que no existe—.
 */
function personOptions(people: readonly TeamPerson[]) {
  return [
    { value: ANY, label: 'Todas' },
    ...people.map((person) => ({
      value: person.developerId,
      label: person.name ?? person.developerId,
    })),
  ]
}

/**
 * Las opciones de un filtro, sacadas de lo que llegó.
 *
 * El catálogo **no se escribe aquí**: los estados del dominio cambian con el tipo —una incidencia
 * está `EN_ATENCION` y un requerimiento `EN_EJECUCION`, los dos desde el mismo estado de GLPI—, así
 * que una lista a mano se quedaría corta el día que el contrato añada uno. El orden es el de la
 * respuesta.
 */
function optionsOf<T extends string>(values: readonly T[], anyLabel: string) {
  return [
    { value: ANY, label: anyLabel },
    ...[...new Set(values)].map((value) => ({ value, label: value })),
  ]
}

/**
 * Selector nativo de filtro: el navegador ya sabe hacerlo y la aplicación no tiene componente de
 * select.
 *
 * Es el mismo que las alertas y la línea de tiempo guardan en privado. Vive también aquí por el mismo
 * motivo: esta fase no puede tocar ninguna de esas dos pantallas —sus pruebas son parte de lo que hay
 * que mantener verde—, así que el original no se puede sustituir por uno compartido. Queda anotado
 * como deuda, no se refactoriza aquí.
 */
function Filter({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * El trabajo activo de hoy, persona a persona.
 *
 * **No calcula nada.** Las filas son las respuestas por persona del endpoint de declaraciones, que ya
 * devuelve solo los tickets activos y ya viene clasificado; esta pantalla las empareja con el padrón
 * para saber de quién es cada una, las ordena y las filtra. El tipo, el estado, la prioridad, la
 * fecha y el estado de declaración llegan puestos.
 *
 * **No duplica el tablero.** No hay tarjetas de métricas ni tabla de alertas: eso vive en el resumen y
 * en `/alertas`, y lo que esta pantalla añade es la lista que allí no cabe —quién tiene qué—. Las
 * cifras que enseña son de la vista, no del negocio.
 *
 * **Desde aquí se declara.** Cada fila pendiente lleva su atajo a la declaración de ese ticket, con la
 * vuelta ya puesta para no perder la vista. Lo que se abre es la pantalla de declaración de siempre,
 * con sus mismas reglas: lo único que cambia es que el técnico y el ticket llegan puestos en vez de
 * tecleados y buscados a ojo.
 *
 * **El modo decide algo más que en Recursos, y se dice:** allí la columna de tickets era del equipo
 * entero y cambiar de modo no preguntaba nada a nadie; aquí las filas **son** los tickets, así que
 * ampliar la vista pide el trabajo de quien entra. Es el precio de que la tabla no tenga filas
 * inventadas, y es la divergencia que queda escrita en la decisión.
 *
 * Todo lo que se pide aquí se pide con la misma clave de caché que la tabla del equipo, así que
 * visitar las dos pantallas no repite ninguna lectura de GLPI.
 */
export function Incidents() {
  const { data, isPending, isError, error, refetch } = useTeam()

  // Las dos lecturas que convierten la tabla en el inventario completo: el plan vigente dice dónde
  // está cada ticket y la renegociación dice qué espera una fecha. Son las mismas consultas que el
  // Timeline —misma clave de caché—, así que ir y volver entre las dos pantallas no relee nada.
  const timeline = useTeamTimeline()
  const renegotiations = useRenegotiations()

  // La dirección **siembra** el modo y los filtros, una sola vez, y el estado local sigue mandando. Si
  // la dirección los gobernara, cada `<select>` sería una navegación y el botón «atrás» desharía
  // filtros en vez de salir de la pantalla. Lo que sí viaja es el enlace de vuelta, que se compone con
  // lo que hay vivo en el momento del clic.
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<TeamViewMode>(() => modeFromParams(searchParams))
  const [filters, setFilters] = useState<IncidentFilters>(() => filtersFromParams(searchParams))

  const people = data?.people ?? []

  // El filtro de equipo operativo se hace sobre la persona del padrón, no con `inOperationalTeam`:
  // aquel predicado protege una fila `PLAN` —alguien a quien solo se conoce por un plan guardado— que
  // solo existe en el modelo de la tabla del equipo. Aquí no hay filas inventadas: hay personas.
  const shown = mode === 'operativo' ? people.filter((person) => person.operational) : people

  // Una consulta por persona visible, en el orden de esta lista: `useQueries` empareja por posición.
  const keys = declarationKeysFor(shown, [])
  const declarations = useTeamDeclarations(keys)

  /*
   * La agenda se cruza con el padrón igual que en el Timeline: un plan guardado puede nombrar a la
   * persona por su número de GLPI, y `teamAgenda` lo traduce al login. Sin esa traducción, la
   * columna de plan saldría «Sin plan» para quien sí lo tiene.
   */
  const agenda = teamAgenda(people, timeline.data)

  /*
   * Los hechos del plan y del acuerdo, sin recalcular nada. Cuando una lectura no llegó se pasa
   * `undefined` y la tabla enseña el hueco: no es lo mismo «sin plan» que «no se pudo leer el plan».
   */
  const factsOf = factsReader(timeline.data ? agenda.items : undefined, renegotiations.data)

  const rows = sortIncidents(
    toIncidentRows(
      shown,
      declarations.map((declaration) => declaration.data),
      factsOf,
    ),
  )

  const visible = filterIncidents(rows, filters)

  // El desglose se cuenta sobre lo que se ve, así que las cifras cuadran con las filas de debajo y
  // nadie puede contar otra cosa mirando la tabla.
  const breakdown = declarationBreakdown(visible)

  /**
   * El atajo de una fila: la dirección de la declaración de ese ticket, con la vuelta ya puesta.
   *
   * Se compone con el modo y los filtros **de este render**, así que lo que queda guardado como vuelta
   * es la vista tal como está en el momento del clic. Es lo que permite conservar los filtros sin
   * llevar el estado de la pantalla en la dirección.
   */
  const declarationHref = (row: IncidentRow) =>
    declarationPath({
      developerId: row.developerId,
      workItemId: row.item.workItemId,
      from: incidentsPath(filters, mode),
    })

  // Las otras dos salidas de la fila no dependen del estado de la pantalla: el Timeline se filtra
  // por la persona y señala el ticket, y la renegociación abre la fila de ese ticket.
  const timelineHref = (row: IncidentRow) =>
    ticketTimelinePath(row.developerId, row.item.workItemId)

  const renegotiationHref = (row: IncidentRow) => renegotiationPath(row.item.workItemId)

  // Una respuesta que falta es una persona a la que **no se le pudo leer el trabajo**, y eso no es lo
  // mismo que no tener ninguno. Se cuenta para poder decirlo.
  const unreadable = declarations.filter((declaration) => declaration.isError).length
  const withWork = new Set(rows.map((row) => row.developerId)).size

  // Se espera al padrón y a las respuestas que producen las filas. Un fallo no cuenta como espera: su
  // consulta pasa a error y la tabla se enseña con lo que sí llegó. La espera tampoco vuelve cuando la
  // tabla ya tiene filas: ampliar la vista no puede tapar lo que ya está leído.
  const loading = isPending || (rows.length === 0 && declarations.some((d) => d.isPending))

  if (loading) {
    return <IncidentsSkeleton />
  }

  if (isError) {
    return (
      <EmptyState
        tone="danger"
        icon={AlertTriangle}
        title="No fue posible cargar el trabajo del equipo"
        detail={error instanceof Error ? error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  if (people.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="El padrón no trae ninguna persona"
        detail="No hay a quién preguntarle por su trabajo. El padrón lo publica el grupo de Desarrollo N2 en GLPI más las excepciones declaradas en la configuración del backend."
      />
    )
  }

  const switchRow = (
    <div className="flex shrink-0 items-center gap-2" data-slot="team-mode-switch">
      <Button
        variant={mode === 'operativo' ? 'secondary' : 'outline'}
        size="sm"
        aria-pressed={mode === 'operativo'}
        onClick={() => setMode('operativo')}
      >
        Solo equipo operativo
      </Button>

      <Button
        variant={mode === 'todos' ? 'secondary' : 'outline'}
        size="sm"
        aria-pressed={mode === 'todos'}
        onClick={() => setMode('todos')}
      >
        Mostrar todo Desarrollo N2
      </Button>
    </div>
  )

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {rows.length} tickets activos repartidos entre {withWork} de las {shown.length} personas de la
        vista{filtersExcludeNothing(filters) ? '' : `, de los que ${visible.length} pasan los filtros`}
        . Solo entran los que GLPI tiene sin resolver —nuevo, asignado, planificado o pendiente—: lo
        resuelto y lo cerrado no aparecen. El tipo, el estado, la prioridad y la fecha los publica
        GLPI; el estado de declaración lo calcula el backend sobre la planificación declarada; el
        plan y el acuerdo se leen de los tramos y de la renegociación, sin recalcular nada.
      </p>

      {/* El desglose de la observabilidad, sobre lo que se ve. Se dice que las cuentas se solapan
          porque lo hacen: sin esa frase, «pendientes» y «sin estimación» se leerían como dos cajones
          que no comparten nada y las cifras parecerían no cuadrar con el total.

          «Con algo pendiente» y no «sin declarar»: un ticket sin estimación ya tiene su fila, y
          llamarlo sin declarar sería afirmar lo contrario de lo que el backend publica. Las cifras
          van delante de una frase que no concuerda —«1 con su fila creada», «3 con su fila creada»—,
          porque el número uno es el caso normal de esta pantalla.

          El segundo parcial no habla de una declaración: desde la Fase 77 la fecha no se declara,
          la publica GLPI, y lo que cuenta son los tickets a los que no les publica ninguna. Decir
          «el compromiso sin declarar» afirmaría que hay algo que declarar, que es justo lo que la
          fase quitó. */}
      <p className="text-xs text-muted-foreground" data-slot="declaration-breakdown">
        De esos {visible.length} tickets: {breakdown.declared} en estado declarado —nada les falta
        para planificarse— y {breakdown.pending} con algo pendiente. De estos últimos,{' '}
        {breakdown.withoutEstimation} con su fila ya creada y la estimación sin declarar, y{' '}
        {breakdown.withoutGlpiDate} con su fila creada y sin fecha que GLPI publique. Las cuentas se
        solapan —un ticket sin estimación también está pendiente—: es un desglose, no un reparto.
      </p>

      {/* Un fallo de lectura se declara donde se ve su efecto —faltan filas— y no se lleva por
          delante la vista, igual que en la tabla del equipo. */}
      {unreadable > 0 && (
        <p className="text-xs text-muted-foreground">
          No fue posible leer el trabajo de {unreadable} de las {shown.length} personas, así que sus
          tickets no están en la tabla. Lo que se ve sí está completo.
        </p>
      )}

      {/* Las dos lecturas que no son de GLPI fallan por su cuenta y no se llevan la tabla por
          delante: lo que no se pudo leer se declara y su columna queda en hueco. */}
      {(timeline.isError || renegotiations.isError) && (
        <p className="text-xs text-muted-foreground">
          {timeline.isError && <span>El plan vigente no se pudo leer: la columna Plan queda en hueco. </span>}
          {renegotiations.isError && (
            <span>Los acuerdos no se pudieron leer: la columna Acuerdo queda en hueco.</span>
          )}
        </p>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Trabajo activo
              </CardTitle>
              <CardDescription>
                Una fila por ticket activo y persona: un ticket que GLPI tenga asignado a dos personas
                aparece en las dos, porque las dos lo tienen como carga. La persona la dice la lectura
                —cada respuesta es la de alguien— y no se deduce del ticket. El estado de declaración
                dice si al ticket no le falta nada para planificarse, y cuando le falta algo lo nombra
                con el código de la regla y su motivo. El plan dice si el motor lo colocó y si lo
                movió de fecha; el acuerdo, si esa fecha nueva ya se acordó. Un hueco —«—»— es que la
                lectura no llegó, no que falte el dato.
                <br />
                Los filtros no vuelven a consultar nada: se aplican sobre lo que ya está en pantalla.
                El conmutador sí, porque aquí las filas son el trabajo de cada persona y ampliar la
                vista es ampliar la lectura.
              </CardDescription>
            </div>

            {switchRow}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* El filtro de equipo operativo se decide sobre el padrón visible: que no quede nadie es
              otra cosa —hay gente y ninguna declarada operativa— y decirlo con la frase del vacío
              mandaría a buscar el problema a GLPI. */}
          {shown.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="Nadie está declarado en el equipo operativo"
              detail={`El padrón trae ${people.length} personas y ninguna forma parte del equipo operativo, así que la vista por defecto no tiene a quién preguntar. «Mostrar todo Desarrollo N2» las enseña todas. La pertenencia la decide la configuración del backend.`}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <Filter
                  id="filtro-persona"
                  label="Persona"
                  value={filters.person}
                  options={personOptions(shown)}
                  onChange={(person) => setFilters((current) => ({ ...current, person }))}
                />
                <Filter
                  id="filtro-tipo"
                  label="Tipo"
                  value={filters.type}
                  options={optionsOf(
                    rows.map((row) => row.item.type).filter((type) => type !== null),
                    'Todos',
                  )}
                  onChange={(type) => setFilters((current) => ({ ...current, type }))}
                />
                <Filter
                  id="filtro-estado"
                  label="Estado GLPI"
                  value={filters.status}
                  options={optionsOf(
                    rows.map((row) => row.item.status).filter((status) => status !== null),
                    'Todos',
                  )}
                  onChange={(status) => setFilters((current) => ({ ...current, status }))}
                />
                <Filter
                  id="filtro-declaracion"
                  label="Declaración"
                  value={filters.declaration}
                  options={[
                    { value: ANY, label: 'Todas' },
                    { value: DECLARED, label: 'Planificable' },
                    { value: PENDING, label: 'Pendiente' },
                  ]}
                  onChange={(declaration) =>
                    setFilters((current) => ({ ...current, declaration }))
                  }
                />
                {/* La pertenencia al plan y el estado del tramo en el mismo control: son una sola
                    pregunta —«¿dónde está?»— y elegir una cosa a la vez evita pedir «con plan» y
                    «sin plan» juntos. */}
                <Filter
                  id="filtro-planificacion"
                  label="Planificación"
                  value={filters.planning}
                  options={[
                    { value: ANY, label: 'Todas' },
                    { value: WITH_PLAN, label: 'Con plan' },
                    { value: WITHOUT_PLAN, label: 'Sin plan' },
                    { value: PLANNED, label: 'Planificado' },
                    { value: DISPLACED, label: 'Desplazado' },
                  ]}
                  onChange={(planning) => setFilters((current) => ({ ...current, planning }))}
                />
                <Filter
                  id="filtro-renegociacion"
                  label="Renegociación"
                  value={filters.renegotiation}
                  options={[
                    { value: ANY, label: 'Todas' },
                    { value: PENDING_AGREEMENT, label: 'Pendiente de acuerdo' },
                    { value: AGREED, label: 'Acordado' },
                  ]}
                  onChange={(renegotiation) =>
                    setFilters((current) => ({ ...current, renegotiation }))
                  }
                />
              </div>

              {rows.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Nadie de la vista tiene trabajo activo"
                  detail={
                    unreadable === shown.length
                      ? `No se pudo leer el trabajo de ninguna de las ${shown.length} personas, así que la tabla está vacía por un fallo de lectura y no porque no haya carga.`
                      : `Se preguntó por las ${shown.length} personas de la vista y ninguna tiene un ticket sin resolver. Una lista vacía es un estado legítimo: significa que hoy no hay carga activa, no que falte un dato.`
                  }
                />
              ) : visible.length === 0 ? (
                <EmptyState
                  icon={FilterX}
                  title="Ningún ticket coincide con los filtros"
                  detail={`Se recibieron ${rows.length} tickets activos y los filtros dejan fuera a todos. Los filtros no vuelven a consultar nada: se aplican sobre lo que ya está en pantalla.`}
                />
              ) : (
                <IncidentTable
                  rows={visible}
                  declarationHref={declarationHref}
                  timelineHref={timelineHref}
                  renegotiationHref={renegotiationHref}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** Si los filtros están todos sin aplicar. Se usa solo para no repetir la cuenta en el resumen. */
function filtersExcludeNothing(filters: IncidentFilters): boolean {
  return Object.values(filters).every((value) => value === ANY)
}
