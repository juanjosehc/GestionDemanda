import { usePlanInput, usePlanSnapshot } from '@/hooks/usePlanResult'
import { useRenegotiations } from '@/hooks/useRenegotiations'
import { useTimeline } from '@/hooks/useTimeline'
import { planOutcome } from '@/lib/planResult'
import type { PlanOutcome } from '@/lib/planResult'
import { ApiError } from '@/services/apiClient'
import type { PlanSnapshotResponse } from '@/types/planning'

/**
 * Las cuatro lecturas de un plan guardado, reducidas a su resultado y a su estado.
 *
 * **Estaba dentro del Calendario y se saca de ahí porque ahora hay dos pantallas que leen lo mismo.**
 * La comparación necesita los dos planes contados con la misma vara, y copiar el bloque sería la
 * segunda definición de «qué produjo este plan»: el día que una de las dos cambiara una lectura, las
 * dos pantallas dirían cosas distintas sobre el mismo plan.
 *
 * **No añade ninguna lectura.** Son las mismas cuatro de siempre —el plan releído, su foto de entrada,
 * la agenda y los acuerdos—, y la comparación no las multiplica por dos: lee las de cada plan con la
 * misma clave de caché, así que abrir la comparación de un plan que ya se miró no pide nada de nuevo.
 *
 * El estado se devuelve como un valor discriminado y no como un puñado de banderas porque **«no
 * existe» y «no se pudo leer» son dos cosas distintas** y hay que poder distinguirlas en el `if`: un
 * identificador mal formado responde `400` y un plan que no existe `404`, y solo el segundo es una
 * ausencia. Con banderas sueltas, la pantalla que se equivocara al combinarlas pintaría un fallo como
 * un hueco del registro.
 */
export type PlanOutcomeState =
  | { status: 'cargando' }
  /** El plan no existe o el identificador está mal formado. `message` es lo que se enseña. */
  | { status: 'sin-plan'; message: string }
  | { status: 'error'; message: string }
  | {
      status: 'listo'
      /** El plan releído, que es lo único que publica los conflictos. */
      snapshot: PlanSnapshotResponse
      outcome: PlanOutcome
      /** La foto de la entrada no consta porque el plan es anterior a la Fase 8. **No es un fallo.** */
      inputMissing: boolean
      /** La foto de la entrada no se pudo leer, y eso sí lo es. */
      inputFailed: boolean
      /** La lectura de acuerdos falló: el resto sigue en pie y se dice. */
      renegotiationsFailed: boolean
    }

/**
 * Lee un plan guardado y lo cuenta.
 *
 * `planId` es opcional porque quien llama suele tenerlo de la ruta y puede ser `undefined` mientras
 * navega: sin él las consultas no se disparan y el estado se queda en `cargando`, que es lo que la
 * pantalla enseña mientras no hay nada que leer.
 */
export function usePlanOutcome(planId: string | undefined): PlanOutcomeState {
  const snapshot = usePlanSnapshot(planId)
  const input = usePlanInput(planId)
  const timeline = useTimeline(planId)
  const renegotiations = useRenegotiations()

  // El 404 de la foto de la entrada **no es un fallo**: los planes anteriores a la Fase 8 no la
  // tienen, y el contrato lo dice —vacío significa que no consta, no que fuera vacía—. Cualquier otro
  // error sí lo es, y por eso se distinguen en vez de tratar los dos como «no hay foto».
  const inputMissing = input.error instanceof ApiError && input.error.status === 404
  const inputFailed = input.isError && !inputMissing

  const data = snapshot.data

  if (snapshot.isPending && !data) {
    return { status: 'cargando' }
  }

  if (!data) {
    return {
      status:
        snapshot.error instanceof ApiError && snapshot.error.status === 404 ? 'sin-plan' : 'error',
      message:
        snapshot.error instanceof Error
          ? snapshot.error.message
          : `No hay un plan guardado con el identificador ${planId}.`,
    }
  }

  return {
    status: 'listo',
    snapshot: data,
    outcome: planOutcome({
      snapshot: data,
      input: input.data ?? null,
      items: timeline.data?.items ?? [],
      capacity: (timeline.data?.resources ?? []).flatMap((resource) => resource.capacity),
      renegotiations: renegotiations.data?.items ?? [],
    }),
    inputMissing,
    inputFailed,
    renegotiationsFailed: renegotiations.isError,
  }
}
