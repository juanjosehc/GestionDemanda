import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Resources } from '@/pages/Resources'
import {
  DEVELOPER_ID,
  FULL_DEVELOPER_ID,
  OVER_DEVELOPER_ID,
  PLAN_ID,
  alertsFixture,
  planningMetricsFixture,
} from '@/test/fixtures'
import { renderWithClient } from '@/test/render'

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const METRICS_URL = '/api/planning/metrics'
const ALERTS_URL = '/api/planning/alerts'

/**
 * Sirve las dos respuestas por su direccion.
 *
 * La vista lee dos endpoints —la fotografia y las alertas— y las pruebas tienen que poder mover uno
 * sin mover el otro: es lo que distingue «la vista se cae» de «las alertas se cayeron y la tabla
 * sigue en pie».
 */
function serve({
  metrics,
  alerts,
}: {
  metrics?: ReturnType<typeof okResponse> | ReturnType<typeof errorResponse>
  alerts?: ReturnType<typeof okResponse> | ReturnType<typeof errorResponse>
}) {
  fetchMock.mockImplementation((url: string) => {
    if (url === METRICS_URL) {
      return Promise.resolve(metrics ?? okResponse(planningMetricsFixture()))
    }

    if (url === ALERTS_URL) {
      return Promise.resolve(alerts ?? okResponse(alertsFixture()))
    }

    throw new Error(`Peticion inesperada: ${url}`)
  })
}

function teamRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="team-row"]')]
}

/** Los desarrolladores en el orden en que estan pintados, que es lo que la ordenacion cambia. */
function orderOf(container: HTMLElement): (string | null)[] {
  return teamRows(container).map((row) => row.getAttribute('data-developer'))
}

