import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

interface SidePanelProps {
  /** El `id` del título que nombra el panel para quien usa un lector de pantalla. */
  labelledBy: string
  /** Lo que anuncia el botón de cerrar. */
  closeLabel: string
  onClose: () => void
  /** La cabecera: la identidad de lo que se está operando, siempre a la vista. */
  header: ReactNode
  children: ReactNode
}

/**
 * El panel lateral que comparten el detalle del Timeline y la declaración de un ticket.
 *
 * **Es `fixed` y no modal.** Queda fuera del flujo, así que la pantalla de debajo no se mueve ni
 * cambia de desplazamiento al abrirlo, y sigue viva: se puede pulsar otra fila o cambiar de tramo sin
 * cerrarlo. El foco entra en el panel al abrirse —los campos que lo necesiten lo toman después—,
 * Escape cierra, y **a dónde vuelve el foco lo decide quien lo abre**, que es el único que sabe de
 * qué fila se salió.
 */
export function SidePanel({ labelledBy, closeLabel, onClose, header, children }: SidePanelProps) {
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const panel = panelRef.current

    // Si un campo ya tomó el foco al montarse —el formulario lo hace con `autoFocus`—, el panel no
    // se lo quita: el foco tiene que quedar donde se escribe, no en el contenedor.
    if (panel && !panel.contains(document.activeElement)) panel.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside
      role="dialog"
      aria-labelledby={labelledBy}
      data-slot="side-panel"
      tabIndex={-1}
      ref={panelRef}
      // z-50: por encima de la barra lateral (z-40) y de la tabla o rejilla. El ancho deja ver la
      // pantalla a la izquierda en escritorio; en móvil ocupa la pantalla, que es lo único que cabe.
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl outline-none"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">{header}</div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel} className="shrink-0">
          <X />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  )
}
