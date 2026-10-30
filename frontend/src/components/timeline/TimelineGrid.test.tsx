import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TimelineGrid } from '@/components/timeline/TimelineGrid'
import { UNSCHEDULED_HEIGHT } from '@/lib/timeline'
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
            time: '13:53',
            cause: 'Sin estimación',
          },
        ]}
      />,
    )

    const ghost = container.querySelector<HTMLElement>('[data-slot="timeline-unscheduled"]')

    expect(ghost).not.toBeNull()
    expect(ghost?.dataset.workItem).toBe('68428')
    expect(ghost?.textContent).toContain('Sin estimación')

    // El día del ticket sin horas es su fecha de entrega, y se ve sin abrir el título: es la marca
    // que convierte el Internal TTR en el ancla de la columna y no un aviso suelto dentro de ella.
    const commitment = ghost?.querySelector('[data-slot="timeline-unscheduled-commitment"]')
    expect(commitment).not.toBeNull()
    expect(commitment?.getAttribute('aria-label')).toBe('Fecha de entrega comprometida en GLPI')

    // No es un tramo: no entra en la escala ni en los filtros de la agenda.
    expect(blocks(container)).toHaveLength(0)

    // **No hay franja aparte.** La Fase 72 borró la banda horizontal: el marcador vive dentro del
    // cuerpo del día, colocado por la hora del Internal TTR.
    expect(container.querySelector('[data-slot="timeline-unscheduled-band"]')).toBeNull()
    expect(ghost?.dataset.time).toBe('13:53')
    expect(ghost?.parentElement?.className).toContain('relative')
  })

  it('el marcador es un botón solo cuando hay a quién avisar, y dice si está elegido', () => {
    /*
      El marcador nació como una etiqueta: decía «este ticket existe y no tiene horas» y no se podía
      pulsar. Desde la Fase 76 es la puerta al panel del ticket, pero **solo si alguien la escucha**:
      sin la prop sigue siendo un `div`, para que una rejilla sin acción no anuncie un botón muerto.
    */
    const ghost = {
      workItemId: '68428',
      workItemType: 'REQUERIMIENTO' as const,
      developerId: 'ana',
      date: '2026-10-21',
      time: '13:53',
      cause: 'Sin estimación',
    }

    const mudo = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[]}
        names={{ ana: 'Ana' }}
        unscheduled={[ghost]}
      />,
    ).container.querySelector<HTMLElement>('[data-slot="timeline-unscheduled"]')!

    expect(mudo.tagName).toBe('DIV')
    expect(mudo.getAttribute('aria-pressed')).toBeNull()

    const onTicketSelect = vi.fn()
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[]}
        names={{ ana: 'Ana' }}
        unscheduled={[ghost]}
        onTicketSelect={onTicketSelect}
        selectedTicket="68428"
      />,
    )

    const marcador = container.querySelector<HTMLElement>('[data-slot="timeline-unscheduled"]')!

    expect(marcador.tagName).toBe('BUTTON')
    expect(marcador.getAttribute('type')).toBe('button')
    // `aria-pressed` es lo que dice «este es el ticket que el panel está enseñando».
    expect(marcador.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(marcador)
    expect(onTicketSelect).toHaveBeenCalledTimes(1)
    expect(onTicketSelect.mock.calls[0]?.[0]).toMatchObject({ workItemId: '68428' })
  })

  it('el ticket sin estimación cae en su hora y no al principio del día', () => {
    const ghosts = [
      { workItemId: 'A', date: '2026-10-21', time: '13:00' },
      { workItemId: 'B', date: '2026-10-22', time: '13:53' },
      { workItemId: 'C', date: '2026-10-23', time: '14:00' },
    ]

    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[]}
        names={{ ana: 'Ana' }}
        unscheduled={ghosts.map((ghost) => ({
          ...ghost,
          workItemType: 'REQUERIMIENTO' as const,
          developerId: 'ana',
          cause: 'Sin estimación',
        }))}
      />,
    )

    const tops = ['A', 'B', 'C'].map((id) => {
      const mark = container.querySelector<HTMLElement>(
        `[data-slot="timeline-unscheduled"][data-work-item="${id}"]`,
      )
      return parseFloat(mark!.style.top)
    })

    // 13:53 está a 53 de los 60 minutos que separan las 13:00 de las 14:00: la posición es
    // proporcional a la hora y no un reparto de la columna.
    expect((tops[1]! - tops[0]!) / (tops[2]! - tops[0]!)).toBeCloseTo(53 / 60, 2)
  })

  it('varios tickets a la misma hora se apilan y siguen diciendo su hora', () => {
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[]}
        names={{ ana: 'Ana' }}
        unscheduled={['A', 'B', 'C'].map((workItemId) => ({
          workItemId,
          workItemType: 'REQUERIMIENTO' as const,
          developerId: 'ana',
          date: '2026-10-21',
          // 17:30 es el cierre de la jornada y la hora que GLPI más repite: la peor de las colisiones.
          time: '17:30',
          cause: 'Sin estimación',
        }))}
      />,
    )

    const marks = [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-unscheduled"]')]
    const tops = marks.map((mark) => parseFloat(mark.style.top))

    expect(marks.map((mark) => mark.dataset.time)).toEqual(['17:30', '17:30', '17:30'])
    expect(tops[1]! - tops[0]!).toBeCloseTo(UNSCHEDULED_HEIGHT, 0)
    expect(tops[2]! - tops[1]!).toBeCloseTo(UNSCHEDULED_HEIGHT, 0)
  })

  it('un ticket fuera del eje se pega al borde y escribe su hora', () => {
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-05', '2026-11-01', 8))]}
        items={[]}
        names={{ ana: 'Ana' }}
        unscheduled={[
          {
            workItemId: 'NOCHE',
            workItemType: 'REQUERIMIENTO',
            developerId: 'ana',
            date: '2026-10-21',
            time: '23:30',
            cause: 'Sin estimación',
          },
        ]}
      />,
    )

    const mark = container.querySelector<HTMLElement>('[data-slot="timeline-unscheduled"]')!

    // El eje lo fija el plan (07:00-17:30), no los compromisos: 23:30 no cabe, así que el marcador
    // se pega al borde inferior y la hora se escribe para no fingir que esa posición es la suya.
    expect(mark.dataset.outside).toBe('true')
    expect(mark.textContent).toContain('23:30')
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
            time: '13:53',
            cause: 'Sin estimación',
          },
        ]}
      />,
    )

    const legend = [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-legend-state"]')]

    expect(legend.map((entry) => entry.dataset.state)).toEqual(['SIN_ESTIMACION'])
    expect(legend[0]?.textContent).toBe('Requiere estimación')
  })

  it('el chip sin estimación dice su riesgo con icono y con etiqueta', () => {
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-19', '2026-10-25', 8))]}
        items={[]}
        unscheduled={[
          {
            workItemId: '66222',
            workItemType: 'REQUERIMIENTO',
            developerId: 'ana',
            date: '2026-10-21',
            time: '13:53',
            cause: 'Sin estimación',
          },
        ]}
        risks={{ '66222': 'HOY' }}
      />,
    )

    const ghost = container.querySelector<HTMLElement>('[data-slot="timeline-unscheduled"]')
    expect(ghost?.dataset.risk).toBe('HOY')

    // El riesgo no depende del color: el icono cambia y el `aria-label` lo dice en palabras.
    const mark = ghost?.querySelector('[data-slot="timeline-unscheduled-commitment"]')
    expect(mark?.getAttribute('aria-label')).toBe('Entrega hoy')

    // Y se explica en la leyenda sin abrir el título.
    const legend = [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-legend-risk"]')]
    expect(legend.map((entry) => entry.dataset.risk)).toEqual(['HOY'])
    expect(legend[0]?.textContent).toBe('Entrega hoy')
  })

  it('sin riesgo el chip sigue diciendo que ese día es la fecha de GLPI', () => {
    // El riesgo es una capa encima: si no se pasa, el chip conserva la marca que tenía.
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-19', '2026-10-25', 8))]}
        items={[]}
        unscheduled={[
          {
            workItemId: '68428',
            workItemType: 'REQUERIMIENTO',
            developerId: 'ana',
            date: '2026-10-21',
            time: '13:53',
            cause: 'Sin estimación',
          },
        ]}
        risks={{ '68428': 'FUTURA' }}
      />,
    )

    const ghost = container.querySelector<HTMLElement>('[data-slot="timeline-unscheduled"]')
    expect(ghost?.dataset.risk).toBeUndefined()
    expect(
      ghost?.querySelector('[data-slot="timeline-unscheduled-commitment"]')?.getAttribute('aria-label'),
    ).toBe('Fecha de entrega comprometida en GLPI')
    expect(container.querySelectorAll('[data-slot="timeline-legend-risk"]')).toHaveLength(0)
  })

  it('la bandera de entrega cambia de icono cuando el compromiso apremia', () => {
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[person('ana', capacityOf('2026-10-19', '2026-10-25', 8))]}
        items={[item('2026-10-21', '07:00', '11:00', 4)]}
        risks={{ [item('2026-10-21', '07:00', '11:00', 4).workItemId]: 'VENCIDA' }}
      />,
    )

    const flag = container.querySelector<HTMLElement>('[data-slot="timeline-delivery"]')
    expect(flag?.dataset.risk).toBe('VENCIDA')
    expect(flag?.getAttribute('aria-label')).toBe('Entrega vencida')

    // El relleno del tramo no se toca: el estado del plan es otro eje y se sigue leyendo.
    const block = container.querySelector<HTMLElement>('[data-slot="timeline-block"]')
    expect(block?.dataset.state).toBe('PLANIFICADO')
  })

  it('la fila solo dice lo que ningún contador dice ya, y ninguna dice «Sin plan»', () => {
    // Cuatro personas en una rejilla: con tramos, con un compromiso que GLPI fecha y nadie estimó,
    // con pendientes que no están en el plan, y sin nada. Las dos del medio tienen trabajo y sus
    // chips ya lo cuentan, así que bajo el nombre no dicen nada: repetirlo era el problema.
    const { container } = renderWithClient(
      <TimelineGrid
        resources={[
          person('ana', capacityOf('2026-10-19', '2026-10-25', 8)),
          person('beto', capacityOf('2026-10-19', '2026-10-25', 8)),
          person('caro', capacityOf('2026-10-19', '2026-10-25', 8)),
          person('dani', capacityOf('2026-10-19', '2026-10-25', 8)),
        ]}
        items={[item('2026-10-21', '09:00', '11:00', 2), item('2026-10-22', '09:00', '10:00', 1)]}
        names={{ ana: 'Ana', beto: 'Beto', caro: 'Caro', dani: 'Dani' }}
        pending={{ caro: 1 }}
        unscheduled={[
          {
            workItemId: '66120',
            workItemType: 'REQUERIMIENTO',
            developerId: 'beto',
            date: '2026-10-21',
            time: '17:00',
            cause: 'Sin estimación',
          },
        ]}
      />,
    )

    const estados = [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-resource-state"]')]
    expect(estados.map((estado) => estado.dataset.state)).toEqual(['TRAMOS', 'SIN_TRABAJO'])
    expect(estados.map((estado) => estado.textContent)).toEqual(['2 tramos', 'Sin trabajo activo'])

    // Beto y Caro tienen trabajo: sus chips y su marcador lo dicen, y la fila se calla.
    const enSilencio = [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-resource"]')]
      .filter((row) => row.querySelector('[data-slot="timeline-resource-state"]') === null)
    expect(enSilencio).toHaveLength(2)
    expect(screen.queryByText('Sin estimación')).toBeNull()
    expect(screen.queryByText('Sin tramos')).toBeNull()
    expect(container.textContent).not.toContain('Sin plan')
  })
})
