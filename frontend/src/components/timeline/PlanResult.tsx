import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Figure } from '@/components/ui/figure'
import { formatInstant } from '@/lib/format'
import { STATUS_VARIANTS } from '@/lib/renegotiations'
import { formatDay, formatHours } from '@/lib/timeline'
import { outside, verdictOf } from '@/lib/planResult'
import { ROUTES } from '@/routes/navigation'
import type { BadgeVariant } from '@/components/ui/badge'
import type { PlanElement, PlanOutcome, PlanVerdict } from '@/lib/planResult'

/** Lo que se pinta donde el backend no publico nada. No es un cero: es la ausencia. */
const MISSING = '—'

/**
 * Un color por veredicto, y los cuatro salen del motor.
 *
 * El mapa es **total** sobre los cuatro valores: anadir un veredicto sin darle color no compila. El
 * orden de los colores es el de la gravedad —fuera es rojo, desplazado ambar, planificado informativo
 * y excluido neutro—, y ninguno se deduce de una regla: el veredicto lo produjo el motor al escribir
 * el plan.
 */
const VERDICT_VARIANTS: Record<PlanVerdict, BadgeVariant> = {
  FUERA: 'danger',
  DESPLAZADO: 'warning',
  EXCLUIDO: 'secondary',
  PLANIFICADO: 'info',
}

interface PlanResultSummaryProps {
  outcome: PlanOutcome
  /** Cuando el motor calculo el plan. Es la fecha de generacion, y el plan no la compara con nada. */
  createdAt: string
  /** El tecnico del plan. Un plan es de un desarrollador: el equipo vive en `/recursos`. */
  developerId: string
  planId: string
}

/**
 * Lo que produjo el motor, contado.
 *
 * **Cada cifra es la longitud de una lista publicada o la suma de una columna publicada**, no un
 * recalculo: el motor no corre aqui. Por eso el resumen y la rejilla de abajo no pueden discrepar
 * —los dos leen las mismas filas— y por eso la frase que las acompana tampoco decide nada que el
 * backend no haya decidido ya.
 *
 * Las dos cifras que **no** se pueden contestar se dicen con palabras en vez de rellenarlas con un
 * cero: los descartes del validador de GLPI no se guardan con el plan, y el total que GLPI entrego no
 * lo publica ninguna lectura de un plan guardado.
 */
