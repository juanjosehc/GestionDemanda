import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router-dom'

import { Dashboard } from '@/pages/Dashboard'
import { renderWithClient } from '@/test/render'
import {
  DEVELOPER_ID,
  FULL_DEVELOPER_ID,
  OVER_DEVELOPER_ID,
  PLAN_ID,
  planningMetricsFixture,
} from '@/test/fixtures'

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

const METRICS_URL = '/api/planning/metrics'

/** La tarjeta que contiene ese rotulo, para poder afirmar su cifra sin chocar con las demas. */
function cardOf(label: string): HTMLElement {
  const card = screen.getByText(label).closest('[data-slot="card"]')

  if (!card) {
    throw new Error(`No hay tarjeta para "${label}"`)
  }

  return card as HTMLElement
}

function rows(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="developer-row"]')
}

/**
 * Escribe la direccion actual para poder afirmar a donde lleva una tarjeta.
 *
 * El tablero no declara rutas hijas, asi que basta con montar el indicador junto a el dentro del
 * mismo router: al pulsar un enlace, el router navega y el indicador lo refleja.
 */
function LocationProbe() {
  const location = useLocation()
  return <p data-slot="location">{location.pathname}</p>
}

function currentPath(container: HTMLElement): string | undefined {
  return container.querySelector('[data-slot="location"]')?.textContent ?? undefined
}

function renderDashboard() {
  return renderWithClient(<Dashboard />)
}

