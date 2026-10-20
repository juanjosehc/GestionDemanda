import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useRenegotiation, useSaveRenegotiation } from '@/hooks/useRenegotiations'
import { formatInstant } from '@/lib/format'
import { STATUS_VARIANTS } from '@/lib/renegotiations'
import { formatDay } from '@/lib/timeline'
import type { Renegotiation, RenegotiationItem, RenegotiationUpdateRequest } from '@/types/renegotiations'

/** Estilo de los dos campos. Es el mismo que usa el formulario de declaracion, con alto de control. */
const FIELD_CLASS =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

/**
 * El cuerpo de la escritura, armado con lo que hay en los tres campos.
 *
 * Los tres valores son obligatorios en el contrato, asi que no hay campo que pueda ir nulo ni medio
 * cuerpo que enviar. Lo unico que se recorta es el espacio de los extremos.
 *
 * No se valida nada mas aqui: que la fecha sea futura, pasada o cualquiera no lo decide la vista.
 * El backend acepta hoy una fecha ya vencida a proposito —es una decision de negocio que todavia no
 * se ha tomado— y escribir esa regla en el formulario la inventaria.
 */
function valuesOf(
  agreedDate: string,
  agreedBy: string,
  agreedReason: string,
): RenegotiationUpdateRequest {
  return {
    agreedDate: agreedDate.trim(),
    agreedBy: agreedBy.trim(),
    agreedReason: agreedReason.trim(),
  }
}

interface FieldsProps {
  item: RenegotiationItem
  /** El acuerdo vigente, leido justo antes de pintar el formulario. Nulo si no habia ninguno. */
  agreement: Renegotiation | null
  onClose: () => void
}

/**
 * Los tres campos, ya con su valor inicial, y la trazabilidad de lo que se esta renegociando.
 *
 * Se monta **despues** de que la lectura haya llegado, y por eso puede tomar el valor inicial en el
 * propio `useState`. Cambiar de requerimiento lo remonta —el padre lo identifica con `key`—, que es
 * lo que devuelve los campos a su sitio sin arrastrar lo que se hubiera escrito para otro.
 *
 * **La fecha y el motivo se precargan y el nombre no.** Los dos primeros son el contenido del acuerdo
 * que el `PUT` reemplaza, y verlos antes de escribir es lo que evita cambiarlos sin querer —o
 * borrarlos por omision, que es lo que pasaria si el motivo no se precargara—; el nombre es quien
 * acuerda ahora, y precargarlo con el anterior afirmaria que es la misma persona la que vuelve a
 * firmar.
 */
