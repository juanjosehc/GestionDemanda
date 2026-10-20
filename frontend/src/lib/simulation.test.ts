import { describe, expect, it } from 'vitest'

import { simulateIncident } from '@/lib/simulation'
import { timelineFixture } from '@/test/fixtures'

const plan = timelineFixture()
const DEVELOPER = 'dev-001'

const input = (overrides: Partial<Parameters<typeof simulateIncident>[2]> = {}) => ({
  developerId: DEVELOPER,
  date: '2026-10-05',
  hours: 2,
  severity: 'ALTO' as const,
  ...overrides,
})

describe('simulateIncident', () => {
  it('si cabe en la capacidad restante no desplaza nada', () => {
    // El día 6 tiene 6 h libres: 4 h de incidente dejan 2.
    const result = simulateIncident(plan.resources, plan.items, input({ date: '2026-10-06', hours: 4 }))

    expect(result.error).toBeNull()
    expect(result.remainingBefore).toBe(6)
    expect(result.remainingAfter).toBe(2)
    expect(result.displaced).toEqual([])
    expect(result.renegotiable).toEqual([])
  })

  it('si no cabe, desplaza primero lo que empieza más tarde', () => {
    // El día 5 está lleno. Un incidente de 2 h mueve el último tramo, que es REQ-1 (15:00–17:00).
    const result = simulateIncident(plan.resources, plan.items, input({ hours: 2 }))

    expect(result.error).toBeNull()
    expect(result.displaced.map((block) => block.workItemId)).toEqual(['REQ-1'])
    expect(result.displaced[0]?.newDate).toBe('2026-10-06')
    expect(result.remainingAfter).toBe(0)
  })

  it('deja como renegociables solo los requerimientos desplazados', () => {
    const result = simulateIncident(plan.resources, plan.items, input({ hours: 6 }))

    expect(result.displaced.map((block) => block.workItemId)).toEqual(['INC-1', 'REQ-1'])
    // INC-1 es un incidente: mover un incidente no es renegociar una fecha con el negocio.
    expect(result.renegotiable).toEqual(['REQ-1'])
  })

  it('parte siempre de la capacidad que publica el plan', () => {
    const result = simulateIncident(plan.resources, plan.items, input({ hours: 2 }))

    expect(result.availableHours).toBe(8)
    expect(result.occupiedHours).toBe(8)
    expect(result.remainingBefore).toBe(0)
  })

  it('avisa cuando la persona no está en el equipo', () => {
    const result = simulateIncident(plan.resources, plan.items, input({ developerId: 'dev-999' }))

    expect(result.error).toBe('Ese técnico no está en el equipo operativo.')
    expect(result.displaced).toEqual([])
  })

  it('avisa cuando la fecha está fuera de la ventana', () => {
    const result = simulateIncident(plan.resources, plan.items, input({ date: '2026-10-07' }))

    expect(result.error).toBe('Esa fecha está fuera de la ventana del plan.')
  })

  it('avisa cuando el día no es laborable', () => {
    const sunday = timelineFixture({
      resources: [
        {
          developerId: DEVELOPER,
          capacity: [{ date: '2026-10-04', availableHours: 0, occupiedHours: 0, remainingHours: 0 }],
        },
      ],
    })

    const result = simulateIncident(sunday.resources, sunday.items, input({ date: '2026-10-04' }))

    expect(result.error).toBe('Ese día no es laborable para esa persona.')
  })

  it('avisa cuando la duración no es positiva', () => {
    const result = simulateIncident(plan.resources, plan.items, input({ hours: 0 }))

    expect(result.error).toBe('La duración debe ser mayor que cero.')
  })

  it('si no queda día hábil en la ventana, lo dice con null', () => {
    // Un plan de un solo día: no hay adónde mover lo que no cabe.
    const singleDay = timelineFixture({
      resources: [
        {
          developerId: DEVELOPER,
          capacity: [{ date: '2026-10-05', availableHours: 8, occupiedHours: 8, remainingHours: 0 }],
        },
      ],
    })

    const result = simulateIncident(singleDay.resources, singleDay.items, input({ hours: 2 }))

    expect(result.displaced[0]?.newDate).toBeNull()
  })

  it('si el día entero no basta, deja el restante en negativo', () => {
    // 8 h de jornada y 8 h ya colocadas: un incidente de 10 h no cabe ni vaciando el día.
    const result = simulateIncident(plan.resources, plan.items, input({ hours: 10 }))

    expect(result.remainingAfter).toBe(-2)
  })
})
