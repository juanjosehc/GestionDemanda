import { Layers } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { NAV_ITEMS, ROUTES } from '@/routes/navigation'

interface SidebarProps {
  /** Barra colapsada (solo iconos). Aplica unicamente en pantallas lg y superiores. */
  collapsed: boolean
  /** Panel deslizante visible en pantallas pequenas. */
  mobileOpen: boolean
  /** Se invoca al elegir una opcion, para cerrar el panel en movil. */
  onNavigate: () => void
}

export function Sidebar({ collapsed, mobileOpen, onNavigate }: SidebarProps) {
  return (
    <aside
      aria-label="Navegacion principal"
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        'transition-[transform,width] duration-200 ease-out lg:static lg:translate-x-0',
        collapsed ? 'lg:w-[4.5rem]' : 'lg:w-64',
        mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
      )}
    >
      {/* Marca */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Layers className="size-5" />
        </span>
        <div className={cn('min-w-0', collapsed && 'lg:hidden')}>
          <p className="truncate text-sm font-semibold leading-tight">Gestión de Demanda</p>
          <p className="truncate text-xs text-muted-foreground">Planificación de recursos</p>
        </div>
      </div>

      {/* Navegacion */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            /* `end` tambien en Planificacion: «Estado del plan» cuelga de su ruta, asi que sin el
               las dos entradas saldrian resaltadas a la vez al visitar la vista previa. */
            end={item.to === ROUTES.dashboard || item.to === ROUTES.planning}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                collapsed && 'lg:justify-center lg:px-0',
                isActive
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )
            }
          >
            <item.icon className="size-4.5 shrink-0" />
            <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Pie */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <p className={cn('px-1 text-xs text-muted-foreground', collapsed && 'lg:hidden')}>
          Fase 1 · Integración GLPI
        </p>
      </div>
    </aside>
  )
}
