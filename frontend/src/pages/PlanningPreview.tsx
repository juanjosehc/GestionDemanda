import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Layers, ListChecks, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useTeamDeclarations } from '@/hooks/useDeclarations'
import { useTeam } from '@/hooks/useTeam'
import { formatInstant } from '@/lib/format'
import { modeFromParams, NO_FILTERS, PENDING } from '@/lib/incidents'
import type { TeamViewMode } from '@/lib/incidents'
import { entrySummary, personEntries, verdictOf } from '@/lib/planningPreview'
import type { EntrySummary, PersonEntry } from '@/lib/planningPreview'
import { declarationKeysFor } from '@/lib/team'
import { Figure } from '@/components/ui/figure'
import { declarationPath, incidentsPath, planningPreviewPath } from '@/routes/navigation'
import type { DeclarationStatus } from '@/types/declarations'

/** Esqueleto de la carga: la misma forma que el contenido, para que no haya salto de altura. */
function PreviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/**
 * Un número con su sustantivo, en singular o en plural.
 *
 * La frase del veredicto lleva cifras dentro, y **una cifra suelta delante de un sustantivo en plural
 * se lee mal en el caso normal de esta pantalla**, que es tener un solo elemento: «1 elementos
 * planificables» es exactamente lo que el equipo vería hoy. Se concuerda aquí y no se esquiva el
 * número, porque el número es el dato.
 */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * La respuesta a «¿qué pasará si genero el plan ahora?», en una frase.
 *
 * **Se compone de hechos publicados y nada más.** El número de planificables es el de la tabla de
 * abajo, y la frase que lo acompaña dice que el motor decidirá cuántos caben: la pantalla explica la
 * **entrada**, no las reglas, y nombrar su propio límite es lo que impide que la frase se lea como una
 * promesa de resultado.
 *
 * Las cuatro ramas salen de `verdictOf`, que las elige en orden —sin lecturas no se puede afirmar
 * nada—. La de `nada-planificable` **nombra las cuatro causas**, y sus cuatro cifras suman el total
 * porque los cinco cajones son un reparto y no un desglose.
 */
function verdictSentence(summary: EntrySummary): string {
  switch (verdictOf(summary)) {
    case 'planificable':
      return `Hay ${plural(summary.counts.PLANIFICABLE, 'elemento planificable listo', 'elementos planificables listos')} para el motor, en ${plural(summary.withReadyWork, 'persona', 'personas')}. Con eso producirá un plan. Cuántos quepan en el horizonte y cuáles desplacen a cuáles lo decide el motor con las reglas vigentes —umbral, horizonte y calendario—, que esta pantalla no publica.`

    case 'nada-planificable':
      return `Hoy el motor no recibiría ningún elemento planificable: el plan saldría vacío. Nada de lo que hay es planificable: de ${plural(summary.active, 'ticket activo', 'tickets activos')}, ${summary.counts.SIN_ESTIMACION} sin estimación, ${summary.counts.SIN_COMPROMISO} sin compromiso, ${summary.counts.SIN_DECLARACION} sin declaración y ${summary.counts.NO_TRADUCIBLE} sin poder traducirse.`

    case 'sin-trabajo':
      return `No hay nada que planificar hoy: se preguntó por ${plural(summary.read, 'persona', 'personas')} y ninguna tiene un ticket sin resolver.`

    case 'sin-lectura':
      return 'No se pudo leer el trabajo de nadie, así que no se puede decir qué recibiría el motor. La tabla está vacía por un fallo de lectura, no porque no haya carga.'
  }
}

/**
 * Una celda del reparto: el número, con el estado al que pertenece.
 *
 * El estado viaja en un atributo y no solo en el número por el mismo motivo que en la tabla de
 * Incidentes: quien lee la fila tiene que poder decir **qué cajón** es cada cifra sin contar columnas
 * a ojo, y una columna nueva no puede mover el significado de las que ya estaban.
 */
function BucketCell({ status, value }: { status: DeclarationStatus; value: number }) {
  return (
    <td className="py-3 pr-4 text-right" data-slot="entry-bucket" data-declaration={status}>
      {value}
    </td>
  )
}

