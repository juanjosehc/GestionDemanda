import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createRenegotiation,
  fetchRenegotiation,
  fetchRenegotiationHistory,
  fetchRenegotiations,
  updateRenegotiation,
} from '@/services/renegotiationsService'
import type { RenegotiationUpdateRequest } from '@/types/renegotiations'

/**
 * Las tres claves, bajo el mismo prefijo y con distinto segundo segmento.
 *
 * La separacion es deliberada, igual que en la declaracion: invalidar la lista no arrastra el
 * detalle ni el historial de cada fila, y escribir en un requerimiento no obliga a releer los otros.
 * Con una sola clave padre habria que elegir entre refrescar de mas o de menos.
 */
export const renegotiationsQueryKey = ['renegotiations', 'list'] as const

export const renegotiationQueryKey = (workItemId: string) =>
  ['renegotiations', 'detail', workItemId] as const

export const renegotiationHistoryQueryKey = (workItemId: string) =>
  ['renegotiations', 'history', workItemId] as const

/**
 * La lista consolidada: una sola peticion para toda la pantalla.
 *
 * Sin `retry: false`, como la fotografia operativa y por el mismo motivo: aqui no hay un `404`
 * esperable que reintentar no vaya a arreglar, y un fallo de red si merece el reintento que ya trae
 * el QueryClient.
 */
export function useRenegotiations() {
  return useQuery({
    queryKey: renegotiationsQueryKey,
    queryFn: ({ signal }) => fetchRenegotiations(signal),
  })
}

/**
 * El acuerdo de un requerimiento, para reemplazarlo.
 *
 * `enabled` lo decide el llamante a partir de un hecho que publico el backend —si la fila trae
 * acuerdo—, no de un estado que la vista haya deducido. Sin acuerdo no hay nada que leer y no se
 * pide nada: la creacion es un `POST` y el `409` es la respuesta correcta si alguien se adelanto.
 *
 * `retry: false` porque el `404` de esta ruta es esperable y no mejora reintentando: describe una
 * carrera con otra persona, y reintentar la escondería.
 */
export function useRenegotiation(workItemId: string, enabled: boolean) {
  return useQuery({
    queryKey: renegotiationQueryKey(workItemId),
    queryFn: ({ signal }) => fetchRenegotiation(workItemId, signal),
    enabled,
    retry: false,
  })
}

/** El historial de un requerimiento. Solo existe si alguien registro un acuerdo alguna vez. */
export function useRenegotiationHistory(workItemId: string, enabled: boolean) {
  return useQuery({
    queryKey: renegotiationHistoryQueryKey(workItemId),
    queryFn: ({ signal }) => fetchRenegotiationHistory(workItemId, signal),
    enabled,
    retry: false,
  })
}

export interface SaveRenegotiationInput {
  workItemId: string
  /**
   * El verbo de la escritura.
   *
   * **Lo decide la existencia del acuerdo, nunca el estado que se pinta.** Un requerimiento con
   * `status: PENDIENTE_DE_ACUERDO` y un acuerdo anterior vigente se edita con `PUT`, porque el
   * recurso existe; y uno sin acuerdo se crea con `POST` aunque su estado se lea igual. Decidirlo por
   * el estado visual mandaria un `POST` contra un recurso que ya existe —un `409` garantizado— cada
   * vez que un requerimiento se moviera despues de haberse acordado.
   */
  create: boolean
  values: RenegotiationUpdateRequest
}

/**
 * La escritura: `POST` si no habia acuerdo, `PUT` si lo habia.
 *
 * Al guardar se invalida **solo** lo que la escritura puede haber cambiado: la lista consolidada —de
 * donde sale el estado de la fila, que el backend recalcula al leer—, el detalle del requerimiento
 * afectado y su historial. Nada mas: ni las otras filas, ni las alertas, ni la fotografia operativa,
 * que no dependen de un acuerdo. Tampoco se recarga la pagina: el estado de la aplicacion no se toca
 * y no se usa `window.location` para refrescar nada.
 *
 * La regla es **invalidar lo que sigue a la vista**. El historial sigue en pantalla despues de
 * guardar, asi que se relee y el cambio recien registrado aparece en su sitio. El detalle no: el
 * formulario se cierra al guardar, y volver a pedir un recurso que nadie va a mirar seria una
 * peticion de mas —se marca obsoleto, y la proxima vez que se abra el formulario se lee fresco—.
 */
export function useSaveRenegotiation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ workItemId, create, values }: SaveRenegotiationInput) =>
      create
        ? createRenegotiation({ workItemId, ...values })
        : updateRenegotiation(workItemId, values),

    onSuccess: (_saved, { workItemId }) => {
      void queryClient.invalidateQueries({ queryKey: renegotiationsQueryKey })
      void queryClient.invalidateQueries({
        queryKey: renegotiationHistoryQueryKey(workItemId),
      })
      void queryClient.invalidateQueries({
        queryKey: renegotiationQueryKey(workItemId),
        refetchType: 'none',
      })
    },
  })
}
