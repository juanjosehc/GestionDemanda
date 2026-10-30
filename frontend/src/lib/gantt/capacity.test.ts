import { describe, expect, it } from 'vitest'

import {
  barsOf,
  commitmentsOf,
  daysBetween,
  loadOf,
  occupancyBand,
  pendingDaysOf,
  periodEnd,
  periodStart,
  riskCountsOf,
  shiftPeriod,
  summaryOf,
} from '@/lib/gantt/capacity'
import type { DeveloperDeclarationsResponse } from '@/types/declarations'
import type { TimelineItem, TimelineResource, UnscheduledItem } from '@/types/timeline'

/** Un tramo de una hora, lo justo para probar agrupacion y carriles. */
function tramo(
  workItemId: string,
  day: string,
  hours = 1,
  developerId = 'ana',
): TimelineItem {
  return {
    workItemId,
    workItemType: 'INCIDENTE',
    startsAt: `${day}T08:00:00`,
    endsAt: `${day}T09:00:00`,
    durationHours: hours,
    developerId,
    estimatedHours: hours,
    committedDate: null,
    severity: null,
    planningStatus: 'PLANIFICADO',
    sourcePlanId: 'plan',
    displacement: null,
  }
}

describe('las bandas de ocupacion', () => {
  it('resuelve los cortes hacia abajo en el limite', () => {
    expect(occupancyBand(0)).toBe('libre')
    expect(occupancyBand(59.9)).toBe('libre')
    expect(occupancyBand(60)).toBe('normal')
    expect(occupancyBand(89.9)).toBe('normal')
    expect(occupancyBand(90)).toBe('lleno')
    expect(occupancyBand(100)).toBe('lleno')
    expect(occupancyBand(100.1)).toBe('sobre')
    expect(occupancyBand(120)).toBe('sobre')
    expect(occupancyBand(120.1)).toBe('critico')
  })

  it('no inventa un porcentaje cuando no hay capacidad', () => {
    expect(occupancyBand(null)).toBe('sin-plan')
  })
})

describe('los periodos', () => {
  it('abre la semana en lunes y la cierra en domingo', () => {
    expect(periodStart('semana', '2026-10-27')).toBe('2026-10-26')
    expect(periodEnd('semana', '2026-10-27')).toBe('2026-11-01')
  })

  it('cubre el mes y el trimestre completos', () => {
    expect(periodStart('mes', '2026-10-27')).toBe('2026-10-01')
    expect(periodEnd('mes', '2026-10-27')).toBe('2026-10-31')
    expect(periodStart('trimestre', '2026-10-27')).toBe('2026-10-01')
    expect(periodEnd('trimestre', '2026-10-27')).toBe('2026-12-31')
  })

  it('navega por periodos completos', () => {
    expect(shiftPeriod('semana', '2026-10-27', 1)).toBe('2026-11-02')
    expect(shiftPeriod('mes', '2026-10-27', 1)).toBe('2026-11-01')
    expect(shiftPeriod('mes', '2026-01-15', -1)).toBe('2025-12-01')
    expect(shiftPeriod('trimestre', '2026-10-27', 1)).toBe('2027-01-01')
  })

  it('enumera los dias del periodo, extremos incluidos', () => {
    expect(daysBetween('2026-10-26', '2026-11-01')).toHaveLength(7)
    expect(daysBetween('2026-10-01', '2026-10-31')).toHaveLength(31)
  })
})

describe('la carga de una persona', () => {
  const resource: TimelineResource = {
    developerId: 'ana',
    capacity: [
      { date: '2026-10-26', availableHours: 8, occupiedHours: 8, remainingHours: 0 },
      { date: '2026-10-27', availableHours: 8, occupiedHours: 10, remainingHours: -2 },
      // Fuera del periodo: no debe sumarse.
      { date: '2026-11-02', availableHours: 8, occupiedHours: 4, remainingHours: 4 },
    ],
  }

  it('suma solo los dias del periodo y no recalcula nada', () => {
    const load = loadOf('ana', resource, daysBetween('2026-10-26', '2026-11-01'), [])

    expect(load.availableHours).toBe(16)
    expect(load.occupiedHours).toBe(18)
    expect(load.remainingHours).toBe(-2)
    expect(load.coveredDays).toBe(2)
    expect(load.percent).toBe(112.5)
  })

  it('deja el porcentaje en nulo si el periodo no tiene capacidad', () => {
    const load = loadOf('ana', resource, daysBetween('2026-09-01', '2026-09-30'), [])

    expect(load.percent).toBeNull()
    expect(load.coveredDays).toBe(0)
  })

  it('cuenta trabajos distintos y no tramos', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')
    const items = [
      tramo('A', '2026-10-26'),
      tramo('A', '2026-10-27'),
      tramo('B', '2026-10-27'),
    ]

    expect(loadOf('ana', resource, days, items).jobs).toBe(2)
  })
})

describe('las barras del Gantt', () => {
  it('agrupa los tramos de un mismo trabajo en una barra', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')
    const items = [
      tramo('A', '2026-10-26', 4),
      tramo('A', '2026-10-27', 6),
      tramo('B', '2026-10-27', 2),
    ]

    const bars = barsOf(items, days)
    const a = bars.find((bar) => bar.workItemId === 'A')

    expect(bars).toHaveLength(2)
    expect(a).toMatchObject({ startIndex: 0, endIndex: 1, days: 2, hours: 10, lane: 0 })
  })

  it('pone en carriles distintos dos trabajos que comparten dia', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')
    const bars = barsOf(
      [tramo('A', '2026-10-26', 4), tramo('B', '2026-10-26', 2)],
      days,
    )

    expect(bars.map((bar) => bar.lane).sort()).toEqual([0, 1])
  })

  it('recorta al periodo lo que empezo antes', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')
    const bars = barsOf([tramo('A', '2026-10-22'), tramo('A', '2026-10-26')], days)

    expect(bars[0]).toMatchObject({ startIndex: 0, endIndex: 0, days: 1 })
  })
})