/**
 * El estado de entrada del plan: qué recibiría el motor si se generara ahora.
 *
 * **No planifica y no escribe.** No hay aquí ninguna regla, horizonte ni prioridad, y no se llama a
 * ninguna ruta de generación: la única acción que sale a la red es «Volver a leer», que relee lo mismo.
 * La pantalla contesta la pregunta que la de Planificación no puede contestar antes de pulsar su botón
 * —el riesgo 121 lo dejó anotado: un plan inesperado no se explicaba desde ninguna parte—.
 *
 * **No simula el plan.** Existe `POST /api/planning/simulate`, pero recibe un escenario entero
 * —tickets, requerimientos y reglas— y está declarado temporal; construirle un cuerpo obligaría a
 * inventarse las reglas vigentes, que es justo lo que no se puede hacer. Lo que sí se sabe, y por
 * construcción, es lo que el motor va a **mirar**: `build()` recorre el mismo `verdicts()` que sirve
 * esta lectura, así que la cuenta de planificables **es** la entrada efectiva del motor.
 *
 * **No duplica el tablero ni la lista de trabajo.** No lee `/api/planning/metrics` —cuenta filas de
 * `planning_metadata` y no tickets conocidos, así que es otro denominador— ni pinta una segunda tabla
 * de tickets: quien bloquea se ve aquí, qué bloquea se ve en Incidentes, y cada fila lleva su enlace.
 *
 * **No fecha por lectura.** El contrato de declaraciones no publica sello; el único instante que llega
 * es el del padrón, y es el que se enseña —diciendo que es ese y no otro—.
 */
