/**
 * Espeja el DTO TimelinePlanResponse del backend (GET /api/planning/{planId}/timeline).
 *
 * No se mapea al contrato de la Fase 1 ({@link Resource}, {@link PlanningItem}): aquel pide
 * titulo, nombre y jornada semanal, que la foto de la entrada no guarda, y descarta el estado
 * de planificacion, la severidad y la capacidad, que es justo lo que hay que pintar.
 */

/** Tipo de elemento planificado. Valores del enum WorkItemType del backend. */
export type WorkItemType = 'INCIDENTE' | 'REQUERIMIENTO'

/** Estado del tramo dentro del plan. Valores del enum TimelineItemStatus del backend. */
export type TimelineItemStatus = 'PLANIFICADO' | 'DESPLAZADO'

/**
 * Los seis estados con los que la rejilla pinta un elemento del Timeline.
 *
 * **No es el mismo vocabulario que {@link TimelineItemStatus} y no lo sustituye.** El estado del
 * tramo es un hecho del plan —el motor lo colocó o lo movió—; estos seis son lo que la pantalla
 * necesita enseñar, y los dos últimos hechos vienen de otras dos lecturas que el plan no guarda: el
 * acuerdo lo publica `GET /api/renegotiations` y la falta de estimación la publica la declaración.
 *
 * Se resuelve con `blockState` en `lib/timeline.ts` y nunca se recalcula en el componente: que la
 * rejilla y la tabla de Tickets coincidan es lo que impide que el mismo ticket tenga dos colores.
 */
export type TimelineState =
  /** Tiene fecha en GLPI y no tiene horas: no entra al plan y se enseña igual, sin ocupar jornada. */
  | 'SIN_ESTIMACION'
  /** Está en el plan, en su fecha. */
  | 'PLANIFICADO'
  /** El motor lo movió de fecha y la renegociación no dice nada de él. */
  | 'DESPLAZADO'
  /** El motor lo movió y alguien tiene que acordar una fecha nueva. */
  | 'PENDIENTE_DE_ACUERDO'
  /** Desplazado y conciliado por el sistema desde el TTR de GLPI. */
  | 'ACORDADO_GLPI'
  /** Desplazado y acordado por una persona por la API. */
  | 'ACORDADO_MANUAL'

/**
 * Cuánto apremia el Internal TTR de un ticket, medido contra hoy.
 *
 * **Es un eje distinto del de {@link TimelineState} y no lo sustituye.** El estado dice qué hizo el
 * plan con el trabajo —lo colocó, lo movió, espera un acuerdo—; el riesgo dice cuánto queda hasta la
 * fecha que GLPI publica. Un tramo planificado puede vencer hoy, y un ticket sin estimación puede
 * vencer en diciembre: son dos hechos, y colapsarlos en un solo color escondería uno de los dos.
 *
 * Los cuatro valores son de la vista y no del backend: el compromiso declarado ya trae
 * `commitmentOverdue` calculado por el servidor, pero el Internal TTR no viaja con ese derivado, así
 * que la rejilla lo compara con el día del navegador con `riskOf`.
 */
export type CommitmentRisk =
  /** El Internal TTR ya pasó y el trabajo sigue en el plan o sin estimación. */
  | 'VENCIDA'
  /** El Internal TTR es hoy. */
  | 'HOY'
  /** El Internal TTR cae dentro de los próximos días del horizonte. */
  | 'PROXIMA'
  /** Todavía hay margen: el compromiso no corre riesgo esta semana. */
  | 'FUTURA'

/**
 * Un ticket que tiene día en GLPI pero no tiene tramo, y que hay que enseñar en ese día.
 *
 * **No es un {@link TimelineItem} y no se puede fabricar uno.** Un tramo ocupa jornada y este no
 * ocupa nada: no tiene horas, no suma capacidad y no está en ningún plan. Convertirlo en un tramo de
 * cero horas lo haría entrar en los filtros, en las sumas y en el detalle como si estuviera
 * planificado, que es justo lo que no es.
 */
export interface UnscheduledItem {
  workItemId: string
  /** Nulo si GLPI no publicó un tipo traducible. */
  workItemType: WorkItemType | null
  developerId: string
  /** El día en que GLPI lo ubica (Internal TTR), en formato ISO. */
  date: string
  /** La causa que publicó el backend, en palabras: lo que le falta al ticket. */
  cause: string
}

/** Severidad de un incidente. Valores del enum IncidentSeverity del backend. */
export type IncidentSeverity = 'ALTO' | 'MEDIO' | 'BAJO'

/** Cuanto cabe, cuanto esta ocupado y cuanto queda en una fecha. */
export interface TimelineCapacity {
  /** Fecha local en formato ISO (yyyy-MM-dd). */
  date: string
  availableHours: number
  occupiedHours: number
  /** No se recorta a cero: un negativo seria una contradiccion del plan y se muestra. */
  remainingHours: number
}

/** Un desarrollador con su capacidad dia a dia. */
export interface TimelineResource {
  developerId: string
  /** Cubre toda la ventana del plan, no solo los dias con trabajo. */
  capacity: TimelineCapacity[]
}

