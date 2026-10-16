import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { remainingState } from '@/lib/capacity'
import { inOperationalTeam, personName, sortTeam } from '@/lib/team'
import type { SortDirection, TeamMember, TeamSortKey } from '@/lib/team'
import { formatHours } from '@/lib/timeline'
import { formatInstant } from '@/lib/format'
import { ROUTES, calendarPath, declarationPath, metricPath } from '@/routes/navigation'
import { DISPLACED_TOKEN } from '@/types/planningMetrics'

/** Columnas ordenables, en el orden en que se pintan. */
const COLUMNS: readonly { key: TeamSortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Nombre', numeric: false },
  { key: 'developerId', label: 'Identificador', numeric: false },
  { key: 'tickets', label: 'Tickets', numeric: true },
  { key: 'displacedRequirements', label: 'Desplazados', numeric: true },
  { key: 'pendingRenegotiations', label: 'Renegociaciones pendientes', numeric: true },
  { key: 'availableHours', label: 'Disponible', numeric: true },
  { key: 'occupiedHours', label: 'Ocupada', numeric: true },
  { key: 'remainingHours', label: 'Restante', numeric: true },
]

/** La ventana que cubre el plan, o el motivo por el que no hay ninguna. */
function windowOf(member: TeamMember): string {
  if (!member.plan) {
    return 'Sin plan vigente hoy'
  }

  if (!member.plan.from || !member.plan.to) {
    return 'Sin agenda: el plan no tiene tramos'
  }

  return `${member.plan.from} → ${member.plan.to} · calculado el ${formatInstant(member.plan.calculatedAt)}`
}

/**
 * Las alertas que esta fila produce por si sola.
 *
 * Son **dos de las seis del catalogo, y son las dos unicas que tienen dueño**: el backend cuenta las
 * dos condiciones de capacidad filtrando por el restante de cada plan y despues tira la identidad, y
 * los requerimientos desplazados se cuentan sobre los planes vigentes, que son estas mismas filas. Las
 * otras cuatro —sin estimacion, sin compromiso, metadata incompleta— se evaluan sobre lo declarado y
 * no sobre un plan, asi que no hay por que repartirlas.
 *
 * No se nombran los tipos aqui: el nombre lo publica el catalogo del backend, y escribirlo en la vista
 * seria una segunda copia que solo se descubre el dia que los dos discrepen. Lo que se pinta es
 * cuantas condiciones cumple la persona y el enlace al centro donde estan contadas.
 *
 * Una persona sin plan vigente no produce ninguna: las dos condiciones se evaluan sobre un plan, y sin
 * plan no hay nada que evaluar. No es que este todo bien —es que no hay nada que medir—, y por eso su
 * celda queda vacia en vez de con un cero que afirmaria lo mismo que una persona con margen.
 */
function alertsOf(member: TeamMember): number {
  if (!member.plan) {
    return 0
  }

  const remaining = remainingState(member.plan.capacity.remainingHours)

  return (remaining === 'ok' ? 0 : 1) + (member.plan.displacedRequirements > 0 ? 1 : 0)
}

interface TeamTableProps {
  /** El equipo, ya con el nombre y lo que se sabe de cada persona. */
  members: readonly TeamMember[]
}

/**
 * La tabla operativa del equipo: una persona por fila.
 *
 * **Cada fila es una persona, no un plan.** Es lo que cambió: antes la fila *era* un plan vigente y
 * por eso quien no tenía ninguno no aparecía en la tabla. Ahora la lista sale del padrón del equipo y
 * el plan es un dato de la fila que puede faltar —`plan` en nulo—, así que alguien sin nada
 * planificado se ve, con su columna de capacidad en «sin plan» en vez de con tres ceros.
 *
 * Los números que se ven son los que el backend publicó —disponible, ocupada, restante y
 * desplazamientos—, y lo único que la vista decide es el color de los dos casos que el backend ya
 * distingue: restante agotado y restante negativo.
 *
 * **El nombre es la identificación y el identificador es el dato técnico.** El de GLPI se sigue
 * enseñando —es la clave con la que se pide todo lo demás, y sin él no se puede consultar nada por
 * fuera de esta pantalla—, pero en su columna, en monoespaciado y sin peso: quien lee la tabla
 * reconoce a la persona por su nombre, y el identificador está ahí para copiarlo, no para leerlo.
 *
 * **El origen se enseña cuando no es el de siempre.** Una insignia en las cuarenta filas del grupo de
 * GLPI sería ruido; la que importa es la de quien está aquí por una excepción declarada a mano, o por
 * un plan que el padrón no conoce, porque esas dos filas no se pueden explicar mirando GLPI.
 *
 * Lo que la vista no pudo leer se declara y no se rellena: una persona cuyo nombre GLPI no publica
 * sigue apareciendo —está en el equipo— con su identificador y el motivo, y una lectura caída deja su
 * celda en «sin dato» en vez de en un cero, que afirmaría un hecho que nadie comprobó.
 *
 * Ordenar es una acción del usuario. El orden de partida es el que entregó el backend —por
 * identificador, con la vigencia ya resuelta—, y la tabla no re-agrupa ni recalcula: mueve filas.
 *
 * Recibe una lista no vacía: el estado vacío lo decide la página, que es quien sabe si además hay
 * alertas que enseñar.
 */