export function PlanningPreview() {
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch, isFetching } = useTeam()

  // El conmutador se siembra desde la direccion, como el de Incidentes y por el mismo motivo: quien
  // entra con «Mostrar todo» puesto —o vuelve de declarar— tiene que encontrar la misma vista, o la
  // fila de quien esta fuera del equipo operativo desaparece sin que nadie haya cambiado nada.
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<TeamViewMode>(() => modeFromParams(searchParams))

  const people = data?.people ?? []

  // El filtro de equipo operativo se hace sobre el padrón, como en Incidentes: aquí tampoco hay filas
  // inventadas —hay personas—, así que el predicado de la tabla del equipo no aplica.
  const shown = mode === 'operativo' ? people.filter((person) => person.operational) : people

  // Una consulta por persona visible, en el orden de esta lista: `useQueries` empareja por posición.
  // Es la misma lectura, con la misma clave, que hacen Incidentes y Recursos: visitar las tres
  // pantallas no repite ni una petición a GLPI.
  const keys = declarationKeysFor(shown, [])
  const declarations = useTeamDeclarations(keys)

  const entries = personEntries(
    shown,
    declarations.map((declaration) => declaration.data),
  )
  const summary = entrySummary(entries)

  // Las filas de la tabla son las personas **leídas**: una respuesta que no llegó no deja ceros —eso
  // afirmaría que no tiene carga—, deja a esa persona fuera, y el banner de abajo dice cuántas faltan.
  const readable = entries.filter((entry) => !entry.unreadable)

  // Se espera al padrón y a las respuestas que producen las filas. Un fallo no cuenta como espera: su
  // consulta pasa a error y la tabla se enseña con lo que sí llegó. La espera tampoco vuelve cuando ya
  // hay filas: ampliar la vista no puede tapar lo que ya está leído.
  const loading =
    isPending || (summary.read === 0 && declarations.some((declaration) => declaration.isPending))

  if (loading) {
    return <PreviewSkeleton />
  }

  if (isError) {
    return (
      <EmptyState
        tone="danger"
        icon={AlertTriangle}
        title="No fue posible cargar el estado de entrada"
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
        detail="No hay a quién preguntarle por su trabajo, así que no se puede decir qué recibiría el motor. El padrón lo publica el grupo de Desarrollo N2 en GLPI más las excepciones declaradas en la configuración del backend."
      />
    )
  }

  /**
   * La relectura, que es el único instrumento contra una cifra que se mueve.
   *
   * Se invalidan las declaraciones —todas, por prefijo— y se relee el padrón. No se toca nada más: la
   * fotografía operativa, las alertas y el timeline miden otras cosas.
   */
  function reread() {
    void queryClient.invalidateQueries({ queryKey: ['planning', 'declarations'] })
    void refetch()
  }

  /**
   * La dirección de Incidentes con el filtro ya puesto: `persona` para los tickets de alguien, y
   * `declaracion=pendiente` para los que le bloquean. El modo viaja con ella, o la fila de quien está
   * fuera del equipo operativo no aparecería al otro lado.
   */
  const personHref = (entry: PersonEntry) =>
    incidentsPath({ ...NO_FILTERS, person: entry.developerId }, mode)

  const blockersHref = (entry: PersonEntry) =>
    incidentsPath({ ...NO_FILTERS, person: entry.developerId, declaration: PENDING }, mode)

  /**
   * La direccion de la declaracion con la persona ya puesta, y la vuelta a esta misma vista.
   *
   * Es la entrada que le faltaba al alcance: Incidentes y Recursos ya llevaban a declarar, y esta
   * pantalla decia quien bloquea sin ofrecer donde se arregla. El modo viaja en la vuelta, o al volver
   * la fila de quien esta fuera no apareceria.
   */
  const declarationHref = (entry: PersonEntry) =>
    declarationPath({ developerId: entry.developerId, from: planningPreviewPath(mode) })

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Lo que el motor recibiría si se generara el plan ahora, contado sobre el trabajo activo de cada
        persona. Esta pantalla no planifica y no escribe: lee el padrón y la declaración de cada
        persona —las mismas lecturas que Incidentes y Recursos, así que no se repite ninguna petición—,
        y no consulta el tablero. Sin fecha de lectura propia: el contrato de declaraciones no publica
        sello, así que la que se enseña es la del padrón.
      </p>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Estado de entrada
              </CardTitle>
              <CardDescription data-slot="plan-verdict">{verdictSentence(summary)}</CardDescription>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {data?.generatedAt ? (
                  <>
                    Padrón del <time dateTime={data.generatedAt}>{formatInstant(data.generatedAt)}</time>
                  </>
                ) : null}
              </span>

              <Button variant="outline" size="sm" onClick={reread} disabled={isFetching}>
                <RefreshCw aria-hidden="true" />
                {isFetching ? 'Leyendo…' : 'Volver a leer'}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/*
            Las cifras **se cuentan, no se calculan**: son longitudes de listas que el backend ya
            clasificó. Y **particionan**: los cinco cajones suman los activos, porque el estado de
            declaración es excluyente. Es lo contrario del desglose de Incidentes, donde las cuentas se
            solapan a propósito y hay que advertirlo.
          */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <Figure
              label="Personas de la vista"
              value={`${summary.read} de ${summary.people}`}
              slot="preview-people"
              hint="Leídas, de las que el padrón trae."
            />
            <Figure label="Tickets activos" value={summary.active} slot="preview-active" />
            <Figure
              label="Planificables"
              value={summary.counts.PLANIFICABLE}
              slot="preview-plannable"
              hint="Con la declaración completa y el tipo traducible."
            />
            <Figure label="No planificables" value={summary.blocked} slot="preview-blocked" />
            <Figure
              label="Sin estimación"
              value={summary.counts.SIN_ESTIMACION}
              slot="preview-without-estimation"
            />
            <Figure
              label="Sin compromiso"
              value={summary.counts.SIN_COMPROMISO}
              slot="preview-without-commitment"
            />
            <Figure
              label="Sin declaración"
              value={summary.counts.SIN_DECLARACION}
              slot="preview-without-declaration"
              hint="Sin fila, o con los dos valores retirados."
            />
            <Figure
              label="No traducible"
              value={summary.counts.NO_TRADUCIBLE}
              slot="preview-untranslatable"
              hint="No se arregla declarando: lo decide GLPI."
            />
            <Figure
              label="Con trabajo listo"
              value={summary.withReadyWork}
              slot="preview-ready-people"
              hint="Personas con al menos un planificable."
            />
            <Figure
              label="Que deben declarar"
              value={summary.needingDeclarations}
              slot="preview-needing-people"
              hint="Personas con algo que se arregla declarando."
            />
          </dl>

          <p className="text-xs text-muted-foreground">
            Los cinco cajones son un reparto: un ticket cae en uno y solo uno, así que suman los
            activos. «Planificables» es lo que el brief llama declaraciones completas —tipo traducible,
            estimación y compromiso—, y es, por construcción, lo que el motor va a mirar.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Estado de entrada, persona a persona
              </CardTitle>
              <CardDescription>
                Una fila por persona de la vista, ordenadas por lo que bloquean. Quién bloquea se ve
                aquí; qué bloquea se ve en Incidentes, y cada fila lleva su enlace con el filtro ya
                puesto. El conmutador sí vuelve a leer, porque aquí las filas son el trabajo de cada
                persona.
              </CardDescription>
            </div>

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
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Que no quede nadie es otra cosa que no tener trabajo —hay gente y ninguna declarada
              operativa—, y decirlo con la frase del vacío mandaría a buscar el problema a GLPI. */}
          {shown.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="Nadie está declarado en el equipo operativo"
              detail={`El padrón trae ${people.length} personas y ninguna forma parte del equipo operativo, así que la vista por defecto no tiene a quién preguntar. «Mostrar todo Desarrollo N2» las enseña todas. La pertenencia la decide la configuración del backend.`}
            />
          ) : readable.length === 0 ? (
            <EmptyState
              tone="danger"
              icon={AlertTriangle}
              title="No se pudo leer el trabajo de nadie"
              detail={`Se preguntó por las ${shown.length} personas de la vista y no respondió ninguna, así que no hay una sola cifra que enseñar. «Volver a leer» lo intenta otra vez; el detalle de cada fallo lo da la pantalla de Incidentes.`}
            />
          ) : summary.active === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="Nadie de la vista tiene trabajo activo"
              detail={`Se preguntó por las ${shown.length} personas de la vista y ninguna tiene un ticket sin resolver. Una lista vacía es un estado legítimo: significa que hoy no hay carga activa, no que falte un dato.`}
            />
          ) : (
            <>
              {/* Un fallo de lectura se declara donde se ve su efecto —faltan filas— y no se lleva por
                  delante la vista, igual que en Incidentes. */}
              {summary.unreadable > 0 && (
                <p className="text-xs text-muted-foreground" data-slot="unreadable-banner">
                  No fue posible leer el trabajo de {summary.unreadable} de las {shown.length} personas,
                  así que sus filas no están en la tabla y sus tickets no cuentan en las cifras de
                  arriba. Lo que se ve sí está completo.
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[64rem] text-sm" data-slot="entry-person-table">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 text-left font-medium">
                        Persona
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Activos
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Planificables
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        No planificables
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Sin estimación
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Sin compromiso
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Sin declaración
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        No traducible
                      </th>
                      <th scope="col" className="py-2 text-left font-medium">
                        Acciones
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {readable.map((entry) => (
                      <tr
                        key={entry.developerId}
                        data-slot="entry-person-row"
                        data-developer={entry.developerId}
                        data-active={entry.active}
                        data-plannable={entry.counts.PLANIFICABLE}
                        className="border-b border-border/60 tabular-nums last:border-0"
                      >
                        {/* El nombre es el enlace a los tickets de esa persona, con el filtro ya
                            puesto: es la respuesta a «¿qué tiene?» sin teclear nada. */}
                        <td className="py-3 pr-4" data-slot="entry-person">
                          <Link
                            to={personHref(entry)}
                            aria-label={`Ver los tickets de ${entry.personName}`}
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            {entry.personName}
                          </Link>
                        </td>

                        <td className="py-3 pr-4 text-right" data-slot="entry-active">
                          {entry.active}
                        </td>

                        <BucketCell status="PLANIFICABLE" value={entry.counts.PLANIFICABLE} />

                        {/* «No planificables» no es un cajón: es la resta de los otros cuatro, y se
                            dice con su propio nombre para que nadie la lea como un quinto estado. */}
                        <td className="py-3 pr-4 text-right" data-slot="entry-blocked">
                          {entry.blocked}
                        </td>

                        <BucketCell status="SIN_ESTIMACION" value={entry.counts.SIN_ESTIMACION} />
                        <BucketCell status="SIN_COMPROMISO" value={entry.counts.SIN_COMPROMISO} />
                        <BucketCell status="SIN_DECLARACION" value={entry.counts.SIN_DECLARACION} />
                        <BucketCell status="NO_TRADUCIBLE" value={entry.counts.NO_TRADUCIBLE} />

                        {/* Los bloqueadores abren la lista de trabajo de esa persona filtrada por lo
                            pendiente. El nombre accesible lleva la cuenta y la persona porque hay
                            tickets compartidos: sin él, dos filas tendrían enlaces indistinguibles. */}
                        <td className="py-3" data-slot="entry-blockers">
                          <div className="flex flex-col items-start gap-1">
                            {entry.blocked > 0 && (
                              <Link
                                to={blockersHref(entry)}
                                aria-label={`Ver los ${entry.blocked} tickets que bloquean a ${entry.personName}`}
                                className="underline underline-offset-2 hover:text-foreground"
                              >
                                Ver
                              </Link>
                            )}

                            {/* Y la entrada a la declaracion con la persona ya puesta. Solo cuando
                                hay algo que declarar: `declarable` excluye lo planificable y lo
                                intraducible, asi que este enlace siempre lleva a trabajo real. */}
                            {entry.declarable > 0 && (
                              <Link
                                to={declarationHref(entry)}
                                aria-label={`Declarar el trabajo pendiente de ${entry.personName}`}
                                className="underline underline-offset-2 hover:text-foreground"
                              >
                                Declarar
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
