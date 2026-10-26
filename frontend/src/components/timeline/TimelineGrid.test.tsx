import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TimelineGrid } from '@/components/timeline/TimelineGrid'
import { renderWithClient } from '@/test/render'
import type { TimelineCapacity, TimelineItem, TimelineResource } from '@/types/timeline'

/**
 * La rejilla por semanas: la Fase 58 abre una semana, no el horizonte entero del plan, y la
 * jornada es de cada persona. Se pinta el componente con datos a mano —sin red— porque lo que se
 * prueba es la ventana temporal y la celda, no la carga.
 */

/** «Hoy» fijo: con la fecha real, el ancla y la marca de hoy cambiarían según el día de ejecución. */
const HOY = new Date(2026, 9, 21, 9, 0) // miércoles 21 de octubre de 2026

function capacityOf(from: string, to: string, hours: number): TimelineCapacity[] {
  const rows: TimelineCapacity[] = []
  const date = new Date(from)

  while (date.toISOString().slice(0, 10) <= to) {
    rows.push({
      date: date.toISOString().slice(0, 10),
      availableHours: hours,
      occupiedHours: 0,
      remainingHours: hours,
    })
    date.setDate(date.getDate() + 1)
  }

  return rows
}

function person(developerId: string, capacity: TimelineCapacity[]): TimelineResource {
  return { developerId, capacity }
}

function days(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-day"]')]
}

function row(container: HTMLElement, index: number) {
  return container.querySelectorAll<HTMLElement>('[data-slot="timeline-resource"]')[index]
}

