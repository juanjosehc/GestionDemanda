import { describe, expect, it } from 'vitest'

import { awaitingAgreement, outside, planOutcome, verdictOf } from '@/lib/planResult'
import type { PlanSources } from '@/lib/planResult'
import {
  planInputFixture,
  planRenegotiationsFixture,
  planSnapshotFixture,
  timelineFixture,
} from '@/test/fixtures'

/** Las cuatro lecturas del plan del fixture, con lo que cada prueba quiera cambiarle. */
function sources(overrides: Partial<PlanSources> = {}): PlanSources {
  const timeline = timelineFixture()

  return {
    snapshot: planSnapshotFixture(),
    input: planInputFixture(),
    items: timeline.items,
    capacity: timeline.resources.flatMap((resource) => resource.capacity),
    renegotiations: planRenegotiationsFixture().items,
    ...overrides,
  }
}

describe('planOutcome', () => {
  it('cuenta elementos con asignacion, no tramos', () => {
    // INC-1, REQ-1 y REQ-2 tienen asignacion; REQ-3 esta en conflicto y REQ-4 solo en la foto. Los
    // tramos son los mismos tres, asi que la prueba no distingue una cuenta de la otra por casualidad:
    // distingue porque REQ-3 y REQ-4 quedan fuera de las dos y el total es cinco.
    const outcome = planOutcome(sources())

    expect(outcome.planned).toBe(1)
    expect(outcome.displaced).toBe(2)
    expect(outcome.out).toBe(1)
    expect(outcome.excluded).toBe(1)
    expect(outcome.considered).toBe(5)
    expect(verdictOf(outcome)).toBe('con-trabajo')
  })

  it('cierra la cuenta: recibidos es la suma de las cuatro cajas', () => {
    const outcome = planOutcome(sources())

    expect(outcome.planned + outcome.displaced + outcome.out + (outcome.excluded ?? 0)).toBe(
      outcome.considered,
    )
  })

  it('un plan sin nada ubicado no se lee como plan vacio', () => {
    // El motor recibio cuatro elementos y no ubico ninguno: el plan salio vacio, pero la entrada no.
    const outcome = planOutcome(
      sources({
        snapshot: planSnapshotFixture({ allocations: [], rescheduleEvents: [] }),
      }),
    )

    expect(verdictOf(outcome)).toBe('nada-ubicado')
    expect(outcome.elements).toHaveLength(5)
  })

  it('sin entrada no inventa un cero: lo deja en nulo', () => {
    // Nulo no es cero. Un cero afirmaria que no entro nada, y lo que pasa es que nadie lo registro.
    const outcome = planOutcome(sources({ input: null }))

    expect(outcome.considered).toBeNull()
    expect(outcome.excluded).toBeNull()
    expect(verdictOf(outcome)).toBe('con-trabajo')
  })

  it('sin foto, los excluidos no se pueden nombrar y no se cuentan', () => {
    const outcome = planOutcome(sources({ input: null }))

    expect(outcome.elements.map((one) => one.workItemId)).toEqual(['REQ-3', 'REQ-1', 'REQ-2', 'INC-1'])
    expect(outcome.elements.some((one) => one.verdict === 'EXCLUIDO')).toBe(false)
  })

  it('un plan sin elementos lo dice, y no como fallo de lectura', () => {
    const outcome = planOutcome(
      sources({
        input: planInputFixture({ incidents: [], requirements: [] }),
        snapshot: planSnapshotFixture({ allocations: [], rescheduleEvents: [], conflicts: [] }),
      }),
    )

    expect(outcome.elements).toEqual([])
    expect(verdictOf(outcome)).toBe('sin-elementos')
    expect(outcome.considered).toBe(0)
  })

  it('pone primero lo que no salio como se acordo', () => {
    const outcome = planOutcome(sources())

    // Un excluido va antes que un planificado: que un elemento entre y desaparezca es mas raro que uno
    // que quede donde se comprometio, y la tabla se lee de arriba abajo.
    expect(outcome.elements.map((one) => one.verdict)).toEqual([
      'FUERA',
      'DESPLAZADO',
      'DESPLAZADO',
      'EXCLUIDO',
      'PLANIFICADO',
    ])
  })
})

