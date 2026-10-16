import { useQuery } from '@tanstack/react-query'

import { fetchPlanInput, fetchPlanSnapshot } from '@/services/planningService'

/**
 * Las dos lecturas que faltaban para poder leer un plan guardado: el plan releido y la foto de su
 * entrada.
 *
 * Van en el mismo fichero porque son dos mitades de la misma pregunta y comparten clave: quien pide el
 * plan casi siempre quiere su entrada, y separarlas en dos ficheros solo repartiria la misma decision
 * —que no se reintenta— en dos sitios.
 */

/** Clave por plan: cada planId es una lectura distinta, y el mismo plan siempre da lo mismo. */
export const planSnapshotQueryKey = (planId: string) => ['planning', 'plan', planId] as const

/**
 * La foto de la entrada, colgando de la clave del plan.
 *
 * Es una clave hermana y no la misma: una puede llegar y la otra responder `404`, y con una sola clave
 * habria que inventar un estado intermedio que diga cual de las dos falta.
 */
export const planInputQueryKey = (planId: string) => ['planning', 'plan', planId, 'input'] as const

/**
 * Un plan guardado, releido. Sin planId la consulta no se dispara.
 *
 * {@code retry: false} porque un plan inexistente responde `404` y reintentarlo no lo va a crear. Es la
 * misma razon que en el timeline.
 */
export function usePlanSnapshot(planId: string | undefined) {
  return useQuery({
    queryKey: planSnapshotQueryKey(planId ?? ''),
    // El planId ya esta garantizado por `enabled`; TypeScript no puede verlo a traves del cierre.
    queryFn: ({ signal }) => fetchPlanSnapshot(planId as string, signal),
    enabled: Boolean(planId),
    retry: false,
  })
}

/**
 * La foto de la entrada de un plan guardado.
 *
 * **El `404` no se reintenta y no se trata como fallo de red**: significa que ese plan no tiene foto
 * registrada —es anterior a la Fase 8—, y reintentar no la va a producir. Quien consuma este hook
 * tiene que leer `error.status` y distinguir «no consta la entrada» de «no se pudo leer», porque son
 * dos frases distintas y solo una de las dos es cierta.
 */
export function usePlanInput(planId: string | undefined) {
  return useQuery({
    queryKey: planInputQueryKey(planId ?? ''),
    queryFn: ({ signal }) => fetchPlanInput(planId as string, signal),
    enabled: Boolean(planId),
    retry: false,
  })
}
