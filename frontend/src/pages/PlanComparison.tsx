import { AlertTriangle, CalendarRange } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { ElementReason } from '@/components/timeline/PlanResult'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Figure } from '@/components/ui/figure'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlanList } from '@/hooks/usePlanList'
import { usePlanOutcome } from '@/hooks/usePlanOutcome'
import { comparisonOf, planComparison, previousPlanOf } from '@/lib/planComparison'
import { VERDICT_VARIANTS } from '@/lib/planResult'
import { formatInstant } from '@/lib/format'
import { STATUS_VARIANTS } from '@/lib/renegotiations'
import { formatDay, formatHours } from '@/lib/timeline'
import { calendarPath } from '@/routes/navigation'
import type { ComparisonToken, PlanComparison as ComparisonData } from '@/lib/planComparison'
import type { PlanElement } from '@/lib/planResult'

/**
 * Lo que cambió entre dos planes guardados del mismo técnico.
 *
 * **Resta, no recalcula.** Los dos planes se leen con `usePlanOutcome` —las mismas cuatro lecturas de
 * siempre, con las mismas claves de caché— y la diferencia la hace `planComparison`, que es aritmética
 * de conjuntos sobre dos resultados ya contados. El motor no corre aquí y no puede correr: no hay una
 * sola regla de capacidad, de desplazamiento o de prioridad reescrita en esta pantalla.
 *
 * **La pareja la elige el sistema.** La dirección trae un solo identificador —el plan actual— y el
 * anterior sale de la lista de planes de **ese** técnico. Por eso los dos son siempre de la misma
 * persona y por eso no existe el caso de comparar un plan consigo mismo.
 *
 * **La pantalla se centra en los cambios y no repite ninguna vista.** No monta la rejilla del
 * calendario ni el resumen del estado del plan: son otras dos pantallas, y montarlas otra vez sería
 * duplicar lo que el brief prohíbe, además de que sus `data-slot` no están namespaciados por plan.
 * Aquí solo se enseña lo que difiere —y, para poder decir «esto sigue igual», lo que no difiere, sin
 * volver a pintarlo entero.
 *
 * **Tres cosas que no se pueden contestar se dicen con palabras y no con un cero**: cuando falta la
 * foto de entrada de uno de los dos planes, cuando la lectura de acuerdos no habla del plan actual y
 * cuando los dos planes no tenían nada.
 */
