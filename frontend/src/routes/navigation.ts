import {
  AlertTriangle,
  BellRing,
  CalendarRange,
  ClipboardList,
  Handshake,
  LayoutDashboard,
  ListChecks,
  PlayCircle,
  Settings,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { incidentsQuery } from '@/lib/incidents'
import type { IncidentFilters, TeamViewMode } from '@/lib/incidents'
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
  /**
   * Lo que el motor recibiria si se generara el plan ahora.
   *
   * Cuelga de `/planificar` porque es la misma pregunta un paso antes —y por eso el menu tiene que
   * marcar las dos entradas con `end`: sin el, esta ruta, que es prefijo de la otra, resaltaria dos.
   */
  planningPreview: '/planificar/estado',
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
 * La vista de Incidentes tal como está: su dirección con los filtros y el modo vivos.
 *
 * Existe para que el enlace de vuelta pueda guardar **a dónde volver** sin que la pantalla tenga que
 * llevar su estado en la dirección mientras se usa. Se compone en el momento del clic, con lo que hay
 * en pantalla en ese instante, y por eso la vuelta conserva los filtros y el conmutador.
 *
 * Una vista sin tocar se escribe como la ruta pelada: `incidentsQuery` omite lo que está en su valor
 * por defecto, así que no hay direcciones con cuatro huecos vacíos.
 */
export function incidentsPath(filters: IncidentFilters, mode: TeamViewMode): string {
  const query = incidentsQuery(filters, mode)

  return query === '' ? ROUTES.incidents : `${ROUTES.incidents}?${query}`
}

/**
 * El contexto con el que se abre la declaración de un ticket.
 *
 * Es el único sitio donde se escriben los nombres de estos tres parámetros: quien los pone y quien los
 * lee son `declarationPath` y `declarationContextOf`, aquí al lado.
 */
export interface DeclarationContext {
  /** El técnico cuyo listado hay que abrir. Sin él la pantalla no tiene nada que pedir. */
  developerId: string
  /** El ticket que se quiere declarar. Sin él se abre el listado y nada más. */
  workItemId?: string
  /** A dónde volver, ya validado por `safeReturnPath`. */
  from?: string
}

/**
 * Una dirección de vuelta, solo si es una ruta de esta aplicación.
 *
 * **`startsWith('/')` no basta y esto no es paranoia:** `//evil.com` es una URL protocolo-relativa
 * —el navegador la resuelve contra otro origen— y pasa el primer filtro. Es la única entrada de este
 * flujo que viene de fuera y acaba en un `<Link to>`, así que se valida aquí, donde se escribe.
 */
function safeReturnPath(value: string | null): string | undefined {
  return value !== null && value.startsWith('/') && !value.startsWith('//') ? value : undefined
}

/**
 * La dirección que abre la declaración de un ticket, con todo lo que la pantalla necesita para no
 * pedir nada a mano.
 *
 * Es lo que convierte «ve a Declaración, teclea el identificador del técnico, busca la fila a ojo»
 * en un clic. El identificador es el mismo login que publica el padrón: el backend lo resuelve igual
 * que un número de GLPI, así que no hay nada que traducir por el camino.
 */
export function declarationPath(context: DeclarationContext): string {
  const params = new URLSearchParams()

  params.set('tecnico', context.developerId)

  if (context.workItemId) {
    params.set('ticket', context.workItemId)
  }
  if (context.from) {
    params.set('volver', context.from)
  }

  return `${ROUTES.declarations}?${params.toString()}`
}

/** El contexto que trae una dirección de declaración. La vuelta se valida; el resto se toma tal cual. */
export function declarationContextOf(params: URLSearchParams): DeclarationContext {
  return {
    developerId: params.get('tecnico') ?? '',
    workItemId: params.get('ticket') ?? undefined,
    from: safeReturnPath(params.get('volver')),
  }
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
    label: 'Estado del plan',
    to: ROUTES.planningPreview,
    icon: ListChecks,
    description: 'Qué recibiría el motor si se generara el plan ahora',
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
