import { fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Calendar } from '@/pages/Calendar'
import { comparisonPath, ROUTES } from '@/routes/navigation'
import {
  PLAN_ID,
  planInputFixture,
  planRenegotiationsFixture,
  planSnapshotFixture,
  timelineFixture,
} from '@/test/fixtures'
import { renderWithClient } from '@/test/render'

/**
 * El calendario, probado por lo que promete: que enseña lo que produjo el motor y dónde quedó.
 *
 * **El servidor de esta prueba lanza ante cualquier dirección que no sea una de las cuatro suyas.**
 * Antes respondía lo mismo a todo, que es lo que dejaba pasar una lectura equivocada sin que nadie se
 * enterara; ahora una dirección de más falla aquí. Las cuatro son las que la pantalla declara: el plan
 * releído, su foto de entrada, la agenda y los acuerdos —y ninguna toca GLPI ni las métricas del
 * tablero, que es otro denominador—.
 */

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const SNAPSHOT_URL = `/api/planning/${PLAN_ID}`
const INPUT_URL = `/api/planning/${PLAN_ID}/input`
const TIMELINE_URL = `/api/planning/${PLAN_ID}/timeline`
const RENEGOTIATIONS_URL = '/api/renegotiations'

interface ServeOptions {
  snapshot?: unknown
  snapshotStatus?: number
  /** Nulo es el `404` del plan sin foto de entrada: no es un fallo, es un hueco del registro. */
  input?: unknown | null
  inputStatus?: number
  timeline?: unknown
  renegotiations?: unknown
  renegotiationsStatus?: number
}

/**
 * Sirve las cuatro lecturas de la pantalla y **lanza ante cualquier otra**.
 *
 * Cada dirección se compara con la del plan del fixture, así que pedir el plan equivocado tampoco
 * pasa: la igualdad es exacta y no un `startsWith`, que es lo que dejaba colar una ruta hermana.
 */
function serve({
  snapshot = planSnapshotFixture(),
  snapshotStatus = 200,
  input = planInputFixture(),
  inputStatus = 200,
  timeline = timelineFixture(),
  renegotiations = planRenegotiationsFixture(),
  renegotiationsStatus = 200,
}: ServeOptions = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (url === SNAPSHOT_URL) {
      return Promise.resolve(
        snapshotStatus === 200
          ? okResponse(snapshot)
          : errorResponse(snapshotStatus, { message: 'No hay un plan con ese identificador' }),
      )
    }

    if (url === INPUT_URL) {
      if (inputStatus !== 200) {
        return Promise.resolve(errorResponse(inputStatus, { message: 'La entrada no consta' }))
      }
      // Un `null` explícito es el caso del plan anterior a la Fase 8: sin foto, con `404`.
      return Promise.resolve(input === null ? errorResponse(404, { message: 'sin foto' }) : okResponse(input))
    }

    if (url === TIMELINE_URL) {
      return Promise.resolve(okResponse(timeline))
    }

    if (url === RENEGOTIATIONS_URL) {
      return Promise.resolve(
        renegotiationsStatus === 200
          ? okResponse(renegotiations)
          : errorResponse(renegotiationsStatus, { message: 'No fue posible leer los acuerdos' }),
      )
    }

    throw new Error(`Peticion inesperada: ${url}`)
  })
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

/**
 * Monta la pantalla del plan y espera a que la rejilla esté.
 *
 * **Se espera por el `data-slot` del recurso y no por el identificador de un tramo.** Desde esta
 * fase el mismo elemento aparece dos veces —en su tramo de la rejilla y en su fila de la tabla de
 * trazabilidad—, así que una búsqueda por texto encontraría dos y fallaría por ambigüedad: la prueba
 * diría «hay dos INC-1» en vez de afirmar lo que quiere afirmar. El `data-slot` del recurso es único
 * y solo lo pinta la rejilla, que es la última lectura en llegar.
 */
async function calendar() {
  const { container } = renderWithClient(calendarRoutes(), { route: `/calendario/${PLAN_ID}` })

  await waitFor(() => {
    expect(container.querySelector('[data-slot="timeline-resource"]')).toBeInTheDocument()
  })

  return container
}

