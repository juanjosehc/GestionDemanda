import { fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Calendar } from '@/pages/Calendar'
import { ROUTES } from '@/routes/navigation'
import { renderWithClient } from '@/test/render'
import { PLAN_ID, timelineFixture } from '@/test/fixtures'

const fetchMock = vi.fn()

const TIMELINE_URL = `/api/planning/${PLAN_ID}/timeline`

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

/** Solo las dos rutas del calendario: la pantalla es lo que se prueba, no el layout. */
function calendarRoutes() {
  return (
    <Routes>
      <Route path={ROUTES.calendar} element={<Calendar />} />
      <Route path={ROUTES.calendarPlan} element={<Calendar />} />
    </Routes>
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Calendar', () => {
  it('con el plan en la ruta carga su agenda', async () => {
    fetchMock.mockResolvedValue(okResponse(timelineFixture()))

    renderWithClient(calendarRoutes(), { route: `/calendario/${PLAN_ID}` })

    expect(await screen.findByText('INC-1')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(TIMELINE_URL, expect.objectContaining({ method: 'GET' }))
  })

  it('sin plan en la ruta pide el identificador y no consulta nada', () => {
    renderWithClient(calendarRoutes(), { route: ROUTES.calendar })

    expect(screen.getByLabelText('Identificador del plan')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('al enviar el identificador navega a la agenda de ese plan', async () => {
    fetchMock.mockResolvedValue(okResponse(timelineFixture()))

    renderWithClient(calendarRoutes(), { route: ROUTES.calendar })

    fireEvent.change(screen.getByLabelText('Identificador del plan'), {
      target: { value: PLAN_ID },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ver agenda' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(TIMELINE_URL, expect.objectContaining({ method: 'GET' }))
    })
  })
})
