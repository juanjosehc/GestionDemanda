import { beforeEach, describe, expect, it } from 'vitest'

import { demoRequest } from '@/demo/demoApi'
import { DEMO_PEOPLE, DEMO_TODAY, resetDemoStore } from '@/demo/demoWorld'
import { daysBetween, loadOf, occupancyBand, periodEnd, periodStart } from '@/lib/gantt/capacity'
import { agreementStates } from '@/lib/renegotiations'
import { blockState, riskOf } from '@/lib/timeline'
import type { TeamDeclarationsResponse } from '@/types/declarations'
import type { PlanningMetadataItem } from '@/types/planningMetrics'
import type { RenegotiationsResponse } from '@/types/renegotiations'
import type { TeamTimelineResponse } from '@/types/timeline'

/**
 * El escenario tiene que ser completo, no bonito: cada estado que una pantalla sabe pintar necesita al
 * menos un caso. Se comprueba con las mismas funciones que usan las pantallas —`blockState`,
 * `agreementStates`, `riskOf`— y no con campos inventados, para que el test no pueda pasar mientras la
 * rejilla pinta otra cosa.
 */
describe('escenario DEMO', () => {
  beforeEach(() => resetDemoStore())

  const timeline = () => demoRequest('/api/planning/team/timeline', 'GET')?.body as TeamTimelineResponse
  const renegotiations = () => demoRequest('/api/renegotiations', 'GET')?.body as RenegotiationsResponse
  // La lectura de equipo pide los tecnicos por consulta, igual que la pantalla.
  const declared = () => {
    const query = DEMO_PEOPLE.map((person) => `developerId=${person.developerId}`).join('&')
    return demoRequest(`/api/planning-metadata/declarations?${query}`, 'GET')?.body as TeamDeclarationsResponse
  }

  it('cubre los seis estados del Timeline y las cuatro urgencias del compromiso', () => {
    const { items } = timeline()
    const agreed = agreementStates(renegotiations())

    // Un tramo sin horas no existe como tramo: el estado SIN_ESTIMACION sale de la declaración.
    const dates = declared()
      .developers.flatMap((developer) => developer.items)
      .map((item) => item.operationalDate)
      .filter((date): date is string => date !== null)

    expect(new Set(items.map((item) => blockState(item, agreed)))).toEqual(
      new Set(['PLANIFICADO', 'DESPLAZADO', 'PENDIENTE_DE_ACUERDO', 'ACORDADO_GLPI', 'ACORDADO_MANUAL']),
    )
    expect(dates.length).toBeGreaterThan(0)
    expect(new Set(dates.map((date) => riskOf(date, DEMO_TODAY)))).toEqual(
      new Set(['VENCIDA', 'HOY', 'PROXIMA', 'FUTURA']),
    )
  })

  it('reparte carga en las cinco bandas del Gantt, de libre a critico, y deja a alguien sin plan', () => {
    // La carga se mide en el periodo visible —la semana, por defecto—, no en toda la ventana del plan.
    const { resources, items } = timeline()
    const days = daysBetween(periodStart('semana', DEMO_TODAY), periodEnd('semana', DEMO_TODAY))

    const bands = resources.map((resource) =>
      occupancyBand(loadOf(resource.developerId, resource, days, items).percent),
    )

    expect(new Set(bands)).toEqual(new Set(['libre', 'normal', 'lleno', 'sobre', 'critico', 'sin-plan']))
    expect(resources).toHaveLength(DEMO_PEOPLE.length)
  })

  it('muestra a la vez renegociaciones pendientes, acordadas a mano y acordadas por GLPI', () => {
    const { items } = renegotiations()

    expect(new Set(items.map((item) => item.status))).toEqual(
      new Set(['PENDIENTE_DE_ACUERDO', 'ACORDADA']),
    )
    expect(
      new Set(items.filter((item) => item.renegotiation !== null).map((item) => item.renegotiation!.source)),
    ).toEqual(new Set(['HTTP', 'GLPI']))
  })

  it('escribe solo en memoria: la declaracion creada aparece y desaparece al reiniciar el escenario', () => {
    const target = timeline().items[0]

    expect(demoRequest('/api/planning-metadata', 'POST', {
      workItemId: target.workItemId,
      estimatedHours: 3,
      estimatedBy: 'demo',
    })?.status).toBe(201)

    const read = () =>
      demoRequest(`/api/planning-metadata/${target.workItemId}`, 'GET')?.body as PlanningMetadataItem

    expect(read().estimatedHours).toBe(3)

    resetDemoStore()
    expect(read().estimatedHours).not.toBe(3)
  })

  it('no inventa rutas: lo que no tiene escenario se declara fuera', () => {
    expect(demoRequest('/api/no-existe', 'GET')).toBeNull()
  })
})
