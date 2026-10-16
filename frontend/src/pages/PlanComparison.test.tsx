import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PlanComparison } from '@/pages/PlanComparison'
import { calendarPath, comparisonPath, ROUTES } from '@/routes/navigation'
import {
  DEVELOPER_ID,
  developerPlansFixture,
  PLAN_ID,
  planInputFixture,
  planRenegotiationsFixture,
  planSnapshotFixture,
  PREVIOUS_PLAN_ID,
  previousPlanInputFixture,
  previousPlanSnapshotFixture,
  previousTimelineFixture,
  timelineFixture,
} from '@/test/fixtures'
import { renderWithClient } from '@/test/render'
import type { PlanningInputResponse, PlanSnapshotResponse } from '@/types/planning'
import type { TimelinePlanResponse } from '@/types/timeline'

/**
 * La comparación entre dos planes, probada por lo que promete: las siete preguntas del brief.
 *
 * **El servidor de esta prueba lanza ante cualquier dirección que no sea una de las ocho suyas**, que
 * son las cuatro lecturas de cada plan. Es la misma puerta que tiene el Calendario y sirve igual: una
 * lectura de más falla aquí en vez de pasar desapercibida.
 *
 * **Se espera por el `data-slot` de la comparación y no por el de la rejilla**, porque esta pantalla no
 * monta la rejilla: montarla sería duplicar el calendario, que es lo que el brief prohíbe.
 */

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const PLANS_URL = `/api/planning/plans/${DEVELOPER_ID}`
const RENEGOTIATIONS_URL = '/api/renegotiations'

/** Las tres direcciones de un plan, para no repetir el patrón en cada rama. */
function planUrls(planId: string) {
  return {
    snapshot: `/api/planning/${planId}`,
    input: `/api/planning/${planId}/input`,
    timeline: `/api/planning/${planId}/timeline`,
  }
}

const NUEVO = planUrls(PLAN_ID)
const ANTERIOR = planUrls(PREVIOUS_PLAN_ID)

interface ServeOptions {
  plans?: unknown
  plansStatus?: number
  /** El plan actual: lo que se compara y lo que fija el técnico del que sale la lista. */
  snapshot?: PlanSnapshotResponse
  snapshotStatus?: number
  input?: PlanningInputResponse
  inputStatus?: number
  timeline?: TimelinePlanResponse
  /** El plan anterior y sus tres lecturas. */
  previousSnapshot?: PlanSnapshotResponse
  previousInput?: PlanningInputResponse
  previousTimeline?: TimelinePlanResponse
  renegotiations?: unknown
  renegotiationsStatus?: number
}

/**
 * Sirve las ocho lecturas de la pantalla y **lanza ante cualquier otra**.
 *
 * La igualdad es exacta y no un `startsWith`: pedir el plan equivocado tampoco pasa, que es lo que
 * dejaría colar una comparación entre dos planes que no son los que la dirección nombra.
 */
