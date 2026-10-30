import { useState } from 'react'
import { Outlet } from 'react-router-dom'

import { Header } from '@/layouts/Header'
import { Sidebar } from '@/layouts/Sidebar'
import { isDemoActive } from '@/lib/demoMode'

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

        {/*
          La franja es el aviso que no se puede confundir con un dato real. Va pegada al encabezado
          y fuera del scroll del contenido, para que siga visible en cualquier pantalla y en
          cualquier punto de la pagina.
        */}
        {isDemoActive() && (
          <div
            data-slot="demo-banner"
            role="status"
            className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900"
          >
            <span className="rounded-xs bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
              DEMO
            </span>
            Escenario sintético activo · no se consulta GLPI ni se modifica ningún dato real
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
