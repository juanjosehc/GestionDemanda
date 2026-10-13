import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Alerts } from '@/pages/Alerts'
import { alertsFixture } from '@/test/fixtures'
import { renderWithClient } from '@/test/render'
import type { OperationalAlert } from '@/types/alerts'

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const ALERTS_URL = '/api/planning/alerts'

function alertRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="alert-row"]')]
}

/** La fila de una condicion concreta, para poder afirmarla sin chocar con las demas. */
function rowOf(container: HTMLElement, type: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-slot="alert-row"][data-type="${type}"]`)

  if (!row) {
    throw new Error(`No hay fila para la alerta "${type}"`)
  }

  return row
}

function typesOf(container: HTMLElement): (string | null)[] {
  return alertRows(container).map((row) => row.getAttribute('data-type'))
}

/**
 * Espera a que la tabla este pintada.
 *
 * No se espera por el nombre de una alerta: el filtro de tipo ofrece esas mismas palabras como
 * opciones, asi que esperar por ellas seria ambiguo. El titulo de la tarjeta es unico.
 */
async function tableRendered() {
  await screen.findByText('Alertas disparadas')
}

/** Aplica un filtro por su etiqueta, como lo haria una persona. */
function chooseFilter(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Alerts', () => {
  it('carga las alertas y solo pide ese endpoint', async () => {
    fetchMock.mockResolvedValue(okResponse(alertsFixture()))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    expect(alertRows(container)).toHaveLength(6)

    // Una sola lectura, y la de las alertas: la pantalla no pide las metricas para comprobar nada.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(ALERTS_URL, expect.objectContaining({ method: 'GET' }))
  })

  it('con la lista vacia lo declara y fecha la evaluacion, sin tabla', async () => {
    fetchMock.mockResolvedValue(okResponse(alertsFixture({ alerts: [] })))

    const { container } = renderWithClient(<Alerts />)

    // `alerts: []` no es un error ni un hueco: es la forma que tiene una alerta de decir que hoy
    // no hay nada que mirar. La fecha es lo que lo distingue de «no se ha mirado».
    expect(await screen.findByText('Ninguna condición exige atención ahora')).toBeInTheDocument()
    expect(screen.getByText(/Se evaluaron las condiciones operativas el .*2026/)).toBeInTheDocument()
    expect(alertRows(container)).toHaveLength(0)
    expect(container.querySelector('table')).toBeNull()
  })

  it('muestra cada alerta tal como la publica el backend', async () => {
    const fixture = alertsFixture()
    fetchMock.mockResolvedValue(okResponse(fixture))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    // La severidad, el tipo, la condicion, la procedencia y el ambito salen del JSON, sin traducir.
    const negativa = rowOf(container, 'CAPACIDAD_NEGATIVA')
    expect(within(negativa).getByText('CRITICAL')).toBeInTheDocument()
    expect(
      within(negativa).getByText('planes vigentes cuya capacidad restante es negativa'),
    ).toBeInTheDocument()
    expect(within(negativa).getByText('1')).toBeInTheDocument()
    expect(within(negativa).getByText(fixture.alerts[0].source)).toBeInTheDocument()
    expect(within(negativa).getByText(fixture.alerts[0].scope)).toBeInTheDocument()

    // Las tres severidades estan a la vista y ninguna se sustituye por una etiqueta propia.
    expect(container.querySelectorAll('[data-slot="alert-row"][data-severity="CRITICAL"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="alert-row"][data-severity="WARNING"]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-slot="alert-row"][data-severity="INFO"]')).toHaveLength(1)

    expect(within(rowOf(container, 'SIN_ESTIMACION')).getByText('4')).toBeInTheDocument()
    expect(within(rowOf(container, 'METADATA_INCOMPLETA')).getByText('6')).toBeInTheDocument()

    // El instante de la respuesta va fechado en un elemento de tiempo, no en texto suelto.
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe(fixture.generatedAt)
  })

  it('pinta las alertas en el orden que publica el backend', async () => {
    const fixture = alertsFixture()
    fetchMock.mockResolvedValue(okResponse(fixture))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    expect(typesOf(container)).toEqual(fixture.alerts.map((alert) => alert.type))
  })

  it('no reordena: el orden de la pantalla es el de la respuesta, no uno recalculado', async () => {
    // Una respuesta al reves solo puede pintarse al reves si la vista no ordena por su cuenta.
    const reversed = [...alertsFixture().alerts].reverse()
    fetchMock.mockResolvedValue(okResponse(alertsFixture({ alerts: reversed })))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    expect(typesOf(container)).toEqual(reversed.map((alert) => alert.type))
  })

  it('filtra por severidad en memoria, sin pedir nada de nuevo', async () => {
    const fixture = alertsFixture()
    fetchMock.mockResolvedValue(okResponse(fixture))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    // Las opciones del filtro salen de lo que llego, no de un catalogo escrito en la vista.
    const severidad = screen.getByLabelText('Severidad')
    expect([...severidad.querySelectorAll('option')].map((option) => option.getAttribute('value'))).toEqual([
      '',
      'CRITICAL',
      'WARNING',
      'INFO',
    ])

    chooseFilter('Severidad', 'CRITICAL')
    expect(typesOf(container)).toEqual(['CAPACIDAD_NEGATIVA'])

    chooseFilter('Severidad', 'INFO')
    expect(typesOf(container)).toEqual(['METADATA_INCOMPLETA'])

    chooseFilter('Severidad', '')
    expect(alertRows(container)).toHaveLength(fixture.alerts.length)

    // Filtrar no es consultar: sigue habiendo una sola peticion.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('filtra por tipo en memoria', async () => {
    fetchMock.mockResolvedValue(okResponse(alertsFixture()))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    chooseFilter('Tipo', 'SIN_COMPROMISO')
    expect(typesOf(container)).toEqual(['SIN_COMPROMISO'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('con los filtros cruzados sin coincidencias lo dice, y no es lo mismo que no tener alertas', async () => {
    fetchMock.mockResolvedValue(okResponse(alertsFixture()))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    chooseFilter('Severidad', 'CRITICAL')
    chooseFilter('Tipo', 'SIN_ESTIMACION')

    expect(screen.getByText('Ninguna alerta coincide con los filtros')).toBeInTheDocument()
    // Las alertas siguen ahi: lo que se vacio es la vista, no la respuesta.
    expect(screen.queryByText('Ninguna condición exige atención ahora')).not.toBeInTheDocument()
    expect(alertRows(container)).toHaveLength(0)
  })

  it('lleva al desglose cuando la alerta lo publica', async () => {
    fetchMock.mockResolvedValue(okResponse(alertsFixture()))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    // El backend publica la ruta de su API; la pantalla la traduce a la suya. Los cuatro destinos
    // salen de la misma tabla de tokens que ya usaba el tablero.
    const destino = [
      ['SIN_ESTIMACION', '/metricas/sin-estimacion'],
      ['SIN_COMPROMISO', '/metricas/sin-compromiso'],
      ['METADATA_INCOMPLETA', '/metricas/metadata-incompleta'],
      ['REQUERIMIENTOS_DESPLAZADOS', '/metricas/desplazados'],
    ] as const

    for (const [type, href] of destino) {
      const enlace = within(rowOf(container, type)).getByRole('link', { name: 'Ver el desglose' })

      expect(enlace.getAttribute('href')).toBe(href)
    }
  })

  it('sin desglose propio lo dice, y no inventa un destino', async () => {
    fetchMock.mockResolvedValue(okResponse(alertsFixture()))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    // Las dos de capacidad viajan con `detailUrl` nulo: su detalle es el calendario del plan.
    for (const type of ['CAPACIDAD_NEGATIVA', 'CAPACIDAD_AGOTADA']) {
      const alerta = rowOf(container, type)

      expect(alerta.getAttribute('data-detail')).toBe('false')
      expect(within(alerta).queryByRole('link')).toBeNull()
      expect(
        within(alerta).getByText('Sin desglose propio: el detalle está en el calendario del plan.'),
      ).toBeInTheDocument()
    }
  })

  it('una ruta que esta aplicacion no sabe abrir se enseña tal cual', async () => {
    const [primera] = alertsFixture().alerts
    const desconocida: OperationalAlert = {
      ...primera,
      detailUrl: '/api/planning/metrics/algo-que-no-existe',
    }
    fetchMock.mockResolvedValue(okResponse(alertsFixture({ alerts: [desconocida] })))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    const alerta = rowOf(container, 'CAPACIDAD_NEGATIVA')

    // Hay desglose, pero no una pantalla que lo abra: se dice, en vez de dejar un hueco mudo.
    expect(alerta.getAttribute('data-detail')).toBe('true')
    expect(within(alerta).queryByRole('link')).toBeNull()
    expect(screen.getByText('/api/planning/metrics/algo-que-no-existe')).toBeInTheDocument()
  })

  it('informa el error con el mensaje del backend y deja reintentar', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, { message: 'La base de datos no responde' }))

    renderWithClient(<Alerts />)

    expect(await screen.findByText('No fue posible cargar las alertas operativas')).toBeInTheDocument()
    expect(screen.getByText('La base de datos no responde')).toBeInTheDocument()

    fetchMock.mockResolvedValue(okResponse(alertsFixture()))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    await tableRendered()
    expect(alertRows(document.body)).toHaveLength(6)
  })

  it('no suma los contadores: las alertas clasifican, no particionan', async () => {
    fetchMock.mockResolvedValue(okResponse(alertsFixture()))

    const { container } = renderWithClient(<Alerts />)
    await tableRendered()

    // Los 19 elementos sumados no significan nada: la misma fila se cuenta en tres alertas a la vez,
    // y la vista no publica ningun total.
    expect(screen.queryByText('19')).not.toBeInTheDocument()
    expect(alertRows(container)).toHaveLength(6)
  })
})
