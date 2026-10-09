import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
// defineConfig de vitest extiende el de vite, asi que el alias y el proxy viven en un solo sitio.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    // Alias "@/*" -> "src/*". Debe coincidir con tsconfig.app.json (paths).
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // El frontend consume rutas relativas ("/api/..."). En desarrollo se resuelven con este
      // proxy; en produccion las resuelve el reverse proxy. Asi el backend no necesita CORS.
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
