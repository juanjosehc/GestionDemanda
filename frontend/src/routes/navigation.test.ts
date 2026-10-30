import { describe, expect, it } from 'vitest'

import {
  MENU_ITEMS,
  NAV_ITEMS,
  ROUTES,
  navItemFor,
  planningPath,
  planningPreviewPath,
  ticketTimelinePath,
} from '@/routes/navigation'

/**
 * El menú de la Fase 61 y lo que quedó fuera de él.
 *
 * La separación entre `MENU_ITEMS` y `NAV_ITEMS` es deliberada: el catálogo sigue teniendo todas las
 * pantallas porque el encabezado y los enlaces de vuelta necesitan nombrarlas. Lo que se comprueba
 * aquí es la mitad visible —cinco entradas desde que Tickets se sumó a las cuatro de la Fase 50— y
 * que las ocultas no se hayan borrado.
 */
describe('el menú y el catálogo de pantallas', () => {
  it('deja en el menú las seis entradas de la operación diaria', () => {
    expect(MENU_ITEMS.map((item) => item.to)).toEqual([
      ROUTES.teamTimeline,
      ROUTES.capacity,
      ROUTES.incidents,
      ROUTES.declarations,
      ROUTES.renegotiations,
      ROUTES.settings,
    ])
  })

  it('saca del menú, sin borrar del catálogo, las pantallas contextuales', () => {
    const hidden = [
      ROUTES.dashboard,
      ROUTES.alerts,
      ROUTES.resources,
      ROUTES.calendar,
      ROUTES.planning,
      ROUTES.planningPreview,
    ]

    for (const route of hidden) {
      expect(MENU_ITEMS.map((item) => item.to)).not.toContain(route)
      expect(NAV_ITEMS.map((item) => item.to)).toContain(route)
    }
  })

  it('sigue titulando las pantallas ocultas por su nombre', () => {
    // El encabezado y el enlace de vuelta de la declaración usan esto: una pantalla oculta que se
    // titulara «Timeline del equipo» mentiría sobre dónde está el usuario.
    expect(navItemFor(ROUTES.dashboard).label).toBe('Dashboard')
    expect(navItemFor(ROUTES.alerts).label).toBe('Alertas')
    expect(navItemFor(ROUTES.planning).label).toBe('Planificación')
    // Gana la coincidencia más larga: la vista previa cuelga de `/planificar`.
    expect(navItemFor(ROUTES.planningPreview).label).toBe('Estado del plan')
    expect(navItemFor(planningPath('dev-001')).label).toBe('Planificación')
  })

  it('titula Tickets la pantalla de incidentes, y conserva su ruta', () => {
    // El rótulo cambió en la Fase 61 porque la tabla pinta incidencias y requerimientos; la ruta no,
    // porque hay enlaces guardados y la vuelta de la declaración se compone con ella.
    expect(navItemFor(ROUTES.incidents).label).toBe('Tickets')
    expect(ROUTES.incidents).toBe('/incidentes')
  })
})

describe('las direcciones contextuales', () => {
  it('siembra el técnico al abrir la planificación', () => {
    expect(planningPath('dev-001')).toBe('/planificar?tecnico=dev-001')
  })

  it('conserva el modo y suma el técnico en la vista previa', () => {
    expect(planningPreviewPath('operativo')).toBe('/planificar/estado')
    expect(planningPreviewPath('todos')).toBe('/planificar/estado?modo=todos')
    expect(planningPreviewPath('operativo', 'dev-001')).toBe('/planificar/estado?tecnico=dev-001')
    expect(planningPreviewPath('todos', 'dev-001')).toBe(
      '/planificar/estado?modo=todos&tecnico=dev-001',
    )
  })

  it('abre el Timeline filtrado por persona y, si se pide, con el ticket señalado', () => {
    expect(ticketTimelinePath('dev-001')).toBe('/?tecnico=dev-001')
    expect(ticketTimelinePath('dev-001', '901')).toBe('/?tecnico=dev-001&ticket=901')
    // El identificador viaja codificado como en toda dirección de la aplicación.
    expect(ticketTimelinePath('dev-001', 'REQ 9')).toBe('/?tecnico=dev-001&ticket=REQ+9')
  })
})