function rowOf(container: HTMLElement, developerId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-slot="team-row"][data-developer="${developerId}"]`,
  )

  if (!row) {
    throw new Error(`No hay fila para el desarrollador "${developerId}"`)
  }

  return row
}

/** Ordena por la cabecera, como lo haria una persona: la cabecera es un boton. */
function sortBy(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

async function tableRendered() {
  await screen.findByText('Desarrolladores')
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Resources', () => {
  it('consolida el equipo y solo pide los dos endpoints que ya existian', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    expect(teamRows(container)).toHaveLength(3)

    // Dos lecturas, las dos de endpoints que ya existian. La vista consolidada no estrena backend:
    // lo que necesita ya viaja publicado en `current.byDeveloper` y en el centro de alertas.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(METRICS_URL, expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenCalledWith(ALERTS_URL, expect.objectContaining({ method: 'GET' }))
  })

  it('con el equipo vacio lo declara, sin tabla y sin inventar capacidad', async () => {
    serve({
      metrics: okResponse(
        planningMetricsFixture({
          current: {
            ...planningMetricsFixture().current,
            capacity: { availableHours: 0, occupiedHours: 0, remainingHours: 0 },
            displacedRequirements: 0,
            byDeveloper: [],
          },
        }),
      ),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })

    expect(await screen.findByText('Ningún desarrollador tiene un plan vigente')).toBeInTheDocument()
    expect(container.querySelector('table')).toBeNull()
    expect(teamRows(container)).toHaveLength(0)

    // Sin planes no hay equipo que comparar, pero las alertas del conjunto siguen publicandose: la
    // vista no las esconde porque la tabla este vacia.
    expect(await screen.findByText('CAPACIDAD_NEGATIVA')).toBeInTheDocument()
  })

  it('muestra un plan vigente por desarrollador, con sus cifras tal como llegan', async () => {
    const fixture = planningMetricsFixture()
    serve({ metrics: okResponse(fixture) })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // Una fila por plan vigente, ni una mas: la vista no agrupa por persona ni fusiona planes.
    expect(orderOf(container)).toEqual([DEVELOPER_ID, FULL_DEVELOPER_ID, OVER_DEVELOPER_ID])

    const conHolgura = rowOf(container, DEVELOPER_ID)
    expect(within(conHolgura).getByText('80')).toBeInTheDocument()
    expect(within(conHolgura).getByText('71')).toBeInTheDocument()
    expect(within(conHolgura).getByText('9')).toBeInTheDocument()
    expect(within(conHolgura).getByText(PLAN_ID)).toBeInTheDocument()
    expect(conHolgura.getAttribute('data-remaining')).toBe('ok')
  })

  it('publica los agregados del backend tal cual, sin sumarlos por su cuenta', async () => {
    // Unos agregados que no cuadran con las filas: si la vista sumara, se veria la suma y no esto.
    serve({
      metrics: okResponse(
        planningMetricsFixture({
          current: {
            ...planningMetricsFixture().current,
            capacity: { availableHours: 999, occupiedHours: 888, remainingHours: 777 },
          },
        }),
      ),
    })

    renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    expect(screen.getByText('999')).toBeInTheDocument()
    expect(screen.getByText('888')).toBeInTheDocument()
    expect(screen.getByText('777')).toBeInTheDocument()

    // Las sumas reales de las tres filas no aparecen por ningun lado.
    expect(screen.queryByText('160')).not.toBeInTheDocument()
    expect(screen.queryByText('163')).not.toBeInTheDocument()
  })

  it('marca la capacidad agotada, con el numero recibido y no una etiqueta', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    const agotado = rowOf(container, FULL_DEVELOPER_ID)

    expect(agotado.getAttribute('data-remaining')).toBe('full')
    expect(within(agotado).getByText('0')).toBeInTheDocument()
  })

  it('marca la capacidad negativa y no la recorta a cero', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    const pasado = rowOf(container, OVER_DEVELOPER_ID)

    expect(pasado.getAttribute('data-remaining')).toBe('over')
    // El signo es la informacion: recortarlo a cero borraria el hecho que la fila existe para decir.
    expect(within(pasado).getByText('-12')).toBeInTheDocument()
  })

  it('señala los desplazamientos y deja abrir su desglose', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    const conDesplazados = rowOf(container, FULL_DEVELOPER_ID)
    expect(conDesplazados.getAttribute('data-displaced')).toBe('true')
    expect(within(conDesplazados).getByText('5')).toBeInTheDocument()
    expect(
      within(conDesplazados).getByRole('link', { name: 'Ver el desglose' }).getAttribute('href'),
    ).toBe('/metricas/desplazados')

    // Quien no tiene desplazamientos no lleva enlace: no hay lista vacia que abrir.
    const sinDesplazados = rowOf(container, DEVELOPER_ID)
    expect(sinDesplazados.getAttribute('data-displaced')).toBe('false')
    expect(within(sinDesplazados).queryByRole('link', { name: 'Ver el desglose' })).toBeNull()
  })

  it('lleva al plan vigente y a su timeline, que es el mismo recurso', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    const fila = rowOf(container, DEVELOPER_ID)

    // La trazabilidad se arma con lo que ya existe: la agenda del plan y el desglose de la metrica.
    expect(within(fila).getByRole('link', { name: PLAN_ID }).getAttribute('href')).toBe(
      `/calendario/${PLAN_ID}`,
    )
  })

  it('un desarrollador sin plan vigente no aparece, y la vista lo declara', async () => {
    // Solo uno de los tres tiene plan: los otros dos tienen trabajo declarado, pero no plan.
    const soloUno = planningMetricsFixture()
    serve({
      metrics: okResponse({
        ...soloUno,
        current: { ...soloUno.current, byDeveloper: [soloUno.current.byDeveloper[0]] },
      }),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    expect(orderOf(container)).toEqual([DEVELOPER_ID])
    expect(container.querySelector(`[data-developer="${FULL_DEVELOPER_ID}"]`)).toBeNull()

    // La ausencia se declara en la tabla en vez de rellenarse con una fila de ceros: la vista
    // consolida planes, no personas.
    expect(
      screen.getByText(/Un desarrollador sin plan vigente no aparece en la tabla/),
    ).toBeInTheDocument()
  })

  it('ordena por cualquier columna, y el segundo clic la invierte', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // Sin tocar nada, el orden es el que entrego el backend.
    expect(orderOf(container)).toEqual([DEVELOPER_ID, FULL_DEVELOPER_ID, OVER_DEVELOPER_ID])

    sortBy('Restante')
    expect(orderOf(container)).toEqual([OVER_DEVELOPER_ID, FULL_DEVELOPER_ID, DEVELOPER_ID])

    sortBy('Restante')
    expect(orderOf(container)).toEqual([DEVELOPER_ID, FULL_DEVELOPER_ID, OVER_DEVELOPER_ID])
  })

  it('ordena numeros como numeros, no como texto', async () => {
    // 9 y 80: como numero el 9 va primero, como texto "80" va primero. Es el unico par del fixture
    // donde los dos ordenes se distinguen —el resto son cifras de dos digitos—, asi que la prueba se
    // lo fabrica en vez de dar por buena una ordenacion que el fixture no puede poner a prueba.
    const [base] = planningMetricsFixture().current.byDeveloper
    const conDigitos = (developerId: string, hours: number) => ({
      ...base,
      developerId,
      capacity: { availableHours: hours, occupiedHours: 0, remainingHours: hours },
    })

    serve({
      metrics: okResponse(
        planningMetricsFixture({
          current: {
            ...planningMetricsFixture().current,
            byDeveloper: [conDigitos('dev-ochenta', 80), conDigitos('dev-nueve', 9)],
          },
        }),
      ),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    sortBy('Disponible')
    expect(orderOf(container)).toEqual(['dev-nueve', 'dev-ochenta'])

    // Ordenar no es consultar: siguen siendo las dos mismas peticiones.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('declara la columna por la que ordena', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    const headers = [...container.querySelectorAll('th')]
    const desplazados = headers.find((header) => header.textContent?.includes('Desplazados'))

    expect(desplazados?.getAttribute('aria-sort')).toBe('none')

    sortBy('Desplazados')
    expect(desplazados?.getAttribute('aria-sort')).toBe('ascending')

    sortBy('Desplazados')
    expect(desplazados?.getAttribute('aria-sort')).toBe('descending')
  })

  it('el contador de cada alerta de capacidad es el numero de filas que la produce', async () => {
    const metrics = planningMetricsFixture()
    serve({ metrics: okResponse(metrics), alerts: okResponse(alertsFixture()) })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // Esta es la unica correspondencia que hay entre la tabla y las alertas, y la vista no la
    // programa: la comprueba. La alerta no tiene dimension de desarrollador, asi que el desglose por
    // persona de una alerta de capacidad es exactamente la tabla.
    const filas = (estado: string) =>
      container.querySelectorAll(`[data-slot="team-row"][data-remaining="${estado}"]`).length

    // La cifra es el ultimo hijo de la fila: la severidad y el tipo van juntos a la izquierda.
    const alerta = (type: string) =>
      Number(
        container.querySelector(`[data-slot="team-alert"][data-type="${type}"]`)?.lastElementChild
          ?.textContent,
      )

    expect(filas('over')).toBe(alerta('CAPACIDAD_NEGATIVA'))
    expect(filas('full')).toBe(alerta('CAPACIDAD_AGOTADA'))
  })

  it('si las alertas fallan, la tabla del equipo sigue en pie', async () => {
    serve({
      alerts: errorResponse(500, { message: 'El servicio de alertas no responde' }),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // El fallo se declara en su tarjeta y no se lleva por delante la vista.
    expect(teamRows(container)).toHaveLength(3)
    expect(screen.getByText(/El servicio de alertas no responde/)).toBeInTheDocument()
    expect(screen.queryByText('No fue posible cargar la vista del equipo')).not.toBeInTheDocument()
  })

  it('informa el error de la fotografia con su mensaje y deja reintentar', async () => {
    serve({ metrics: errorResponse(500, { message: 'La base de datos no responde' }) })

    renderWithClient(<Resources />, { route: '/recursos' })

    expect(await screen.findByText('No fue posible cargar la vista del equipo')).toBeInTheDocument()
    expect(screen.getByText('La base de datos no responde')).toBeInTheDocument()

    serve({})
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    await tableRendered()
    expect(teamRows(document.body)).toHaveLength(3)
  })

  it('no escribe el catalogo de alertas ni re-deriva severidades', async () => {
    // Una severidad que la vista no conoce se pinta igual: el color no decide nada.
    const fixture = alertsFixture()
    const [primera] = fixture.alerts
    const desconocida = { ...primera, severity: 'CRITICAL' as const, type: 'ALGO_NUEVO', count: 3 }

    serve({
      alerts: okResponse(alertsFixture({ alerts: [desconocida] })),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // La vista no filtra el catalogo: pinta lo que llego, con su tipo y su cifra.
    const alerta = container.querySelector('[data-slot="team-alert"]')
    expect(alerta?.getAttribute('data-type')).toBe('ALGO_NUEVO')
    expect(within(alerta as HTMLElement).getByText('3')).toBeInTheDocument()
    expect(within(alerta as HTMLElement).getByText('CRITICAL')).toBeInTheDocument()
  })
})