export function PlanComparison() {
  const { planId } = useParams<{ planId: string }>()

  const current = usePlanOutcome(planId)
  // El técnico sale del propio plan, así que la lista y la comparación no pueden acabar mezclando dos
  // personas aunque alguien escriba la dirección a mano.
  const developerId = current.status === 'listo' ? current.snapshot.developerId : undefined
  const plans = usePlanList(developerId)

  // La posición la fija la lista del backend, que viene del más antiguo al más reciente.
  const previous = previousPlanOf(plans.data?.plans ?? [], planId ?? '')
  const before = usePlanOutcome(previous?.planId)

  // Los cuatro estados del plan actual se resuelven **antes** de mirar la lista: sin plan no hay
  // técnico del que pedirla, así que la consulta de la lista ni siquiera se dispara (`enabled`) y su
  // `isPending` seguiría en verdadero para siempre. Mirarla primero dejaría al plan inexistente
  // girando en un esqueleto en vez de decir que no existe.
  if (current.status === 'cargando') {
    return <Loading />
  }

  if (current.status === 'sin-plan') {
    return (
      <EmptyState
        icon={CalendarRange}
        title="No hay un plan guardado con ese identificador"
        detail={`${current.message} Un plan que no existe no se puede comparar con nada.`}
        action={
          <Link to={calendarPath(planId ?? '')} className="text-sm underline underline-offset-2">
            Ver el calendario de ese plan
          </Link>
        }
      />
    )
  }

  // Un identificador mal formado responde `400`, y eso **no es una ausencia**: es un fallo, y se pinta
  // como tal. Decir «no hay plan» sobre una dirección rota disfrazaría un error de un hueco.
  if (current.status === 'error') {
    return <Failed message={current.message} />
  }

  if (plans.isPending) {
    return <Loading />
  }

  if (plans.isError) {
    return (
      <Failed message="No fue posible leer los planes de este técnico, así que no se sabe cuál es el anterior." />
    )
  }

  if (previous === null) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Este es el primer plan guardado de este técnico"
        detail="No hay un plan anterior con el que compararlo. La comparación aparece en cuanto se genere
          un plan nuevo para la misma persona."
        action={
          <Link to={calendarPath(planId ?? '')} className="text-sm underline underline-offset-2">
            Ver el calendario del plan
          </Link>
        }
      />
    )
  }

  if (before.status === 'cargando') {
    return <Loading />
  }

  if (before.status !== 'listo') {
    return <Failed message={before.message} />
  }

  const comparison = planComparison(before.outcome, current.outcome, previous.createdAt)
  const token = comparisonOf(comparison)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Qué cambió entre dos planes</CardTitle>
          <CardDescription>
            Lo que difiere entre el plan anterior de este técnico y el plan actual. Solo cambios: el
            detalle de cada plan vive en su calendario. Solo lectura, y sin recalcular nada.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-8">
          <section aria-labelledby="comparacion-resumen" className="space-y-4">
            <div>
              <h2 id="comparacion-resumen" className="text-sm font-medium">
                Los dos planes
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Anterior <span className="font-mono">{previous.planId}</span> · calculado el{' '}
                <time dateTime={previous.createdAt}>{formatInstant(previous.createdAt)}</time> · Actual{' '}
                <span className="font-mono">{current.snapshot.planId}</span> · calculado el{' '}
                <time dateTime={current.snapshot.createdAt}>
                  {formatInstant(current.snapshot.createdAt)}
                </time>
              </p>
            </div>

            <dl
              data-slot="comparison-summary"
              data-verdict={token}
              className="grid grid-cols-2 gap-4 sm:grid-cols-4"
            >
              <Figure
                label="Elementos en el anterior"
                value={comparison.elementCounts.from}
                slot="comparison-from-count"
              />
              <Figure
                label="Elementos en el actual"
                value={comparison.elementCounts.to}
                slot="comparison-to-count"
              />
              <Figure
                label="Entraron"
                value={comparison.entered.length}
                slot="comparison-entered-count"
                hint={comparison.photosKnown ? undefined : PHOTO_MISSING}
              />
              <Figure
                label="Salieron"
                value={comparison.left.length}
                slot="comparison-left-count"
                hint={comparison.photosKnown ? undefined : PHOTO_MISSING}
              />
            </dl>

            <p data-slot="comparison-verdict" className="text-sm">
              <ComparisonSentence token={token} />
            </p>
          </section>

          {/* Sin elementos en ninguno de los dos no hay siete listas vacías que enseñar: hay una cosa
              que decir, y decirla es más honesto que siete ceros. */}
          {token === 'sin-elementos' ? (
            <p data-slot="comparison-empty" className="text-sm text-muted-foreground">
              Ninguno de los dos planes tenía elementos: no hay nada que comparar. Un cero aquí no
              significaría «no cambió nada», sino que no había nada que cambiar.
            </p>
          ) : (
            <>
              <ChangeList
                slot="comparison-entered"
                title="Tickets que entraron"
                detail="Están en el plan actual y no estaban en el anterior."
                empty="Ninguno: el plan actual no trae elementos nuevos."
                note={comparison.photosKnown ? undefined : PHOTO_FLOOR}
                elements={comparison.entered}
              />

              <ChangeList
                slot="comparison-left"
                title="Tickets que salieron"
                detail="Estaban en el plan anterior y ya no están en el actual."
                empty="Ninguno: todo lo que había sigue estando."
                note={comparison.photosKnown ? undefined : PHOTO_FLOOR}
                elements={comparison.left}
              />

              <CapacityChanges capacity={comparison.capacity} />

              <ChangeList
                slot="comparison-new-displacements"
                title="Desplazamientos que aparecieron"
                detail="Están desplazados en el plan actual y no lo estaban en el anterior: el motor dejó
                  su auditoría —de qué fecha a qué fecha y con qué regla—."
                empty="Ninguno: nada se movió de sitio que no estuviera ya movido."
                elements={comparison.newDisplacements}
              />

              <ChangeList
                slot="comparison-gone-displacements"
                title="Desplazamientos que desaparecieron"
                detail="Estaban desplazados en el plan anterior y en el actual ya no lo están."
                empty="Ninguno: los desplazamientos del plan anterior siguen ahí."
                note="Un desplazamiento que desaparece **no siempre es un cambio real**: el motor no
                  vuelve a auditar un par incidente-requerimiento que ya reclamó en una generación
                  anterior (riesgo 177), así que dos generaciones seguidas pueden producir esta
                  diferencia con la agenda quieta."
                elements={comparison.goneDisplacements}
              />

              <Agreements comparison={comparison} />

              <ChangeList
                slot="comparison-changed"
                title="Lo que sigue en los dos, pero cambió"
                detail="El mismo ticket en los dos planes con una fila distinta: otro veredicto, otra
                  fecha compromiso, otras horas o un desplazamiento nuevo sobre él."
                empty="Ninguno: lo que sigue en los dos sigue igual."
                elements={comparison.changed}
              />

              <ChangeList
                slot="comparison-unchanged"
                title="Lo que sigue igual"
                detail="El mismo ticket, en los dos planes, con el veredicto, la fecha, las horas y sus
                  desplazamientos sin tocar. Es la respuesta a «qué parte no cambió»."
                empty="Ninguno: nada de lo que sigue en el plan actual se quedó como estaba."
                elements={comparison.unchanged}
              />
            </>
          )}

          <p className="text-xs text-muted-foreground">
            El contexto congelado de los dos planes no se compara: dos planes con las mismas entradas y
            reglas distintas —otro horizonte, otro umbral— saldrían como «sin diferencias» aunque el
            cambio esté en las reglas. Es la limitación que más se nota en una auditoría. Los descartes
            del validador de GLPI tampoco se guardan con el plan, así que un ticket descartado en las
            dos generaciones no aparece ni como entrante ni como saliente.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