describe('planOutcome: el por que de cada caja', () => {
  it('un planificado no ofrece motivo, porque no hubo ninguno', () => {
    const element = planOutcome(sources()).elements.find((one) => one.workItemId === 'INC-1')

    expect(element?.verdict).toBe('PLANIFICADO')
    expect(element?.conflict).toBeNull()
    expect(element?.reschedule).toBeNull()
  })

  it('un elemento fuera trae el motivo literal del motor', () => {
    const element = planOutcome(sources()).elements.find((one) => one.workItemId === 'REQ-3')

    expect(element?.verdict).toBe('FUERA')
    expect(element?.allocatedHours).toBe(0)
    // El texto se pinta tal cual: la vista no lo traduce ni lo reescribe.
    expect(element?.conflict?.reason).toBe('Sin capacidad en el horizonte de 10 dias')
  })

  it('un desplazado trae sus dos fechas, la regla aplicada y el motivo', () => {
    const element = planOutcome(sources()).elements.find((one) => one.workItemId === 'REQ-1')

    expect(element?.verdict).toBe('DESPLAZADO')
    expect(element?.reschedule?.originalDate).toBe('2026-10-05')
    expect(element?.reschedule?.rescheduledDate).toBe('2026-10-05')
    expect(element?.reschedule?.appliedRule).toBe('INCIDENTE_ALTO_DESPLAZA_REQUERIMIENTOS')
    expect(element?.reschedule?.reason).toBe('Incidente de severidad alta sobre la misma jornada')
  })

  it('un excluido dice que entro y que el motor no lo uso', () => {
    const element = planOutcome(sources()).elements.find((one) => one.workItemId === 'REQ-4')

    expect(element?.verdict).toBe('EXCLUIDO')
    expect(element?.allocatedHours).toBe(0)
    // Sin conflicto y sin asignacion: lo unico que lo explica es el estado con el que entro.
    expect(element?.conflict).toBeNull()
    expect(element?.workItemType).toBe('REQUERIMIENTO')
    expect(element?.committedDate).toBe('2026-10-08')
  })

  it('toma la estimacion y la severidad de la foto cuando la tiene', () => {
    const element = planOutcome(sources()).elements.find((one) => one.workItemId === 'INC-1')

    expect(element?.estimatedHours).toBe(6)
    expect(element?.severity).toBe('MEDIO')
    // La fecha compromiso la trae el tramo, no la foto: un incidente no se compromete a una fecha.
    expect(element?.committedDate).toBeNull()
  })
})

describe('planOutcome: la capacidad', () => {
  it('suma lo disponible, lo ocupado y lo libre de toda la ventana', () => {
    const outcome = planOutcome(sources())

    expect(outcome.capacity).toEqual({ availableHours: 16, occupiedHours: 10, remainingHours: 6 })
  })

  it('un dia a cero esta saturado y no sobrepasado', () => {
    const outcome = planOutcome(sources())

    expect(outcome.saturatedDays).toBe(1)
    expect(outcome.overDays).toBe(0)
  })

  it('un dia sobrepasado se cuenta aparte y no se compensa con uno holgado', () => {
    // La suma da 4 y ninguno de los dos dias esta libre: si la vista se quedara con el total, el
    // resumen diria que hay holgura donde hay una contradiccion del plan con su propio contexto.
    const outcome = planOutcome(
      sources({
        capacity: [
          { date: '2026-10-05', availableHours: 8, occupiedHours: 10, remainingHours: -2 },
          { date: '2026-10-06', availableHours: 8, occupiedHours: 2, remainingHours: 6 },
        ],
      }),
    )

    expect(outcome.capacity.remainingHours).toBe(4)
    expect(outcome.overDays).toBe(1)
    expect(outcome.saturatedDays).toBe(0)
  })

  it('un dia cerrado sin trabajo no es un dia saturado', () => {
    // Un sabado tiene cero disponible, cero ocupado y cero libre. Contarlo como saturado diria que la
    // agenda esta al limite justo los dias en que esta cerrada.
    const outcome = planOutcome(
      sources({
        capacity: [
          { date: '2026-10-05', availableHours: 8, occupiedHours: 8, remainingHours: 0 },
          { date: '2026-10-10', availableHours: 0, occupiedHours: 0, remainingHours: 0 },
        ],
      }),
    )

    expect(outcome.saturatedDays).toBe(1)
    expect(outcome.overDays).toBe(0)
    expect(outcome.capacity.availableHours).toBe(8)
  })
})

describe('planOutcome: la renegociacion es un eje aparte', () => {
  it('ata el acuerdo al plan que se mira, no al identificador a secas', () => {
    // `GET /api/renegotiations` recorre el plan vigente de cada desarrollador. Al mirar un plan
    // antiguo, sus filas hablan de otro desplazamiento y pegarlas pondria un acuerdo junto a unas
    // fechas que no son las suyas.
    const outcome = planOutcome(
      sources({ renegotiations: planRenegotiationsFixture().items.map((one) => ({ ...one, planId: 'otro-plan' })) }),
    )

    expect(outcome.agreementsKnown).toBe(false)
    expect(outcome.elements.every((one) => one.renegotiation === null)).toBe(true)
  })

  it('no convierte el acuerdo en un quinto veredicto', () => {
    // REQ-1 esta acordado y REQ-2 pendiente, y los dos siguen siendo DESPLAZADO: el motor no produce
    // la renegociacion, solo emite el evento.
    const outcome = planOutcome(sources())

    expect(outcome.agreementsKnown).toBe(true)
    expect(outcome.elements.find((one) => one.workItemId === 'REQ-1')?.renegotiation?.status).toBe(
      'ACORDADA',
    )
    expect(outcome.elements.find((one) => one.workItemId === 'REQ-2')?.renegotiation?.status).toBe(
      'PENDIENTE_DE_ACUERDO',
    )
  })
})

describe('outside y awaitingAgreement', () => {
  it('fuera son los del conflicto y pendientes los desplazados sin acuerdo', () => {
    const outcome = planOutcome(sources())

    expect(outside(outcome).map((one) => one.workItemId)).toEqual(['REQ-3'])
    expect(awaitingAgreement(outcome).map((one) => one.workItemId)).toEqual(['REQ-2'])
  })
})
