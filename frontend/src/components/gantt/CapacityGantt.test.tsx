import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CapacityGantt } from '@/components/gantt/CapacityGantt'
import { barsOf, daysBetween, loadOf, pendingDaysOf } from '@/lib/gantt/capacity'
import { renderWithClient } from '@/test/render'
import type { TimelineItem, TimelineResource, UnscheduledItem } from '@/types/timeline'

/**
 * El Gantt de capacidad, con datos a mano.
 *
 * Lo que se prueba es **el contrato visual de la versión 2**: que la barra pinte el estado que le
 * pasa la página y no uno propio, que la entrega viaje a la barra y que el compromiso sin estimar
 * tenga carril en vez de desaparecer. Nada de esto necesita la red: la página es la que lee.
 */

const DAYS = daysBetween('2026-11-02', '2026-11-08')

function tramo(workItemId: string, day: string, hours = 4): TimelineItem {
  return {
    workItemId,
    workItemType: 'REQUERIMIENTO',
    startsAt: `${day}T08:00:00`,
    endsAt: `${day}T12:00:00`,
    durationHours: hours,
    developerId: 'ana',
    estimatedHours: hours,
    committedDate: null,
    severity: null,
    planningStatus: 'PLANIFICADO',
    sourcePlanId: 'plan-1',
    displacement: null,
  }
}

const RESOURCE: TimelineResource = {
  developerId: 'ana',
  capacity: [
    { date: '2026-11-02', availableHours: 8, occupiedHours: 4, remainingHours: 4 },
    { date: '2026-11-03', availableHours: 8, occupiedHours: 8, remainingHours: 0 },
  ],
}

const GHOST: UnscheduledItem = {
  workItemId: '67923',
  workItemType: 'REQUERIMIENTO',
  developerId: 'ana',
  date: '2026-11-04',
  time: '09:00',
  cause: 'No tiene estimación de horas.',
}

function render(items: readonly TimelineItem[], pending: readonly UnscheduledItem[] = []) {
  const rows = [
    {
      developerId: 'ana',
      name: 'Ana Arango',
      load: loadOf('ana', RESOURCE, DAYS, items),
    },
  ]

  return renderWithClient(
    <CapacityGantt
      rows={rows}
      bars={barsOf(items, DAYS, {
        states: { 'WI-1': 'DESPLAZADO' },
        commitments: {
          'WI-1': { date: '2026-11-03', time: '17:00', risk: 'PROXIMA' },
        },
      })}
      pending={pendingDaysOf(pending, DAYS)}
      days={DAYS}
      view="semana"
      today="2026-11-02"
      titles={{ 'WI-1': 'Portal Tesorería', '67923': 'Ajuste de nómina' }}
    />,
  )
}

describe('CapacityGantt: el contrato visual de la v2', () => {
  it('pinta la barra con el estado que resolvio la pagina', () => {
    const { container } = render([tramo('WI-1', '2026-11-02')])
    const bar = container.querySelector<HTMLElement>('[data-slot="capacity-bar"]')

    expect(bar?.dataset.state).toBe('DESPLAZADO')
    // El nombre del negocio, no el identificador de GLPI.
    expect(bar?.textContent).toContain('Portal Tesorería')
  })

  it('lleva la fecha de entrega dentro de la barra', () => {
    const { container } = render([tramo('WI-1', '2026-11-02')])
    const bar = container.querySelector<HTMLElement>('[data-slot="capacity-bar"]')

    expect(bar?.title).toContain('Entrega')
    expect(bar?.title).toContain('Entrega próxima')
  })

  it('enseña la ocupacion de la fila sin abrir el detalle', () => {
    const { container } = render([tramo('WI-1', '2026-11-02')])

    expect(container.querySelector('[data-slot="capacity-load-bar"]')).not.toBeNull()
    // 12 ocupadas de las 16 que declaró la capacidad del periodo.
    expect(container.textContent).toContain('75 %')
    expect(container.textContent).toContain('h libres')
  })

  it('pone el ticket sin estimar en su dia, en su propio carril', () => {
    const { container } = render([tramo('WI-1', '2026-11-02')], [GHOST])
    const mark = container.querySelector<HTMLElement>('[data-slot="capacity-pending"]')

    expect(mark?.dataset.count).toBe('1')
    expect(mark?.title).toContain('67923')
    expect(mark?.title).toContain('Ajuste de nómina')
    expect(screen.getByText('1', { selector: '[data-slot="capacity-pending"] span' })).toBeTruthy()
  })
})
