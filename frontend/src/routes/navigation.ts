import {
  AlertTriangle,
  BellRing,
  CalendarRange,
  ChartGantt,
  ClipboardList,
  Gauge,
  Handshake,
  LayoutDashboard,
  ListChecks,
  PlayCircle,
  Settings,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { incidentsQuery, modeQuery } from '@/lib/incidents'
import type { IncidentFilters, TeamViewMode } from '@/lib/incidents'
import { DISPLACED_TOKEN, METRIC_GAPS } from '@/types/planningMetrics'
import type { MetricToken } from '@/types/planningMetrics'

/** Rutas de la aplicacion, en un solo lugar para evitar literales dispersos. */
export const ROUTES = {
  /**
   * La pantalla con la que abre la aplicacion: la agenda de todo el equipo.
   *
   * **Ocupa la raiz y no una ruta con nombre a proposito.** Es la vista que responde «quien tiene
   * trabajo, en que esta y cuanto le queda libre» sin que nadie configure nada: no pide un plan, ni
   * un identificador, ni una seleccion. Cualquier otra ruta de entrada obligaria a pasar por una
   * pantalla intermedia antes de contestar eso.
   */
  teamTimeline: '/',
  /**
   * El tablero de indicadores, que dejo de ser la raiz y, desde la Fase 50, tambien la entrada de
   * menu: lo que mide —planes vigentes, carencias, incidentes— ya se lee en el Timeline, y la salud
   * operativa se movio alli. La ruta sigue viva para el desglose de una metrica y para quien la
   * tenga guardada.
   */
  dashboard: '/tablero',
  alerts: '/alertas',
  resources: '/recursos',
  /**
   * La capacidad del equipo: el Gantt de ocupacion para quien coordina.
   *
   * **No es el Timeline y no lo sustituye.** Aquel contesta «cuando se entrega y que paso con este
   * ticket»; este contesta «que tan ocupado esta el equipo» con las mismas lecturas, recortadas al
   * periodo que se este mirando. Es de solo lectura y no tiene acciones.
   */
  capacity: '/capacidad',
  calendar: '/calendario',
  /** Plantilla de la agenda de un plan. No se enlaza tal cual: se construye con calendarPath(). */
  calendarPlan: '/calendario/:planId',
  /**
   * Plantilla de la comparación de un plan con el anterior. Se construye con comparisonPath().
   *
   * **Lleva un solo identificador y no dos, y es la decisión de esta fase**: el plan anterior no se
   * pide por la dirección, lo resuelve la pantalla a partir de la lista de planes de **ese** técnico.
   * Con dos identificadores se podría componer a mano una comparación entre dos personas distintas, y
   * con uno solo no hay forma de comparar un plan consigo mismo.
   */
  calendarComparison: '/calendario/comparar/:planId',
  incidents: '/incidentes',
  declarations: '/declaraciones',
  /** Donde se invoca la generacion de un plan desde GLPI. La ruta no planifica: llama a la que ya existia. */
  planning: '/planificar',
  /**
   * Lo que el motor recibiria si se generara el plan ahora.
   *
   * Cuelga de `/planificar` porque es la misma pregunta un paso antes. Desde la Fase 50 no es una
   * entrada de menu: se llega desde la accion de planificar, con el tecnico ya puesto, que es el
   * unico momento en el que la pregunta tiene un destinatario.
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
 * Ruta concreta de la comparación de un plan con el que le precede.
 *
 * Cuelga de `/calendario` a propósito: es una vista del calendario, y el menú la resalta y la titula
 * como tal sin que haya que declarar una entrada nueva. Lo que no lleva es el identificador del plan
 * anterior —lo resuelve la pantalla—, así que esta dirección no puede nombrar una pareja que el
 * sistema no hubiera elegido.
 */
export function comparisonPath(planId: string): string {
  return ROUTES.calendarComparison.replace(':planId', encodeURIComponent(planId))
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
 * La vista previa del estado de entrada, con su conmutador de equipo y, si se pide, un tecnico.
 *
 * El modo viaja por el mismo motivo que en `incidentsPath`: quien entro con «Mostrar todo» puesto
 * tiene que volver a esa vista. Sin el, la fila de quien esta fuera del equipo operativo
 * desapareceria al otro lado del enlace y el cambio se leeria como si alguien la hubiera sacado.
 *
 * **`tecnico` es la Fase 50.** La vista previa contesta «que recibiria el motor» para todo el
 * equipo; cuando se llega desde la accion de planificar de una persona, la pregunta es por ella.
 * El nombre del parametro es el mismo que el de `planningPath`, porque es el mismo tecnico.
 */
export function planningPreviewPath(mode: TeamViewMode, developerId?: string): string {
  const query = modeQuery(mode)

  if (!developerId) {
    return query === '' ? ROUTES.planningPreview : `${ROUTES.planningPreview}?${query}`
  }

  const params = new URLSearchParams(query)
  params.set('tecnico', developerId)

  return `${ROUTES.planningPreview}?${params.toString()}`
}

/**
 * La dirección que abre la renegociación de un ticket, con la fila ya seleccionada.
 *
 * Es el enlace que hace la acción «Renegociar» del timeline: lleva el ticket y nada más. La pantalla
 * de renegociaciones siembra su selección con ese parámetro y abre el formulario, que es el mismo
 * que se usa desde su listado — no hay formulario nuevo ni escritura nueva.
 *
 * **No lleva la vuelta.** Renegociaciones no es un formulario de paso que devuelva a otra pantalla:
 * al guardar, el acuerdo aparece en su propia lista, y volver es abrir el timeline desde el menú.
 */
export function renegotiationPath(workItemId: string): string {
  return `${ROUTES.renegotiations}?ticket=${encodeURIComponent(workItemId)}`
}

/**
 * La agenda del equipo filtrada por una persona y, si se pide, con un ticket señalado.
 *
 * Es la acción «Ver en el Timeline» de la ficha de un ticket: el Timeline siembra su filtro de fila
 * con el técnico y, cuando el ticket tiene tramo, abre su detalle contextual —el mismo panel que se
 * abre pulsando el tramo—. Sin el ticket lleva solo a la persona, que es lo que sirve cuando el
 * trabajo no está colocado y no hay tramo que señalar.
 *
 * **No lleva la vuelta.** Se llega al puesto de mando, no a un formulario de paso.
 */
export function ticketTimelinePath(developerId: string, workItemId?: string): string {
  const params = new URLSearchParams()
  params.set('tecnico', developerId)

  if (workItemId) {
    params.set('ticket', workItemId)
  }

  return `${ROUTES.teamTimeline}?${params.toString()}`
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
  /**
   * Abrir la persona entera en modo lote, en vez de un ticket.
   *
   * Es lo que pide el Timeline cuando la unidad de trabajo es la persona y no el ticket: una sola
   * vista con sus pendientes, un solo firmante y una sola escritura. El ticket concreto sigue
   * mandando cuando viene —un enlace de Incidentes—, así que las dos formas no se mezclan.
   */
  batch?: boolean
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
  if (context.batch) {
    params.set('lote', '1')
  }

  return `${ROUTES.declarations}?${params.toString()}`
}

/** El contexto que trae una dirección de declaración. La vuelta se valida; el resto se toma tal cual. */
export function declarationContextOf(params: URLSearchParams): DeclarationContext {
  return {
    developerId: params.get('tecnico') ?? '',
    workItemId: params.get('ticket') ?? undefined,
    from: safeReturnPath(params.get('volver')),
    batch: params.get('lote') === '1',
  }
}

/**
 * La dirección que abre la generación del plan de una persona, con el técnico ya puesto.
 *
 * **Existe para que el cierre del ciclo no pida teclear lo que la pantalla anterior ya sabía.** El
 * gestor acaba de declarar los tickets de alguien; preguntarle otra vez por su identificador en
 * `/planificar` es exactamente la fricción que este flujo quita. Los dos nombres de parámetro viven
 * aquí, junto a los de la declaración.
 */
export function planningPath(developerId: string): string {
  const params = new URLSearchParams()

  params.set('tecnico', developerId)

  return `${ROUTES.planning}?${params.toString()}`
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

/**
 * El catalogo de pantallas con nombre y descripcion.
 *
 * **No es el menu.** Desde la Fase 50 el menu es `MENU_ITEMS`, y este catalogo se queda porque hay
 * dos consumidores que necesitan nombrar una pantalla aunque no este en el menu: el encabezado
 * —que titula la que se esta viendo— y el enlace de vuelta de la declaracion —que nombra a donde se
 * vuelve—. Borrar las entradas ocultas dejaria las dos diciendo «Timeline del equipo» desde una
 * pantalla que no lo es.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: 'Timeline del equipo',
    to: ROUTES.teamTimeline,
    icon: ChartGantt,
    description: 'Quien tiene trabajo, en que esta, cuanto le queda libre y que sigue pendiente',
  },
  {
    /**
     * La segunda lectura de la misma agenda, para otro publico: líderes técnicos, coordinación,
     * gerencia y PMO. No enseña entregas ni renegociaciones —eso es el Timeline—, solo ocupación.
     */
    label: 'Capacidad del equipo',
    to: ROUTES.capacity,
    icon: Gauge,
    description: 'Que tan ocupado esta el equipo: horas, ocupacion y capacidad libre por periodo',
  },
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
    description: 'Informacion auxiliar del equipo: personas, carga y alertas',
  },
  {
    label: 'Calendario',
    to: ROUTES.calendar,
    icon: CalendarRange,
    description: 'La agenda de un plan dia a dia, en el mismo modo que el timeline del equipo',
  },
  {
    /**
     * «Tickets» y no «Incidentes»: la tabla pinta las dos clases de trabajo —incidencias y
     * requerimientos—, y el rotulo anterior nombraba solo una de ellas. La ruta no cambia, para no
     * romper los enlaces guardados.
     */
    label: 'Tickets',
    to: ROUTES.incidents,
    icon: AlertTriangle,
    description: 'El inventario del trabajo activo: cada ticket con su estado, su plan y su acuerdo',
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
    description: 'Cómo se genera el plan que el timeline muestra: el motor, a pedido',
  },
  {
    label: 'Estado del plan',
    to: ROUTES.planningPreview,
    icon: ListChecks,
    description: 'La capa de pendientes: qué recibiría el motor si se generara el plan ahora',
  },
  {
    label: 'Renegociación',
    to: ROUTES.renegotiations,
    icon: Handshake,
    description: 'Las fechas acordadas para lo que un incidente desplazó en el timeline',
  },
  {
    label: 'Configuracion',
    to: ROUTES.settings,
    icon: Settings,
    description: 'Parametros de la integracion y del sistema',
  },
]

/**
 * El menu visible: las seis entradas que la operacion diaria necesita.
 *
 * **Las demas pantallas no desaparecieron; dejaron de tener puerta propia.** El Timeline es el
 * puesto de mando y enlaza a cada una en el momento en que hace falta —declarar desde una persona,
 * planificar desde su fila de cobertura, renegociar desde un tramo o desde la cola de acuerdos—,
 * y el menu se queda con lo que no tiene un contexto unico: la agenda, el inventario de tickets, la
 * accion de declarar, la cola de acuerdos y el diagnostico.
 *
 * **Tickets entra porque es la unica pantalla que contesta «que tickets existen»**, no «cuando»: el
 * Timeline enseña los tramos y los pendientes dentro de su agenda, pero no el registro de GLPI de
 * cada ticket —titulo, estado, prioridad, fecha— ni una lista plana que se pueda filtrar por estado
 * de planificacion o de renegociacion. Eso no se llega a buscar desde ninguna otra pantalla.
 *
 * Se deriva del catalogo para no escribir dos veces el rotulo, el icono y la descripcion.
 */
const MENU_ROUTES: readonly string[] = [
  ROUTES.teamTimeline,
  ROUTES.capacity,
  ROUTES.incidents,
  ROUTES.declarations,
  ROUTES.renegotiations,
  ROUTES.settings,
]

export const MENU_ITEMS: readonly NavItem[] = NAV_ITEMS.filter((item) =>
  MENU_ROUTES.includes(item.to),
)

/**
 * La entrada de menu que corresponde a una direccion: su rotulo y su descripcion.
 *
 * **Gana la coincidencia mas larga, no la primera.** «Estado del plan» cuelga de `/planificar` y las
 * dos casan por prefijo, asi que quedarse con la primera le daria a la vista previa el titulo de la
 * pantalla de al lado. El respaldo es la primera entrada del menu —hoy el timeline del equipo—, que
 * es a donde apunta la raiz y por tanto lo que le toca a una direccion desconocida.
 *
 * La usan el encabezado —para titular la pantalla— y el enlace de vuelta de la declaracion —para
 * nombrar a donde se vuelve—. Recibe la direccion entera, con su consulta, porque el enlace de vuelta
 * la lleva: la consulta no cambia de pantalla, solo de vista.
 */
export function navItemFor(path: string): NavItem {
  const pathname = path.split('?')[0]

  return NAV_ITEMS.filter(
    (item) => item.to === pathname || pathname.startsWith(`${item.to}/`),
  ).reduce((longest, item) => (item.to.length > longest.to.length ? item : longest), NAV_ITEMS[0])
}
