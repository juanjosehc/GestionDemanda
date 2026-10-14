import { useMutation, useQueryClient } from '@tanstack/react-query'

import { alertsQueryKey } from '@/hooks/useAlerts'
import { planningMetricsQueryKey } from '@/hooks/usePlanningMetrics'
import { renegotiationsQueryKey } from '@/hooks/useRenegotiations'
import { generatePlan } from '@/services/planningService'

/**
 * La generacion de un plan: una mutacion, porque escribe.
 *
 * No es una consulta y no se puede modelar como tal: cada llamada crea un plan y sube el contador de
 * ejecuciones, asi que no hay una respuesta que se pueda cachear ni repetir sola. La mutacion la
 * dispara una persona y su resultado se enseña de la respuesta, sin volver a pedir nada.
 *
 * **Que se refresca al terminar, y por que.**
 *
 * - `['planning','metrics']`: la fotografia operativa. `current.byDeveloper` es el plan **vigente** de
 *   cada tecnico y `plans.generated` cuenta ejecuciones, y las dos cosas cambian con un plan nuevo. No
 *   hay una cuarta clave que invalidar por el equipo: `/recursos` no tiene consulta propia, lee esta
 *   misma —el mismo `usePlanningMetrics`, con la misma clave—, asi que se refresca por aqui. Los dos
 *   desgloses que cuelgan del prefijo, `['planning','metrics','displaced']` y
 *   `['planning','metrics','declared',gap]`, caen con el.
 *
 * - `['planning','alerts']`: las alertas son una proyeccion de esa fotografia, pero son **otra
 *   consulta con otra clave**. Un plan nuevo puede encender una condicion de capacidad o apagar la que
 *   habia, y dejarlas sin refrescar enseñaria un centro de alertas que contradice al tablero que se
 *   acaba de releer.
 *
 * - `['renegotiations','list']`: la lectura consolidada se arma sobre el plan vigente de cada tecnico,
 *   y el estado de cada fila lo recalcula el backend al leer. Un plan nuevo puede traer desplazamientos
 *   que no existian —y con ellos filas nuevas— o resolver los que habia. **Solo la lista**: un acuerdo
 *   ya registrado y el historial de un requerimiento son filas propias que un plan nuevo no toca, y
 *   volver a pedirlas seria trabajo de mas.
 *
 * **Que no se refresca, y por que.** El timeline, porque cada plan tiene su propio `planId`: el que se
 * acaba de crear no tiene entrada en cache que refrescar —nadie lo ha abierto todavia— y el anterior
 * sigue siendo la lectura correcta de *su* plan, no una version vieja de este. Y la salud de GLPI, que
 * es un diagnostico de conectividad y no un dato de negocio: que un plan se haya podido calcular no la
 * invalida.
 *
 * El refresco va en segundo plano y la pantalla no lo espera: el resultado que hay que ver —el plan
 * recien generado— ya viaja en la respuesta de la mutacion.
 */
export function usePlanGeneration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: generatePlan,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: planningMetricsQueryKey })
      void queryClient.invalidateQueries({ queryKey: alertsQueryKey })
      void queryClient.invalidateQueries({ queryKey: renegotiationsQueryKey })
    },
  })
}
