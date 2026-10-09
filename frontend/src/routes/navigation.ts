import { AlertTriangle, CalendarRange, LayoutDashboard, Settings, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { MetricToken } from '@/types/planningMetrics'

/** Rutas de la aplicacion, en un solo lugar para evitar literales dispersos. */
export const ROUTES = {
  dashboard: '/',
  resources: '/recursos',
  calendar: '/calendario',
  /** Plantilla de la agenda de un plan. No se enlaza tal cual: se construye con calendarPath(). */
  calendarPlan: '/calendario/:planId',
  incidents: '/incidentes',
  settings: '/configuracion',
  /** Plantilla del desglose de una metrica. Se construye con metricPath(). */
  metricDetail: '/metricas/:gap',
} as const

/** Ruta concreta del calendario para un plan, derivada de la plantilla para no repetir el literal. */
export function calendarPath(planId: string): string {
  return ROUTES.calendarPlan.replace(':planId', encodeURIComponent(planId))
}

/**
 * Ruta concreta del desglose de una metrica del tablero.
 *
 * El token de la URL no siempre es el que viaja a la API: para las tres carencias declaradas la
 * tabla que los relaciona vive en `types/planningMetrics`, junto al contrato que describe. Se pasa
 * el token ya validado y no un texto, para que no se pueda construir una direccion que la pagina
 * despues no sepa resolver.
 */
export function metricPath(token: MetricToken): string {
  return ROUTES.metricDetail.replace(':gap', token)
}

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Texto que se muestra en el tooltip cuando la barra lateral esta colapsada. */
  description: string
}

/** Menu de navegacion principal. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: 'Dashboard',
    to: ROUTES.dashboard,
    icon: LayoutDashboard,
    description: 'Vision general y estado de la integracion',
  },
  {
    label: 'Recursos',
    to: ROUTES.resources,
    icon: Users,
    description: 'Equipo de desarrollo y su capacidad',
  },
  {
    label: 'Calendario',
    to: ROUTES.calendar,
    icon: CalendarRange,
    description: 'Planificacion de recursos en el tiempo',
  },
  {
    label: 'Incidentes',
    to: ROUTES.incidents,
    icon: AlertTriangle,
    description: 'Incidentes y requerimientos provenientes de GLPI',
  },
  {
    label: 'Configuracion',
    to: ROUTES.settings,
    icon: Settings,
    description: 'Parametros de la integracion y del sistema',
  },
]