/** Un tramo del 21 o el 22 de octubre de 2026, dentro de la semana que abre la rejilla. */
function item(day: string, from: string, to: string, hours: number): TimelineItem {
  return {
    workItemId: `WI-${day.slice(8)}${from}`,
    workItemType: 'REQUERIMIENTO',
    startsAt: `${day}T${from}:00`,
    endsAt: `${day}T${to}:00`,
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

beforeEach(() => {
  // Solo el reloj: el resto de temporizadores sigue real, que es lo que espera la rejilla.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(HOY)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TimelineGrid por semanas', () => {
  it('abre en la semana de hoy y navega anterior, siguiente y vuelta a hoy', () => {
    // Ventana de cuatro semanas: la navegación tiene por dónde moverse.
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[]}
        names={{ ana: 'Ana' }}
      />,
    )

    const label = () => screen.getByText(/^Semana \d+/).textContent
    const header = () => days(container).map((day) => day.textContent)
    const button = (name: RegExp) => screen.getByRole('button', { name })

    // La vista abre en la semana que contiene hoy, no en el primer día de la ventana.
    expect(label()).toMatch(/^Semana 43 · /)
    expect(header()).toHaveLength(7)
    expect(header()[0]).toContain('19')
    expect(header()[6]).toContain('25')

    fireEvent.click(button(/Semana siguiente/))
    expect(label()).toMatch(/^Semana 44 · /)
    expect(header()[0]).toContain('26')

    // El domingo 1 de noviembre cierra la última semana de la ventana: no hay una más.
    fireEvent.click(button(/Semana siguiente/))
    expect(label()).toMatch(/^Semana 44 · /)
    expect(button(/Semana siguiente/)).toBeDisabled()

    fireEvent.click(button(/Volver a hoy/))
    expect(label()).toMatch(/^Semana 43 · /)
    expect(button(/Volver a hoy/)).toBeDisabled()

    // Tres semanas atrás se llega al borde y se detiene ahí.
    fireEvent.click(button(/Semana anterior/))
    fireEvent.click(button(/Semana anterior/))
    expect(label()).toMatch(/^Semana 41 · /)
    fireEvent.click(button(/Semana anterior/))
    expect(label()).toMatch(/^Semana 41 · /)
    expect(button(/Semana anterior/)).toBeDisabled()
  })

  it('sábado y domingo se pintan siempre, y la jornada la decide cada persona', () => {
    // Ana trabaja los siete días; Beto cierra el fin de semana. La misma rejilla, dos respuestas:
    // por eso la cabecera ya no habla por el equipo.
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[
          person('ana', capacityOf('2026-10-19', '2026-10-25', 8)),
          person('beto', [
            ...capacityOf('2026-10-19', '2026-10-23', 8),
            { date: '2026-10-24', availableHours: 0, occupiedHours: 0, remainingHours: 0 },
            { date: '2026-10-25', availableHours: 0, occupiedHours: 0, remainingHours: 0 },
          ]),
        ]}
        items={[]}
        names={{ ana: 'Ana', beto: 'Beto' }}
      />,
    )

    expect(days(container)).toHaveLength(7)
    // La cabecera no marca días: no hay un «fin de semana del equipo» que valga para todos.
    expect(days(container).some((day) => day.dataset.working !== undefined)).toBe(false)

    const cells = (index: number) => [
      ...row(container, index).querySelectorAll<HTMLElement>('[data-slot="timeline-cell"]'),
    ]

    expect(cells(0).map((cell) => cell.dataset.working)).toEqual(Array(7).fill('true'))
    expect(cells(1).map((cell) => cell.dataset.working)).toEqual([
      'true',
      'true',
      'true',
      'true',
      'true',
      'false',
      'false',
    ])

    // El sábado de Ana tiene jornada; el de Beto lo dice en su celda, no en la columna.
    expect(cells(0)[5].querySelector('[data-slot="timeline-not-working"]')).toBeNull()
    expect(cells(1)[5].textContent).toContain('no laborable')
    expect(cells(1)[6].textContent).toContain('no laborable')
  })

  it('un día sin fila de capacidad no se declara ni laborable ni cerrado', () => {
    // Un recurso sin plan no trae capacidad. «Desconocido» no es «no laborable»: la celda no puede
    // afirmar una jornada que nadie publicó.
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-19', '2026-10-20', 8))]}
        items={[]}
        names={{ ana: 'Ana' }}
      />,
    )

    const cells = [
      ...row(container, 0).querySelectorAll<HTMLElement>('[data-slot="timeline-cell"]'),
    ]

    expect(cells.map((cell) => cell.dataset.working)).toEqual([
      'true',
      'true',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ])
    expect(cells[2].textContent).not.toContain('no laborable')
  })

  it('la escala horaria vive en su propio rail y el tramo siempre dice sus horas', () => {
    // Un tramo corto (30 min) y uno largo (5 h) el mismo día, más uno de 15 min al siguiente.
    // Con el zoom normal (44 px/h) el corto mide 22 px y el de 15 min 11: ese se pinta con el
    // alto mínimo y lo advierte, en vez de mentir sobre su final.
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-19', '2026-10-25', 8))]}
        items={[
          item('2026-10-21', '09:00', '09:30', 0.5),
          item('2026-10-21', '09:30', '14:30', 5),
          item('2026-10-22', '10:00', '10:15', 0.25),
        ]}
        names={{ ana: 'Ana' }}
      />,
    )

    const rail = row(container, 0).querySelector<HTMLElement>('[data-slot="timeline-hour-rail"]')
    expect(rail).not.toBeNull()

    // La jornada es fija, de 07:00 a 17:30, y se rotula hasta su hora de cierre aunque los tramos
    // del día solo ocupen de 09:00 a 15:00: la escala no cambia con la carga del día.
    const labels = [...rail!.querySelectorAll('span')].map((span) => span.textContent)
    expect(labels).toEqual([
      '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00',
      '17:00', '17:30',
    ])
    expect(rail!.nextElementSibling?.getAttribute('data-slot')).toBe('timeline-cell')

    const blocks = [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-block"]')]
    const [corto, largo, quinceMinutos] = blocks

    // El corto no tiene alto para la segunda línea, así que sus horas van en la primera.
    expect(corto.querySelector('[data-slot="timeline-block-time"]')?.textContent).toBe(
      '09:00–09:30',
    )
    // El largo sí: conserva la línea completa con las horas y la duración.
    expect(largo.querySelector('[data-slot="timeline-block-time"]')).toBeNull()
    expect(largo.textContent).toContain('09:30–14:30 · 5 h')

    // Quince minutos no llegan al alto mínimo: se marca el recorte en vez de simularlo.
    expect(quinceMinutos.dataset.clamped).toBe('true')
    expect(quinceMinutos.style.height).toBe('18px')

    // «Detalle» prioriza la lectura del tiempo: el mismo tramo ya mide lo que dura y no se recorta.
    fireEvent.click(screen.getByRole('button', { name: 'Detalle' }))
    expect(quinceMinutos.dataset.clamped).toBeUndefined()
    expect(quinceMinutos.style.height).toBe('30px')
  })

  it('un día con cinco tramos no degrada la lectura: ninguno pierde sus horas ni se pisa', () => {
    // Ninguna persona de los datos vivos pasa de cuatro tramos en un día. El quinto se pinta igual
    // que el primero porque el alto no depende del número de vecinos: se comprueba aquí.
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-19', '2026-10-25', 8))]}
        items={[
          item('2026-10-21', '08:00', '08:30', 0.5),
          item('2026-10-21', '08:30', '09:15', 0.75),
          item('2026-10-21', '09:15', '11:15', 2),
          item('2026-10-21', '11:15', '12:00', 0.75),
          item('2026-10-21', '12:00', '17:00', 5),
        ]}
        names={{ ana: 'Ana' }}
      />,
    )

    const blocks = [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-block"]')]
    expect(blocks).toHaveLength(5)

    // Cada uno dice su horario, sea en la segunda línea o, si no cabe, en la primera.
    for (const block of blocks) {
      expect(block.textContent).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/)
    }

    // Y cada uno empieza donde termina el anterior: el quinto no se come al cuarto.
    const spans = blocks.map((block) => ({
      top: Number.parseFloat(block.style.top),
      height: Number.parseFloat(block.style.height),
    }))
    spans.slice(1).forEach((span, index) => {
      expect(span.top).toBeCloseTo(spans[index].top + spans[index].height, 5)
    })
  })

  it('el chip de pendientes es la acción: enlace si hay uno, botón si hay varios', () => {
    const onPendingSelect = vi.fn()
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[
          person('ana', capacityOf('2026-10-19', '2026-10-25', 8)),
          person('beto', capacityOf('2026-10-19', '2026-10-25', 8)),
        ]}
        items={[]}
        names={{ ana: 'Ana', beto: 'Beto' }}
        pending={{ ana: 1, beto: 5 }}
        pendingLinks={{ ana: '/declaraciones?tecnico=ana&ticket=502' }}
        onPendingSelect={onPendingSelect}
      />,
    )

    const chips = container.querySelectorAll<HTMLElement>('[data-slot="timeline-pending"]')
    expect([...chips].map((chip) => chip.textContent)).toEqual(['1 pendiente', '5 pendientes'])

    // Un solo pendiente: el chip es el enlace a donde se resuelve, con la ruta que calculó quien
    // llama —la misma del panel—, no una ruta armada aquí.
    expect(chips[0].tagName).toBe('A')
    expect(chips[0].getAttribute('href')).toBe('/declaraciones?tecnico=ana&ticket=502')

    // Varios: no hay un ticket único que abrir, así que el chip pide filtrar el panel.
    expect(chips[1].tagName).toBe('BUTTON')
    fireEvent.click(chips[1])
    expect(onPendingSelect).toHaveBeenCalledWith('beto')
  })
})

