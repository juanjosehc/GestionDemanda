import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useGlpiHealth } from '@/hooks/useGlpiHealth'
import { cn } from '@/lib/utils'
import type { GlpiHealth } from '@/types/glpi'
import type { BadgeVariant } from '@/components/ui/badge'

type StatusKey = 'operational' | 'degraded' | 'down' | 'unconfigured'

const STATUS: Record<StatusKey, { label: string; variant: BadgeVariant; description: string }> = {
  operational: {
    label: 'Operativo',
    variant: 'success',
    description: 'Conexión y autenticación verificadas',
  },
  degraded: {
    label: 'Degradado',
    variant: 'warning',
    description: 'Sin autenticación con GLPI',
  },
  down: {
    label: 'Sin conexión',
    variant: 'danger',
    description: 'GLPI no responde',
  },
  unconfigured: {
    label: 'Sin configurar',
    variant: 'secondary',
    description: 'Faltan credenciales de GLPI',
  },
}

/**
 * Determina el estado a mostrar.
 *
 * El backend responde 200 siempre, por lo que un error de la consulta implica que el
 * backend mismo no esta disponible. Una URL vacia significa que no hay configuracion.
 */
function resolveStatus(health: GlpiHealth | undefined, isError: boolean): StatusKey {
  if (isError || !health) {
    return 'down'
  }
  if (!health.baseUrl) {
    return 'unconfigured'
  }
  if (health.connected && health.authenticated) {
    return 'operational'
  }
  return health.connected ? 'degraded' : 'down'
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-foreground">{children}</dd>
    </div>
  )
}

/** Tarjeta "Estado GLPI": consume GET /api/glpi/health a traves de useGlpiHealth. */
export function GlpiStatusCard() {
  const { data, isPending, isError, error, isFetching, refetch } = useGlpiHealth()

  const status = STATUS[resolveStatus(data, isError)]
  const loading = isPending && !data

  return (
    <Card className="gap-0 py-5">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg',
              status.variant === 'success' && 'bg-emerald-50 text-emerald-600',
              status.variant === 'warning' && 'bg-amber-50 text-amber-600',
              status.variant === 'danger' && 'bg-red-50 text-red-600',
              status.variant === 'secondary' && 'bg-muted text-muted-foreground',
            )}
          >
            <RefreshCw className={cn('size-4.5', isFetching && 'animate-spin')} />
          </span>
          <CardTitle className="truncate text-sm font-medium text-muted-foreground">Estado GLPI</CardTitle>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Volver a verificar el estado de GLPI"
        >
          <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
        </Button>
      </CardHeader>

      <CardContent className="mt-4 space-y-4">
        {loading ? (
          <>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold tracking-tight">{status.label}</span>
              <Badge variant={status.variant}>{status.description}</Badge>
            </div>

            <dl className="space-y-1.5 text-xs">
              <Field label="Conectado">{data ? (data.connected ? 'Sí' : 'No') : 'No'}</Field>
              <Field label="Autenticado">{data ? (data.authenticated ? 'Sí' : 'No') : 'No'}</Field>
              <Field label="URL">
                <span className="font-mono">{data?.baseUrl || 'No configurada'}</span>
              </Field>
              <Field label="Verificado">{data ? formatTimestamp(data.checkedAt) : '—'}</Field>
            </dl>

            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              {isError
                ? `No fue posible consultar el backend: ${error instanceof Error ? error.message : 'error desconocido'}`
                : (data?.detail ?? 'Sin datos')}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
