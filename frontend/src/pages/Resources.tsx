import { Activity, AlertTriangle, BellRing, CheckCircle2, Gauge, Timer, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { StatCard } from '@/components/dashboard/StatCard'
import { TeamTable } from '@/components/team/TeamTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useAlerts } from '@/hooks/useAlerts'
import { useTeamDeclarations } from '@/hooks/useDeclarations'
import { usePlanningMetrics } from '@/hooks/usePlanningMetrics'
import { useRenegotiations } from '@/hooks/useRenegotiations'
import { useTeam } from '@/hooks/useTeam'
import { SEVERITY_VARIANTS } from '@/lib/alerts'
import { formatInstant } from '@/lib/format'
import { declarationKeysFor, inOperationalTeam, knownTickets, toTeamMembers } from '@/lib/team'
import { formatHours } from '@/lib/timeline'
import { ROUTES } from '@/routes/navigation'

/**
 * Los dos modos de la tabla del equipo.
 *
 * Son dos modos de **mirar**, no dos equipos: el padrón es el mismo y se lee entero en los dos. Lo que
 * cambia es a quién se enseña.
 *
 * `operativo` es el de partida porque es el trabajo de todos los días: la gestión de la demanda se hace
 * con un subconjunto de Desarrollo N2, y el resto ocupaba la tabla sin aportar a lo que se mira a diario.
 * `todos` devuelve el padrón completo —las personas de GLPI y las declaradas—, que es de donde se saca a
 * quién incluir.
 */
type TeamViewMode = 'operativo' | 'todos'

/** Esqueleto de la carga: la misma forma que el contenido, para que no haya salto de altura. */
function TeamSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-96" />

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>

      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/**
 * El equipo sin nadie a quien consolidar.
 *
 * Cubre los dos motivos por los que la tabla no tiene filas, y ahora son los dos de verdad: el padron
 * no trae personas y no hay ningun plan vigente. Antes el segundo bastaba —la vista consolidaba planes
 * y una persona sin plan no aparecia—, y esa frase ya no se puede escribir: alguien sin plan vigente
 * **si** aparece, con su columna de capacidad en «sin plan».
 */
function EmptyTeam({ withDetail }: { withDetail: boolean }) {
  return (
    <EmptyState
      icon={Users}
      title="No hay nadie en el equipo"
      detail={
        withDetail
          ? 'El padron no trae personas y tampoco hay ningun plan vigente. Alguien aparece en esta tabla si GLPI lo publica en el grupo del equipo, si esta declarado como excepcion o si tiene un plan guardado; con las tres cosas vacias no hay filas que enseñar.'
          : 'El padron no trae personas y todavia no hay ningun plan vigente.'
      }
    />
  )
}

/**
 * El padrón trae gente y ninguna es del equipo operativo.
 *
 * Es un estado distinto de «no hay equipo» y no se puede decir con la misma frase: aquí **sí** hay
 * personas —GLPI las publica y están en el padrón—, lo que falta es la marca de pertenencia. Decirlo mal
 * mandaría a buscar el problema en GLPI, que es justo donde no está.
 *
 * El conmutador sigue arriba, en la cabecera de la tarjeta, y por eso este estado no es un callejón: con
 * «Mostrar todos» se ve a todo el mundo desde aquí mismo.
 */
function EmptyOperationalTeam({ total }: { total: number }) {
  return (
    <EmptyState
      icon={Users}
      title="Nadie está en el equipo operativo"
      detail={`El padrón trae ${total} ${total === 1 ? 'persona' : 'personas'}, pero ninguna está declarada como equipo operativo. Suele ser una configuración sin estrenar —team.operational en el backend— y no un problema de GLPI: usa «Mostrar todos» para verlas, o declara a quién pertenece el equipo.`}
    />
  )
}

/**
 * El equipo de hoy: quién es cada persona, qué carga tiene y qué le está pasando.
 *
 * **Responde «¿cómo está el equipo hoy?» sin abrir ninguna otra pantalla.** Cada fila es una persona
 * del equipo —su nombre, sus tickets, sus desplazamientos, sus renegociaciones pendientes, su
 * capacidad y las alertas que produce— y las acciones llevan al detalle de cada cosa. No hay que pasar
 * por el tablero, ni por la declaración, ni por la planificación, ni por la renegociación para saber a
 * quién hay que mirar.
 *
 * **Quién está en la tabla ya no lo decide el plan.** Lo decide el padrón del equipo
 * (`/api/team`), que es la única lectura del sistema que enumera personas. Antes esta vista
 * consolidaba planes —era lo único enumerable— y por eso quien no tenía uno no existía para ella. Hoy
 * alguien sin plan vigente aparece igual, con su columna de capacidad en «sin plan».
 *
 * **No es un plan de equipo.** No fusiona planes, no suma tramos y no recalcula capacidad: cada fila
 * lleva el plan que ya existe y las cifras son las que el backend publicó para él. Lo único que la
 * vista aporta es la comparación —ordenar por una columna— y la navegación hacia el detalle.
 *
 * La consolidación sigue siendo una **proyección de respuestas existentes**: el padrón decide quién
 * está y de dónde viene cada persona, la fotografía operativa aporta la capacidad, la declaración
 * aporta los tickets y la lista de renegociaciones aporta las pendientes. Se cruzan por el
 * identificador, y ninguna cifra se recalcula aquí. La fotografía se deja sin tocar a propósito
 * —añadirle nombres la ataría a GLPI, y hoy esa ruta no lo consulta, que es por lo que el tablero sigue
 * en pie cuando GLPI no responde—.
 *
 * **Cada lectura que se cae se declara donde se ve su efecto**, sin llevarse la pantalla: el padrón,
 * las renegociaciones y las alertas fallan por separado, y un GLPI que no responde deja el equipo con
 * las excepciones y lo dice. Nada se rellena con ceros para tapar un hueco.
 */
export function Resources() {
  const { data, isPending, isError, error, refetch } = usePlanningMetrics()
  const team = useTeam()
  const alerts = useAlerts()
  const renegotiations = useRenegotiations()

  // El filtro vive en la vista y no viaja al backend: se abre con el equipo operativo y «Mostrar todos»
  // es una decision de quien mira, no un dato que haya que recordar entre sesiones. Se pierde al
  // recargar, y esta bien que se pierda —volver a abrir en el equipo de trabajo es lo esperado—.
  const [mode, setMode] = useState<TeamViewMode>('operativo')

  // El padron decide quien esta en la tabla. Si su lectura se cae, la lista queda vacia y las filas
  // salen de los planes que ya existen —abajo—, que es la degradacion correcta: un plan guardado no
  // desaparece de la pantalla porque el padron no haya respondido.
  const people = team.data?.people ?? []
  const byDeveloper = data?.current.byDeveloper ?? []

  // Los tickets son una columna del equipo, asi que se piden por **todo el padron** y no solo por
  // quien tiene plan vigente: atar la columna a que hubiera plan dejaba a las personas sin plan con
  // «Sin dato» en una lectura que nunca se intento. Se pide por el login, que es como el sistema
  // nombra a la persona, y los planes guardados con otra clave —hoy los hay pedidos por numero— se
  // suman a la lista para que su fila tambien tenga el dato. Son cuarenta y una lecturas a GLPI la
  // primera vez y ninguna despues: cada declaracion se cachea por su identificador.
  const declarationKeys = declarationKeysFor(people, byDeveloper)

  const declarations = useTeamDeclarations(declarationKeys)

  const members = toTeamMembers(
    people,
    byDeveloper,
    knownTickets(
      declarationKeys,
      declarations.map((declaration) => declaration.data),
    ),
    // Nulo mientras la lista no haya llegado, y nulo si su lectura fallo: en los dos casos el
    // pendiente de cada persona esta sin dato. Vacio es otra cosa —no hay ninguna abierta—.
    renegotiations.data ? renegotiations.data.items : null,
  )

  // Lo que se enseña, y lo que se queda fuera por no ser del equipo operativo. Se calcula sobre las
  // filas y no sobre el padron porque una fila `PLAN` —alguien a quien solo se conoce por su plan— no
  // esta en el padron y aun asi tiene que verse: su plan guardado no puede desaparecer por un filtro.
  const outside = members.filter((member) => !inOperationalTeam(member))
  const shown = mode === 'operativo' ? members.filter(inOperationalTeam) : members
  const shownWithPlan = shown.filter((member) => member.plan).length

  // La pantalla espera a las dos respuestas de las que sale la tabla: sin el padron no se sabe quien
  // esta, y sin la fotografia no se sabe como esta.
  const loading = (isPending && !data) || (team.isPending && !team.data)

  if (loading) {
    return <TeamSkeleton />
  }

  if (isError) {
    return (
      <EmptyState
        tone="danger"
        icon={AlertTriangle}
        title="No fue posible cargar la vista del equipo"
        detail={error instanceof Error ? error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  if (!data) {
    return <EmptyTeam withDetail={false} />
  }

  const { current } = data

  return (
    <div className="space-y-6">
      <p data-slot="team-summary" className="text-xs text-muted-foreground">
        Una fila por persona del equipo, con la fotografía generada el{' '}
        <time dateTime={data.generatedAt}>{formatInstant(data.generatedAt)}</time>
        {current.from && current.to && (
          <>
            {' '}
            · ventana del {current.from} al {current.to}
          </>
        )}{' '}
        {/* Con el filtro puesto se dice «N de M»; sin el, el «N de N» sobra y solo se dice cuantas hay. */}
        ·{' '}
        {shown.length === members.length
          ? `${members.length} ${members.length === 1 ? 'persona' : 'personas'}`
          : `${shown.length} de ${members.length} personas`}
        {/*
          Cuantas quedan fuera del equipo operativo, en los dos modos: es el numero que hace visible que
          el equipo de trabajo es un subconjunto, y en «Mostrar todos» es lo unico que distingue una fila
          que pertenece de una que no.
        */}
        {outside.length > 0 && (
          <> · {outside.length} fuera del equipo operativo</>
        )}
        {shownWithPlan < shown.length && (
          <> · {shown.length - shownWithPlan} sin plan vigente</>
        )}
      </p>

      {/*
        El padron caido no se lleva la tabla: sin el, las filas salen de los planes que ya existen y
        cada una queda marcada como «solo plan». Se declara porque el equipo que se ve entonces no es
        el equipo: es la parte que tiene plan.
      */}
      {team.isError && (
        <p className="text-xs text-muted-foreground">
          No fue posible leer el padrón del equipo, así que la tabla muestra solo las personas con un
          plan vigente.{' '}
          {team.error instanceof Error ? team.error.message : 'Error desconocido'}
        </p>
      )}

      {/*
        Un GLPI que no responde deja el padron con las excepciones y el motivo dentro de la respuesta.
        Se enseña entero —que no se pudo, que grupo se intento leer y por que— porque en ese estado la
        tabla no esta incompleta por casualidad: le faltan justo las personas que solo GLPI conoce.
      */}
      {team.data && !team.data.glpi.available && (
        <p
          data-slot="team-glpi-down"
          className="text-xs text-muted-foreground"
        >
          GLPI no respondió al leer el grupo{team.data.glpi.groupName
            ? ` ${team.data.glpi.groupName}`
            : ''}, así que el padrón trae solo las excepciones declaradas —y la tabla, además, solo
          enseña las que sean del equipo operativo y los planes ya guardados.
          {team.data.glpi.detail ? ` ${team.data.glpi.detail}` : ''}
        </p>
      )}

      {team.data && team.data.unusedExceptions.length > 0 && (
        <p
          data-slot="team-unused-exceptions"
          className="text-xs text-muted-foreground"
        >
          Hay {team.data.unusedExceptions.length}{' '}
          {team.data.unusedExceptions.length === 1 ? 'excepción' : 'excepciones'} que GLPI ya entrega y
          que por tanto no se aplican:{' '}
          <span className="font-mono">{team.data.unusedExceptions.join(', ')}</span>.
        </p>
      )}

      {/*
        La pertenencia al equipo operativo se escribe a mano, y un login mal escrito no hace nada: saca
        de la vista por defecto a quien se queria incluir y no lo dice. Este aviso es lo unico que lo
        delata, y por eso se publica aunque el brief no lo pidiera.
      */}
      {team.data && team.data.unusedOperational.length > 0 && (
        <p
          data-slot="team-unused-operational"
          className="text-xs text-muted-foreground"
        >
          Hay {team.data.unusedOperational.length}{' '}
          {team.data.unusedOperational.length === 1
            ? 'marca de equipo operativo que no corresponde a nadie'
            : 'marcas de equipo operativo que no corresponden a nadie'}{' '}
          del padrón y que por tanto no hacen nada:{' '}
          <span className="font-mono">{team.data.unusedOperational.join(', ')}</span>.
        </p>
      )}

      {/*
        Sin equipo no se pinta la tabla ni las tarjetas —serian tres ceros que nadie calculo—, pero
        las alertas del conjunto se siguen enseñando: hay condiciones que se evaluan sobre lo
        declarado y no sobre la capacidad, y esconderlas porque la tabla este vacia borraria el unico
        sitio donde se ven.
      */}
      {members.length === 0 ? (
        <EmptyTeam withDetail />
      ) : (
        <>
          {/*
            Las tarjetas suman los planes vigentes, no las personas: una persona sin plan no aporta
            horas a ninguna de las tres, y por eso el aviso de cuantas estan sin plan va arriba, junto
            al recuento, en vez de repartirse por las tarjetas.
          */}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Capacidad disponible"
              icon={Gauge}
              tone="success"
              value={formatHours(current.capacity.availableHours)}
              hint="horas · suma de los planes vigentes"
            />

            <StatCard
              label="Capacidad ocupada"
              icon={Activity}
              tone="primary"
              value={formatHours(current.capacity.occupiedHours)}
              hint="horas · suma de los planes vigentes"
            />

            <StatCard
              label="Capacidad restante"
              icon={Timer}
              tone="muted"
              value={formatHours(current.capacity.remainingHours)}
              hint="horas · no se recorta a cero"
            />
          </div>

          <Card>
            <CardHeader>
              {/*
                El conmutador vive en la cabecera y no junto a la tabla porque tiene que seguir siendo
                alcanzable cuando el filtro deja la tabla sin filas: en el estado «nadie es del equipo
                operativo» es la unica salida que hay en la pantalla.
              */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Personas
                  </CardTitle>
                  <CardDescription>
                    Todo el equipo, tenga plan o no. Ordena por cualquier columna: la cabecera es un
                    botón y el orden de partida es el que entregó el backend, por identificador. Ordenar
                    mueve filas; no recalcula ninguna cifra. Quien no tiene plan vigente aparece con su
                    columna de capacidad en «sin plan», y quien está en el equipo por una excepción
                    declarada o solo por su plan lo dice en su nombre.
                    <br />
                    El conmutador decide qué se enseña, no qué se pregunta: el padrón se lee entero y
                    cambiar de modo no vuelve a consultar nada. Quien no es del equipo operativo lo dice
                    en su nombre, y sale del equipo operativo quien no esté declarado en la
                    configuración del backend.
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
                    Mostrar todos
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {/*
                El estado vacio se decide con el padron **sin filtrar**: que no quede ninguna fila que
                enseñar es otra cosa —el padron tiene gente y ninguna es operativa— y decirla con la
                frase de «no hay equipo» mandaria a buscar el problema en GLPI.
              */}
              {shown.length === 0 ? (
                <EmptyOperationalTeam total={members.length} />
              ) : (
                <TeamTable members={shown} />
              )}

              {/*
                El fallo de las renegociaciones se declara donde se ve su efecto —la columna que se
                queda sin dato— y no se lleva por delante la vista, igual que las alertas.
              */}
              {renegotiations.isError && (
                <p className="text-xs text-muted-foreground">
                  No fue posible leer las renegociaciones, así que las pendientes de cada persona
                  quedan sin dato.{' '}
                  {renegotiations.error instanceof Error
                    ? renegotiations.error.message
                    : 'Error desconocido'}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Alertas activas
          </CardTitle>
          <CardDescription>
            Las condiciones que hoy se cumplen, tal como las publica el backend. Las dos de capacidad
            y la de desplazamientos se desglosan por persona en la tabla de arriba: sus contadores
            cuentan sobre el equipo entero, no sobre lo que la tabla esté enseñando, así que el
            conmutador no los cambia. Las de declaración se evalúan sobre lo declarado y no sobre un
            plan, así que son del conjunto y no se reparten por persona.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/*
            Las alertas se leen aparte y fallan aparte: si su consulta se cae, la tabla del equipo
            —que es la vista— sigue en pie y el fallo se declara en su sitio, no en toda la pantalla.
          */}
          {alerts.isPending && !alerts.data ? (
            <Skeleton className="h-24 w-full" />
          ) : alerts.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                No fue posible leer las alertas.{' '}
                {alerts.error instanceof Error ? alerts.error.message : 'Error desconocido'}
              </p>
              <Button variant="outline" size="sm" onClick={() => void alerts.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : !alerts.data || alerts.data.alerts.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Ninguna condición exige atención ahora.
            </p>
          ) : (
            <ul className="space-y-2">
              {alerts.data.alerts.map((alert) => (
                <li
                  key={alert.type}
                  data-slot="team-alert"
                  data-type={alert.type}
                  data-severity={alert.severity}
                  className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge variant={SEVERITY_VARIANTS[alert.severity]}>{alert.severity}</Badge>
                    <span className="truncate font-mono text-xs">{alert.type}</span>
                  </span>

                  <span className="shrink-0 text-sm font-semibold tabular-nums">{alert.count}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BellRing className="size-3.5" aria-hidden="true" />
          Solo lectura: la vista proyecta el plan vigente de cada persona. No crea un plan de equipo,
          no fusiona planes y no recalcula capacidad.
        </p>

        <Button variant="outline" size="sm" asChild>
          <Link to={ROUTES.alerts}>Ver el centro de alertas</Link>
        </Button>
      </div>
    </div>
  )
}