function serve({
  plans = developerPlansFixture(),
  plansStatus = 200,
  snapshot = planSnapshotFixture(),
  snapshotStatus = 200,
  input = planInputFixture(),
  inputStatus = 200,
  timeline = timelineFixture(),
  previousSnapshot = previousPlanSnapshotFixture(),
  previousInput = previousPlanInputFixture(),
  previousTimeline = previousTimelineFixture(),
  renegotiations = planRenegotiationsFixture(),
  renegotiationsStatus = 200,
}: ServeOptions = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (url === PLANS_URL) {
      return Promise.resolve(
        plansStatus === 200
          ? okResponse(plans)
          : errorResponse(plansStatus, { message: 'No fue posible leer los planes' }),
      )
    }

    if (url === NUEVO.snapshot) {
      return Promise.resolve(
        snapshotStatus === 200
          ? okResponse(snapshot)
          : errorResponse(snapshotStatus, { message: 'No hay un plan con ese identificador' }),
      )
    }
    if (url === NUEVO.input) {
      return Promise.resolve(
        inputStatus === 200
          ? okResponse(input)
          : errorResponse(inputStatus, { message: 'La entrada no consta' }),
      )
    }
    if (url === NUEVO.timeline) {
      return Promise.resolve(okResponse(timeline))
    }

    if (url === ANTERIOR.snapshot) {
      return Promise.resolve(okResponse(previousSnapshot))
    }
    if (url === ANTERIOR.input) {
      return Promise.resolve(okResponse(previousInput))
    }
    if (url === ANTERIOR.timeline) {
      return Promise.resolve(okResponse(previousTimeline))
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

/** Solo la ruta de la comparación: la pantalla es lo que se prueba, no el layout. */
function comparisonRoutes() {
  return (
    <Routes>
      <Route path={ROUTES.calendarComparison} element={<PlanComparison />} />
    </Routes>
  )
}

/** Monta la comparación y espera a que el resumen esté. */
async function compare(planId: string = PLAN_ID) {
  const { container } = renderWithClient(comparisonRoutes(), { route: comparisonPath(planId) })

  await waitFor(() => {
    expect(container.querySelector('[data-slot="comparison-summary"]')).toBeInTheDocument()
  })

  return container
}

function slotOf(container: HTMLElement, slot: string): HTMLElement {
  const cell = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)

  if (!cell) {
    throw new Error(`No hay casilla "${slot}"`)
  }

  return cell
}

/** Los identificadores de una lista, leídos de sus filas y en el orden en que están pintadas. */
function rowsOf(container: HTMLElement, slot: string): string[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-slot="${slot}-item"]`)].map(
    (row) => row.dataset.workItem ?? '',
  )
}

/** La fila de un elemento dentro de una lista concreta. */
function rowIn(container: HTMLElement, slot: string, workItemId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-slot="${slot}-item"][data-work-item="${workItemId}"]`,
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PlanComparison', () => {
  it('compara el plan de la ruta con el que le precede, y no con otro', async () => {
    serve()
    const container = await compare()

    // Las dos cifras y las dos orillas de la entrada: cuatro elementos antes, cinco ahora, dos que
    // entraron y uno que salió. Son las listas del fixture, no una cuenta hecha aquí.
    expect(slotOf(container, 'comparison-from-count').textContent).toBe('4')
    expect(slotOf(container, 'comparison-to-count').textContent).toBe('5')
    expect(slotOf(container, 'comparison-entered-count').textContent).toBe('2')
    expect(slotOf(container, 'comparison-left-count').textContent).toBe('1')

    expect(rowsOf(container, 'comparison-entered')).toEqual(['REQ-2', 'REQ-4'])
    expect(rowsOf(container, 'comparison-left')).toEqual(['REQ-6'])

    // El veredicto de la pantalla es el token, y con estas dos fotos hay diferencias.
    expect(slotOf(container, 'comparison-summary').dataset.verdict).toBe('con-diferencias')
    expect(slotOf(container, 'comparison-verdict').textContent).toContain('no dicen lo mismo')
  })

  it('el mismo ticket en dos listas se afirma por su casilla, no por su texto', async () => {
    serve()
    const container = await compare()

    // REQ-2 entro y ademas nace desplazado, y REQ-6 salio y ademas se lleva su desplazamiento. Los dos
    // aparecen dos veces en la pantalla, asi que una busqueda por texto encontraria dos y fallaria por
    // ambiguedad: por eso cada fila lleva su casilla y su ticket.
    expect(rowIn(container, 'comparison-entered', 'REQ-2')).toBeInTheDocument()
    expect(rowIn(container, 'comparison-new-displacements', 'REQ-2')).toBeInTheDocument()

    expect(rowIn(container, 'comparison-left', 'REQ-6')).toBeInTheDocument()
    expect(rowIn(container, 'comparison-gone-displacements', 'REQ-6')).toBeInTheDocument()

    // Y cada aparicion es la suya: el desplazamiento trae la regla del motor, que la lista de entradas
    // no tiene por que repetir.
    expect(rowIn(container, 'comparison-new-displacements', 'REQ-1')?.textContent).toContain(
      'INCIDENTE_ALTO_DESPLAZA_REQUERIMIENTOS',
    )
    expect(rowIn(container, 'comparison-entered', 'REQ-2')?.dataset.verdict).toBe('DESPLAZADO')
    expect(rowIn(container, 'comparison-left', 'REQ-6')?.dataset.verdict).toBe('DESPLAZADO')
  })

  it('lo que sigue en los dos se parte entre lo que cambió y lo que sigue igual', async () => {
    serve()
    const container = await compare()

    // REQ-3 no cupo en ninguno de los dos y INC-1 quedó donde se comprometió: siguen igual.
    expect(rowsOf(container, 'comparison-unchanged')).toEqual(['REQ-3', 'INC-1'])

    // REQ-1 sigue estando en los dos, pero no con la misma fila: en el anterior estaba planificado y
    // en el actual el incidente lo desplazó. **Es la mitad que una lista de entradas y salidas no ve**,
    // porque el elemento no se movió de plan; solo cambió lo que su fila dice.
    expect(rowsOf(container, 'comparison-changed')).toEqual(['REQ-1'])
    expect(rowIn(container, 'comparison-changed', 'REQ-1')?.dataset.verdict).toBe('DESPLAZADO')
  })

  it('los cinco números de capacidad se restan y el delta lleva su signo', async () => {
    // El plan anterior ocupaba 10 horas y el actual ocupa 14 sobre las mismas 16 disponibles: la
    // diferencia está en lo ocupado y en lo libre, con signos contrarios.
    serve({
      timeline: timelineFixture({
        resources: [
          {
            developerId: DEVELOPER_ID,
            capacity: [
              { date: '2026-10-05', availableHours: 8, occupiedHours: 8, remainingHours: 0 },
              { date: '2026-10-06', availableHours: 8, occupiedHours: 6, remainingHours: 2 },
            ],
          },
        ],
      }),
    })
    const container = await compare()

    const delta = (metric: string) => slotOf(container, `comparison-delta-${metric}`).textContent

    expect(delta('availableHours')).toBe('0 h')
    expect(delta('occupiedHours')).toBe('+4 h')
    expect(delta('remainingHours')).toBe('-4 h')
    // Los días saturados son los que cada plan contó —el día 5 quedó a cero en los dos—, y no una
    // clasificación nueva: la vista resta, no vuelve a decidir qué día está saturado.
    expect(delta('saturatedDays')).toBe('0')
    expect(delta('overDays')).toBe('0')
  })

  it('dos planes que dicen lo mismo se leen como sin diferencias', async () => {
    // El mismo plan en las dos orillas, con el sello del anterior posterior al acuerdo: así la última
    // pregunta también sale vacía por una razón y no por casualidad.
    const mismo = planSnapshotFixture({ planId: PREVIOUS_PLAN_ID, createdAt: '2026-10-06T10:00:00Z' })

    serve({
      plans: developerPlansFixture({
        plans: [
          { planId: PREVIOUS_PLAN_ID, createdAt: '2026-10-06T10:00:00Z' },
          { planId: PLAN_ID, createdAt: '2026-10-07T14:00:00Z' },
        ],
      }),
      previousSnapshot: mismo,
      previousInput: planInputFixture(),
      previousTimeline: timelineFixture(),
    })
    const container = await compare()

    expect(slotOf(container, 'comparison-summary').dataset.verdict).toBe('sin-diferencias')
    expect(slotOf(container, 'comparison-verdict').textContent).toContain('nada cambió')

    expect(rowsOf(container, 'comparison-entered')).toEqual([])
    expect(rowsOf(container, 'comparison-left')).toEqual([])
    expect(rowsOf(container, 'comparison-changed')).toEqual([])
    // Vacío no es «no se sabe»: la lectura de acuerdos habla de este plan y no encontró ninguno nuevo.
    expect(slotOf(container, 'comparison-new-agreements-empty').textContent).toContain('Ninguno')
  })

  it('dos planes vacíos no son «sin diferencias»: se dice que no hay nada que comparar', async () => {
    const vacioSnapshot = planSnapshotFixture({
      allocations: [],
      rescheduleEvents: [],
      conflicts: [],
    })
    const vacioInput = planInputFixture({ incidents: [], requirements: [] })

    serve({
      snapshot: vacioSnapshot,
      input: vacioInput,
      timeline: timelineFixture({ resources: [], items: [] }),
      previousSnapshot: { ...vacioSnapshot, planId: PREVIOUS_PLAN_ID },
      previousInput: { ...vacioInput, planId: PREVIOUS_PLAN_ID },
      previousTimeline: previousTimelineFixture({ resources: [], items: [] }),
    })
    const container = await compare()

    // No coinciden en nada: lo que pasa es que no hay nada que comparar. Decir «sin diferencias»
    // sobre dos agendas vacías afirmaría una igualdad que nadie comprobó.
    expect(slotOf(container, 'comparison-summary').dataset.verdict).toBe('sin-elementos')
    expect(slotOf(container, 'comparison-empty').textContent).toContain('no hay nada que comparar')

    // Y no se pintan siete listas vacías: no habría nada que leer en ellas.
    expect(container.querySelector('[data-slot="comparison-entered"]')).not.toBeInTheDocument()
  })

  it('el primer plan de un técnico no tiene anterior, y eso se dice', async () => {
    serve({
      plans: developerPlansFixture({
        plans: [{ planId: PLAN_ID, createdAt: '2026-10-07T14:00:00Z' }],
      }),
    })

    renderWithClient(comparisonRoutes(), { route: comparisonPath(PLAN_ID) })

    expect(
      await screen.findByText(/primer plan guardado de este técnico/),
    ).toBeInTheDocument()

    // Y no se lee el plan anterior, porque no hay: solo se piden las cuatro del actual y la lista.
    const urls = new Set(fetchMock.mock.calls.map((call) => String(call[0])))
    expect(urls).toEqual(new Set([PLANS_URL, NUEVO.snapshot, NUEVO.input, NUEVO.timeline, RENEGOTIATIONS_URL]))
  })

  it('un plan que no existe lo dice y lleva a su calendario', async () => {
    serve({ snapshotStatus: 404 })

    renderWithClient(comparisonRoutes(), { route: comparisonPath(PLAN_ID) })

    expect(await screen.findByText(/No hay un plan guardado con ese identificador/)).toBeInTheDocument()

    // La salida que se ofrece es la del plan que sí se puede mirar sin comparar, y con su
    // identificador ya resuelto: no un enlace a la lista de planes.
    expect(screen.getByRole('link')).toHaveAttribute('href', calendarPath(PLAN_ID))

    // Y la lista de planes ni se pide: sin plan no hay técnico del que pedirla.
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContainEqual(PLANS_URL)
  })

  it('un identificador mal formado es un fallo, y no se disfraza de ausencia', async () => {
    // El backend contesta `400` a un identificador que no es un UUID. Eso no es «no hay plan»: es una
    // dirección rota, y pintarla como un hueco del registro culparía al registro de un error de quien
    // escribió la dirección.
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/planning/mal-formado')) {
        return Promise.resolve(errorResponse(400, { message: 'Identificador invalido' }))
      }

      if (url === RENEGOTIATIONS_URL) {
        return Promise.resolve(okResponse(planRenegotiationsFixture()))
      }

      throw new Error(`Peticion inesperada: ${url}`)
    })

    renderWithClient(comparisonRoutes(), { route: comparisonPath('mal-formado') })

    expect(await screen.findByText(/No fue posible leer los planes que hay que comparar/)).toBeInTheDocument()
    expect(screen.queryByText(/No hay un plan guardado con ese identificador/)).not.toBeInTheDocument()
  })

  it('los acuerdos registrados después del plan anterior se cuentan', async () => {
    serve()
    const container = await compare()

    // El plan anterior se calculó a las 09:00 y el acuerdo de REQ-1 se firmó a las 09:30: surgió entre
    // los dos, que es exactamente lo que la sexta pregunta pide.
    expect(rowsOf(container, 'comparison-new-agreements')).toEqual(['REQ-1'])

    // Y es un eje aparte del veredicto: el motor no produce el acuerdo, solo emite el desplazamiento.
    expect(rowIn(container, 'comparison-new-displacements', 'REQ-1')?.textContent).toContain('ACORDADA')
  })

  it('si la lectura de acuerdos no habla de este plan, la pregunta no se contesta', async () => {
    serve({
      renegotiations: planRenegotiationsFixture({
        items: planRenegotiationsFixture().items.map((one) => ({ ...one, planId: 'otro-plan' })),
      }),
    })
    const container = await compare()

    // «No consta» no es un cero: un cero afirmaría que nadie acordó nada, y lo que pasa es que la
    // lectura recorre el plan vigente de cada técnico y este no lo es.
    expect(slotOf(container, 'comparison-agreements-unknown').textContent).toContain('No consta')
    expect(container.querySelector('[data-slot="comparison-new-agreements-item"]')).not.toBeInTheDocument()

    // Y no se lleva por delante el resto: las otras seis preguntas siguen contestadas.
    expect(rowsOf(container, 'comparison-entered')).toEqual(['REQ-2', 'REQ-4'])
    expect(rowsOf(container, 'comparison-left')).toEqual(['REQ-6'])
  })

  it('no lee de más: ocho direcciones, todas GET y ninguna del tablero', async () => {
    serve()
    await compare()

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))

    // Las cuatro lecturas de cada plan y la lista. **Los acuerdos son una sola llamada y no dos**: los
    // dos planes comparten la misma clave de caché, así que la comparación no duplica esa lectura.
    expect(new Set(urls)).toEqual(
      new Set([
        PLANS_URL,
        NUEVO.snapshot,
        NUEVO.input,
        NUEVO.timeline,
        ANTERIOR.snapshot,
        ANTERIOR.input,
        ANTERIOR.timeline,
        RENEGOTIATIONS_URL,
      ]),
    )

    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ method: 'GET' })
    }

    // El `serve` lanza ante cualquier otra, así que llegar hasta aquí ya lo demuestra; esto lo deja
    // escrito por si algún día alguien lo cambia por un `mockResolvedValue`.
    expect(urls.some((url) => url.includes('/metrics') || url.includes('/from-glpi'))).toBe(false)
  })
})
