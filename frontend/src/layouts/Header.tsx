import { Bell, PanelLeft } from 'lucide-react'
import { useLocation } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NAV_ITEMS } from '@/routes/navigation'

interface HeaderProps {
  onToggleSidebar: () => void
}

export function Header({ onToggleSidebar }: HeaderProps) {
  const { pathname } = useLocation()

  // El titulo se deriva del menu para no duplicar literales en cada pagina. El prefijo cubre las
  // rutas con parametro ("/calendario/:planId"); para "/" el prefijo es "//" y nunca casa, asi que
  // el tablero sigue resolviendose por igualdad exacta.
  //
  // **Gana la coincidencia mas larga, no la primera.** «Estado del plan» cuelga de `/planificar`, y
  // las dos casan por prefijo: quedarse con la primera le daria a la vista previa el titulo y la
  // descripcion de la pantalla de al lado. El respaldo sigue siendo el tablero.
  const current = NAV_ITEMS.filter(
    (item) => item.to === pathname || pathname.startsWith(`${item.to}/`),
  ).reduce((longest, item) => (item.to.length > longest.to.length ? item : longest), NAV_ITEMS[0])

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSidebar}
        aria-label="Alternar menú lateral"
        className="shrink-0"
      >
        <PanelLeft />
      </Button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold tracking-tight">{current.label}</h1>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">{current.description}</p>
      </div>

      <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
        Fase 1
      </Badge>

      <Button variant="ghost" size="icon" aria-label="Notificaciones" className="shrink-0">
        <Bell />
      </Button>

      {/* Marcador de posicion del usuario; la autenticacion llega en Fase 2. */}
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
      >
        GD
      </span>
    </header>
  )
}
