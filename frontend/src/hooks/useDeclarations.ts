import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createDeclaration,
  fetchDeclaration,
  fetchDeclarations,
  updateDeclaration,
} from '@/services/declarationsService'
import type { DeclarationUpdateRequest } from '@/types/declarations'

/**
 * Clave de la lista de declaraciones de un tecnico: una por tecnico, porque el listado si es de uno.
 */
export const declarationsQueryKey = (developerId: string) =>
  ['planning', 'declarations', developerId] as const

/**
 * Clave de la planificacion declarada de un ticket.
 *
 * Va bajo otro prefijo que la lista y no debajo de ella: son dos lecturas distintas —una de todos
 * los tickets de una persona y otra de un ticket— y compartir prefijo haria que invalidar una
 * arrastrara la otra sin querer.
 */
export const declarationQueryKey = (workItemId: string) =>
  ['planning', 'declaration', workItemId] as const

/**
 * Los tickets de un tecnico con su estado de declaracion.
 *
 * `enabled` mientras no se haya elegido tecnico: la pantalla arranca sin consultar nada, porque no
 * hay un listado de tecnicos que ofrecer —el backend no publica ese catalogo— y preguntar por uno
 * inventado seria afirmar que existe.
 *
 * `retry: false` como en el desglose de una metrica y por el mismo motivo: aqui **si hay un 404
 * esperable** —un identificador que no esta en GLPI— y reintentarlo no lo arregla, solo retrasa el
 * mensaje que hay que leer.
 */
export function useDeclarations(developerId: string) {
  return useQuery({
    queryKey: declarationsQueryKey(developerId),
    queryFn: ({ signal }) => fetchDeclarations(developerId, signal),
    enabled: developerId !== '',
    retry: false,
  })
}

/**
 * La planificacion declarada de un ticket, para rellenar el formulario antes de escribirla.
 *
 * Solo se pide cuando el formulario esta abierto **y** el ticket ya tiene declaracion: sin fila no
 * hay nada que leer, y la creacion no necesita este paso.
 */
export function useDeclaration(workItemId: string, enabled: boolean) {
  return useQuery({
    queryKey: declarationQueryKey(workItemId),
    queryFn: ({ signal }) => fetchDeclaration(workItemId, signal),
    enabled,
    retry: false,
  })
}

/** Lo que hay que guardar, y si es la primera declaracion del ticket o un reemplazo. */
export interface SaveDeclarationInput {
  workItemId: string
  /** true cuando el ticket no tenia declaracion: se crea, y un `409` es la respuesta correcta. */
  create: boolean
  values: DeclarationUpdateRequest
}

/**
 * La unica escritura de la pantalla: crear o reemplazar la declaracion de un ticket.
 *
 * **El verbo lo decide la existencia de la fila, no el estado de declaracion.** Un ticket con los
 * dos valores retirados se clasifica `SIN_DECLARACION` pero tiene fila, asi que se reemplaza; si se
 * decidiera por el estado, ese caso recibiria un `409` por intentar crear lo que ya existe.
 *
 * Al terminar invalida **las dos lecturas afectadas y solo esas**: la lista del tecnico, que es la
 * que cambia de estado en pantalla, y el recurso del ticket, que acaba de quedar con otros valores.
 * El resto de la aplicacion no se toca: la fotografia operativa, las alertas y el timeline miden
 * otras cosas, y recargar la pagina entera para refrescar una fila seria tirar lo que ya estaba
 * bien.
 *
 * Las dos se invalidan de forma distinta, y la diferencia importa:
 *
 * - La **lista** se relee en el acto. Es lo que el usuario tiene que ver cambiar, y no hay otra
 *   peticion que lo traiga.
 * - El **recurso del ticket** solo se marca viejo, sin releerlo. En el momento de invalidar el
 *   formulario todavia esta montado —se cierra justo despues, en el `onSuccess` de la llamada—, asi
 *   que un reenvio inmediato pediria unos valores que son exactamente los que se acaban de guardar.
 *   Marcarlo viejo basta: la proxima vez que se abra el formulario, la lectura se rehace y nadie
 *   escribe encima de un dato rancio.
 */
export function useSaveDeclaration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ workItemId, create, values }: SaveDeclarationInput) =>
      create
        ? createDeclaration({ workItemId, ...values })
        : updateDeclaration(workItemId, values),

    onSuccess: (_saved, { workItemId }) => {
      void queryClient.invalidateQueries({ queryKey: ['planning', 'declarations'] })
      void queryClient.invalidateQueries({
        queryKey: declarationQueryKey(workItemId),
        refetchType: 'none',
      })
    },
  })
}
