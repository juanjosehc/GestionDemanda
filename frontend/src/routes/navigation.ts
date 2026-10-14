import {
  AlertTriangle,
  BellRing,
  CalendarRange,
  ClipboardList,
  Handshake,
  LayoutDashboard,
  PlayCircle,
  Settings,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { DISPLACED_TOKEN, METRIC_GAPS } from '@/types/planningMetrics'
import type { MetricToken } from '@/types/planningMetrics'

/** Rutas de la aplicacion, en un solo lugar para evitar literales dispersos. */
export const ROUTES = {
  dashboard: '/',
  alerts: '/alertas',
  resources: '/recursos',
  calendar: '/calendario',
  /** Plantilla de la agenda de un plan. No se enlaza tal cual: se construye con calendarPath(). */
  calendarPlan: '/calendario/:planId',
  incidents: '/incidentes',
  declarations: '/declaraciones',
  /** Donde se invoca la generacion de un plan desde GLPI. La ruta no planifica: llama a la que ya existia. */
  planning: '/planificar',
  renegotiations: '/renegociaciones',
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

/**
 * La tabla que traduce el sentido contrario: de la ruta de la API al token de la pantalla.
 *
 * **No se escriben los literales aqui.** Un `detailUrl` del backend es
 * `/api/planning/metrics/declared/SIN_ESTIMACION`, y ese `SIN_ESTIMACION` ya esta escrito en
 * `METRIC_GAPS` para el sentido que ya existia —token de la URL a constante de la API—, asi que la
 * vuelta se deriva de la misma tabla. Copiarla a mano seria la tercera copia de un hecho que ya
 * tiene dos dueños, que es exactamente lo que la decision 148 descarto al elegir publicar la ruta
 * de la API en vez de la de la interfaz.
 */
const ALERT_DETAIL_TOKENS: Readonly<Record<string, MetricToken>> = {
  ...Object.fromEntries(
    Object.entries(METRIC_GAPS).map(([token, code]) => [
      `/api/planning/metrics/declared/${code}`,
      token,
    ]),
  ),
  '/api/planning/metrics/displaced': DISPLACED_TOKEN,
}

/**
 * La pantalla que abre el desglose de una alerta, a partir del `detailUrl` que publica el backend.
 *
 * El backend publica la ruta de **su** API y no la de la interfaz: no conoce el prefijo con el que
 * se sirve la aplicacion ni si va detras de un proxy (riesgo 81). Traducirla es de este lado, y es
 * lo que el centro de alertas hace con esto: la accion «ver el desglose» solo aparece si la
 * traduccion existe.
 *
 * Devuelve nulo cuando la alerta no tiene listado propio —las dos de capacidad viajan con el campo
 * en nulo— **y tambien cuando la ruta no esta en la tabla**: una ruta que esta aplicacion no sabe
 * abrir no se convierte en un destino inventado, se enseña como lo que es.
 */
export function alertDetailPath(detailUrl: string | null): string | null {
  const token = detailUrl ? ALERT_DETAIL_TOKENS[detailUrl] : undefined

  return token ? metricPath(token) : null
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
    label: 'Alertas',
    to: ROUTES.alerts,
    icon: BellRing,
    description: 'Condiciones operativas que hoy exigen atencion',
  },
  {
    label: 'Recursos',
    to: ROUTES.resources,
    icon: Users,
    description: 'El equipo de hoy: personas, carga y alertas',
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
    label: 'Declaración',
    to: ROUTES.declarations,
    icon: ClipboardList,
    description: 'Estimación y compromiso de los tickets asignados a un técnico',
  },
  {
    label: 'Planificación',
    to: ROUTES.planning,
    icon: PlayCircle,
    description: 'Generación del plan de un técnico a partir de lo que GLPI tiene asignado',
  },
  {
    label: 'Renegociación',
    to: ROUTES.renegotiations,
    icon: Handshake,
    description: 'Fechas acordadas para los requerimientos que un incidente desplazó',
  },
  {
    label: 'Configuracion',
    to: ROUTES.settings,
    icon: Settings,
    description: 'Parametros de la integracion y del sistema',
  },
]
