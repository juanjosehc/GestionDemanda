import { describe, expect, it } from 'vitest'

import { NO_ROW_FILTERS, filterRows, hasFilters, matchesRow } from '@/lib/timelineFilters'
import type { TeamRowFilters, TeamRowSignals } from '@/lib/timelineFilters'

function row(overrides: Partial<TeamRowSignals> = {}): TeamRowSignals {
  return {
    developerId: 'ana.perez',
    name: 'Ana Pérez',
    glpiId: 101,
    hasPlan: true,
    pending: 2,
    agreements: 0,
    displacements: 1,
    plannable: 3,
    recoverable: 1,
    types: new Set(['INCIDENTE', 'REQUERIMIENTO']),
    searchText: 'ana.perez ana pérez 101 inc-1 incidente planificado req-1 requerimiento desplazado',
    ...overrides,
  }
}

const filters = (overrides: Partial<TeamRowFilters> = {}): TeamRowFilters => ({
  ...NO_ROW_FILTERS,
  ...overrides,
})

describe('matchesRow', () => {
  it('sin filtros, todas las filas pasan', () => {
    expect(matchesRow(row(), NO_ROW_FILTERS)).toBe(true)
    expect(hasFilters(NO_ROW_FILTERS)).toBe(false)
  })

  it('busca por nombre, login, GLPI y ticket', () => {
    expect(matchesRow(row(), filters({ query: 'ana' }))).toBe(true)
    expect(matchesRow(row(), filters({ query: 'ANA.PEREZ' }))).toBe(true)
    expect(matchesRow(row(), filters({ query: '101' }))).toBe(true)
    expect(matchesRow(row(), filters({ query: 'req-1' }))).toBe(true)
    expect(matchesRow(row(), filters({ query: 'carlos' }))).toBe(false)
  })

  it('exige todas las palabras de la búsqueda', () => {
    // «ana req-1» encuentra a Ana por ese ticket; «ana req-9» no.
    expect(matchesRow(row(), filters({ query: 'ana req-1' }))).toBe(true)
    expect(matchesRow(row(), filters({ query: 'ana req-9' }))).toBe(false)
  })

  it('filtra por persona', () => {
    expect(matchesRow(row(), filters({ developerId: 'ana.perez' }))).toBe(true)
    expect(matchesRow(row(), filters({ developerId: 'carlos.ruiz' }))).toBe(false)
  })

  it('filtra por tipo, con plan y señales de la fila', () => {
    expect(matchesRow(row(), filters({ type: 'INCIDENTE' }))).toBe(true)
    expect(matchesRow(row({ types: new Set(['REQUERIMIENTO']) }), filters({ type: 'INCIDENTE' }))).toBe(
      false,
    )

    expect(matchesRow(row({ hasPlan: false }), filters({ plan: 'CON' }))).toBe(false)
    expect(matchesRow(row({ hasPlan: false }), filters({ plan: 'SIN' }))).toBe(true)

    expect(matchesRow(row({ pending: 0 }), filters({ withPending: true }))).toBe(false)
    expect(matchesRow(row({ agreements: 0 }), filters({ withAgreements: true }))).toBe(false)
    expect(matchesRow(row({ agreements: 2 }), filters({ withAgreements: true }))).toBe(true)
    expect(matchesRow(row({ displacements: 0 }), filters({ withDisplacements: true }))).toBe(false)
    expect(matchesRow(row({ plannable: 0 }), filters({ plannableOnly: true }))).toBe(false)
    expect(matchesRow(row({ recoverable: 0 }), filters({ recoverableOnly: true }))).toBe(false)
  })

  it('combina los filtros con Y, no con O', () => {
    const both = filters({ plan: 'CON', withPending: true })

    expect(matchesRow(row(), both)).toBe(true)
    expect(matchesRow(row({ pending: 0 }), both)).toBe(false)
    expect(matchesRow(row({ hasPlan: false }), both)).toBe(false)
  })
})

describe('filterRows', () => {
  it('conserva el orden en que llegaron las filas', () => {
    // Cada fila con su propio texto: el resto de señales no cambia la búsqueda.
    const named = (developerId: string) => row({ developerId, searchText: developerId })
    const rows = [named('a'), named('b'), named('c')]

    expect(filterRows(rows, filters({ query: 'a' })).map((entry) => entry.developerId)).toEqual([
      'a',
    ])
    expect(filterRows(rows, NO_ROW_FILTERS)).toHaveLength(3)
  })
})

describe('hasFilters', () => {
  it('reconoce cada filtro activo', () => {
    expect(hasFilters(filters({ query: '  ' }))).toBe(false)
    expect(hasFilters(filters({ query: 'ana' }))).toBe(true)
    expect(hasFilters(filters({ plan: 'SIN' }))).toBe(true)
    expect(hasFilters(filters({ recoverableOnly: true }))).toBe(true)
  })
})
