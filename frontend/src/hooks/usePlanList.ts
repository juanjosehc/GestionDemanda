import { useQuery } from '@tanstack/react-query'

import { fetchDeveloperPlans } from '@/services/planningService'

/**
 * Los planes guardados de un tecnico, del mas antiguo al mas reciente.
 *
 * Es la unica lectura que permite nombrar «el plan anterior» de alguien: las metricas publican el
 * vigente de cada tecnico y descartan el resto, asi que sin esta lista la comparacion no tendria con
 * que comparar.
 *
 * Vive en su propio fichero y no junto a `usePlanResult` porque no comparte clave con el plan: aquella
 * es de un plan concreto y esta es del historial de un tecnico.
 */

/** Clave por tecnico: el historial de uno no es el de otro. */
export const developerPlansQueryKey = (developerId: string) =>
  ['planning', 'plans', developerId] as const

/**
 * Sin identificador la consulta no se dispara.
 *
 * {@code retry: false} porque la respuesta a un tecnico sin planes es `200` con la lista vacia, no un
 * error: lo unico que se reintentaria es un fallo de red real. Y **no se reintenta el `400`** de un
 * identificador mal formado, que no se arregla insistiendo.
 */
export function usePlanList(developerId: string | undefined) {
  return useQuery({
    queryKey: developerPlansQueryKey(developerId ?? ''),
    // El identificador ya esta garantizado por `enabled`; TypeScript no puede verlo a traves del cierre.
    queryFn: ({ signal }) => fetchDeveloperPlans(developerId as string, signal),
    enabled: Boolean(developerId),
    retry: false,
  })
}
