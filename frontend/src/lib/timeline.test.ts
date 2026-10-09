import { describe, expect, it } from 'vitest'

import {
  EMPTY_FILTERS,
  filterItems,
  formatHours,
  hourAxis,
  itemsByDate,
  minutesOfDay,
  parseLocalDateTime,
  timelineDays,
} from '@/lib/timeline'
import { timelineFixture } from '@/test/fixtures'

const plan = timelineFixture()

describe('parseLocalDateTime', () => {
  it('lee una fecha sin hora como hora local, no como UTC', () => {
    // Con `new Date("2026-10-05")` esto devolveria el dia 4 en cualquier huso negativo.
    const date = parseLocalDateTime('2026-10-05')

    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(9)
    expect(date.getDate()).toBe(5)
  })

  it('conserva la hora de una fecha-hora local', () => {
    const date = parseLocalDateTime('2026-10-05T09:30:15')

    expect(date.getDate()).toBe(5)
    expect(date.getHours()).toBe(9)
    expect(date.getMinutes()).toBe(30)
    expect(date.getSeconds()).toBe(15)
  })
})

describe('minutesOfDay', () => {
  it('devuelve los minutos desde medianoche', () => {
    expect(minutesOfDay('2026-10-05T09:00:00')).toBe(540)
    expect(minutesOfDay('2026-10-05T17:00:00')).toBe(1020)
  })
})

describe('hourAxis', () => {
  it('sin tramos usa la jornada por defecto', () => {
    expect(hourAxis([])).toEqual({ startMinutes: 480, endMinutes: 1080 })
  })

  it('deriva el eje de los tramos observados, redondeado hacia fuera', () => {
    // La jornada del calendario congelado no viaja en la respuesta: el eje sale de los tramos.
    expect(hourAxis(plan.items)).toEqual({ startMinutes: 540, endMinutes: 1020 })
  })
})

describe('timelineDays', () => {
  it('toma los dias de la capacidad del recurso, en orden', () => {
    expect(timelineDays(plan.resources, plan.items)).toEqual(['2026-10-05', '2026-10-06'])
  })

  it('suma los dias de los tramos que no estuvieran en la capacidad', () => {
    expect(timelineDays([], plan.items)).toEqual(['2026-10-05', '2026-10-06'])
  })
})

describe('itemsByDate', () => {
  it('agrupa los tramos por su fecha de inicio', () => {
    const byDate = itemsByDate(plan.items)

    expect(byDate.get('2026-10-05')?.map((item) => item.workItemId)).toEqual(['INC-1', 'REQ-1'])
    expect(byDate.get('2026-10-06')?.map((item) => item.workItemId)).toEqual(['REQ-2'])
  })
})

describe('filterItems', () => {
  it('sin filtros devuelve todo', () => {
    expect(filterItems(plan.items, EMPTY_FILTERS)).toHaveLength(3)
  })

  it('filtra por estado de planificacion', () => {
    const displaced = filterItems(plan.items, { ...EMPTY_FILTERS, planningStatus: 'DESPLAZADO' })

    expect(displaced.map((item) => item.workItemId)).toEqual(['REQ-1', 'REQ-2'])
  })

  it('filtra por tipo y por severidad', () => {
    expect(filterItems(plan.items, { ...EMPTY_FILTERS, workItemType: 'INCIDENTE' })).toHaveLength(1)
    expect(filterItems(plan.items, { ...EMPTY_FILTERS, severity: 'MEDIO' })).toHaveLength(1)
    // La severidad solo la traen los incidentes: filtrar por ella descarta los requerimientos.
    expect(filterItems(plan.items, { ...EMPTY_FILTERS, severity: 'BAJO' })).toHaveLength(0)
  })
})

describe('formatHours', () => {
  it('no arrastra decimales de relleno', () => {
    expect(formatHours(8)).toBe('8')
    expect(formatHours(0)).toBe('0')
    expect(formatHours(2.5)).toMatch(/^2[.,]5$/)
  })
})