function Fields({ item, agreement, onClose }: FieldsProps) {
  const [agreedDate, setAgreedDate] = useState(() => agreement?.agreedDate ?? '')
  const [agreedBy, setAgreedBy] = useState('')
  const [agreedReason, setAgreedReason] = useState(() => agreement?.agreedReason ?? '')

  const save = useSaveRenegotiation()
  const create = agreement === null

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate(
      { workItemId: item.workItemId, create, values: valuesOf(agreedDate, agreedBy, agreedReason) },
      // Se cierra al guardar: lo que el usuario tiene que ver despues es la fila ya refrescada y el
      // historial con el cambio recien registrado.
      { onSuccess: onClose },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        <div className="flex items-baseline gap-2">
          <dt className="text-muted-foreground">Estado actual</dt>
          <dd>
            {/* El estado que publico el backend. La vista no lo deduce ni lo corrige. */}
            <Badge variant={STATUS_VARIANTS[item.status]}>{item.status}</Badge>
          </dd>
        </div>

        <div className="flex items-baseline gap-2">
          <dt className="text-muted-foreground">
            {create ? 'Acuerdo vigente' : 'Fecha anterior'}
          </dt>
          <dd data-slot="previous-date">
            {agreement ? formatDay(agreement.agreedDate) : 'sin acuerdo registrado'}
          </dd>
        </div>

        {agreement && (
          <div className="flex items-baseline gap-2 sm:col-span-2">
            <dt className="text-muted-foreground">Registrado</dt>
            <dd>
              por {agreement.agreedBy} el{' '}
              <time dateTime={agreement.agreedAt}>{formatInstant(agreement.agreedAt)}</time> ·
              origen <span className="font-mono">{agreement.source}</span>
            </dd>
          </div>
        )}
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Nueva fecha acordada</span>
          {/* El foco entra donde se empieza a escribir. El formulario solo se monta cuando la fila
              abre el diálogo —o cuando llega la lectura previa—, así que no roba el foco al cargar. */}
          <input
            type="date"
            required
            autoFocus
            value={agreedDate}
            onChange={(event) => setAgreedDate(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Quién acuerda</span>
          <input
            type="text"
            required
            maxLength={64}
            value={agreedBy}
            onChange={(event) => setAgreedBy(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      </div>

      {/*
        El motivo del acuerdo. Va a lo ancho y en un area de texto porque no es una etiqueta: es una
        explicacion, y el contrato admite hasta 500 caracteres.

        **No se confunde con el motivo de abajo, y por eso las dos etiquetas dicen quien lo redacta.**
        Este lo escribe quien firma —es la unica pieza del acuerdo que ningun dato puede deducir—; el
        de la lista lo publica el plan desde la regla que aplico, y es de solo lectura. Son dos hechos
        distintos: uno explica por que se movio el requerimiento, este explica por que se llego a esa
        fecha.
      */}
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Por qué se acuerda esta fecha</span>
        <textarea
          required
          rows={2}
          maxLength={500}
          value={agreedReason}
          onChange={(event) => setAgreedReason(event.target.value)}
          className={`${FIELD_CLASS} h-auto py-2`}
        />
      </label>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Por qué se desplazó (lo publica el plan)</p>
        <ul className="space-y-1">
          {item.events.map((event) => (
            <li
              key={`${event.timestamp}-${event.incidentId}-${event.originalDate}`}
              data-slot="renegotiation-reason"
              className="border-l-2 border-amber-400 pl-3 text-xs"
            >
              <p className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">
                  {formatDay(event.originalDate)} → {formatDay(event.rescheduledDate)}
                </span>
                <span className="font-mono text-muted-foreground">{event.incidentId}</span>
                <span className="font-mono text-muted-foreground">{event.appliedRule}</span>
              </p>
              {/* El motivo lo redacta el backend desde la regla aplicada; aqui no se re-deriva. */}
              <p className="mt-0.5">{event.reason}</p>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        {create
          ? 'El acuerdo aporta lo que nadie más puede saber: a qué fecha se llegó, quién lo acordó y por qué. El incidente y la fecha original no se envían: el plan ya los auditó.'
          : 'El reemplazo es total: lo que venga es la fecha vigente y el motivo vigente. El sello de registro lo pone el servidor, así que no viaja en el cuerpo.'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
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

interface RenegotiationFormProps {
  item: RenegotiationItem
  /**
   * Sin la tarjeta ni su cabecera, para el modal.
   *
   * El diálogo ya trae el título y el ticket en su propia cabecera; repetirlos dentro sería dos
   * veces la misma frase a dos centímetros. No es otro formulario: es el mismo cuerpo sin el marco.
   */
  bare?: boolean
  onClose: () => void
}

/**
 * El formulario del acuerdo: la fecha nueva, quien la firma y por que.
 *
 * **Lee antes de escribir.** Cuando el requerimiento ya tiene acuerdo, el formulario no se rellena
 * con lo que traia la lista sino con una lectura fresca del recurso. El `PUT` reemplaza lo que no
 * venga en el cuerpo, asi que rellenar con un dato de hace un minuto y guardar borraria lo que
 * alguien cambio en ese minuto. Mientras la lectura no llega no se enseña ningun campo: no hay un
 * estado intermedio en el que se pueda escribir encima de valores que todavia no se conocen.
 *
 * **El verbo lo decide la existencia del acuerdo y no el estado de la fila.** Son dos hechos
 * distintos: un requerimiento que se movio despues de haberse acordado esta en PENDIENTE_DE_ACUERDO
 * —hay que volver a acordar— y a la vez tiene un acuerdo que reemplazar. Decidirlo por el estado
 * mandaria un `POST` contra un recurso que ya existe, que es un `409` garantizado.
 *
 * Sin acuerdo no hay nada que leer y no se pide nada: la creacion es un `POST`, y el `409` es la
 * respuesta correcta si alguien se adelanto.
 */
export function RenegotiationForm({ item, bare = false, onClose }: RenegotiationFormProps) {
  const hasAgreement = item.renegotiation !== null
  const { data, isPending, isError, error, refetch } = useRenegotiation(
    item.workItemId,
    hasAgreement,
  )

  const loading = hasAgreement && isPending && !data

  const body = loading ? (
    <Skeleton className="h-40 w-full" />
  ) : isError ? (
    // El 404 del backend, con su mensaje. Ocurre cuando la fila traia un acuerdo que ya no
    // esta: alguien lo cambio entre la lectura de la lista y esta. No se cae al `POST` por
    // cuenta propia —eso crearia un acuerdo que la fila decia que ya existia—: se enseña lo
    // que respondio el servidor y se ofrece reintentar.
    <EmptyState
      tone="danger"
      icon={AlertTriangle}
      title="No fue posible leer el acuerdo"
      detail={error instanceof Error ? error.message : 'Error desconocido'}
      action={
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Reintentar
        </Button>
      }
    />
  ) : (
    <Fields key={item.workItemId} item={item} agreement={data ?? null} onClose={onClose} />
  )

  if (bare) {
    return body
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          {hasAgreement ? 'Reemplazar la fecha acordada' : 'Registrar el acuerdo'}
        </CardTitle>
        <CardDescription>
          <span className="font-mono text-xs">{item.workItemId}</span> · {item.developerId}
          {data && (
            <>
              {' '}
              · acordado por {data.agreedBy} el {formatInstant(data.agreedAt)}
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent>{body}</CardContent>
    </Card>
  )
}