function renderDashboardWithLocation() {
  return renderWithClient(
    <>
      <Dashboard />
      <LocationProbe />
    </>,
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Dashboard', () => {
  it('carga la fotografia operativa y solo pide ese endpoint', async () => {
    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))

    renderDashboard()

    expect(await screen.findByText('Tickets planificables')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(METRICS_URL, expect.objectContaining({ method: 'GET' }))
  })

  it('muestra las nueve metricas tal como llegan del backend', async () => {
    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))

    renderDashboard()
    await screen.findByText('Tickets planificables')

    const expected = [
      ['Tickets planificables', '34'],
      ['Sin estimación', '4'],
      ['Sin compromiso', '2'],
      ['Metadata incompleta', '6'],
      ['Requerimientos desplazados', '5'],
      ['Planes generados', '9'],
      ['Capacidad disponible', '160'],
      ['Capacidad ocupada', '163'],
      ['Capacidad restante', '-3'],
    ] as const

    for (const [label, value] of expected) {
      expect(within(cardOf(label)).getByText(value)).toBeInTheDocument()
    }
  })

  it('declara de donde sale cada bloque con el texto que envia el backend', async () => {
    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))

    renderDashboard()
    await screen.findByText('De dónde sale cada cifra')

    expect(screen.getByText('planning_metadata')).toBeInTheDocument()
    expect(screen.getByText('plan_snapshot')).toBeInTheDocument()
    expect(
      screen.getByText('plan_snapshot.created_at + work_block + planning_context'),
    ).toBeInTheDocument()

    expect(screen.getByText('estado declarado hoy, sin ventana temporal')).toBeInTheDocument()
  })

  it('desglosa la capacidad del plan vigente de cada desarrollador', async () => {
    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))

    const { container } = renderDashboard()
    await screen.findByText('Cuellos de botella por desarrollador')

    expect(rows(container)).toHaveLength(3)

    const withSlack = rows(container)[0] as HTMLElement
    expect(within(withSlack).getByText(DEVELOPER_ID)).toBeInTheDocument()
    expect(within(withSlack).getByText(PLAN_ID)).toBeInTheDocument()
    expect(within(withSlack).getByText('80')).toBeInTheDocument()
    expect(within(withSlack).getByText('71')).toBeInTheDocument()
    expect(within(withSlack).getByText('9')).toBeInTheDocument()

    expect(within(rows(container)[1] as HTMLElement).getByText(FULL_DEVELOPER_ID)).toBeInTheDocument()
    expect(within(rows(container)[2] as HTMLElement).getByText(OVER_DEVELOPER_ID)).toBeInTheDocument()
  })

  it('resalta la capacidad agotada, la negativa y los desplazamientos', async () => {
    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))

    const { container } = renderDashboard()
    await screen.findByText('Cuellos de botella por desarrollador')

    expect(container.querySelectorAll('[data-slot="developer-row"][data-remaining="ok"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="developer-row"][data-remaining="full"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="developer-row"][data-remaining="over"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="developer-row"][data-displaced="true"]')).toHaveLength(1)

    // El valor no se sustituye por una etiqueta: el cero y el negativo siguen a la vista.
    const atLimit = container.querySelector('[data-remaining="full"]') as HTMLElement
    const overrun = container.querySelector('[data-remaining="over"]') as HTMLElement

    expect(within(atLimit).getByText('0')).toBeInTheDocument()
    expect(within(overrun).getByText('-12')).toBeInTheDocument()
  })

  it('avisa cuando ningun desarrollador tiene plan vigente', async () => {
    const fixture = planningMetricsFixture()
    fetchMock.mockResolvedValue(
      okResponse(planningMetricsFixture({ current: { ...fixture.current, byDeveloper: [] } })),
    )

    const { container } = renderDashboard()
    await screen.findByText('Cuellos de botella por desarrollador')

    expect(screen.getByText('Ningún desarrollador tiene un plan vigente')).toBeInTheDocument()
    expect(rows(container)).toHaveLength(0)
  })

  it('no pinta tarjetas cuando no hay declaraciones ni planes', async () => {
    const fixture = planningMetricsFixture()
    fetchMock.mockResolvedValue(
      okResponse(
        planningMetricsFixture({
          declared: { ...fixture.declared, total: 0 },
          current: { ...fixture.current, byDeveloper: [] },
        }),
      ),
    )

    renderDashboard()

    expect(await screen.findByText('Todavía no hay nada que fotografiar')).toBeInTheDocument()
    expect(screen.queryByText('Tickets planificables')).not.toBeInTheDocument()
  })

  it('informa el error con el mensaje del backend y deja reintentar', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, { message: 'La base de datos no responde' }))

    renderDashboard()

    expect(
      await screen.findByText('No fue posible cargar la fotografía operativa'),
    ).toBeInTheDocument()
    expect(screen.getByText('La base de datos no responde')).toBeInTheDocument()

    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Tickets planificables')).toBeInTheDocument()
  })

  it('no deja rastro de las metricas simuladas de la fase 1', async () => {
    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))

    renderDashboard()
    await screen.findByText('Tickets planificables')

    // Esas tarjetas se fueron con su servicio. Si alguien las repone, esta prueba lo dice.
    const simulated = [
      'Recursos activos',
      'Incidentes abiertos',
      'Requerimientos activos',
      'Ocupación del equipo',
    ]

    for (const label of simulated) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }

    // Una sola lectura, y la de la fotografia: ninguna otra fuente alimenta el tablero.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(METRICS_URL, expect.objectContaining({ method: 'GET' }))
  })

  it('no dibuja ninguna tasa ni barra de ocupacion', async () => {
    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))

    const { container } = renderDashboard()
    await screen.findByText('Tickets planificables')

    // Para una barra habria que dividir bloques de momentos distintos, que el backend prohibe.
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('lleva de cada tarjeta navegable al desglose de sus elementos', async () => {
    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))

    const { container } = renderDashboardWithLocation()
    await screen.findByText('Sin estimación')

    const destino = [
      ['Sin estimación', '/metricas/sin-estimacion'],
      ['Sin compromiso', '/metricas/sin-compromiso'],
      ['Metadata incompleta', '/metricas/metadata-incompleta'],
      ['Requerimientos desplazados', '/metricas/desplazados'],
    ] as const

    for (const [label, path] of destino) {
      // Cada destino es un enlace de verdad: se enfoca con Tab y el lector anuncia su texto.
      fireEvent.click(screen.getByRole('link', { name: label }))
      expect(currentPath(container)).toBe(path)
    }
  })

  it('no convierte en enlace las cifras que no tienen desglose', async () => {
    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))

    renderDashboardWithLocation()
    await screen.findByText('Tickets planificables')

    // Planes generados cuenta ejecuciones sin identidad propia, y la capacidad no tiene lista:
    // son texto. Si alguien las enlaza a una pantalla que no existe, esta prueba lo dice.
    for (const label of ['Tickets planificables', 'Planes generados', 'Capacidad restante']) {
      expect(within(cardOf(label)).queryByRole('link')).toBeNull()
    }
  })

  it('lleva del plan de un desarrollador a su calendario', async () => {
    fetchMock.mockResolvedValue(okResponse(planningMetricsFixture()))

    const { container } = renderDashboardWithLocation()
    await screen.findByText('Cuellos de botella por desarrollador')

    // La capacidad agotada se resalta en la tabla, pero su detalle es el plan: hay que poder abrirlo.
    const enlace = container.querySelector(`a[href="/calendario/${PLAN_ID}"]`)

    expect(enlace).not.toBeNull()
    expect(enlace?.textContent).toBe(PLAN_ID)

    fireEvent.click(enlace as HTMLElement)
    expect(currentPath(container)).toBe(`/calendario/${PLAN_ID}`)
  })
})