describe('el resumen del equipo', () => {
  it('suma horas y no promedia porcentajes', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')

    const ana: TimelineResource = {
      developerId: 'ana',
      capacity: [{ date: '2026-10-26', availableHours: 8, occupiedHours: 8, remainingHours: 0 }],
    }
    const luis: TimelineResource = {
      developerId: 'luis',
      capacity: [
        { date: '2026-10-26', availableHours: 2, occupiedHours: 3, remainingHours: -1 },
      ],
    }

    const summary = summaryOf([
      loadOf('ana', ana, days, []),
      loadOf('luis', luis, days, []),
    ])

    // 11 ocupadas de 10 disponibles: la media simple de 100 % y 150 % seria 125 %.
    expect(summary.percent).toBeCloseTo(110)
    expect(summary.overloaded).toBe(1)
    expect(summary.remainingHours).toBe(-1)
    expect(summary.covered).toBe(2)
  })
})

/** Una declaración con los tickets que interesan a la prueba, rellenando lo que no se mira. */
function declaration(
  developerId: string,
  tickets: readonly { id: string; date: string | null; time?: string | null }[],
): DeveloperDeclarationsResponse {
  return {
    developer: { id: developerId, name: null },
    source: { glpi: 'glpi', declaration: 'local' },
    items: tickets.map((ticket) => ({
      workItemId: ticket.id,
      type: 'REQUERIMIENTO',
      status: 'UNICO',
      priority: 3,
      createdAt: null,
      title: `Ticket ${ticket.id}`,
      declarationStatus: 'PLANIFICABLE',
      discards: [],
      declaration: null,
      operationalDate: ticket.date,
      operationalTime: ticket.time ?? null,
      operationalDateSource: 'internal_time_to_resolve',
    })),
  }
}

describe('los compromisos que publica GLPI', () => {
  it('toma la fecha operativa y le pone el mismo riesgo que el Timeline', () => {
    const commitments = commitmentsOf(
      { ana: declaration('ana', [{ id: 'A', date: '2026-10-26' }]) },
      '2026-10-27',
    )

    expect(commitments.A).toEqual({ date: '2026-10-26', time: null, risk: 'VENCIDA' })
  })

  it('no inventa compromiso para un ticket sin fecha en GLPI', () => {
    const commitments = commitmentsOf(
      { ana: declaration('ana', [{ id: 'A', date: null }]) },
      '2026-10-27',
    )

    expect(commitments.A).toBeUndefined()
  })
})

describe('las barras heredan el estado y la entrega', () => {
  it('pinta el estado que le pasa la pagina y no uno propio', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')
    const [bar] = barsOf([tramo('A', '2026-10-26')], days, { states: { A: 'DESPLAZADO' } })

    expect(bar?.state).toBe('DESPLAZADO')
    // Sin mapa de acuerdos, el estado del tramo es el que publica el plan.
    expect(barsOf([tramo('A', '2026-10-26')], days)[0]?.state).toBe('PLANIFICADO')
  })

  it('lleva la fecha de entrega y su riesgo a la barra', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')
    const commitments = commitmentsOf(
      { ana: declaration('ana', [{ id: 'A', date: '2026-10-28', time: '17:00:00' }]) },
      '2026-10-27',
    )
    const [bar] = barsOf([tramo('A', '2026-10-26')], days, { commitments })

    expect(bar).toMatchObject({ delivery: '2026-10-28', risk: 'PROXIMA' })
  })

  it('deja la entrega en nula cuando el ticket no se ubica por promesa', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')
    const [bar] = barsOf([tramo('A', '2026-10-26')], days, { commitments: {} })

    expect(bar).toMatchObject({ delivery: null, risk: null })
  })
})

describe('los compromisos sin estimar', () => {
  function ghost(workItemId: string, date: string, developerId = 'ana'): UnscheduledItem {
    return {
      workItemId,
      workItemType: 'REQUERIMIENTO',
      developerId,
      date,
      time: '09:00',
      cause: 'No tiene estimación de horas.',
    }
  }

  it('agrupa por persona y dia para no llenar la columna de etiquetas', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')
    const pending = pendingDaysOf(
      [ghost('A', '2026-10-26'), ghost('B', '2026-10-26'), ghost('C', '2026-10-27')],
      days,
    )

    expect(pending).toHaveLength(2)
    expect(pending[0]).toMatchObject({ developerId: 'ana', dayIndex: 0, count: 2 })
    expect(pending[0]?.items.map((item) => item.workItemId)).toEqual(['A', 'B'])
  })

  it('descarta los que vencen fuera del periodo visible', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')

    expect(pendingDaysOf([ghost('A', '2026-12-01')], days)).toEqual([])
  })
})

describe('el resumen de riesgos', () => {
  it('cuenta solo los compromisos del periodo que no tienen margen', () => {
    const days = daysBetween('2026-10-26', '2026-11-01')
    const commitments = commitmentsOf(
      {
        ana: declaration('ana', [
          { id: 'VENCIDO', date: '2026-10-25' },
          { id: 'HOY', date: '2026-10-27' },
          { id: 'PROXIMO', date: '2026-10-29' },
          { id: 'LEJANO', date: '2026-11-20' },
        ]),
      },
      '2026-10-27',
    )

    // El vencido queda fuera del periodo visible: no se cuenta un riesgo que no está en pantalla.
    expect(riskCountsOf(commitments, days)).toEqual({ VENCIDA: 0, HOY: 1, PROXIMA: 1 })
  })
})
