import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeclaration, useSaveDeclaration } from '@/hooks/useDeclarations'
import { formatDeclaredHours } from '@/lib/declarations'
import { readFirmante, rememberFirmante } from '@/lib/firmante'
import type { DeclarationItem, DeclarationUpdateRequest, PlanningMetadata } from '@/types/declarations'

/** Estilo de los tres campos. Es el mismo que usa el selector de filtros, con alto de control. */
const FIELD_CLASS =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

/** Las horas declaradas, como valor inicial de un campo numerico: `6`, nunca `6.0000`. */
function initialHours(declaration: PlanningMetadata | null): string {
  const hours = declaration?.estimatedHours

  return hours == null ? '' : formatDeclaredHours(hours)
}

/**
 * El cuerpo de la escritura, armado con lo que hay en los tres campos.
 *
 * **Los dos valores viajan siempre**, con nulo para decir «retiralo»: el `PUT` reemplaza, asi que un
 * cuerpo con solo la fecha borraria las horas. El formulario no puede enviar medio cuerpo porque este
 * objeto no tiene forma de expresarlo.
 *
 * Un campo vacio se convierte en nulo y no en cero ni en cadena vacia. Vaciar no es «no lo toques»:
 * es retirar el valor, que es una operacion legitima y queda registrada con su autor.
 *
 * Lo unico que se valida aqui es lo que el navegador ya exige —un numero o nada—. Los limites y la
 * exigencia de declarar algo los comprueba el backend, que es quien los escribio, y su `400` se
 * enseña tal cual en vez de reinterpretarlo con un mensaje propio.
 */
function valuesOf(
  estimatedHours: string,
  committedDate: string,
  changedBy: string,
): DeclarationUpdateRequest {
  return {
    estimatedHours: estimatedHours.trim() === '' ? null : Number(estimatedHours),
    committedDate: committedDate.trim() === '' ? null : committedDate,
    changedBy: changedBy.trim(),
  }
}

interface FieldsProps {
  item: DeclarationItem
  /** Lo declarado hoy, leido justo antes de pintar el formulario. */
  declaration: PlanningMetadata | null
  /**
   * Apila los tres campos en una columna.
   *
   * En la pantalla caben tres a lo ancho; en el panel lateral de 448 px cada uno quedaria en 111 px
   * y la fecha se corta. No es un segundo formulario: es la misma rejilla con otro punto de corte.
   */
  stacked?: boolean
  onClose: () => void
  /** Avisa de que hubo escritura, para que la pantalla ofrezca el resto del ciclo. */
  onSaved?: () => void
}

/**
 * Los tres campos, ya con su valor inicial.
 *
 * Se monta **despues** de que la lectura haya llegado, y por eso puede tomar el valor inicial en el
 * propio `useState`: no hay que sincronizar nada con un efecto. Cambiar de ticket lo remonta —el
 * padre lo identifica con `key`—, que es lo que devuelve los campos a su sitio sin arrastrar lo que
 * se hubiera escrito para otro.
 */
