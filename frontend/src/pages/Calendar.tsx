import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ResourceTimeline } from '@/components/timeline/ResourceTimeline'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { calendarPath } from '@/routes/navigation'
import type { FormEvent } from 'react'

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
            Agenda de un plan guardado, tal como quedó: tramos, capacidad por día y
            desplazamientos. Solo lectura.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {planId ? (
            <ResourceTimeline planId={planId} />
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
              'Los tramos se rotulan con el identificador del elemento; el plan no guarda títulos.',
              'Una fila por recurso. La vista de equipo consolidada todavía no existe.',
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
