import type { BadgeVariant } from '@/components/ui/badge'
import type { AlertSeverity } from '@/types/alerts'

/**
 * Un color por severidad, y los tres salen del backend.
 *
 * No hay umbrales aqui: `CRITICAL`, `WARNING` e `INFO` son las tres clases que el enum del backend
 * declara, y el mapa es total sobre ellas —anadir un nivel sin darle color no compila—. Vive aqui y
 * no dentro de una pantalla porque el centro de alertas y la vista de equipo pintan la misma
 * severidad, y dos copias de una paleta acaban siendo dos paletas.
 */
export const SEVERITY_VARIANTS: Record<AlertSeverity, BadgeVariant> = {
  CRITICAL: 'danger',
  WARNING: 'warning',
  INFO: 'info',
}