function figureOf(container: HTMLElement, slot: string): string {
  const cell = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)

  if (!cell) {
    throw new Error(`No hay cifra "${slot}"`)
  }

  return cell.textContent ?? ''
}

/** El bloque de cifras entero, notas incluidas: el valor y su nota son la misma casilla. */
function summaryOf(container: HTMLElement): HTMLElement {
  const summary = container.querySelector<HTMLElement>('[data-slot="plan-result-summary"]')

  if (!summary) {
    throw new Error('No hay resumen del plan')
  }

  return summary
}

/** La fila de un elemento de la tabla de trazabilidad, por su identificador. */
function rowOf(container: HTMLElement, workItemId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-slot="plan-element"][data-work-item="${workItemId}"]`)

  if (!row) {
    throw new Error(`No hay fila para ${workItemId}`)
  }

  return row
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
    serve()

    await calendar()

    expect(fetchMock).toHaveBeenCalledWith(TIMELINE_URL, expect.objectContaining({ method: 'GET' }))
  })

  it('sin plan en la ruta pide el identificador y no consulta nada', () => {
    renderWithClient(calendarRoutes(), { route: ROUTES.calendar })

    expect(screen.getByLabelText('Identificador del plan')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('al enviar el identificador navega a la agenda de ese plan', async () => {
    serve()

    renderWithClient(calendarRoutes(), { route: ROUTES.calendar })

    fireEvent.change(screen.getByLabelText('Identificador del plan'), {
      target: { value: PLAN_ID },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ver agenda' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(TIMELINE_URL, expect.objectContaining({ method: 'GET' }))
    })
  })

  it('enseña el resultado del motor con las cifras que publicó el backend', async () => {
    // Las cuatro cajas del fixture suman lo que su foto de entrada declara: 1 planificado, 2
    // desplazados, 1 fuera y 1 excluido, sobre 5 recibidos. Los números son los de las listas, no
    // unos recalculados aquí.
    serve()
    const container = await calendar()

    expect(figureOf(container, 'plan-considered')).toBe('5')
    expect(figureOf(container, 'plan-planned')).toBe('1')
    expect(figureOf(container, 'plan-displaced')).toBe('2')
    expect(figureOf(container, 'plan-out')).toBe('1')
    expect(figureOf(container, 'plan-excluded')).toBe('1')
  })

  it('la frase del resultado dice qué ubicó y qué quedó fuera', async () => {
    serve()
    const container = await calendar()
    const sentence = container.querySelector<HTMLElement>('[data-slot="plan-verdict"]')

    expect(sentence?.textContent).toContain('recibió 5 elementos')
    expect(sentence?.textContent).toContain('1 fuera del horizonte')
  })

  it('un plan sin nada ubicado lo dice, y no se lee como fallo de lectura', async () => {
    // El motor recibió los cinco y no ubicó ninguno: el plan salió vacío, pero la entrada no.
    serve({ snapshot: planSnapshotFixture({ allocations: [], rescheduleEvents: [] }) })
    const container = await calendar()
    const summary = container.querySelector<HTMLElement>('[data-slot="plan-result-summary"]')

    expect(summary?.dataset.verdict).toBe('nada-ubicado')
    expect(figureOf(container, 'plan-planned')).toBe('0')
    expect(figureOf(container, 'plan-considered')).toBe('5')
  })

  it('un plan sin foto de entrada no inventa un cero: lo deja declarado', async () => {
    serve({ input: null })
    const container = await calendar()

    // Nulo no es cero. Un cero afirmaría que no entró nada, y lo que pasa es que nadie lo registró.
    expect(figureOf(container, 'plan-considered')).toContain('—')
    expect(figureOf(container, 'plan-excluded')).toContain('—')
    expect(container.querySelector('[data-slot="plan-input-missing"]')).toBeInTheDocument()
    expect(figureOf(container, 'plan-planned')).toBe('1')
  })

  it('un fallo al leer la entrada no se confunde con que no conste', async () => {
    serve({ inputStatus: 500 })
    const container = await calendar()

    expect(container.querySelector('[data-slot="plan-input-error"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="plan-input-missing"]')).not.toBeInTheDocument()
  })

  it('un plan que no existe lo dice con esas palabras', async () => {
    serve({ snapshotStatus: 404 })

    renderWithClient(calendarRoutes(), { route: `/calendario/${PLAN_ID}` })

    expect(await screen.findByText(/No hay un plan con ese identificador/)).toBeInTheDocument()

    // La rejilla se pinta igual —es otra lectura, y esa si respondio—, pero el bloque de resultado
    // no: sin plan no hay nada que resumir, y un resumen a cero se leeria como un plan sin trabajo.
    expect(screen.queryByText('Qué produjo el motor')).not.toBeInTheDocument()
  })

  it('la capacidad usada y la libre salen de la capacidad del plan', async () => {
    // El fixture declara 8 horas disponibles y 8 ocupadas el primer día, y 8 y 2 el segundo: 16
    // disponibles, 10 ocupadas y 6 libres, con un solo día exactamente a cero.
    serve()
    const container = await calendar()

    expect(figureOf(container, 'plan-occupied')).toContain('10')
    expect(figureOf(container, 'plan-remaining')).toContain('6')

    // Los días saturados van en la nota de la cifra y no dentro de ella: `plan-remaining` es el
    // valor, y la nota es el otro `<p>` de la misma casilla. Se lee la casilla entera.
    expect(summaryOf(container).textContent).toContain('1 día')
  })

  it('un día sobrepasado se cuenta aparte y no se compensa con uno holgado', async () => {
    serve({
      timeline: timelineFixture({
        resources: [
          {
            developerId: 'dev-001',
            capacity: [
              { date: '2026-10-05', availableHours: 8, occupiedHours: 10, remainingHours: -2 },
              { date: '2026-10-06', availableHours: 8, occupiedHours: 2, remainingHours: 6 },
            ],
          },
        ],
      }),
    })
    const container = await calendar()

    // La suma da 4 y ninguno de los dos días está libre: si la vista se quedara con el total, el
    // resumen diría que hay holgura donde hay una contradicción del plan con su contexto.
    expect(figureOf(container, 'plan-remaining')).toContain('4')
    expect(summaryOf(container).textContent).toContain('sobrepasados')
  })

  it('la trazabilidad dice dónde acabó cada elemento y por qué', async () => {
    serve()
    const container = await calendar()

    // Un planificado no ofrece motivo, porque no hubo ninguno.
    expect(rowOf(container, 'INC-1').dataset.verdict).toBe('PLANIFICADO')
    expect(rowOf(container, 'INC-1').querySelector('[data-slot="plan-element-event"]')).toBeNull()

    // Un desplazado trae sus dos fechas, la regla aplicada y el motivo del motor.
    const displaced = rowOf(container, 'REQ-1')
    expect(displaced.dataset.verdict).toBe('DESPLAZADO')
    expect(displaced.textContent).toContain('INCIDENTE_ALTO_DESPLAZA_REQUERIMIENTOS')
    expect(displaced.textContent).toContain('Incidente de severidad alta sobre la misma jornada')

    // Un elemento fuera trae el motivo literal del conflicto, y no una traducción de la vista.
    const out = rowOf(container, 'REQ-3')
    expect(out.dataset.verdict).toBe('FUERA')
    expect(out.textContent).toContain('Sin capacidad en el horizonte de 10 dias')

    // Un excluido entró y el motor no lo usó: es lo único que se puede decir de él.
    expect(rowOf(container, 'REQ-4').dataset.verdict).toBe('EXCLUIDO')
  })

  it('la renegociación es un eje aparte y enlaza a donde se registra', async () => {
    serve()
    const container = await calendar()

    // Los dos siguen siendo DESPLAZADO: el motor no produce la renegociación, solo emite el evento.
    expect(rowOf(container, 'REQ-1').dataset.verdict).toBe('DESPLAZADO')
    expect(rowOf(container, 'REQ-2').dataset.verdict).toBe('DESPLAZADO')

    const agreed = rowOf(container, 'REQ-1').querySelector<HTMLElement>('[data-slot="plan-renegotiation"]')
    expect(agreed?.dataset.status).toBe('ACORDADA')
    expect(agreed?.closest('a')).toHaveAttribute('href', ROUTES.renegotiations)

    expect(
      rowOf(container, 'REQ-2').querySelector('[data-slot="plan-renegotiation"]')?.textContent,
    ).toBe('PENDIENTE_DE_ACUERDO')
  })

  it('un acuerdo de otro plan no se pega a este desplazamiento', async () => {
    // `GET /api/renegotiations` recorre el plan vigente de cada desarrollador. Al mirar un plan
    // antiguo sus filas hablan de otro desplazamiento, y pegarlas pondría un acuerdo junto a unas
    // fechas que no son las suyas.
    serve({
      renegotiations: planRenegotiationsFixture({
        items: planRenegotiationsFixture().items.map((one) => ({ ...one, planId: 'otro-plan' })),
      }),
    })
    const container = await calendar()

    expect(rowOf(container, 'REQ-1').querySelector('[data-slot="plan-renegotiation"]')).toBeNull()
    expect(rowOf(container, 'REQ-1').textContent).toContain('no consta para este plan')
  })

  it('un fallo de la lectura de acuerdos no borra el resto de la pantalla', async () => {
    serve({ renegotiationsStatus: 500 })
    const container = await calendar()

    expect(container.querySelector('[data-slot="plan-renegotiations-error"]')).toBeInTheDocument()
    // El resumen, la tabla y la rejilla siguen enteros: un fallo no se lleva por delante lo demás.
    expect(figureOf(container, 'plan-planned')).toBe('1')
    expect(rowOf(container, 'REQ-3').dataset.verdict).toBe('FUERA')
    expect(container.querySelectorAll('[data-slot="timeline-block"]').length).toBeGreaterThan(0)
  })

  it('un día no laborable se distingue de uno laborable sin trabajo', async () => {
    serve({
      timeline: timelineFixture({
        resources: [
          {
            developerId: 'dev-001',
            capacity: [
              { date: '2026-10-05', availableHours: 8, occupiedHours: 8, remainingHours: 0 },
              // Un sábado: cero disponible, cero ocupado y cero libre. Es lo que hoy se pinta igual
              // que un martes sin nada agendado.
              { date: '2026-10-06', availableHours: 0, occupiedHours: 0, remainingHours: 0 },
            ],
          },
        ],
      }),
    })
    const container = await calendar()

    const days = [...container.querySelectorAll<HTMLElement>('[data-slot="timeline-day"]')]
    expect(days.map((day) => day.dataset.working)).toEqual(['true', 'false'])
    expect(days[1].textContent).toContain('no laborable')
  })

  it('enlaza a la comparación con el plan anterior sin resolver nada aquí', async () => {
    serve()
    const container = await calendar()

    // El identificador va ya resuelto en la dirección, así que el enlace no consulta nada para
    // construirse. **Quien sabe si hay plan anterior es la otra pantalla**, que es la que tiene la
    // lista: esta conserva sus cuatro lecturas y no aprende una quinta para pintar un enlace.
    const link = container.querySelector<HTMLAnchorElement>('[data-slot="compare-with-previous"]')

    expect(link).toHaveAttribute('href', comparisonPath(PLAN_ID))
  })

  it('no lee de más: cuatro direcciones, todas GET y ninguna del tablero', async () => {
    serve()
    await calendar()

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(new Set(urls)).toEqual(
      new Set([SNAPSHOT_URL, INPUT_URL, TIMELINE_URL, RENEGOTIATIONS_URL]),
    )
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ method: 'GET' })
    }

    // El `serve` lanza ante cualquier otra, así que llegar hasta aquí ya lo demuestra; esto lo deja
    // escrito por si algún día alguien lo cambia por un `mockResolvedValue`.
    expect(urls.some((url) => url.includes('/metrics') || url.includes('/from-glpi'))).toBe(false)
  })
})
