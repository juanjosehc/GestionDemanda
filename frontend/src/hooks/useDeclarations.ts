import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createDeclaration,
  fetchDeclaration,
  fetchDeclarations,
  fetchTeamDeclarations,
  updateDeclaration,
} from '@/services/declarationsService'
import type {
  DeclarationUpdateRequest,
  DeveloperDeclarationsResponse,
  TeamDeclarationsResponse,
} from '@/types/declarations'

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
 * La declaracion de cada persona del equipo: de donde salen su nombre y sus tickets.
 *
 * **Es la unica lectura de la aplicacion que multiplica peticiones, y es a proposito.** El nombre de
 * una persona solo lo publica esta ruta —el backend no expone un catalogo de GLPI, y la fotografia
 * operativa no lleva nombres—, asi que nombrar la tabla entera cuesta una consulta por fila. La
 * alternativa era enriquecer `/metrics` con nombres, y eso ataria la fotografia a GLPI: hoy esa ruta
 * no lo consulta y por eso el tablero sigue en pie cuando GLPI no responde.
 *
 * `useQueries` y no un hook por fila dentro de un bucle: la lista de personas cambia con la
 * fotografia y los hooks no se pueden llamar en un bucle. Ademas deja las respuestas en el orden en
 * que se pidieron, que es lo que permite emparejarlas con los identificadores.
 *
 * `retry: false` como en la pantalla de declaracion y por el mismo motivo: el `404` de un
 * identificador que GLPI no conoce es esperable, y reintentarlo solo retrasa el mensaje. Cada
 * consulta falla sola: un tecnico que GLPI no conozca deja su fila sin nombre sin llevarse las otras.
 */
export function useTeamDeclarations(developerIds: readonly string[]) {
  return useQueries({
    queries: developerIds.map((developerId) => ({
      queryKey: declarationsQueryKey(developerId),
      queryFn: (context) => fetchDeclarations(developerId, context.signal),
      retry: false,
    })),
  })
}

/**
 * Clave de la lectura por lote: una sola entrada para el conjunto de personas que se pregunta.
 *
 * Los identificadores van **ordenados** en la clave aunque la petición viaje en el orden que pidió
 * quien llama. Así dos pantallas que preguntan por el mismo equipo no releen porque lo enumeren en
 * otro orden —el timeline lo hace por el orden de los tramos—. El orden del cuerpo no importa:
 * quien lo consume lo indexa por identificador.
 */
export const teamDeclarationsQueryKey = (developerIds: readonly string[]) =>
  ['planning', 'declarations', 'team', [...developerIds].sort()] as const

/**
 * Las declaraciones de todo el equipo en **una** lectura.
 *
 * **Es la lectura del timeline y existe para quitarle las N peticiones por técnico.** La ruta por
 * persona sigue siendo la correcta donde se pregunta por una persona —la pantalla de declaración— y
 * sigue viva; lo que cambia es que pintar la capa de pendientes del equipo ya no cuesta una petición
 * por fila.
 *
 * **No se usa en las pantallas del padrón entero.** Recursos, Incidentes y Estado del plan preguntan
 * por cuarenta y tantas personas, y el lote las lee en serie contra GLPI —dos lecturas por persona—,
 * así que ahí el navegador sigue lanzando las lecturas por persona en paralelo, que es más rápido.
 * El techo está medido y declarado; el hook por persona se queda para ese caso.
 *
 * `enabled` sin personas: no hay nada que preguntar y el timeline arranca sin recursos.
 * `retry: false` por el mismo motivo que la lectura por persona: los `404` de GLPI no se arreglan
 * reintentando, y los que sí importan ya viajan en `unknownDevelopers` sin tumbar la respuesta.
 */
export function useTeamDeclarationsBatch(developerIds: readonly string[]) {
  return useQuery({
    queryKey: teamDeclarationsQueryKey(developerIds),
    queryFn: ({ signal }) => fetchTeamDeclarations(developerIds, signal),
    enabled: developerIds.length > 0,
    retry: false,
  })
}

/**
 * La respuesta del lote indexada por identificador.
 *
 * Se indexa por el identificador que pidió quien llama —el que el backend devuelve en
 * `developer.id`— y no por posición: un desconocido se cae de `developers`, y emparejar por índice
 * le asignaría a una persona los tickets de la siguiente.
 */
export function declarationsByDeveloper(
  response: TeamDeclarationsResponse | undefined,
): Record<string, DeveloperDeclarationsResponse> {
  const byId: Record<string, DeveloperDeclarationsResponse> = {}

  for (const developer of response?.developers ?? []) {
    byId[developer.developer.id] = developer
  }

  return byId
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

/** Lo que dejo un lote: cuantas se guardaron y cuales fallaron, con el mensaje de su error. */
export interface BatchSaveResult {
  saved: number
  failed: { workItemId: string; message: string }[]
}

/**
 * La escritura de un lote: las declaraciones de una persona, una detras de otra.
 *
 * **Un fallo no cancela el resto.** Son tickets independientes y un `409` en uno —alguien se adelanto
 * desde otra maquina— no debe impedir guardar los otros ocho. Por eso cada entrada se escribe sola y
 * el resultado publica las fallidas con su mensaje, que es lo que la pantalla enseña al lado de la
 * fila. El backend sigue siendo el que valida: aqui no hay una segunda version de sus reglas.
 *
 * **Invalida una vez, al final.** La mutacion por ticket invalida en cada `onSuccess`, y diez
 * declaraciones seguidas serian diez relecturas de la misma lista. Este lote escribe la lista una
 * sola vez y deja el recurso de cada ticket marcado viejo sin releerlo —el formulario ya no esta
 * montado cuando termina—.
 *
 * Secuencial y no en paralelo: el backend serializa las escrituras con el bloqueo de la fila, y
 * lanzarlas juntas solo llenaria la cola sin ganar tiempo.
 */
export function useSaveDeclarations() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (entries: readonly SaveDeclarationInput[]): Promise<BatchSaveResult> => {
      const failed: BatchSaveResult['failed'] = []
      let saved = 0

      for (const { workItemId, create, values } of entries) {
        try {
          await (create
            ? createDeclaration({ workItemId, ...values })
            : updateDeclaration(workItemId, values))
          saved += 1
        } catch (error) {
          failed.push({
            workItemId,
            message: error instanceof Error ? error.message : 'Error desconocido',
          })
        }
      }

      return { saved, failed }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['planning', 'declarations'] })
      void queryClient.invalidateQueries({
        queryKey: ['planning', 'declaration'],
        refetchType: 'none',
      })
    },
  })
}
