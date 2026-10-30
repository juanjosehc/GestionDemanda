import { AlertTriangle, CalendarClock } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeclaration, useSaveDeclaration } from '@/hooks/useDeclarations'
import { formatDeclaredHours, glpiCommitmentOf } from '@/lib/declarations'
import { readFirmante, rememberFirmante } from '@/lib/firmante'
import type { DeclarationItem, DeclarationUpdateRequest, PlanningMetadata } from '@/types/declarations'

/** Estilo de los campos. Es el mismo que usa el selector de filtros, con alto de control. */
const FIELD_CLASS =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

/** Las horas declaradas, como valor inicial de un campo numerico: `6`, nunca `6.0000`. */
function initialHours(declaration: PlanningMetadata | null): string {
  const hours = declaration?.estimatedHours

  return hours == null ? '' : formatDeclaredHours(hours)
}

/**
 * El cuerpo de la escritura: las horas de los campos y la fecha que ya estaba guardada.
 *
 * **La fecha viaja sin tocarse.** Desde la Fase 77 no se declara —el compromiso es el Internal TTR
 * que publica GLPI—, pero el `PUT` reemplaza: mandar `null` borraria el valor que una declaracion
 * anterior dejo escrito y con el se iria su rastro en el historial. Reenviar el que habia conserva
 * el pasado sin volver a pedirlo. En un alta no hay nada que conservar y viaja nulo.
 *
 * Un campo vacio se convierte en nulo y no en cero ni en cadena vacia. Vaciar no es «no lo toques»:
 * es retirar la estimacion, que es una operacion legitima y queda registrada con su autor.
 *
 * Lo unico que se valida aqui es lo que el navegador ya exige —un numero o nada—. La exigencia de
 * declarar algo la comprueba el backend, que es quien la escribio, y su `400` se enseña tal cual en
 * vez de reinterpretarlo con un mensaje propio.
 */
function valuesOf(
  estimatedHours: string,
  committedDate: string | null,
  changedBy: string,
): DeclarationUpdateRequest {
  return {
    estimatedHours: estimatedHours.trim() === '' ? null : Number(estimatedHours),
    committedDate,
    changedBy: changedBy.trim(),
  }
}

/**
 * La fecha con la que GLPI compromete el ticket, de solo lectura.
 *
 * No es un campo deshabilitado sino un dato: no hay nada que rellenar. Ensenarlo en el mismo sitio
 * donde hasta la Fase 77 se pedia la fecha es lo que responde a la pregunta que el formulario deja
 * abierta —«¿y cuando hay que entregarlo?»— sin convertir la respuesta en una segunda fuente.
 */
function GlpiCommitment({ item }: { item: DeclarationItem }) {
  const commitment = glpiCommitmentOf(item)

  return (
    <div
      data-slot="compromiso-glpi"
      className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
    >
      <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="text-xs">
        <span className="font-medium">Compromiso GLPI</span>
        {commitment === null ? (
          <span className="block text-muted-foreground">
            {item.type === 'INCIDENTE'
              ? 'Un incidente no se ubica por una promesa: GLPI no le publica fecha.'
              : 'GLPI no publica fecha para este ticket.'}
          </span>
        ) : (
          <span className="block text-muted-foreground">{commitment}</span>
        )}
      </p>
    </div>
  )
}

interface FieldsProps {
  item: DeclarationItem
  /** Lo declarado hoy, leido justo antes de pintar el formulario. */
  declaration: PlanningMetadata | null
  /**
   * Apila los campos en una columna.
   *
   * En la pantalla caben dos a lo ancho; en el panel lateral de 448 px cada uno quedaria en 200 px,
   * que es suficiente pero deja el bloque de GLPI en una linea que se parte. No es un segundo
   * formulario: es la misma rejilla con otro punto de corte.
   */
  stacked?: boolean
  onClose: () => void
  /** Avisa de que hubo escritura, para que la pantalla ofrezca el resto del ciclo. */
  onSaved?: () => void
}

/**
 * Los campos, ya con su valor inicial.
 *
 * Se monta **despues** de que la lectura haya llegado, y por eso puede tomar el valor inicial en el
 * propio `useState`: no hay que sincronizar nada con un efecto. Cambiar de ticket lo remonta —el
 * padre lo identifica con `key`—, que es lo que devuelve los campos a su sitio sin arrastrar lo que
 * se hubiera escrito para otro.
 */
function Fields({ item, declaration, stacked = false, onClose, onSaved }: FieldsProps) {
  const [estimatedHours, setEstimatedHours] = useState(() => initialHours(declaration))
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
        values: valuesOf(estimatedHours, declaration?.committedDate ?? null, changedBy),
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
      <div className={stacked ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Horas estimadas</span>
          {/* El foco entra donde se empieza a escribir. El formulario se monta cuando alguien pulsa
              Declarar —o cuando llega la lectura previa—, así que no roba el foco de la pantalla al
              cargar: solo cuando está a la vista.
              En un alta es obligatoria porque es lo único que se declara: el backend sigue
              aceptando una fecha suelta por compatibilidad, pero la pantalla ya no la ofrece. */}
          <input
            type="number"
            step="0.01"
            min="0.01"
            max="999999.9999"
            required={create}
            autoFocus
            value={estimatedHours}
            onChange={(event) => setEstimatedHours(event.target.value)}
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

      <GlpiCommitment item={item} />

      <p className="text-xs text-muted-foreground">
        {create
          ? 'La estimación la pone el desarrollo. La fecha de compromiso no se declara aquí: la publica GLPI y es la única que el sistema conoce.'
          : 'La modificación reemplaza las horas declaradas. La fecha de compromiso no se declara aquí: la publica GLPI y es la única que el sistema conoce.'}
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
  /** Una columna en vez de dos: lo pide el panel lateral, donde no caben dos campos. */
  stacked?: boolean
  onClose: () => void
  /** Avisa de que hubo escritura, para que la pantalla ofrezca el resto del ciclo. */
  onSaved?: () => void
}

/**
 * El formulario de declaración de un ticket: las horas estimadas y quién declara.
 *
 * **La fecha no se pide.** Desde la Fase 77 el compromiso es el Internal TTR que publica GLPI y
 * declararlo a mano era la segunda fecha del sistema: se capturaba en este formulario, no coincidia
 * con la del plan y obligaba a reconciliar dos valores. Aqui se enseña, de solo lectura, y no viaja
 * al backend mas que para conservar lo que una declaracion anterior guardo.
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
          {hasDeclaration ? 'Editar la estimación' : 'Declarar la estimación'}
        </CardTitle>
        <CardDescription>
          <span className="font-mono text-xs">{item.workItemId}</span> · {item.title}
          {data && <> · última estimación por {data.estimatedBy ?? 'nadie'}</>}
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