/** Un tramo de agenda con todo lo necesario para pintarlo sin pedir nada mas. */
export interface TimelineItem {
  workItemId: string
  workItemType: WorkItemType
  /** Fecha-hora local ISO (yyyy-MM-ddTHH:mm:ss). */
  startsAt: string
  endsAt: string
  /** Horas que consume este tramo, no el total del elemento. */
  durationHours: number
  developerId: string
  /** Total estimado del elemento, de la foto de la entrada. */
  estimatedHours: number
  /** Fecha compromiso, de la foto. Nula en incidentes. */
  committedDate: string | null
  /** Severidad del incidente, de la foto. Nula en requerimientos. */
  severity: IncidentSeverity | null
  planningStatus: TimelineItemStatus
  sourcePlanId: string
  /**
   * Por qué este elemento cambió de fecha, o `null` si no se movió.
   *
   * Es la auditoría del plan —el evento de reprogramación— puesta al lado del tramo: los dos
   * extremos de fecha, la regla que se aplicó, el incidente que consumió la franja y el motivo ya
   * redactado. Viaja con el tramo para que la rejilla pueda decir por qué una barra está donde está
   * sin una segunda llamada y sin recalcular nada.
   *
   * Cuando un elemento se movió varias veces lleva **el último** evento, que es el que explica la
   * fecha que se está viendo.
   */
  displacement: TimelineDisplacement | null
}

/**
 * La causa de un desplazamiento, tal como quedó auditada en el plan.
 *
 * El motivo es el texto del motor y no se vuelve a redactar aquí; la severidad es la copia que
 * guardó el evento, no la que el incidente tenga hoy en GLPI: un incidente reclasificado después no
 * puede reescribir por qué se movió un requerimiento el mes pasado.
 */
export interface TimelineDisplacement {
  /** Fecha en la que estaba pactado, en formato ISO (yyyy-MM-dd). */
  originalDate: string
  /** Fecha en la que el plan lo entregó. */
  newDate: string
  /** Valores del enum AppliedRule del backend. */
  appliedRule: string
  /** Nulo si el desplazamiento lo provocó la ocupación previa de la jornada. */
  incidentId: string | null
  incidentSeverity: IncidentSeverity | null
  /** El motivo redactado por el motor, tal como lo publica. */
  reason: string
}

/** Lo pactado por elemento, para no perder el total al mirar los tramos. */
export interface TimelineAllocation {
  workItemId: string
  workItemType: WorkItemType
  developerId: string
  date: string
  hours: number
}

/** Respuesta completa de GET /api/planning/{planId}/timeline. */
export interface TimelinePlanResponse {
  planId: string
  developerId: string
  /** Primer dia de la ventana, o nulo si el plan no tiene agenda. */
  from: string | null
  /** Ultimo dia de la ventana, o nulo si el plan no tiene agenda. */
  to: string | null
  resources: TimelineResource[]
  /** Los tramos, ordenados por inicio. */
  items: TimelineItem[]
  allocations: TimelineAllocation[]
}

/**
 * El plan vigente de una persona del equipo, con su propia ventana.
 *
 * Existe porque `resources` solo lleva el identificador de la persona, y quien tiene el plan vacío no
 * tiene ningún tramo del que deducir cuál es su plan. Es lo que permite afirmar «este trabajo no entró
 * en el plan vigente» sin adivinar.
 */
export interface TeamTimelinePlan {
  developerId: string
  planId: string
  /** Primer día de los tramos de *este* plan, o nulo si no tiene agenda. */
  from: string | null
  /** Último día de los tramos de *este* plan, o nulo si no tiene agenda. */
  to: string | null
}

/**
 * Respuesta de `GET /api/planning/team/timeline`: la agenda de todo el equipo en una ventana común.
 *
 * **No es un tipo nuevo, es un envase.** Los recursos, la capacidad y los tramos son los mismos
 * registros que publica la lectura de un plan, compuestos sin tocarlos. Lo único que añade es la
 * ventana de equipo —una sola para todas las filas— y el mapa de qué plan es el vigente de cada uno;
 * ninguna de las dos se puede calcular mirando un plan.
 *
 * **Por eso no vale concatenar las respuestas de cada plan.** La ventana de un plan son las fechas de
 * sus propios tramos, así que dos planes con cargas distintas devuelven dos ventanas distintas: pegadas,
 * las columnas de día no alinean y la capacidad de los días que un plan no cubre no existe en ninguna
 * parte.
 */
export interface TeamTimelineResponse {
  /** Primer día de la ventana común, o nulo si ningún plan tiene agenda. */
  from: string | null
  /** Último día de la ventana común, o nulo si ningún plan tiene agenda. */
  to: string | null
  /** Una entrada por desarrollador con tramos o con plan vigente, con su capacidad. */
  resources: TimelineResource[]
  /** Todos los tramos del equipo, ordenados por inicio. */
  items: TimelineItem[]
  /** El plan vigente de cada desarrollador, con su propia ventana. */
  plans: TeamTimelinePlan[]
  /** El trabajo que el motor no pudo ubicar, con el motivo que el mismo redactó. */
  conflicts: TeamConflict[]
}

/**
 * Trabajo que el plan vigente de alguien no pudo ubicar.
 *
 * **Es lo que separa «no hay tramo porque no se puede planificar» de «no hay tramo porque no cupo».**
 * Las dos se ven igual en la rejilla —una celda vacía— y se arreglan distinto, así que el motivo
 * viaja tal como lo escribió el motor: reescribirlo aquí sería la segunda versión de una explicación
 * que ya tiene dueño.
 */
export interface TeamConflict {
  developerId: string
  workItemId: string
  workItemType: WorkItemType
  reason: string
}
