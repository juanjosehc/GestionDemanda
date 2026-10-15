import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'

/**
 * Renderiza con el proveedor de consultas y un router en memoria.
 *
 * El QueryClient se crea por prueba, sin reintentos y **sin cache**: cada caso parte de cero y un
 * error se ve como error en vez de esperar una segunda llamada. Ese es el punto de partida de casi
 * todas las pruebas del repositorio y no se toca.
 *
 * `staleTime` y `gcTime` existen para la única prueba que **no puede** correr así: la que demuestra
 * que la declaración recién guardada se ve al volver a la lista. Con la caché en cero cualquier
 * remontaje relee por su cuenta y esa prueba pasaría aunque nadie invalidara nada —probaría que hay
 * una pantalla al final del enlace, que no es lo que hay que probar—. Declarando la política de
 * producción en esa prueba, la relectura solo puede venir de la invalidación.
 */
export function renderWithClient(
  ui: ReactElement,
  options: { route?: string; staleTime?: number; gcTime?: number } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: options.gcTime ?? 0,
        staleTime: options.staleTime ?? 0,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}
