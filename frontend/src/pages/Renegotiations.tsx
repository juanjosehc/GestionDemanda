import { AlertTriangle, CalendarRange, FilterX, Handshake } from 'lucide-react'
import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { RenegotiationForm } from '@/components/renegotiations/RenegotiationForm'
import { RenegotiationHistory } from '@/components/renegotiations/RenegotiationHistory'
import { RenegotiationTable } from '@/components/renegotiations/RenegotiationTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Modal } from '@/components/ui/modal'
import { Skeleton } from '@/components/ui/skeleton'
import { useRenegotiations } from '@/hooks/useRenegotiations'
import { formatInstant } from '@/lib/format'
import { ANY_STATUS, FILTER_OPTIONS, STATUS_VARIANTS, matchesFilter } from '@/lib/renegotiations'
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
  const [params] = useSearchParams()
  const [filter, setFilter] = useState<RenegotiationFilter>(ANY_STATUS)

  /**
   * La fila con la que abre la pantalla, si alguien llegó desde un tramo del timeline.
   *
   * Es una **siembra y no un estado gobernado por la dirección**: se lee una vez, al montar, y a
   * partir de ahí manda lo que la persona hace en pantalla. Sincronizar los dos sentidos obligaría a
   * reescribir la dirección en cada clic, y no hace falta para que el enlace funcione.
   *
   * Si el ticket no está en la lista —dejó de estar desplazado, o se acordó desde otra máquina— la
   * selección no encuentra fila y la pantalla se abre como siempre. No se inventa un formulario para
   * un elemento que el backend no publica.
   */
  const ticket = params.get('ticket')
  const [selected, setSelected] = useState<string | null>(ticket)
  const [editing, setEditing] = useState(ticket !== null)

  /*
   * El botón de la fila que abrió el modal, para devolverle el foco al cerrarlo. Se guarda el
   * elemento pulsado y no `document.activeElement`: con un clic disparado desde código el foco no
   * viaja, y aun así el cierre tiene que devolverlo a la misma fila.
   */
  const openerRef = useRef<HTMLElement | null>(null)

  function open(workItemId: string, opener: HTMLElement) {
    openerRef.current = opener
    // La selección se conserva al cerrar: es la fila de la que habla el historial que queda debajo.
    setSelected(workItemId)
    setEditing(true)
  }

  function close() {
    setEditing(false)
    openerRef.current?.focus()
  }

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
        El historial se queda en la página, bajo la tabla: es información que se consulta después de
        guardar, no un formulario que haya que buscar. La escritura —registrar o reemplazar— vive en
        el modal, que se abre sobre la fila y no la empuja hacia abajo.
      */}
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

      {/*
        La acción individual es un modal y no una tarjeta en el flujo: pulsar una fila ya no alarga
        la página ni obliga a bajar a buscar el formulario. El diálogo trae el ticket que se está
        operando —identificador, persona, plan y estado— y dentro va el mismo formulario de siempre,
        sin su marco, con la lectura fresca y el `POST`/`PUT` que ya decidía.
      */}
      {selectedItem && editing && (
        <Modal
          labelledBy="renegociacion-titulo"
          closeLabel="Cerrar el acuerdo"
          onClose={close}
          header={
            <>
              <h2
                id="renegociacion-titulo"
                className="flex flex-wrap items-center gap-2 text-sm font-medium"
              >
                {selectedItem.renegotiation
                  ? 'Reemplazar la fecha acordada'
                  : 'Registrar el acuerdo'}
                <Badge variant={STATUS_VARIANTS[selectedItem.status]}>{selectedItem.status}</Badge>
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="font-mono">{selectedItem.workItemId}</span> ·{' '}
                {selectedItem.developerId} · plan{' '}
                <span className="font-mono">{selectedItem.planId}</span>
              </p>
            </>
          }
        >
          <RenegotiationForm
            key={selectedItem.workItemId}
            item={selectedItem}
            bare
            onClose={close}
          />
        </Modal>
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
