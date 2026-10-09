import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  detail: string
  /** Accion opcional: reintentar, ir a otra seccion. */
  action?: ReactNode
  tone?: 'muted' | 'danger'
}

/**
 * Panel de estado vacio o de error, con el mismo aspecto que el de la linea de tiempo.
 *
 * Nace como copia del que ResourceTimeline guarda en privado: la Fase 18 no puede tocar la Timeline
 * (Fase 16), asi que no se pudo sustituir el original por este. Cuando la Timeline se retoque, el
 * suyo desaparece y este se queda con los dos consumidores.
 */
export function EmptyState({ icon: Icon, title, detail, action, tone = 'muted' }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <span
        className={cn(
          'flex size-11 items-center justify-center rounded-full',
          tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <div className="max-w-md">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>

      {action}
    </div>
  )
}
