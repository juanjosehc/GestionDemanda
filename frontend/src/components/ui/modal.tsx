import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

interface ModalProps {
  /** El `id` del título que nombra el diálogo para quien usa un lector de pantalla. */
  labelledBy: string
  /** Lo que anuncia el botón de cerrar. */
  closeLabel: string
  onClose: () => void
  /** La cabecera: qué se va a hacer y sobre qué ticket. */
  header: ReactNode
  children: ReactNode
}

/** Lo que puede recibir el foco dentro del diálogo. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * El modal de una acción sobre una fila.
 *
 * **Sí es modal, a diferencia del panel del Timeline**: la acción —registrar o reemplazar un
 * acuerdo— suspende la lista mientras se escribe, así que oscurece lo de debajo y no deja tabular
 * fuera. El panel del Timeline, en cambio, acompaña a la agenda y por eso no atrapa el foco; aquí
 * no hay nada que mirar detrás que haga falta para decidir la fecha.
 *
 * El foco entra en el diálogo —o se queda en el campo que lo tomó al montarse—, Tab circula dentro,
 * Escape cierra y **a dónde vuelve el foco lo decide quien lo abre**, que es el único que sabe de
 * qué fila se salió.
 */
export function Modal({ labelledBy, closeLabel, onClose, header, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const panel = panelRef.current
    // Si un campo ya tomó el foco al montarse —el formulario lo hace con `autoFocus`—, el diálogo no
    // se lo quita: el foco tiene que quedar donde se escribe.
    if (panel && !panel.contains(document.activeElement)) panel.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return

      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      // La vuelta del tabulador: de lo último a lo primero y al revés, para que la lista de debajo
      // no se pueda alcanzar con el teclado mientras el diálogo está abierto.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      data-slot="modal"
      // El fondo cierra al pulsarlo, pero solo si el clic empezó en el fondo: un arrastre que
      // empieza dentro del diálogo y acaba fuera no debe cerrarlo.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={panelRef}
        className="relative my-auto flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">{header}</div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={closeLabel}
            className="shrink-0"
          >
            <X />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