/** Lo que se pinta donde no se puede afirmar un número. No es un cero: es la ausencia. */
const MISSING = '—'

/** El motivo por el que las dos orillas de la entrada dejan de ser una cuenta. */
const PHOTO_MISSING = 'sin la foto de entrada no es una cuenta'

/** Lo mismo, dicho entero, para las dos listas que dependen de esa foto. */
const PHOTO_FLOOR =
  'La foto de entrada no consta en uno de los dos planes, así que esta lista es un suelo y no una ' +
  'cuenta: puede haber más de los que se ven aquí.'

function Loading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

function Failed({ message }: { message: string }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      tone="danger"
      title="No fue posible leer los planes que hay que comparar"
      detail={message}
    />
  )
}

/**
 * La frase de la comparación, armada en la pantalla a partir del token.
 *
 * El módulo de cálculo devuelve un token y no prosa, para que la misma cuenta se pueda leer de otra
 * forma sin tocar la lógica. **`sin-elementos` no es un `sin-diferencias` más**: dos planes vacíos no
 * coinciden en nada, lo que pasa es que no hay nada que comparar.
 */
function ComparisonSentence({ token }: { token: ComparisonToken }) {
  switch (token) {
    case 'sin-elementos':
      return <>Los dos planes están vacíos: no hay ni un elemento que comparar.</>
    case 'sin-diferencias':
      return <>Los dos planes dicen lo mismo: nada cambió entre ellos.</>
    case 'con-diferencias':
      return <>Los dos planes no dicen lo mismo: abajo está lo que cambió, una pregunta por bloque.</>
  }
}

