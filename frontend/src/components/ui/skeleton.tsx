import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/** Marcador de carga. Se usa mientras TanStack Query resuelve una consulta. */
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

export { Skeleton }
