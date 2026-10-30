import { FlaskConical } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DEMO_AVAILABLE, isDemoActive, setDemoActive } from '@/lib/demoMode'

/**
 * El boton del Modo DEMO, y el aviso de que esta activo.
 *
 * **Recarga al cambiar.** No es pereza: el QueryClient guarda datos reales con la misma clave que
 * los sinteticos, y cambiar de origen sin vaciarlo dejaria una pantalla que mezcla los dos. Recargar
 * es la unica forma barata de garantizar que no hay una sola respuesta de un mundo en el otro.
 *
 * En DEMO el boton se convierte en el aviso —«Modo DEMO activo»— y en la salida: no hay dos
 * controles que puedan contradecirse.
 */
export function DemoToggle() {
  if (!DEMO_AVAILABLE) return null

  const active = isDemoActive()

  const toggle = () => {
    setDemoActive(!active)
    window.location.reload()
  }

  if (active) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={toggle}
        data-slot="demo-toggle"
        className="shrink-0 border-amber-500 bg-amber-50 text-amber-900 hover:bg-amber-100"
        title="Salir del Modo DEMO y volver a los datos reales"
      >
        <FlaskConical className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Modo DEMO activo</span>
        <Badge variant="warning" className="hidden md:inline-flex">
          datos sintéticos
        </Badge>
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      data-slot="demo-toggle"
      className="shrink-0"
      title="Explorar la aplicación con un escenario sintético completo"
    >
      <FlaskConical className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline">Modo DEMO</span>
    </Button>
  )
}
