import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { PlanResultSummary, PlanTraceability } from '@/components/timeline/PlanResult'
import { ResourceTimeline } from '@/components/timeline/ResourceTimeline'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlanOutcome } from '@/hooks/usePlanOutcome'
import { calendarPath, comparisonPath } from '@/routes/navigation'
import type { FormEvent } from 'react'

/**
 * El resultado del motor, encima de la agenda.
 *
 * **Es la mitad que faltaba de esta pantalla.** La rejilla contesta «donde quedo el trabajo»; esto
 * contesta «que produjo el motor»: cuantos elementos recibio, cuantos ubico, cuantos quedaron fuera y
 * por que, y como quedo la capacidad. Las dos mitades leen las mismas filas publicadas, asi que no
 * pueden discrepar.
 *
 * Las cuatro lecturas y su cuenta viven en `usePlanOutcome`, que es lo que comparte con la pantalla de
 * comparacion: las dos tienen que contar un plan con la misma vara. **Esta pantalla no gana ninguna
 * lectura por tener un enlace a la comparacion**: quien resuelve si hay plan anterior es la otra, que
 * es la que tiene la lista.
 */
function PlanResult({ planId }: { planId: string }) {
  const state = usePlanOutcome(planId)

  if (state.status === 'cargando') {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  // «No existe» y «no se pudo leer» se pintan igual aquí —las dos son «no hay plan que resumir»— y la
  // distinción queda para quien tenga algo distinto que hacer con ella.
  if (state.status !== 'listo') {
    return (
      <p data-slot="plan-result-missing" className="text-sm text-muted-foreground">
        {state.message}
      </p>
    )
  }

  const { snapshot, outcome, inputMissing, inputFailed, renegotiationsFailed } = state

  return (
    <div className="space-y-6">
      <PlanResultSummary
        outcome={outcome}
        createdAt={snapshot.createdAt}
        developerId={snapshot.developerId}
        planId={snapshot.planId}
      />

      <p className="text-sm">
        <Link
          to={comparisonPath(snapshot.planId)}
          data-slot="compare-with-previous"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Comparar con el plan anterior
        </Link>
      </p>

      {/* La entrada que no consta y la que no se pudo leer son dos frases distintas, y solo una de
          las dos es cierta. Un fallo de red no puede leerse como un hueco del registro. */}
      {inputMissing && (
        <p data-slot="plan-input-missing" className="text-xs text-muted-foreground">
          La entrada de este plan no consta: es anterior a que se registrara la foto de lo que recibió
          el motor. Las cifras de arriba salen del plan guardado y no de su entrada.
        </p>
      )}
      {inputFailed && (
        <p data-slot="plan-input-error" className="text-xs text-destructive">
          No fue posible leer la entrada de este plan, así que los excluidos no se pueden contar.
        </p>
      )}

      <PlanTraceability outcome={outcome} />

      {/* Un fallo de la lectura de acuerdos no borra el resto: la tabla se pinta sin la columna de
          estado y lo dice, en vez de desaparecer entera. */}
      {renegotiationsFailed && (
        <p data-slot="plan-renegotiations-error" className="text-xs text-destructive">
          No fue posible leer los acuerdos, así que la columna de renegociación queda sin estado.
        </p>
      )}
    </div>
  )
}

/** Sección del calendario corporativo. Aloja el módulo de línea de tiempo de recursos. */
export function Calendar() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')

  // Todavia no hay ninguna pantalla que genere planes, asi que el identificador se escribe a mano.
  const submit = (event: FormEvent) => {
    event.preventDefault()

    const value = draft.trim()
    if (value) {
      void navigate(calendarPath(value))
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Calendario corporativo</CardTitle>
          <CardDescription>
            El resultado de un plan guardado: qué produjo el motor —cuántos elementos recibió, cuántos
            ubicó y cuáles quedaron fuera— y, debajo, dónde quedó el trabajo, día por día. Solo lectura.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {planId ? (
            <div className="space-y-8">
              <PlanResult planId={planId} />
              <ResourceTimeline planId={planId} />
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <label htmlFor="plan-id" className="text-xs text-muted-foreground">
                  Identificador del plan
                </label>
                <input
                  id="plan-id"
                  name="planId"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="h-9 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>

              <Button type="submit" disabled={!draft.trim()}>
                Ver agenda
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Alcance de esta vista
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {[
              'Solo lectura: no se edita la agenda ni se arrastran asignaciones.',
              'Los tramos y las filas se rotulan con el identificador del elemento; el plan no guarda títulos.',
              'Un plan es de un técnico: la vista de equipo consolidada vive en recursos.',
              'El horizonte, el umbral y la política de incidentes congelados no se enseñan; el horizonte se lee dentro del motivo de cada conflicto.',
              'Los descartes del validador de GLPI no se guardan con el plan: solo viajan en la respuesta de la generación.',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
