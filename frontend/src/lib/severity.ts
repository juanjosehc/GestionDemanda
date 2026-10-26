import type { IncidentSeverity } from '@/types/timeline'

/**
 * El color de cada severidad del incidente.
 *
 * Vive aquí y no en cada componente porque tres superficies pintan la misma severidad —el Timeline,
 * el tablero de desplazamientos y la renegociación— y un color distinto para el mismo valor sería la
 * aplicación contradiciéndose. Los tres valores los fija el backend; esto solo los viste.
 */
export const SEVERITY_VARIANTS: Record<IncidentSeverity, 'danger' | 'warning' | 'secondary'> = {
  ALTO: 'danger',
  MEDIO: 'warning',
  BAJO: 'secondary',
}
