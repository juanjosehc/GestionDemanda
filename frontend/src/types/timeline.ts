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
