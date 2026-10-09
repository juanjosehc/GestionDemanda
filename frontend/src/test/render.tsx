import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'

/**
 * Renderiza con el proveedor de consultas y un router en memoria.
 *
 * El QueryClient se crea por prueba, sin reintentos y sin cache: cada caso parte de cero y un
 * error se ve como error en vez de esperar una segunda llamada.
 */
export function renderWithClient(ui: ReactElement, options: { route?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}
