import { useState } from 'react'
import { Outlet } from 'react-router-dom'

import { Header } from '@/layouts/Header'
import { Sidebar } from '@/layouts/Sidebar'

/**
 * Estructura de la aplicacion: barra lateral + encabezado + area de contenido.
 *
 * Se usa una altura fija de viewport con scroll interno del contenido, de modo que el
 * encabezado y la barra lateral permanezcan visibles. En pantallas pequenas la barra
 * lateral pasa a ser un panel deslizante con fondo oscurecido.
 */
export function MainLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const toggleSidebar = () => {
    // Un unico boton controla ambos comportamientos segun el tamano de pantalla.
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setCollapsed((value) => !value)
    } else {
      setMobileOpen((value) => !value)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
      />

      {mobileOpen && (
        <button
          type="button"
          aria-label="Cerrar menú lateral"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 cursor-default bg-black/40 lg:hidden"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onToggleSidebar={toggleSidebar} />

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
