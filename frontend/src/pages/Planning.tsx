import {
  AlertTriangle,
  BellRing,
  CalendarRange,
  Handshake,
  LayoutDashboard,
  PlayCircle,
} from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlanGeneration } from '@/hooks/usePlanGeneration'
import { formatInstant } from '@/lib/format'
import { ApiError } from '@/services/apiClient'
import { ROUTES, calendarPath } from '@/routes/navigation'
import type { PlanningFromGlpiResponse } from '@/types/planning'

/** Esqueleto de la generación: la misma forma que el resultado, para que no haya salto de altura. */
function PlanningSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-80" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-72" />
      </CardContent>
    </Card>
  )
}

/** Un número del resultado, con el rótulo encima. Se cuentan listas; no se recalcula nada. */
function Figure({
  label,
  value,
  slot,
  hint,
}: {
  label: string
  value: number | string
  slot: string
  hint?: string
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd data-slot={slot} className="tabular-nums">
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * El plan que acaba de salir, con lo que produjo y por donde seguir.
 *
 * **Los tres números se cuentan, no se calculan.** Son las longitudes de tres listas que el backend ya
 * devolvió, y por eso coinciden con lo que el contrato publica. No se comparan con el tablero: el
 * desplazamiento de esta tarjeta es el de *esta* ejecución, y el del tablero es el del plan vigente de
 * cada técnico —coinciden cuando este plan es el vigente, y no antes—.
 *
 * Los descartes se listan tal como llegan, con el código de la causa y su motivo. **Un ticket puede
 * aparecer más de una vez**, porque cada fila es una causa y no un ticket: agrupar aquí por ticket
 * afirmaría una cuenta que el contrato no publica.
 */
function GenerationResult({ result }: { result: PlanningFromGlpiResponse }) {
  const { plan, discarded } = result

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Plan generado</CardTitle>
        <CardDescription>
          Calculado por el motor con las reglas configuradas y ya guardado. Lo que sigue es leerlo, no
          volver a planificar.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
          <Figure label="Plan" value={result.planId} slot="generated-plan-id" />
          <Figure label="Técnico" value={plan.developerId} slot="generated-developer" />
          <div>
            <dt className="text-xs text-muted-foreground">Calculado el</dt>
            <dd data-slot="generated-at">
              <time dateTime={result.createdAt}>{formatInstant(result.createdAt)}</time>
            </dd>
          </div>
          <Figure
            label="Elementos ubicados"
            value={plan.allocations.length}
            slot="generated-allocations"
          />
          <Figure
            label="Desplazados en esta ejecución"
            value={plan.displacedRequirements.length}
            slot="generated-displaced"
            hint="Los de esta corrida, no los del plan vigente."
          />
          <Figure label="Conflictos" value={plan.conflicts.length} slot="generated-conflicts" />
        </dl>

        <p className="text-xs text-muted-foreground">
          Cuántos tickets entregó GLPI no viaja en esta respuesta —el contrato publica el plan y los
          descartes, no el total consultado—, así que no se enseña una cifra que nadie publicó.
        </p>

        {discarded.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            El backend no reportó descartes para esta ejecución.
          </p>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground">
              {discarded.length} {discarded.length === 1 ? 'descarte' : 'descartes'}. Un ticket puede
              aparecer más de una vez: cada fila es una causa, no un ticket.
            </p>
            <ul className="mt-2 space-y-1.5">
              {discarded.map((entry, index) => (
                <li
                  key={`${entry.ticketId}-${entry.code}-${index}`}
                  data-slot="discarded-ticket"
                  data-ticket={entry.ticketId}
                  data-code={entry.code}
                  className="flex flex-wrap items-baseline gap-2 text-xs"
                >
                  <Badge variant="warning">{entry.code}</Badge>
                  <span className="font-mono text-muted-foreground">{entry.ticketId}</span>
                  <span>{entry.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
          Los cuatro destinos se construyen con las rutas de la aplicación y nunca a mano: el
          timeline con `calendarPath`, que es el único sitio que sabe cómo se arma la dirección de un
          plan. Ninguno recarga la página.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link to={calendarPath(result.planId)} data-slot="open-timeline">
              <CalendarRange aria-hidden="true" />
              Abrir timeline
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTES.dashboard}>
              <LayoutDashboard aria-hidden="true" />
              Métricas
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTES.alerts}>
              <BellRing aria-hidden="true" />
              Alertas
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTES.renegotiations}>
              <Handshake aria-hidden="true" />
              Renegociaciones
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * La pantalla que genera el plan de un técnico desde GLPI: el tramo que faltaba del flujo.
 *
 * Cierra el recorrido —GLPI entrega los tickets, alguien declara, **aquí se planifica**, y el plan se
 * abre en su timeline para leer métricas, alertas y renegociaciones— invocando una ruta que ya
 * existía. **La interfaz no planifica**: no hay una sola regla, horizonte o prioridad que se pueda
 * tocar desde aquí, porque el cuerpo de la petición solo lleva el identificador del técnico y el motor
 * corre entero en el backend. Lo que vuelve es un plan ya guardado; esta pantalla lo enseña.
 *
 * **Generar escribe.** Cada llamada guarda un plan y sube el contador de ejecuciones, así que la
 * petición sale del botón y nunca al abrir la pantalla: abrirla no deja rastro. Es la misma razón por
 * la que `Declarations` no usa esta ruta para listar.
 *
 * Generar dos veces al mismo técnico es lo normal y no un error: se vuelve a planificar cuando lo
 * declarado cambió, y cada corrida es un plan nuevo con su propio identificador. La pantalla enseña la
 * última; las anteriores siguen donde estaban, y sus timelines se abren con el suyo.
 */
export function Planning() {
  const [draft, setDraft] = useState('')
  const generate = usePlanGeneration()

  const developerId = draft.trim()

  /**
   * La única acción de la pantalla.
   *
   * Un identificador vacío no sale a la red: el backend respondería `400` por una petición que no
   * hacía falta enviar, y el hueco se explica mejor en el propio formulario que con un error del
   * servidor.
   */
  function run(id: string) {
    if (id === '') return

    generate.mutate(id)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    run(developerId)
  }

  const failure = generate.error
  const failureStatus = failure instanceof ApiError ? failure.status : null

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Genera el plan de un técnico con lo que GLPI tiene asignado y lo que ya está declarado. La
        planificación corre entera en el backend, con las reglas configuradas: esta pantalla invoca la
        ruta que ya existía y enseña lo que devuelve. Cada generación guarda un plan y sube el
        contador de ejecuciones, así que se dispara desde el botón y no al abrir la pantalla.
      </p>

      {/*
        Campo de texto y no un desplegable, por lo mismo que en declaración: el backend no publica un
        catálogo de técnicos. Y la petición sale al enviar, no al teclear: escribir «296» no debe
        generar el plan de «2» ni el de «29» —cada intento deja un plan guardado—.
      */}
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <label htmlFor="tecnico" className="text-xs text-muted-foreground">
          Técnico
        </label>
        <input
          id="tecnico"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Identificador en GLPI, p. ej. 296"
          className="h-8 w-56 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button type="submit" size="sm" disabled={generate.isPending || developerId === ''}>
          <PlayCircle aria-hidden="true" />
          {generate.isPending ? 'Generando…' : 'Generar plan'}
        </Button>
      </form>

      {/*
        El error va antes que el resultado: una generación que falla deja en pie el plan de la anterior
        —la mutación conserva su último dato—, y enseñarlo debajo del fallo lo haría pasar por el
        resultado de esta acción. El texto es el del backend, sin traducir: un 404 y un 503 explican
        cada uno un problema distinto y con sus propias palabras.
      */}
      {generate.isPending ? (
        <PlanningSkeleton />
      ) : failure ? (
        <EmptyState
          tone="danger"
          icon={AlertTriangle}
          title="El backend no pudo generar el plan"
          detail={failure instanceof Error ? failure.message : 'Error desconocido'}
          action={failureStatus === null ? undefined : <Badge variant="danger">HTTP {failureStatus}</Badge>}
        />
      ) : generate.data ? (
        <GenerationResult result={generate.data} />
      ) : (
        <EmptyState
          icon={PlayCircle}
          title="Todavía no se ha generado ningún plan"
          detail="Escribe el identificador de un técnico y genera. Generar escribe: cada corrida guarda un plan nuevo y sube el contador de ejecuciones, así que no ocurre por abrir la pantalla."
        />
      )}
    </div>
  )
}
