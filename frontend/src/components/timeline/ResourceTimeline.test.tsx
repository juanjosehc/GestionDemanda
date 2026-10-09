import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResourceTimeline } from '@/components/timeline/ResourceTimeline'
import { renderWithClient } from '@/test/render'
import { DEVELOPER_ID, PLAN_ID, timelineFixture } from '@/test/fixtures'

const fetchMock = vi.fn()

/**
 * Respuesta minima que satisface a apiClient (ok, status, json). No hace falta un Response real
 * ni interceptar la red: el cliente solo lee esos tres miembros.
 */
function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const TIMELINE_URL = `/api/planning/${PLAN_ID}/timeline`

function renderTimeline() {
  return renderWithClient(<ResourceTimeline planId={PLAN_ID} />)
}

function blocks(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="timeline-block"]')
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ResourceTimeline', () => {
  it('carga el timeline del plan y solo pide su agenda', async () => {
    fetchMock.mockResolvedValue(okResponse(timelineFixture()))

    renderTimeline()

    expect(await screen.findByText('INC-1')).toBeInTheDocument()
    expect(screen.getAllByText(DEVELOPER_ID).length).toBeGreaterThan(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(TIMELINE_URL, expect.objectContaining({ method: 'GET' }))
  })

  it('muestra el estado vacio cuando el plan no tiene agenda', async () => {
    fetchMock.mockResolvedValue(
      okResponse(timelineFixture({ from: null, to: null, resources: [], items: [] })),
    )

    const { container } = renderTimeline()

    expect(await screen.findByText('Este plan no tiene agenda')).toBeInTheDocument()
    expect(blocks(container)).toHaveLength(0)
  })

  it('pinta una sola fila con un solo recurso', async () => {
    fetchMock.mockResolvedValue(okResponse(timelineFixture()))

    const { container } = renderTimeline()
    await screen.findByText('INC-1')

    expect(container.querySelectorAll('[data-slot="timeline-resource"]')).toHaveLength(1)
  })

  it('pinta un bloque por tramo', async () => {
    fetchMock.mockResolvedValue(okResponse(timelineFixture()))

    const { container } = renderTimeline()
    await screen.findByText('INC-1')

    expect(blocks(container)).toHaveLength(3)
    expect(screen.getByText('REQ-1')).toBeInTheDocument()
    expect(screen.getByText('REQ-2')).toBeInTheDocument()
  })

  it('distingue los tramos desplazados de los planificados', async () => {
    fetchMock.mockResolvedValue(okResponse(timelineFixture()))

    const { container } = renderTimeline()
    await screen.findByText('INC-1')

    const displaced = container.querySelectorAll('[data-slot="timeline-block"][data-status="DESPLAZADO"]')
    const planned = container.querySelectorAll('[data-slot="timeline-block"][data-status="PLANIFICADO"]')

    expect(displaced).toHaveLength(2)
    expect(planned).toHaveLength(1)
    expect(within(displaced[0] as HTMLElement).getByText('Desplazado')).toBeInTheDocument()
    expect(within(planned[0] as HTMLElement).queryByText('Desplazado')).not.toBeInTheDocument()
  })

  it('muestra la capacidad de cada dia tal como llega', async () => {
    fetchMock.mockResolvedValue(okResponse(timelineFixture()))

    renderTimeline()
    await screen.findByText('INC-1')

    expect(screen.getAllByText('8 disp')).toHaveLength(2)
    expect(screen.getByText('8 ocup')).toBeInTheDocument()
    expect(screen.getByText('0 libre')).toBeInTheDocument()
    expect(screen.getByText('2 ocup')).toBeInTheDocument()
    expect(screen.getByText('6 libre')).toBeInTheDocument()
  })

  it('informa el error de carga con el mensaje del backend', async () => {
    fetchMock.mockResolvedValue(errorResponse(404, { message: 'No existe un plan con ese identificador' }))

    renderTimeline()

    expect(await screen.findByText('No fue posible cargar la agenda')).toBeInTheDocument()
    expect(screen.getByText('No existe un plan con ese identificador')).toBeInTheDocument()
  })

  it('sin planId muestra el estado vacio y no consulta el endpoint', () => {
    renderWithClient(<ResourceTimeline />)

    expect(screen.getByText('Sin plan seleccionado')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('filtra por estado en memoria, sin volver a consultar', async () => {
    fetchMock.mockResolvedValue(okResponse(timelineFixture()))

    const { container } = renderTimeline()
    await screen.findByText('INC-1')

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'DESPLAZADO' } })

    expect(blocks(container)).toHaveLength(2)
    expect(screen.queryByText('INC-1')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
