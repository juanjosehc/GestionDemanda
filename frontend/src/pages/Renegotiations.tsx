import { AlertTriangle, CalendarRange, FilterX, Handshake } from 'lucide-react'
import { useState } from 'react'

import { RenegotiationForm } from '@/components/renegotiations/RenegotiationForm'
import { RenegotiationHistory } from '@/components/renegotiations/RenegotiationHistory'
import { RenegotiationTable } from '@/components/renegotiations/RenegotiationTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useRenegotiations } from '@/hooks/useRenegotiations'
import { formatInstant } from '@/lib/format'
import { ANY_STATUS, FILTER_OPTIONS, matchesFilter } from '@/lib/renegotiations'
import type { RenegotiationFilter } from '@/lib/renegotiations'

/** Esqueleto de la carga: la misma forma que el contenido, para que no haya salto de altura. */
function RenegotiationsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/**
 * La pantalla de renegociacion: lo que un incidente desplazo y a que fecha se llego.
 *
 * Cierra el flujo operativo entero —**incidente → desplazamiento → pendiente de acuerdo → acuerdo
 * registrado → historial consultable**— leyendo y escribiendo solo los cinco endpoints que la Fase 25
 * publico. No hay ninguna ruta nueva y no hay ninguna regla nueva.
 *
 * **Lo que esta pantalla no hace, y es lo que la define.** No decide estados: pinta el que llego y el
 * filtro compara contra ese mismo valor, sin traducirlo. No calcula cobertura: si un acuerdo cubre o
 * no los desplazamientos vigentes lo decidio el backend al calcular `status`, y aqui no se comparan
 * fechas para comprobarlo. No determina si algo esta renegociado: eso es exactamente lo que
 * `status` dice. No reconstruye el historial: lo pide y lo pinta en el orden en que llega. Y no
 * recalcula ninguna fecha del desplazamiento: las parejas «de que fecha a que fecha» son las que el
 * plan audito.
 *
 * Los dos unicos estados que existen aqui son los del contrato —`PENDIENTE_DE_ACUERDO` y `ACORDADA`—
 * y se usan tal cual. En particular, un requerimiento que se movio despues de haberse acordado llega
 * como `PENDIENTE_DE_ACUERDO` **y** con su acuerdo anterior: hay que volver a acordar, pero el
 * recurso que se reemplaza ya existe. La pantalla enseña las dos cosas y no elige por su cuenta.
 *
 * El **verbo de la escritura** tambien sale de un hecho del backend y no del estado: la existencia
 * del acuerdo. Por eso la accion de una fila pendiente puede ser «Editar acuerdo» y no «Registrar».
 */
export function Renegotiations() {
  const { data, isPending, isError, error, refetch } = useRenegotiations()
  const [filter, setFilter] = useState<RenegotiationFilter>(ANY_STATUS)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const loading = isPending && !data

  if (loading) {
    return <RenegotiationsSkeleton />
  }

  if (isError) {
    return (
      <EmptyState
        tone="danger"
        icon={AlertTriangle}
        title="No fue posible cargar las renegociaciones"
        detail={error instanceof Error ? error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Ningún requerimiento está desplazado"
        detail="Los planes vigentes no movieron ningún elemento de su fecha original, así que no hay nada que renegociar. Una lista vacía es el estado que esta pantalla existe para poder declarar."
      />
    )
  }

  // El filtro es una funcion del estado recibido: no vuelve a consultar nada ni recalcula el estado.
  const visible = data.items.filter((item) => matchesFilter(item.status, filter))

  // La fila seleccionada se busca en la lista completa y no en la filtrada: cambiar el filtro no
  // puede cerrar un formulario a medio escribir.
  const selectedItem = data.items.find((item) => item.workItemId === selected) ?? null

  function open(workItemId: string) {
    setSelected(workItemId)
    setEditing(true)
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Los requerimientos desplazados del plan vigente de cada desarrollador, en la lectura generada
        el <time dateTime={data.generatedAt}>{formatInstant(data.generatedAt)}</time> ·{' '}
        <span data-slot="summary">
          Desplazados: {data.summary.displaced} · Pendientes: {data.summary.pending} · Acordadas:{' '}
          {data.summary.agreed}
        </span>{' '}
        · procedencia <span className="font-mono">{data.source}</span>
      </p>

      <div className="flex items-center gap-1.5">
        <label htmlFor="filtro-estado" className="text-xs text-muted-foreground">
          Estado
        </label>
        <select
          id="filtro-estado"
          value={filter}
          onChange={(event) => setFilter(event.target.value as RenegotiationFilter)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/*
        El formulario y el historial van arriba de la tabla, como en la pantalla de declaracion: al
        elegir una fila, lo que hay que hacer con ella aparece sin buscarlo. El formulario se cierra
        al guardar y la fila sigue elegida, de modo que el historial —que se relee— enseña el cambio
        recien registrado sin tener que volver a abrir nada.
      */}
      {selectedItem && editing && (
        <RenegotiationForm item={selectedItem} onClose={() => setEditing(false)} />
      )}

      {selectedItem && <RenegotiationHistory item={selectedItem} />}

      {visible.length === 0 ? (
        <EmptyState
          icon={FilterX}
          title="Ningún requerimiento coincide con el filtro"
          detail={`Se recibieron ${data.items.length} y el filtro deja fuera a todos. El filtro no vuelve a consultar nada: se aplica sobre la lista que ya está en pantalla.`}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Requerimientos desplazados
            </CardTitle>
            <CardDescription>
              Una fila por requerimiento, no por desplazamiento: uno que se movió dos veces por dos
              incidentes aparece una vez, con los dos dentro. El estado y las fechas del
              desplazamiento los calculó y auditó el backend; el acuerdo lo registró una persona.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <RenegotiationTable items={visible} selected={selected} onSelect={open} />
          </CardContent>
        </Card>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Handshake className="size-3.5" aria-hidden="true" />
        Registrar un acuerdo no mueve el requerimiento ni lo saca de esta lista: el desplazamiento
        sigue siendo un hecho auditado. Cambia el estado de la fila, que el backend recalcula al
        leer, y deja la entrada correspondiente en el historial.
      </p>
    </div>
  )
}
