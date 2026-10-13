import { AlertTriangle, ClipboardList, Inbox, Search } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { DeclarationForm } from '@/components/declarations/DeclarationForm'
import { DeclarationTable } from '@/components/declarations/DeclarationTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeclarations } from '@/hooks/useDeclarations'

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
 * El selector de técnico.
 *
 * Es un campo de texto y no una lista porque **el backend no publica un catálogo de técnicos**: la
 * ruta pide un identificador y responde por él. Ofrecer un desplegable obligaría a inventarse la
 * lista, y un identificador que no existe en GLPI no es «no tiene trabajo» —el backend responde
 * `404` justamente para no confundir las dos cosas—.
 *
 * La consulta se dispara al enviar y no al teclear: escribir «296» no debe pedir los tickets de «2»
 * ni los de «29».
 */
function DeveloperPicker({
  value,
  onChange,
  onSubmit,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor="tecnico" className="text-xs text-muted-foreground">
        Técnico
      </label>
      <input
        id="tecnico"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Identificador en GLPI, p. ej. 296"
        className="h-8 w-56 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
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
 * Leer no escribe: abrir la pantalla, cambiar de técnico y ordenar no guardan nada.
 */
export function Declarations() {
  const [draft, setDraft] = useState('')
  const [developerId, setDeveloperId] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useDeclarations(developerId)
  const loading = developerId !== '' && isPending && !data

  // El ticket abierto se busca en la respuesta y no se guarda copiado: así, cuando la lista se
  // refresca tras guardar, el formulario ve la fila nueva y no una foto vieja de sí misma.
  const selectedItem = data?.items.find((item) => item.workItemId === selected) ?? null

  /** Consultar cierra el formulario abierto: los tickets que van a llegar son otros. */
  function consult() {
    setSelected(null)
    setDeveloperId(draft.trim())
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Los tickets que GLPI tiene asignados a un técnico, con lo que le falta a cada uno para poder
        planificarse. El estado y los motivos los decide el backend —el mismo que decide qué entra al
        plan—: esta pantalla no reclasifica nada. Lo que sí se escribe aquí es la estimación y la
        fecha compromiso, que son las dos cosas que GLPI no guarda.
      </p>

      <DeveloperPicker value={draft} onChange={setDraft} onSubmit={consult} />

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
          detail="Escribe su identificador en GLPI y consulta. No hay una lista de técnicos que ofrecer: el backend no publica ese catálogo, y un identificador que no existe responde 404 en vez de una lista vacía, porque un identificador equivocado no es «no tiene trabajo»."
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
            {data.items.length} {data.items.length === 1 ? 'ticket asignado' : 'tickets asignados'} a{' '}
            <span className="font-medium">{data.developer.name ?? data.developer.id}</span> (
            <span className="font-mono">{data.developer.id}</span>), en el orden en que los devolvió
            GLPI.
          </p>

          {selectedItem && (
            <DeclarationForm item={selectedItem} onClose={() => setSelected(null)} />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tickets asignados
              </CardTitle>
              <CardDescription>
                Una fila por ticket. La columna de estado de declaración es la clasificación del
                backend —con el código de la regla aplicada y su motivo—, no una cuenta que haga la
                tabla. La prioridad es la cruda de GLPI, en su escala 1..5: normalizarla es del motor y
                todavía no ha ocurrido.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <DeclarationTable
                items={data.items}
                selected={selected}
                onSelect={setSelected}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
