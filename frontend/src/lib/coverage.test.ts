import { describe, expect, it } from 'vitest'

import {
  coverageByGroup,
  coverageOf,
  coverageTotals,
  formatPercent,
  priorityOrder,
  priorityTickets,
  teamCoverage,
} from '@/lib/coverage'
import { declarationItemFixture, declarationsFixture } from '@/test/fixtures'
import type { DeveloperCoverage } from '@/lib/coverage'
import type { PendingItem } from '@/lib/pending'

/** Un pendiente con la causa que se quiera, sin arrastrar el resto de la clasificación. */
function pendiente(
  developerId: string,
  workItemId: string,
  cause: PendingItem['cause'],
  overrides: Partial<PendingItem> = {},
): PendingItem {
  return {
    developerId,
    workItemId,
    title: `Ticket ${workItemId}`,
    type: 'REQUERIMIENTO',
    cause,
    declarationStatus: cause === 'SIN_ACUERDO' ? 'PLANIFICABLE' : cause,
    priority: null,
    createdAt: null,
    ...overrides,
  } as PendingItem
}

function coverage(overrides: Partial<DeveloperCoverage> = {}): DeveloperCoverage {
  return {
    developerId: 'dev-001',
    name: 'Ana Perez',
    active: 0,
    declared: 0,
    planificable: 0,
    covered: 0,
    pending: 0,
    blockedByInformation: 0,
    potential: 0,
    causes: {
      SIN_ESTIMACION: 0,
      SIN_COMPROMISO: 0,
      SIN_DECLARACION: 0,
      NO_TRADUCIBLE: 0,
      FUERA_POR_CAPACIDAD: 0,
      SIN_ACUERDO: 0,
      NO_INCLUIDO_EN_EL_PLAN: 0,
    },
    ...overrides,
  }
}

describe('coverageOf', () => {
  it('separa activos, declarados, planificables, pendientes y cubiertos', () => {
    const declaration = declarationsFixture({
      items: [
        declarationItemFixture({ workItemId: 'A', declarationStatus: 'PLANIFICABLE' }),
        declarationItemFixture({ workItemId: 'B', declarationStatus: 'SIN_COMPROMISO' }),
        declarationItemFixture({
          workItemId: 'C',
          declarationStatus: 'SIN_DECLARACION',
          declaration: null,
        }),
        declarationItemFixture({
          workItemId: 'D',
          declarationStatus: 'NO_TRADUCIBLE',
          declaration: null,
        }),
      ],
    })

    const row = coverageOf('dev-001', declaration, [
      pendiente('dev-001', 'B', 'SIN_COMPROMISO'),
      pendiente('dev-001', 'C', 'SIN_DECLARACION'),
      pendiente('dev-001', 'D', 'NO_TRADUCIBLE'),
    ])

    expect(row).toMatchObject({
      active: 4,
      // `SIN_ESTIMACION` y `SIN_COMPROMISO` cuentan como algo declarado; `NO_TRADUCIBLE` no.
      declared: 2,
      planificable: 1,
      pending: 3,
      blockedByInformation: 3,
      // El único cubierto es `A`, que es planificable y no arrastra pendiente.
      covered: 1,
      // Y el potencial suma lo cubierto más lo que solo espera información: `A` + `B` + `C` + `D`.
      potential: 4,
    })
    expect(row?.causes.SIN_COMPROMISO).toBe(1)
    expect(row?.causes.SIN_DECLARACION).toBe(1)
    expect(row?.causes.NO_TRADUCIBLE).toBe(1)
  })

  it('no inventa una cobertura cuando la declaración no se leyó', () => {
    expect(coverageOf('dev-001', undefined, [])).toBeNull()
  })

  it('cuenta como pendiente lo planificable que no está en el plan', () => {
    const declaration = declarationsFixture({
      items: [declarationItemFixture({ workItemId: 'A', declarationStatus: 'PLANIFICABLE' })],
    })

    const row = coverageOf('dev-001', declaration, [
      pendiente('dev-001', 'A', 'NO_INCLUIDO_EN_EL_PLAN'),
    ])

    expect(row).toMatchObject({ active: 1, planificable: 1, covered: 0, blockedByInformation: 0 })
  })
})

describe('teamCoverage', () => {
  it('deja fuera a quien no se leyó y respeta el orden del padrón', () => {
    const rows = teamCoverage(
      ['dev-001', 'dev-002', 'dev-003'],
      {
        'dev-001': declarationsFixture({ developer: { id: 'dev-001', name: 'Ana Perez' } }),
        'dev-003': declarationsFixture({ developer: { id: 'dev-003', name: 'Diana Lopez' } }),
      },
      [],
    )

    expect(rows.map((row) => row.developerId)).toEqual(['dev-001', 'dev-003'])
  })
})

