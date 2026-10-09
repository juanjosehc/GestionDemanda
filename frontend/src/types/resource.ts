/**
 * Modelo del dominio de planificacion de recursos.
 *
 * Es deliberadamente independiente de GLPI: la integracion traduce incidentes y
 * requerimientos a estos tipos. Si manana cambia la fuente (GLPI, Jira, ServiceNow),
 * el modelo de planificacion no se modifica.
 */

/** Origen del trabajo planificado. */
export type WorkItemSource = 'INCIDENT' | 'REQUEST' | 'PROJECT'

/** Rol del recurso, determina su capacidad y las tareas que puede tomar. */
export type ResourceKind = 'DEVELOPER' | 'QA' | 'ANALYST' | 'INFRASTRUCTURE'

/** Prioridad ya normalizada por la capa de negocio (no la de GLPI). */
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface Resource {
  id: string
  name: string
  kind: ResourceKind
  /** Capacidad disponible en horas por semana. */
  weeklyCapacityHours: number
  /** true si esta activo y puede recibir asignaciones. */
  active: boolean
}

/** Bloque de trabajo asignado a un recurso en una franja de tiempo. */
export interface PlanningItem {
  id: string
  resourceId: string
  title: string
  source: WorkItemSource
  priority: Priority
  /** Fin e inicio en ISO-8601. */
  startsAt: string
  endsAt: string
  /** Fraccion de la capacidad del recurso dedicada al bloque, 0..1. */
  allocation: number
}

/** Rango visible de la linea de tiempo. */
export interface TimelineWindow {
  from: string
  to: string
}
