import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { BadgeVariant } from '@/components/ui/badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Colores del contenedor del icono. Semanticos, no de marca. */
const ICON_TONES = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
  danger: 'bg-red-50 text-red-600',
  muted: 'bg-muted text-muted-foreground',
} as const

export type StatTone = keyof typeof ICON_TONES

interface StatCardProps {
  label: string
  value: ReactNode
  /** Texto secundario bajo la cifra. */
  hint?: string
  icon: LucideIcon
  tone?: StatTone
  /** Etiqueta opcional en la esquina superior derecha. */
  badge?: { text: string; variant?: BadgeVariant }
  loading?: boolean
  /** Si se pasa, la tarjeta lleva al desglose de la cifra que muestra. */
  to?: string
}

/**
 * Tarjeta de indicador del tablero.
 *
 * Cuando lleva `to`, la tarjeta entera es pulsable mediante un enlace estirado: una sola `<Link>`
 * real, enfocable con Tab y con su texto para el lector de pantalla, cubriendo la tarjeta con
 * `after:absolute after:inset-0`. La alternativa —`onClick` en el `div`— obligaria a `role="button"`
 * y `tabIndex` a mano y dejaria el teclado y el lector a medias, que es justo lo que no se puede
 * simplificar. Sin `to` la tarjeta se comporta como siempre: un titulo, no un enlace.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'primary',
  badge,
  loading = false,
  to,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        'gap-0 py-5',
        to &&
          'relative transition-colors hover:border-ring focus-within:ring-2 focus-within:ring-ring/50',
      )}
    >
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', ICON_TONES[tone])}>
            <Icon className="size-4.5" />
          </span>
          {to ? (
            <CardTitle className="truncate text-sm font-medium">
              <Link to={to} className="after:absolute after:inset-0">
                {label}
              </Link>
            </CardTitle>
          ) : (
            <CardTitle className="truncate text-sm font-medium text-muted-foreground">
              {label}
            </CardTitle>
          )}
        </div>

        {badge && (
          <Badge variant={badge.variant ?? 'secondary'} className="shrink-0">
            {badge.text}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="mt-4">
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        )}

        {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}
