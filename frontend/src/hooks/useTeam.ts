import { useQuery } from '@tanstack/react-query'

import { fetchTeam } from '@/services/teamService'

/**
 * Clave única y sin parámetros: el padrón es uno solo para toda la aplicación, como la fotografía
 * operativa. El grupo lo decide la configuración del backend, no la pantalla.
 */
export const teamQueryKey = ['team'] as const

/**
 * El padrón del equipo.
 *
 * Sin `retry: false`, como la fotografía: aquí no hay un 404 esperable que reintentar no vaya a
 * arreglar. **Que GLPI no responda no es un error de esta consulta** —el backend devuelve el padrón
 * con las excepciones y declara el fallo dentro de la respuesta—, así que un rechazo aquí significa
 * que no se pudo hablar con el backend, y eso sí merece el reintento que ya trae el QueryClient.
 */
export function useTeam() {
  return useQuery({
    queryKey: teamQueryKey,
    queryFn: ({ signal }) => fetchTeam(signal),
  })
}