function Fields({ item, declaration, stacked = false, onClose, onSaved }: FieldsProps) {
  const [estimatedHours, setEstimatedHours] = useState(() => initialHours(declaration))
  const [committedDate, setCommittedDate] = useState(() => declaration?.committedDate ?? '')
  // El firmante se recuerda entre formularios: es la misma persona la que opera la pantalla, y
  // teclearlo en cada ticket era la friccion que el lote tambien quita.
  const [changedBy, setChangedBy] = useState(() => readFirmante())

  const save = useSaveDeclaration()
  const create = item.declaration === null

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate(
      {
        workItemId: item.workItemId,
        create,
        values: valuesOf(estimatedHours, committedDate, changedBy),
      },
      // Se cierra al guardar: lo que el usuario tiene que ver despues es la fila ya refrescada.
      {
        onSuccess: () => {
          rememberFirmante(changedBy)
          onSaved?.()
          onClose()
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className={stacked ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-3'}>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Horas estimadas</span>
          {/* El foco entra donde se empieza a escribir. El formulario se monta cuando alguien pulsa
              Declarar —o cuando llega la lectura previa—, así que no roba el foco de la pantalla al
              cargar: solo cuando está a la vista. */}
          <input
            type="number"
            step="0.01"
            min="0.01"
            max="999999.9999"
            autoFocus
            value={estimatedHours}
            onChange={(event) => setEstimatedHours(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Fecha compromiso</span>
          <input
            type="date"
            value={committedDate}
            onChange={(event) => setCommittedDate(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Quién declara</span>
          <input
            type="text"
            required
            maxLength={64}
            value={changedBy}
            onChange={(event) => setChangedBy(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        {create
          ? 'La estimación la pone el desarrollo y la fecha se acuerda con quien pide el trabajo. Hay que declarar al menos una de las dos: una estimación sin fecha no es media planificación, y el motor necesita las dos.'
          : 'La modificación reemplaza lo declarado, así que se envían siempre los dos valores. Vaciar un campo lo retira; dejar el otro quieto exige reenviarlo, y es lo que este formulario hace.'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/* Una sola etiqueta para los dos verbos. La accion de la fila ya distingue «Declarar» de
            «Editar»; el botón del formulario guarda lo que haya en los campos, y con dos etiquetas
            distintas habría dos botones llamados «Declarar» en la misma pantalla. */}
        <Button type="submit" size="sm" disabled={save.isPending}>
          Guardar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>

        {/* El error del backend, con sus palabras. Un 400, un 404 y un 409 dicen cosas distintas y
            reescribirlos aquí sustituiría el diagnóstico por uno peor. */}
        {save.isError && (
          <p role="alert" className="text-xs text-red-600">
            {save.error.message}
          </p>
        )}
      </div>
    </form>
  )
}

interface DeclarationFormProps {
  item: DeclarationItem
  /** Una columna en vez de tres: lo pide el panel lateral, donde no caben tres campos. */
  stacked?: boolean
  onClose: () => void
  /** Avisa de que hubo escritura, para que la pantalla ofrezca el resto del ciclo. */
  onSaved?: () => void
}

/**
 * El formulario de declaración de un ticket: estimación, compromiso y quién declara.
 *
 * **Lee antes de escribir.** Cuando el ticket ya tiene declaración, el formulario no se rellena con
 * lo que traía la lista sino con una lectura fresca del recurso. El `PUT` reemplaza lo que no venga
 * en el cuerpo, así que rellenar con un dato de hace un minuto y guardar borraría lo que alguien
 * cambió en ese minuto. Mientras la lectura no llega no se enseña ningún campo: no hay un estado
 * intermedio en el que se pueda escribir encima de valores que todavía no se conocen.
 *
 * Sin fila no hay nada que leer y no se pide nada: la creación es un `POST` y el `409` es la
 * respuesta correcta si alguien se adelantó.
 */
export function DeclarationForm({ item, stacked, onClose, onSaved }: DeclarationFormProps) {
  const hasDeclaration = item.declaration !== null
  const { data, isPending, isError, error, refetch } = useDeclaration(
    item.workItemId,
    hasDeclaration,
  )

  const loading = hasDeclaration && isPending && !data

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          {hasDeclaration ? 'Editar la planificación declarada' : 'Declarar la planificación'}
        </CardTitle>
        <CardDescription>
          <span className="font-mono text-xs">{item.workItemId}</span> · {item.title}
          {data && (
            <>
              {' '}
              · último cambio: estimación por {data.estimatedBy ?? 'nadie'}, compromiso por{' '}
              {data.committedBy ?? 'nadie'}
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <EmptyState
            tone="danger"
            icon={AlertTriangle}
            title="No fue posible leer la planificación declarada"
            detail={error instanceof Error ? error.message : 'Error desconocido'}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Reintentar
              </Button>
            }
          />
        ) : (
          <Fields
            key={item.workItemId}
            item={item}
            declaration={data ?? null}
            stacked={stacked}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </CardContent>
    </Card>
  )
}