interface ChangeListProps {
  slot: string
  title: string
  detail: string
  empty: string
  /** Lo que hay que advertir sobre la lista entera, si hay algo. */
  note?: string
  elements: readonly PlanElement[]
}

/**
 * Una de las preguntas, con sus filas.
 *
 * **Cada fila lleva su `data-slot` y su `data-work-item`**, y las pruebas agarran por los dos: un mismo
 * ticket puede salir a la vez en «entraron» y en «desplazamientos nuevos», así que una búsqueda por
 * texto encontraría dos y fallaría por ambigüedad.
 *
 * Una lista vacía dice «ninguno» y no desaparece: **«no hay ninguno» es la respuesta a la pregunta**,
 * y una sección que se esconde obliga a quien lee a deducir si no había nada o si no se miró.
 */
function ChangeList({ slot, title, detail, empty, note, elements }: ChangeListProps) {
  return (
    <section data-slot={slot} className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground">{detail}</p>

      {note && (
        <p data-slot={`${slot}-note`} className="text-xs text-amber-700">
          {note}
        </p>
      )}

      {elements.length === 0 ? (
        <p data-slot={`${slot}-empty`} className="text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {elements.map((element) => (
            <ElementRow key={element.workItemId} slot={slot} element={element} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** Una fila: qué es el elemento, cómo acabó, qué horas y fechas tiene y por qué. */
function ElementRow({ slot, element }: { slot: string; element: PlanElement }) {
  return (
    <li
      data-slot={`${slot}-item`}
      data-work-item={element.workItemId}
      data-verdict={element.verdict}
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-border/60 px-3 py-2 text-sm"
    >
      <span className="font-mono font-medium">{element.workItemId}</span>
      <Badge variant={VERDICT_VARIANTS[element.verdict]}>{element.verdict}</Badge>

      <span className="text-xs tabular-nums text-muted-foreground">
        {element.estimatedHours === null ? MISSING : `${formatHours(element.estimatedHours)} h`}
        {' estimadas · '}
        {element.allocatedHours > 0 ? `${formatHours(element.allocatedHours)} h` : MISSING}
        {' comprometidas · '}
        {element.committedDate ? formatDay(element.committedDate) : MISSING}
      </span>

      <span className="text-xs">
        <ElementReason element={element} />
      </span>

      {/* El estado de la renegociación se lee del mismo sitio que en el calendario, y es un eje aparte
          del veredicto: el motor no la produce, solo emite el desplazamiento. */}
      {element.renegotiation && (
        <Badge variant={STATUS_VARIANTS[element.renegotiation.status]}>
          {element.renegotiation.status}
        </Badge>
      )}
    </li>
  )
}

/** Las cinco columnas de capacidad que la comparación resta. */
const CAPACITY_ROWS = [
  { metric: 'availableHours', label: 'Horas disponibles', unit: 'h' },
  { metric: 'occupiedHours', label: 'Horas ocupadas', unit: 'h' },
  { metric: 'remainingHours', label: 'Horas libres', unit: 'h' },
  { metric: 'saturatedDays', label: 'Días saturados', unit: '' },
  { metric: 'overDays', label: 'Días sobrepasados', unit: '' },
] as const

function withUnit(value: number, unit: string): string {
  return unit === 'h' ? `${formatHours(value)} h` : String(value)
}

/**
 * La capacidad de los dos planes, una fila por número, con su resta.
 *
 * **Se resta, no se vuelve a clasificar.** Los dos lados son lo que cada timeline publicó —los días
 * sumados tal como llegaron—, así que los días saturados y sobrepasados son los que cada plan contó,
 * y lo que se enseña es la diferencia entre las dos cuentas. La vista no recalcula qué día está
 * saturado: eso lo decidió cada plan cuando se calculó.
 *
 * El delta lleva su signo y es lo único que hay que interpretar: `+4 h` significa que el plan actual
 * tiene cuatro horas más de lo que tenía el anterior, no que sea mejor.
 */
function CapacityChanges({ capacity }: { capacity: ComparisonData['capacity'] }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Cambios de capacidad</h3>
      <p className="text-xs text-muted-foreground">
        Lo que cada plan publicó y su resta. El delta es el plan actual menos el anterior, con su signo.
      </p>

      <div className="overflow-x-auto">
        <table data-slot="comparison-capacity" className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-4 text-left font-medium">
                Número
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Plan anterior
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Plan actual
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Cambio
              </th>
            </tr>
          </thead>

          <tbody>
            {CAPACITY_ROWS.map((row) => (
              <tr
                key={row.metric}
                data-slot="comparison-capacity-row"
                data-metric={row.metric}
                className="border-b border-border/60 last:border-0"
              >
                <td className="py-2 pr-4">{row.label}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {withUnit(capacity.from[row.metric], row.unit)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {withUnit(capacity.to[row.metric], row.unit)}
                </td>
                <td
                  data-slot={`comparison-delta-${row.metric}`}
                  className="py-2 text-right tabular-nums"
                >
                  {signedDelta(capacity.delta[row.metric], row.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Un delta con su signo: `+4 h`, `-2` o `0 h`. El cero va sin signo, porque no tiene sentido. */
function signedDelta(value: number, unit: string): string {
  return `${value > 0 ? '+' : ''}${withUnit(value, unit)}`
}

/**
 * La sexta pregunta: los acuerdos registrados **después** del plan anterior.
 *
 * **Se contesta por tiempo y no por pertenencia**, y es la única respuesta honesta que queda: la
 * lectura de acuerdos recorre el plan vigente de cada técnico, no un plan cualquiera, así que lo único
 * que se puede afirmar es cuándo se firmó cada acuerdo. El sello del plan anterior es el corte.
 *
 * **Cuando esa lectura no habla del plan actual, la pregunta no se contesta** y se dice «no consta»,
 * que no es lo mismo que un cero: un cero afirmaría que nadie acordó nada.
 *
 * Y hay algo que esta cifra **no** distingue, y se escribe: un acuerdo es lo que alguien firmó, no lo
 * que hace falta firmar. Los tickets que esperan un acuerdo son otra cosa, y se ven por su estado.
 */
function Agreements({ comparison }: { comparison: ComparisonData }) {
  return (
    <section data-slot="comparison-new-agreements" className="space-y-2">
      <h3 className="text-sm font-medium">Acuerdos registrados después del plan anterior</h3>
      <p className="text-xs text-muted-foreground">
        Los acuerdos que se firmaron entre el plan anterior y el actual. La renegociación no la produce
        el motor: solo emite el desplazamiento, y el acuerdo lo registra una persona.
      </p>

      {!comparison.agreementsKnown ? (
        <p data-slot="comparison-agreements-unknown" className="text-sm text-muted-foreground">
          No consta: la lectura de acuerdos habla del plan vigente de cada técnico, y el plan actual no
          lo es. No se puede decir cuáles surgieron entre los dos.
        </p>
      ) : comparison.newAgreements.length === 0 ? (
        <p data-slot="comparison-new-agreements-empty" className="text-sm text-muted-foreground">
          Ninguno: no se registró ningún acuerdo entre los dos planes.
        </p>
      ) : (
        <ul className="space-y-2">
          {comparison.newAgreements.map((element) => (
            <ElementRow key={element.workItemId} slot="comparison-new-agreements" element={element} />
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Un acuerdo registrado no es lo mismo que una necesidad de acordar: esta cifra cuenta firmas, no
        desplazamientos pendientes. Y un acuerdo posterior al plan actual también entraría aquí, porque
        el corte es el sello del anterior.
      </p>
    </section>
  )
}
