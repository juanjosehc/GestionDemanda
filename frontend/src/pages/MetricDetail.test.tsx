import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { MetricDetail } from '@/pages/MetricDetail'
import { declaredGapFixture, displacedFixture, PLAN_ID } from '@/test/fixtures'
import { renderWithClient } from '@/test/render'

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const DECLARED_URL = '/api/planning/metrics/declared/SIN_ESTIMACION'
const DISPLACED_URL = '/api/planning/metrics/displaced'

/**
 * La pagina lee `:gap` de la ruta, asi que hay que montarla bajo una ruta real: sin `<Routes>` el
 * parametro no existe y el caso que se quiere probar no llega a ocurrir.
 */
function renderDetail(route: string) {
  return renderWithClient(
    <Routes>
      <Route path="/metricas/:gap" element={<MetricDetail />} />
    </Routes>,
    { route },
  )
}

function gapRows(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="gap-row"]')
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MetricDetail', () => {
  it('lista los elementos que producen la cifra, con lo que si esta declarado', async () => {
    fetchMock.mockResolvedValue(okResponse(declaredGapFixture()))

    const { container } = renderDetail('/metricas/sin-estimacion')

    expect(await screen.findByText('Requerimientos sin estimación')).toBeInTheDocument()

    // Una fila por elemento, ni una mas: la tabla y el contador salen del mismo predicado.
    expect(gapRows(container)).toHaveLength(3)

    expect(screen.getByText('67501')).toBeInTheDocument()
    expect(screen.getByText('67502')).toBeInTheDocument()
    expect(screen.getByText('67503')).toBeInTheDocument()

    // Lo que si esta declarado viaja en la fila: horas, fecha, quien y cuando.
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('2026-10-01')).toBeInTheDocument()
    expect(screen.getAllByText('ana').length).toBeGreaterThan(0)
    expect(screen.getByText('carlos')).toBeInTheDocument()

    // El vencimiento lo dice el backend; la vista solo pinta su respuesta.
    expect(screen.getByText('vencido')).toBeInTheDocument()
  })

  it('no sustituye un valor ausente por un cero', async () => {
    fetchMock.mockResolvedValue(okResponse(declaredGapFixture()))

    const { container } = renderDetail('/metricas/sin-estimacion')
    await screen.findByText('Requerimientos sin estimación')

    // La fila retirada no tiene ninguno de los dos valores declarados: se ve su guion, no un cero.
    const retirada = [...gapRows(container)].find((row) => row.textContent?.includes('67503'))

    expect(retirada).toBeDefined()
    expect(retirada?.textContent).toContain('—')
    expect(retirada?.textContent).not.toContain('vencido')
  })

  it('con la lista vacia muestra el estado vacio y ninguna tabla', async () => {
    fetchMock.mockResolvedValue(okResponse(declaredGapFixture({ items: [] })))

    const { container } = renderDetail('/metricas/sin-estimacion')

    expect(await screen.findByText('Ningún requerimiento cae en esta carencia')).toBeInTheDocument()
    expect(gapRows(container)).toHaveLength(0)
    expect(container.querySelector('table')).toBeNull()
  })

  it('conserva la trazabilidad que declara el backend', async () => {
    const fixture = declaredGapFixture()
    fetchMock.mockResolvedValue(okResponse(fixture))

    renderDetail('/metricas/sin-estimacion')
    await screen.findByText('Requerimientos sin estimación')

    // La procedencia se muestra desde el JSON: si el backend la renombra, la vista la sigue.
    expect(screen.getByText(fixture.source)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(fixture.scope))).toBeInTheDocument()
  })

  it('pide un unico endpoint para el token de la ruta', async () => {
    fetchMock.mockResolvedValue(okResponse(declaredGapFixture()))

    renderDetail('/metricas/sin-estimacion')
    await screen.findByText('Requerimientos sin estimación')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(DECLARED_URL, expect.objectContaining({ method: 'GET' }))
  })

  it('informa el error con el mensaje del backend y deja reintentar', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, { message: 'La base de datos no responde' }))

    renderDetail('/metricas/sin-estimacion')

    expect(await screen.findByText('No fue posible cargar el desglose')).toBeInTheDocument()
    expect(screen.getByText('La base de datos no responde')).toBeInTheDocument()

    fetchMock.mockResolvedValue(okResponse(declaredGapFixture()))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Requerimientos sin estimación')).toBeInTheDocument()
  })

  it('una direccion que no es una metrica se explica sin pedir nada', async () => {
    renderDetail('/metricas/lo-que-sea')

    expect(await screen.findByText('Esa métrica no existe')).toBeInTheDocument()
    // La comprobacion es local: no se traduce en una peticion que el backend conteste con un 400.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('los desplazamientos traen el elemento, el desarrollador, el plan y el motivo', async () => {
    fetchMock.mockResolvedValue(okResponse(displacedFixture()))

    const { container } = renderDetail('/metricas/desplazados')

    expect(await screen.findByText('Requerimientos desplazados')).toBeInTheDocument()

    // Dos elementos, y el primero se movio dos veces: la fila es el elemento, no el tramo.
    const filas = container.querySelectorAll('[data-slot="displaced-row"]')
    expect(filas).toHaveLength(2)
    expect(filas[0]?.getAttribute('data-events')).toBe('2')
    expect(filas[1]?.getAttribute('data-events')).toBe('1')

    expect(screen.getByText('REQ-1')).toBeInTheDocument()
    expect(screen.getByText('REQ-2')).toBeInTheDocument()
    expect(screen.getAllByText('INC-9').length).toBeGreaterThan(0)
    // El mismo incidente desplazo a los dos elementos: el motivo aparece una vez por evento.
    expect(
      screen.getAllByText('Incidente de severidad alta sobre la misma jornada'),
    ).toHaveLength(2)
    expect(screen.getByText('La jornada quedo sin capacidad disponible')).toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledWith(
      DISPLACED_URL,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('enlaza al plan que produjo el desplazamiento', async () => {
    fetchMock.mockResolvedValue(okResponse(displacedFixture()))

    const { container } = renderDetail('/metricas/desplazados')
    await screen.findByText('Requerimientos desplazados')

    const enlace = container.querySelector(`a[href="/calendario/${PLAN_ID}"]`)

    expect(enlace).not.toBeNull()
    expect(enlace?.textContent).toBe(PLAN_ID)
  })

  it('sin planes vigentes lo dice en vez de fallar', async () => {
    fetchMock.mockResolvedValue(okResponse(displacedFixture({ items: [] })))

    const { container } = renderDetail('/metricas/desplazados')

    expect(await screen.findByText('Ningún requerimiento quedó desplazado')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="displaced-row"]')).toHaveLength(0)
  })
})
