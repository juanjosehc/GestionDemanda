// Matchers de jest-dom (toBeInTheDocument, toHaveLength...) sobre el expect de Vitest.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library solo se limpia sola si los globales de Vitest estan activos, y aqui no lo
// estan. Sin esto el DOM se acumula entre casos y `screen` encuentra restos del anterior.
afterEach(cleanup)
