import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import { AppRoutes } from '@/routes/AppRoutes'

/**
 * Politica de cache por defecto.
 *
 * Los datos de planificacion cambian poco; se evita revalidar al recuperar el foco para
 * no generar trafico innecesario contra GLPI.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