export function PlanResultSummary({
  outcome,
  createdAt,
  developerId,
  planId,
}: PlanResultSummaryProps) {
  const verdict = verdictOf(outcome)
  const excluded = outcome.excluded

  return (
    <section aria-labelledby="resultado-del-plan" className="space-y-4">
      <div>
        <h2 id="resultado-del-plan" className="text-sm font-medium">
          Qué produjo el motor
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Plan <span className="font-mono">{planId}</span> · {developerId} · calculado el{' '}
          <time dateTime={createdAt}>{formatInstant(createdAt)}</time>
        </p>
      </div>

      <dl
        data-slot="plan-result-summary"
        data-verdict={verdict}
        className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7"
      >
        {/*
          «Recibidos por el motor» y no «tickets»: es la foto de la entrada —lo que llego al motor
          despues de validar—, y el total que GLPI entrego es otra cifra que este plan no guarda.
        */}
        <Figure
          label="Recibidos por el motor"
          value={outcome.considered ?? MISSING}
          slot="plan-considered"
          hint={outcome.considered === null ? 'la entrada de este plan no consta' : undefined}
        />
        <Figure label="Planificados" value={outcome.planned} slot="plan-planned" />
        <Figure label="Desplazados" value={outcome.displaced} slot="plan-displaced" />
        <Figure
          label="Fuera del plan"
          value={outcome.out}
          slot="plan-out"
          hint="no cupieron en el horizonte"
        />
        <Figure
          label="Excluidos"
          value={excluded ?? MISSING}
          slot="plan-excluded"
          hint={excluded === null ? 'sin la foto de la entrada no se pueden contar' : 'el motor no los usó'}
        />
        <Figure
          label="Capacidad usada"
          value={`${formatHours(outcome.capacity.occupiedHours)} h`}
          slot="plan-occupied"
          hint={`de ${formatHours(outcome.capacity.availableHours)} h disponibles`}
        />
        <Figure
          label="Capacidad libre"
          value={`${formatHours(outcome.capacity.remainingHours)} h`}
          slot="plan-remaining"
          hint={
            outcome.overDays > 0
              ? `${outcome.overDays} día(s) sobrepasados`
              : `${outcome.saturatedDays} día(s) saturados`
          }
        />
      </dl>

      <p data-slot="plan-verdict" className="text-sm">
        <VerdictSentence outcome={outcome} />
      </p>

      {outside(outcome).length > 0 && (
        <div data-slot="plan-outside" className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            Lo que no cupo, con el motivo del motor
          </h3>
          <ul className="space-y-1">
            {outside(outcome).map((element) => (
              <li
                key={element.workItemId}
                data-slot="plan-outside-item"
                data-work-item={element.workItemId}
                className="flex flex-wrap items-baseline gap-2 text-sm"
              >
                <span className="font-mono font-medium">{element.workItemId}</span>
                {/* El motivo se pinta tal cual: la vista no lo traduce ni lo reescribe. */}
                <span className="text-xs text-muted-foreground">{element.conflict?.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Los descartes del validador de GLPI no se guardan con el plan: solo viajan en la respuesta de
        la generación, y esta vista lee un plan ya guardado. El total de tickets que entregó GLPI
        tampoco se publica aquí: «recibidos» es la foto de la entrada.
      </p>
    </section>
  )
}

/**
 * La frase del resultado, armada en la pantalla a partir del token.
 *
 * El modulo de calculo devuelve un token y no prosa, para que la misma cuenta se pueda leer de otra
 * forma sin tocar la logica. **La ausencia de la foto de la entrada no es un veredicto** y por eso no
 * tiene token: se dice aparte, y decirla aqui obligaria a la frase a elegir entre dos hechos.
 */
function VerdictSentence({ outcome }: { outcome: PlanOutcome }) {
  if (outcome.considered === null) {
    return (
      <>
        El motor ubicó {outcome.planned + outcome.displaced} de los elementos que quedaron registrados
        en la agenda. La foto de la entrada de este plan no consta, así que no se puede decir cuántos
        recibió.
      </>
    )
  }

  switch (verdictOf(outcome)) {
    case 'sin-elementos':
      return <>El motor no recibió ningún elemento: el plan salió vacío.</>
    case 'nada-ubicado':
      return (
        <>
          El motor recibió {outcome.considered} elementos y no ubicó ninguno: los{' '}
          {outcome.out + (outcome.excluded ?? 0)} quedaron fuera del horizonte o los descartó su
          propio estado.
        </>
      )
    case 'con-trabajo':
      return (
        <>
          El motor recibió {outcome.considered} elementos y ubicó{' '}
          {outcome.planned + outcome.displaced}: {outcome.planned} donde se comprometieron,{' '}
          {outcome.displaced} desplazados y {outcome.out} fuera del horizonte
          {outcome.excluded ? `, más ${outcome.excluded} que no usó` : ''}.
        </>
      )
  }
}

interface PlanTraceabilityProps {
  outcome: PlanOutcome
}

/**
 * Ticket a ticket: donde acabo cada elemento y por que.
 *
 * **Es la respuesta a las siete preguntas, fila a fila.** Un planificado no ofrece motivo porque no
 * hubo ninguno; un desplazado enseña sus dos fechas, la regla que aplico el motor y su motivo; un
 * elemento fuera enseña el motivo del conflicto; y un excluido dice que entro y que el motor no lo
 * uso, que es lo unico que se puede decir de el.
 *
 * La columna de renegociación es **un eje aparte del veredicto, no un quinto veredicto**: el motor no
 * produce la renegociación, solo emite el evento. Cuando la lectura de acuerdos habla de otro plan,
 * la celda lo dice con esas palabras en vez de pintar un cero que se leeria como «nadie ha hecho
 * nada».
 */
export function PlanTraceability({ outcome }: PlanTraceabilityProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Elemento
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Veredicto
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Estimado
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Comprometido
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Fecha compromiso
            </th>
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              Por qué
            </th>
            <th scope="col" className="py-2 text-left font-medium">
              Renegociación
            </th>
          </tr>
        </thead>

        <tbody>
          {outcome.elements.map((element) => (
            <tr
              key={element.workItemId}
              data-slot="plan-element"
              data-work-item={element.workItemId}
              // El veredicto que la vista pinta, para poder afirmarlo sin mirar el texto del badge.
              data-verdict={element.verdict}
              className="border-b border-border/60 align-top last:border-0"
            >
              <td className="py-3 pr-4">
                <p className="font-mono text-sm font-medium">{element.workItemId}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {element.workItemType ?? MISSING}
                  {element.severity ? ` · ${element.severity}` : ''}
                </p>
              </td>

              <td className="py-3 pr-4">
                <Badge variant={VERDICT_VARIANTS[element.verdict]}>{element.verdict}</Badge>
              </td>

              <td className="py-3 pr-4 tabular-nums">
                {element.estimatedHours === null ? MISSING : `${formatHours(element.estimatedHours)} h`}
              </td>

              {/*
                Lo comprometido y lo estimado, uno al lado del otro: es la unica comparacion que deja
                ver si a un elemento le sobra o le falta agenda, y los dos numeros son del contrato.
              */}
              <td className="py-3 pr-4 tabular-nums">
                {element.allocatedHours > 0 ? `${formatHours(element.allocatedHours)} h` : MISSING}
              </td>

              <td className="py-3 pr-4 tabular-nums">
                {element.committedDate ? formatDay(element.committedDate) : MISSING}
              </td>

              <td className="py-3 pr-4 text-xs">
                <ElementReason element={element} />
              </td>

              <td className="py-3 text-xs">
                {element.renegotiation ? (
                  <Link
                    to={ROUTES.renegotiations}
                    data-slot="plan-renegotiation"
                    data-status={element.renegotiation.status}
                    className="inline-flex underline-offset-4 hover:underline"
                  >
                    <Badge variant={STATUS_VARIANTS[element.renegotiation.status]}>
                      {element.renegotiation.status}
                    </Badge>
                  </Link>
                ) : element.verdict === 'DESPLAZADO' ? (
                  <span className="text-muted-foreground">
                    {outcome.agreementsKnown ? 'sin acuerdo registrado' : 'no consta para este plan'}
                  </span>
                ) : (
                  MISSING
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-muted-foreground">
        La renegociación no la produce el motor: solo emite el desplazamiento.{' '}
        <Link to={ROUTES.renegotiations} className="underline-offset-4 hover:text-foreground hover:underline">
          Los acuerdos se registran en renegociaciones
        </Link>
        , y la agenda de todo el equipo está en{' '}
        <Link to={ROUTES.resources} className="underline-offset-4 hover:text-foreground hover:underline">
          recursos
        </Link>
        .
      </p>
    </div>
  )
}

/**
 * El motivo de la fila, con la forma que le toca.
 *
 * Un desplazado trae la auditoria entera —de que fecha a que fecha, con que regla— y un elemento
 * fuera trae la frase del conflicto. Los dos textos los redacto el motor: aqui no se reescriben ni se
 * resumen en una palabra.
 */
function ElementReason({ element }: { element: PlanElement }) {
  if (element.reschedule) {
    return (
      <span data-slot="plan-element-event" className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums">
          {formatDay(element.reschedule.originalDate)} → {formatDay(element.reschedule.rescheduledDate)}
        </span>
        <span className="font-mono text-muted-foreground">{element.reschedule.appliedRule}</span>
        <span className="text-muted-foreground">{element.reschedule.reason}</span>
      </span>
    )
  }

  if (element.conflict) {
    return <span data-slot="plan-element-conflict">{element.conflict.reason}</span>
  }

  if (element.verdict === 'EXCLUIDO') {
    return (
      <span className="text-muted-foreground">
        entró en la foto de la entrada y el motor no lo usó: su estado no consume capacidad
      </span>
    )
  }

  // Un planificado no tiene motivo, y decir «sin incidencias» seria inventarse un campo que el
  // contrato no publica.
  return <span className="text-muted-foreground">{MISSING}</span>
}