describe('coverageTotals', () => {
  it('suma tickets y no promedia porcentajes', () => {
    const totals = coverageTotals([
      coverage({ developerId: 'a', active: 10, covered: 2, blockedByInformation: 3, potential: 5 }),
      coverage({ developerId: 'b', active: 5, covered: 5, potential: 5 }),
    ])

    expect(totals).toMatchObject({ active: 15, covered: 7, potential: 10 })
    expect(totals.rate).toBeCloseTo(7 / 15)
    expect(totals.potentialRate).toBeCloseTo(10 / 15)
    expect(formatPercent(totals.rate)).toBe('46,7%')
  })

  it('con cero activos la tasa es cero, no un cien por ciento vacío', () => {
    const totals = coverageTotals([])

    expect(totals.rate).toBe(0)
    expect(totals.potentialRate).toBe(0)
  })
})

describe('priorityOrder', () => {
  it('pone primero a quien desbloquea más tickets declarando', () => {
    const rows = [
      coverage({ developerId: 'pocos', active: 2, pending: 2, blockedByInformation: 2 }),
      coverage({ developerId: 'muchos', active: 10, pending: 10, blockedByInformation: 10 }),
      coverage({ developerId: 'sin', active: 9, pending: 0, blockedByInformation: 0 }),
    ]

    expect(priorityOrder(rows).map((row) => row.developerId)).toEqual([
      'muchos',
      'pocos',
      'sin',
    ])
  })
})

describe('priorityTickets', () => {
  it('pone primero lo que solo espera un dato y deja fuera lo que declarar no arregla', () => {
    const rows = [
      coverage({ developerId: 'a', active: 3, blockedByInformation: 3 }),
      coverage({ developerId: 'b', active: 5, blockedByInformation: 5 }),
    ]

    const tickets = priorityTickets(
      [
        // Dos datos: va detrás de cualquiera al que le falte uno, por mucho que su persona tenga más.
        pendiente('b', 'B2', 'SIN_DECLARACION', { priority: 5, createdAt: '2026-01-01' }),
        pendiente('a', 'A2', 'SIN_ESTIMACION', { priority: 1, createdAt: '2026-02-01' }),
        pendiente('b', 'B1', 'SIN_DECLARACION', { priority: 4, createdAt: '2026-01-02' }),
        pendiente('a', 'A1', 'SIN_COMPROMISO', { priority: 3, createdAt: '2026-03-01' }),
        // Ni el tipo intraducible ni el acuerdo pendiente se recuperan declarando desde aquí.
        pendiente('a', 'A3', 'NO_TRADUCIBLE'),
        pendiente('a', 'A4', 'SIN_ACUERDO'),
      ],
      rows,
    )

    // Primero los de un solo dato (A1 antes que A2 por prioridad de GLPI); después los de dos,
    // y entre ellos primero los de quien desbloquea más (b).
    expect(tickets.map((item) => item.workItemId)).toEqual(['A1', 'A2', 'B2', 'B1'])
  })

  it('a igual impacto respeta la prioridad y después la antigüedad de GLPI', () => {
    const rows = [coverage({ developerId: 'a', active: 4, blockedByInformation: 4 })]

    const tickets = priorityTickets(
      [
        pendiente('a', 'nueva', 'SIN_DECLARACION', { priority: 3, createdAt: '2026-09-01' }),
        pendiente('a', 'vieja', 'SIN_DECLARACION', { priority: 3, createdAt: '2026-01-01' }),
        // En GLPI la prioridad más alta es la 5; a igual prioridad gana el más viejo.
        pendiente('a', 'urgente', 'SIN_DECLARACION', { priority: 5, createdAt: '2026-09-02' }),
      ],
      rows,
    )

    expect(tickets.map((item) => item.workItemId)).toEqual(['urgente', 'vieja', 'nueva'])
  })

  it('sin lecturas de cobertura no inventa apalancamiento: ordena por lo que sí sabe', () => {
    const tickets = priorityTickets(
      [
        pendiente('a', 'B', 'SIN_DECLARACION', { priority: 1 }),
        pendiente('b', 'A', 'SIN_DECLARACION', { priority: 5 }),
      ],
      [],
    )

    expect(tickets.map((item) => item.workItemId)).toEqual(['A', 'B'])
  })
})

describe('coverageByGroup', () => {
  it('agrupa las causas por la pregunta del gestor', () => {
    const groups = coverageByGroup([
      coverage({
        causes: {
          SIN_ESTIMACION: 2,
          SIN_COMPROMISO: 1,
          SIN_DECLARACION: 3,
          NO_TRADUCIBLE: 0,
          FUERA_POR_CAPACIDAD: 1,
          SIN_ACUERDO: 2,
          NO_INCLUIDO_EN_EL_PLAN: 4,
        },
      }),
    ])

    expect(groups).toEqual({ P1: 6, P2: 1, P3: 2, P4: 4 })
  })
})