/**
 * La duración multidía, el día de entrega y los tickets sin horas.
 *
 * Los tres son la misma pregunta: qué dice la rejilla de un trabajo que ocupa más de una jornada o
 * de ninguno. El plan ya parte esos trabajos en un tramo por día; lo que se prueba aquí es que la
 * vista los lea como uno solo.
 */
describe('TimelineGrid: duración y estado visual', () => {
  function blocks(container: HTMLElement) {
    return [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-block"]')]
  }

  function inBlock(element: HTMLElement, slot: string) {
    return element.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
  }

  it('dos jornadas del mismo trabajo se leen como día 1 de 2 y día 2 de 2, con entrega en el último', () => {
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[
          // Martes 20, 8 h, y miércoles 21: el ejemplo del enunciado, con la fecha objetivo en el
          // primer día como la coloca el motor.
          { ...item('2026-10-20', '07:00', '15:30', 8), workItemId: 'REQ-9' },
          { ...item('2026-10-21', '07:00', '15:30', 8), workItemId: 'REQ-9' },
        ]}
        names={{ ana: 'Ana' }}
      />,
    )

    const [first, second] = blocks(container)

    expect(first?.textContent).toContain('día 1 de 2')
    expect(second?.textContent).toContain('día 2 de 2')

    // La entrega es el último día y solo el último.
    expect(first?.dataset.delivery).toBeUndefined()
    expect(second?.dataset.delivery).toBe('true')
    expect(inBlock(second!, 'timeline-delivery')).not.toBeNull()
    expect(inBlock(first!, 'timeline-delivery')).toBeNull()

    // El chevron dice que el trabajo sigue a la derecha; el otro, que viene de la izquierda.
    expect(inBlock(first!, 'timeline-continues')).not.toBeNull()
    expect(inBlock(first!, 'timeline-continued')).toBeNull()
    expect(inBlock(second!, 'timeline-continues')).toBeNull()
    expect(inBlock(second!, 'timeline-continued')).not.toBeNull()

    // La barra inferior acompaña a la entrega: es la marca que se ve de un vistazo.
    expect(inBlock(second!, 'timeline-delivery-bar')).not.toBeNull()
    expect(inBlock(first!, 'timeline-delivery-bar')).toBeNull()
  })

  it('un trabajo de un día es su propio día de entrega y no lleva chevrones', () => {
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[item('2026-10-21', '07:00', '15:30', 8)]}
        names={{ ana: 'Ana' }}
      />,
    )

    const [only] = blocks(container)

    expect(only?.dataset.delivery).toBe('true')
    expect(inBlock(only!, 'timeline-delivery')).not.toBeNull()
    expect(inBlock(only!, 'timeline-continues')).toBeNull()
    expect(inBlock(only!, 'timeline-continued')).toBeNull()
  })

  it('el ticket sin horas se enseña en su día sin ocupar la jornada', () => {
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[]}
        names={{ ana: 'Ana' }}
        unscheduled={[
          {
            workItemId: '68428',
            workItemType: 'REQUERIMIENTO',
            developerId: 'ana',
            date: '2026-10-21',
            cause: 'Sin estimación',
          },
        ]}
      />,
    )

    const ghost = container.querySelector<HTMLElement>('[data-slot="timeline-unscheduled"]')

    expect(ghost).not.toBeNull()
    expect(ghost?.dataset.workItem).toBe('68428')
    expect(ghost?.textContent).toContain('Sin estimación')

    // No es un tramo: no entra en la escala ni en los filtros de la agenda.
    expect(blocks(container)).toHaveLength(0)

    // La franja se reserva en todas las celdas de la semana, no solo en la que tiene el ticket:
    // si solo la reservara esa, su escala de horas empezaría más abajo y las filas no alinearían.
    const bands = container.querySelectorAll('[data-slot="timeline-unscheduled-band"]')
    expect(bands).toHaveLength(days(container).length)
  })

  it('la leyenda solo lista los estados que están en la semana', () => {
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[
          { ...item('2026-10-20', '07:00', '15:30', 8), workItemId: 'REQ-A' },
          {
            ...item('2026-10-21', '07:00', '15:30', 8),
            workItemId: 'REQ-B',
            planningStatus: 'DESPLAZADO',
          },
        ]}
        names={{ ana: 'Ana' }}
        states={{ 'REQ-A': 'ACORDADO_GLPI' }}
      />,
    )

    const legend = [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-legend-state"]')]

    // ACORDADO_GLPI gana al estado del plan, y ningún estado ausente se anuncia con su color.
    expect(legend.map((entry) => entry.dataset.state)).toEqual(['DESPLAZADO', 'ACORDADO_GLPI'])
    // Los rótulos se leen dentro de la leyenda: el mismo texto está en el tramo, y ahí no es la leyenda.
    expect(legend.map((entry) => entry.textContent)).toEqual(['Desplazado', 'Acordado en GLPI'])
  })

  it('con un ticket sin horas, la leyenda explica ese estado aunque no haya tramos', () => {
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[]}
        names={{ ana: 'Ana' }}
        unscheduled={[
          {
            workItemId: '68428',
            workItemType: 'REQUERIMIENTO',
            developerId: 'ana',
            date: '2026-10-21',
            cause: 'Sin estimación',
          },
        ]}
      />,
    )

    const legend = [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-legend-state"]')]

    expect(legend.map((entry) => entry.dataset.state)).toEqual(['SIN_ESTIMACION'])
    expect(legend[0]?.textContent).toBe('Requiere estimación')
  })
})
