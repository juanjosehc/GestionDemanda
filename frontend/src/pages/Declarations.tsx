import { AlertTriangle, ArrowLeft, ClipboardList, Inbox, ListChecks, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { FormEvent } from 'react'

import { DeclarationForm } from '@/components/declarations/DeclarationForm'
import { DeclarationTable } from '@/components/declarations/DeclarationTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeclarations } from '@/hooks/useDeclarations'
import { useTeam } from '@/hooks/useTeam'
import { isDeclarable } from '@/lib/declarations'
import { isActive } from '@/lib/incidents'
import { statusCounts } from '@/lib/planningPreview'
import { Figure } from '@/components/ui/figure'
import { ROUTES, declarationContextOf, navItemFor } from '@/routes/navigation'
import type { TeamPerson } from '@/types/team'

/** Esqueleto de la carga: la misma forma que el contenido, para que no haya salto de altura. */
function DeclarationsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/**
 * El rótulo de una persona en el desplegable: su nombre, y una marca si es una excepción.
 *
 * **El login no se enseña**, y es deliberado: es el identificador técnico que esta fase viene a
 * retirar de la pantalla, y quien declara reconoce a la persona por su nombre. Cuando GLPI no publica
 * ninguno utilizable el login es lo único que queda, y entonces se usa como nombre —el mismo trato que
 * `personName` en la tabla del equipo—.
 *
 * La marca de excepción sigue la convención de la Fase 30: se señala lo que no es GLPI y nada más.
 * Saber cuál de las filas la declaró alguien a mano es lo que explica por qué una persona que no está
 * en el grupo aparece en la lista.
 */
function personLabel(person: TeamPerson): string {
  const name = person.name ?? person.developerId

  return person.sourceType === 'EXCEPTION' ? `${name} · excepción` : name
}

/**
 * El selector de técnico.
 *
 * **Es un desplegable desde que hay padrón que ofrecer.** Hasta la Fase 30 esta pantalla pedía el
 * identificador a mano —«Identificador en GLPI, p. ej. 296»— porque el backend no publicaba ninguna
 * lista de personas: ese hueco quedó abierto como riesgo 107, con la mitigación escrita «se convierte
 * en desplegable el día que ese catálogo exista», y la Fase 30 dejó anotado que ya tenía de dónde
 * salir. `GET /api/team` publica el padrón con nombre, login y pertenencia, así que teclear un
 * identificador técnico ya no hace falta para nada.
 *
 * Las dos listas van agrupadas y en el orden del padrón: primero el equipo operativo —con quien se
 * trabaja a diario— y después el resto. **Nadie queda fuera del desplegable**: una persona nueva en
 * GLPI entra al padrón el día que GLPI la publique y a la vista por defecto el día que alguien la
 * declare, así que esconderla aquí la dejaría sin pantalla por la que declarar.
 *
 * La consulta sale del botón y no del `change`: cambiar de técnico cierra el formulario abierto y pide
 * su listado, y eso es una acción de quien opera, no un efecto de pasar por encima de las opciones.
 */
function DeveloperPicker({
  people,
  value,
  onChange,
  onSubmit,
}: {
  people: readonly TeamPerson[]
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  const operational = people.filter((person) => person.operational)
  const rest = people.filter((person) => !person.operational)

  // Un técnico que no está en el padrón de hoy —un enlace viejo, o alguien a quien GLPI dejó de
  // publicar— se ofrece igual. Quitarlo dejaría el desplegable en blanco sobre un técnico que sí se
  // pidió, y la pantalla diría «elige un técnico» teniéndolo ya elegido.
  const unknown = value !== '' && !people.some((person) => person.developerId === value)

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor="tecnico" className="text-xs text-muted-foreground">
        Técnico
      </label>
      <select
        id="tecnico"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-72 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <option value="">Elige un técnico…</option>

        {unknown && <option value={value}>{value} · no está en el padrón de hoy</option>}

        {operational.length > 0 && (
          <optgroup label="Equipo operativo">
            {operational.map((person) => (
              <option key={person.developerId} value={person.developerId}>
                {personLabel(person)}
              </option>
            ))}
          </optgroup>
        )}

        {rest.length > 0 && (
          <optgroup label="Resto del padrón">
            {rest.map((person) => (
              <option key={person.developerId} value={person.developerId}>
                {personLabel(person)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <Button type="submit" variant="outline" size="sm">
        <Search className="size-3.5" aria-hidden="true" />
        Consultar
      </Button>
    </form>
  )
}

/**
 * La pantalla de declaración de planificación: el primer tramo del flujo, del ticket a lo declarado.
 *
 * Cierra el recorrido que faltaba —GLPI asigna el ticket, alguien declara cuánto dura y cuándo se
 * promete, y eso acaba en `planning_metadata`— con las cuatro rutas que ya existían. Consume
 * exclusivamente `GET /api/planning-metadata/declarations/{developerId}` para listar y escribe con
 * `POST` y `PUT`: **no se usa `POST /api/planning/from-glpi`**, que es el endpoint que planifica, y
 * pedirle el listado dejaría un plan guardado cada vez que alguien abriera la pantalla.
 *
 * **La pantalla no clasifica.** El estado de declaración y los descartes llegan decididos por el mismo
 * validador que decide qué entra al plan, y aquí se pintan tal cual. Lo único que la vista deduce es
 * si el ticket ya tiene fila —para elegir entre crear y reemplazar—, que es una decisión de protocolo
 * y no de negocio.
 *
 * **No se teclea ningún identificador técnico.** El técnico sale del padrón de `GET /api/team` y el
 * ticket de la lista de esa persona: para usar esta pantalla hay que conocer a la persona y el trabajo
 * que tiene, no su login ni su identificador de GLPI. Los dos siguen viajando en la dirección, porque
 * son la clave con la que el backend responde, pero nadie tiene que escribirlos.
 *
 * Leer no escribe: abrir la pantalla, cambiar de técnico y ordenar no guardan nada.
 *
 * **Se puede llegar desde Incidentes, Recursos y el estado del plan, y entonces no hay nada que
 * elegir.** La dirección trae el técnico, el ticket que se quiere declarar y a dónde volver, y la
 * pantalla los usa para **sembrarse una sola vez**: el listado se pide solo, el formulario del ticket
 * aparece abierto y el enlace de vuelta lleva de regreso a la vista de la que se salió, **con su
 * nombre** —el rótulo sale del menú, que es quien sabe cómo se llama cada pantalla—. Cerrar el
 * formulario no lo reabre aunque el parámetro siga en la dirección —ya nadie lo lee—, igual que el
 * valor inicial de un campo no vuelve cuando alguien lo borra.
 *
 * Nada de esto cambia **cómo** se declara: los mismos verbos, la misma validación y el mismo
 * formulario.
 */
export function Declarations() {
  // El contexto se lee una vez, al montar. A partir de ahí manda el estado local, que es lo que
  // permite cerrar el formulario, cambiar de técnico y consultar sin reescribir la dirección.
  const [searchParams] = useSearchParams()
  const [seed] = useState(() => declarationContextOf(searchParams))

  const [draft, setDraft] = useState(seed.developerId)
  const [developerId, setDeveloperId] = useState(seed.developerId)
  const [selected, setSelected] = useState<string | null>(seed.workItemId ?? null)

  // El padrón es la única lectura que enumera personas, y es la que convierte el campo de texto en un
  // desplegable. Comparte clave de caché con Recursos, Incidentes y el estado del plan: llegar aquí
  // desde cualquiera de las tres no repite la petición.
  const team = useTeam()
  const people = team.data?.people ?? []

  const { data, isPending, isError, error, refetch } = useDeclarations(developerId)
  const loading = developerId !== '' && isPending && !data

  // El ticket abierto se busca en la respuesta y no se guarda copiado: así, cuando la lista se
  // refresca tras guardar, el formulario ve la fila nueva y no una foto vieja de sí misma.
  const selectedItem = data?.items.find((item) => item.workItemId === selected) ?? null

  // Un ticket pedido que ya no está. Se calla si la lista viene vacía: ahí la pantalla ya dice que
  // este técnico no tiene nada, y añadir esto serían dos diagnósticos del mismo hecho.
  const missingTicket =
    selected !== null && data !== undefined && data.items.length > 0 && selectedItem === null

  // El trabajo vivo de este técnico, contado una vez para el resumen y para el atajo. `statusCounts`
  // ya descarta lo resuelto —es la guarda de pantalla de Incidentes—, así que lo de abajo cuenta
  // exactamente lo mismo que la tabla.
  const activeItems = (data?.items ?? []).filter(isActive)
  const counts = statusCounts(activeItems)
  const declarables = activeItems.filter(isDeclarable)
  const pending = activeItems.length - counts.PLANIFICABLE

  /** Consultar cierra el formulario abierto: los tickets que van a llegar son otros. */
  function consult() {
    setSelected(null)
    setDeveloperId(draft.trim())
  }

  /**
   * El atajo: abre el siguiente ticket al que le falta algo.
   *
   * **Salta el que ya está abierto**, que es lo que hace que el botón sirva dos veces seguidas: quien
   * acaba de declarar uno quiere el siguiente, no el mismo otra vez. El orden es el que devolvió GLPI
   * —el mismo de la tabla—, así que el recorrido es el de la lista y no uno inventado aquí.
   *
   * Solo ofrece lo que se arregla declarando: `isDeclarable` deja fuera lo planificable, que no
   * necesita nada, y lo intraducible, que no se arregla con una estimación.
   */
  function declareNext() {
    const next = declarables.find((item) => item.workItemId !== selected) ?? declarables[0]

    setSelected(next?.workItemId ?? null)
  }

  // A dónde se vuelve, y cómo se llama ese sitio. El rótulo sale del menú y no de un literal: el
  // enlace decía «Volver a Incidentes» incluso a quien había entrado desde Recursos, que es nombrar
  // mal el destino. Sin `volver` el respaldo sigue siendo Incidentes, que es donde empieza el flujo.
  const back = seed.from ?? ROUTES.incidents
  const backLabel = `Volver a ${navItemFor(back).label}`

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Los tickets que GLPI tiene asignados a un técnico, con lo que le falta a cada uno para poder
        planificarse. El técnico se elige de la lista del equipo y el ticket de la suya: no hay ningún
        identificador que teclear. El estado y los motivos los decide el backend —el mismo que decide
        qué entra al plan—: esta pantalla no reclasifica nada. Lo que sí se escribe aquí es la
        estimación y la fecha compromiso, que son las dos cosas que GLPI no guarda.
      </p>

      {/* La vuelta se ofrece siempre, venga o no de otra pantalla: el flujo empieza en la lista de
          trabajo —es la que dice qué falta— y sin este enlace el camino de vuelta es el menú.
          `replace` para que el botón «atrás» salga del flujo en vez de devolver al formulario que se
          acaba de cerrar. */}
      <Button asChild variant="outline" size="sm">
        <Link to={back} replace>
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {backLabel}
        </Link>
      </Button>

      {team.isError ? (
        // Sin padrón no hay a quién elegir, y un desplegable vacío no explica por qué. Un fallo aquí
        // significa que no se pudo hablar con el backend, así que la pantalla entera está caída.
        <EmptyState
          tone="danger"
          icon={AlertTriangle}
          title="No fue posible cargar el equipo"
          detail={team.error instanceof Error ? team.error.message : 'Error desconocido'}
          action={
            <Button variant="outline" size="sm" onClick={() => void team.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : (
        <>
          <DeveloperPicker
            people={people}
            value={draft}
            onChange={setDraft}
            onSubmit={consult}
          />

          {loading ? (
            <DeclarationsSkeleton />
          ) : isError ? (
            <EmptyState
              tone="danger"
              icon={AlertTriangle}
              title="No fue posible leer los tickets del técnico"
              detail={error instanceof Error ? error.message : 'Error desconocido'}
              action={
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  Reintentar
                </Button>
              }
            />
          ) : developerId === '' ? (
            <EmptyState
              icon={ClipboardList}
              title="Elige un técnico"
              detail={`El desplegable trae las ${people.length} personas del padrón —el equipo operativo primero, y después el resto—. Elige una y consulta sus tickets.`}
            />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Este técnico no tiene tickets asignados"
              detail={`GLPI no le tiene asignado ningún ticket${data ? ` a ${data.developer.name ?? data.developer.id}` : ''}. Una lista vacía es una respuesta completa: no es un error ni un hueco que rellenar.`}
            />
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {data.items.length} {data.items.length === 1 ? 'ticket asignado' : 'tickets asignados'}{' '}
                a <span className="font-medium">{data.developer.name ?? data.developer.id}</span>, en
                el orden en que los devolvió GLPI.
              </p>

              {/*
                El resumen operativo de la persona: lo que hay que saber antes de tocar nada.

                **Las cinco cifras no son de la misma clase, y por eso van separadas.** «Activos» es el
                total; «declarados» y «pendientes» lo parten en dos; y «sin estimación» y «sin
                compromiso» son dos de las causas de estar pendiente, no el desglose entero —falta el
                trabajo sin ninguna declaración y el tipo que el contrato no sabe leer—. Es el mismo
                aviso que el desglose de Incidentes lleva desde la Fase 35: se solapan, y quien lo
                pinte tiene que decirlo.
              */}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-5">
                <Figure
                  label="Tickets activos"
                  value={activeItems.length}
                  slot="declaration-active"
                  hint="Sin resolver."
                />
                <Figure
                  label="Declarados"
                  value={counts.PLANIFICABLE}
                  slot="declaration-declared"
                  hint="Con estimación y compromiso."
                />
                <Figure
                  label="Pendientes"
                  value={pending}
                  slot="declaration-pending"
                  hint="Todo lo demás."
                />
                <Figure
                  label="Sin estimación"
                  value={counts.SIN_ESTIMACION}
                  slot="declaration-without-estimation"
                />
                <Figure
                  label="Sin compromiso"
                  value={counts.SIN_COMPROMISO}
                  slot="declaration-without-commitment"
                />
              </dl>

              <p className="text-xs text-muted-foreground">
                «Pendientes» es todo lo que no está declarado; «sin estimación» y «sin compromiso» son
                dos de sus causas y no lo agotan —lo que resta es trabajo sin ninguna declaración, o un
                tipo que el contrato no sabe leer y que no se arregla declarando—.
              </p>

              {/* El atajo, que es lo que evita volver a buscar la fila a ojo entre decenas. Solo
                  aparece si hay algo que declarar: un botón que no lleva a ninguna parte es una
                  promesa vacía. */}
              {declarables.length > 0 && (
                <Button size="sm" onClick={declareNext} data-slot="declare-next">
                  <ListChecks className="size-3.5" aria-hidden="true" />
                  Declarar siguiente pendiente
                </Button>
              )}

              {selectedItem && (
                <DeclarationForm item={selectedItem} onClose={() => setSelected(null)} />
              )}

              {/* Un ticket pedido que ya no está se declara, en vez de dejar la pantalla como si nadie
                  hubiera pedido nada: quien llegó por el atajo espera ver su ticket, y no verlo sin
                  explicación se lee como que el atajo falló. `consult()` lo limpia solo, porque pone
                  `selected` a nulo. */}
              {missingTicket && (
                <p className="text-xs text-muted-foreground" data-slot="missing-ticket">
                  El ticket <span className="font-mono">{selected}</span> no está entre los que GLPI
                  tiene hoy asignados a este técnico: se cerró, o dejó de estar asignado. No hay nada
                  que declararle; los de la tabla son los que sí tiene.
                </p>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Tickets asignados
                  </CardTitle>
                  <CardDescription>
                    Una fila por ticket. La columna de estado de declaración es la clasificación del
                    backend —con el código de la regla aplicada y su motivo—, no una cuenta que haga la
                    tabla. La prioridad es la cruda de GLPI, en su escala 1..5: normalizarla es del
                    motor y todavía no ha ocurrido.
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <DeclarationTable items={data.items} selected={selected} onSelect={setSelected} />
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