export function TeamTable({ members }: TeamTableProps) {
  const [sort, setSort] = useState<{ key: TeamSortKey; direction: SortDirection } | null>(null)

  const rows = sort ? sortTeam(members, sort.key, sort.direction) : members

  /** Un clic ordena por esa columna; el siguiente la invierte. Cambiar de columna empieza ascendente. */
  function toggle(key: TeamSortKey) {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[88rem] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {COLUMNS.map((column) => {
              const active = sort?.key === column.key
              const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={!active ? 'none' : sort.direction === 'asc' ? 'ascending' : 'descending'}
                  className={`py-2 pr-4 font-medium ${column.numeric ? 'text-right' : 'text-left'}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(column.key)}
                    className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {column.label}
                    <Icon className="size-3" aria-hidden="true" />
                  </button>
                </th>
              )
            })}

            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Alertas
            </th>

            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Plan vigente
            </th>

            <th scope="col" className="py-2 text-left font-medium">
              Acciones
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((member) => {
            // Sin plan no hay estado de capacidad que enseñar: la columna queda en «sin plan» y no en
            // un verde que diria que a esta persona le sobra capacidad, cuando lo que pasa es que no
            // se le ha calculado ninguna.
            const remaining = member.plan
              ? remainingState(member.plan.capacity.remainingHours)
              : 'sin-plan'
            const displaced = (member.plan?.displacedRequirements ?? 0) > 0
            const alerts = alertsOf(member)
            // Agotado advierte; negativo señala un plan que contradice su propio contexto.
            const remainingTone =
              remaining === 'over' ? 'danger' : remaining === 'full' ? 'warning' : undefined

            return (
              <tr
                key={member.developerId}
                data-slot="team-row"
                data-developer={member.developerId}
                data-name={member.name ?? ''}
                data-source={member.sourceType}
                data-operational={inOperationalTeam(member) ? 'true' : 'false'}
                data-remaining={remaining}
                data-displaced={displaced ? 'true' : 'false'}
                className="border-b border-border/60 align-top last:border-0"
              >
                <td data-slot="team-name" className="py-3 pr-4">
                  <span className="flex items-center gap-1.5 font-medium">
                    {personName(member)}

                    {/*
                      El origen solo se enseña cuando no es el de siempre. Una insignia en cada fila
                      del grupo de GLPI seria ruido; la que importa es la que dice que esta persona
                      esta aqui por una decision escrita a mano y no porque GLPI la publique.
                    */}
                    {member.sourceType !== 'GLPI' && (
                      <Badge variant="outline" data-slot="team-origin">
                        {member.sourceType === 'EXCEPTION' ? 'Excepción' : 'Solo plan'}
                      </Badge>
                    )}

                    {/*
                      Quien no es del equipo operativo solo se puede estar viendo en «Mostrar todos», y
                      decirlo es lo que hace utilizable ese modo: sin la marca, incluir a alguien exige
                      adivinar quien estaba fuera. En el modo operativo no aparece nunca —todas las
                      filas lo son—, asi que no es ruido en el caso normal. Va con el mismo predicado
                      que el filtro, para que la marca y lo que se enseña no puedan discrepar.
                    */}
                    {!inOperationalTeam(member) && (
                      <Badge variant="outline" data-slot="team-outside">
                        Fuera del equipo operativo
                      </Badge>
                    )}

                    {/*
                      Dado de baja en GLPI y todavia en el padron: se dice, porque una fila vigente de
                      alguien retirado se lee como un error de datos y no lo es.
                    */}
                    {!member.active && (
                      <Badge variant="warning" data-slot="team-inactive">
                        Inactivo
                      </Badge>
                    )}
                  </span>

                  {/*
                    Sin nombre no se deja la celda muda: el identificador de arriba es un respaldo, y
                    decir de donde sale evita que alguien lo lea como si fuera la persona. El motivo
                    depende del origen —una excepcion sin nombre es una declaracion incompleta, no un
                    silencio de GLPI— y por eso no se escribe el mismo texto para las dos.
                  */}
                  {!member.name && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {member.sourceType === 'EXCEPTION'
                        ? 'La excepción no declara un nombre'
                        : member.sourceType === 'PLAN'
                          ? 'Solo se conoce por su plan'
                          : 'GLPI no publica un nombre para este identificador'}
                    </p>
                  )}
                </td>

                <td
                  data-slot="team-developer-id"
                  className="py-3 pr-4 font-mono text-xs text-muted-foreground"
                >
                  {member.developerId}
                </td>

                <td data-slot="team-tickets" className="py-3 pr-4 text-right">
                  {member.tickets === null ? (
                    <span className="text-xs text-muted-foreground">Sin dato</span>
                  ) : member.tickets === 0 ? (
                    <span className="text-xs text-muted-foreground">Sin tickets</span>
                  ) : (
                    <span className="tabular-nums">{member.tickets}</span>
                  )}
                </td>

                <td data-slot="team-displaced" className="py-3 pr-4 text-right">
                  {!member.plan ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : displaced ? (
                    <Badge variant="warning">{member.plan.displacedRequirements}</Badge>
                  ) : (
                    <span className="tabular-nums">{member.plan.displacedRequirements}</span>
                  )}
                </td>

                <td data-slot="team-pending" className="py-3 pr-4 text-right">
                  {member.pendingRenegotiations === null ? (
                    <span className="text-xs text-muted-foreground">Sin dato</span>
                  ) : member.pendingRenegotiations > 0 ? (
                    <Badge variant="warning">{member.pendingRenegotiations}</Badge>
                  ) : (
                    <span className="tabular-nums">0</span>
                  )}
                </td>

                <td className="py-3 pr-4 text-right tabular-nums">
                  {member.plan ? formatHours(member.plan.capacity.availableHours) : '—'}
                </td>

                <td className="py-3 pr-4 text-right tabular-nums">
                  {member.plan ? formatHours(member.plan.capacity.occupiedHours) : '—'}
                </td>

                {/*
                  Esta columna **es** el estado de capacidad: el numero con el color de los dos casos
                  que el backend distingue. No se anade la palabra al lado —«agotada», «negativa»— ni
                  una columna aparte con ella: seria el mismo hecho dicho dos veces en la misma fila.
                */}
                <td className="py-3 pr-4 text-right">
                  {!member.plan ? (
                    <span className="text-xs text-muted-foreground">Sin plan</span>
                  ) : remainingTone ? (
                    <Badge variant={remainingTone}>
                      {formatHours(member.plan.capacity.remainingHours)}
                    </Badge>
                  ) : (
                    <span className="tabular-nums">
                      {formatHours(member.plan.capacity.remainingHours)}
                    </span>
                  )}
                </td>

                <td data-slot="team-alerts" data-alerts={alerts} className="py-3 pr-4 text-right">
                  {alerts > 0 ? (
                    <Link
                      to={ROUTES.alerts}
                      aria-label={`Ver la alerta de ${personName(member)}`}
                      className="inline-flex rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Badge variant={remaining === 'over' ? 'danger' : 'warning'}>{alerts}</Badge>
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>

                <td className="py-3 pr-4">
                  {!member.plan ? (
                    <span className="text-xs text-muted-foreground">{windowOf(member)}</span>
                  ) : (
                    <>
                      {/*
                        El plan vigente y su timeline son el mismo recurso: la agenda de un plan ya
                        existe y se abre por su identificador. No hay una segunda pantalla que
                        inventar.
                      */}
                      <Link
                        to={calendarPath(member.plan.planId)}
                        className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        {member.plan.planId}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">{windowOf(member)}</p>
                    </>
                  )}
                </td>

                <td data-slot="team-actions" className="py-3">
                  <div className="flex flex-col items-start gap-1 text-xs">
                    {/*
                      Cada accion aparece solo cuando hay algo que abrir: un enlace a una lista vacia
                      promete un contenido que no existe. El plan no esta aqui porque su enlace es el
                      identificador de la columna de al lado.

                      La de los tickets lleva el identificador de esta fila: la pantalla de
                      declaracion ya sabe abrirse por direccion, asi que dejar al usuario delante de
                      un campo vacio —teniendo aqui el dato— era un callejon sin salida.

                      Y lleva tambien **a donde volver**: sin el, la pantalla de declaracion ofrecia
                      «Volver a Incidentes» a quien habia entrado desde aqui, que es nombrar mal el
                      sitio al que se vuelve.
                    */}
                    {member.tickets !== null && member.tickets > 0 && (
                      <Link
                        to={declarationPath({ developerId: member.developerId, from: ROUTES.resources })}
                        className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Ver los tickets
                      </Link>
                    )}

                    {displaced && (
                      <Link
                        to={metricPath(DISPLACED_TOKEN)}
                        className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Ver el desglose
                      </Link>
                    )}

                    {member.pendingRenegotiations !== null && member.pendingRenegotiations > 0 && (
                      <Link
                        to={ROUTES.renegotiations}
                        className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Ver las renegociaciones
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
