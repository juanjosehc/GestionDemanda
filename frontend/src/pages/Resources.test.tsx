import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Resources } from '@/pages/Resources'
import {
  DEVELOPER_ID,
  FULL_DEVELOPER_ID,
  OVER_DEVELOPER_ID,
  PLAN_ID,
  alertsFixture,
  declarationsFixture,
  planningMetricsFixture,
  renegotiationsFixture,
  teamCatalogFixture,
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
const RENEGOTIATIONS_URL = '/api/renegotiations'
const TEAM_URL = '/api/team'
const DECLARATIONS_PREFIX = '/api/planning-metadata/declarations/'

function declarationsUrl(developerId: string) {
  return `${DECLARATIONS_PREFIX}${developerId}`
}

/**
 * Nicolas Alejandro Suarez Flores: el caso que esta fase tiene que poder enseñar.
 *
 * Su login y su numero de GLPI son **dos claves de la misma persona**, y el sistema lo nombra por el
 * login: si el plan se pidio tecleando el numero, la tabla tiene que cruzarlos o enseñaria dos filas de
 * alguien que es uno solo.
 */
const NICOLAS_LOGIN = 'NicoSuar'
const NICOLAS_GLPI_ID = 1071

/**
 * Cuantos tickets tiene asignados cada persona del fixture.
 *
 * **El nombre ya no sale de aqui.** Lo publica el padron del equipo —`/api/team`—, que es la unica
 * lectura que enumera personas y responde por todas de una vez; la declaracion del tecnico se pide por
 * los tickets, y se pide por todo el que esta en la tabla, tenga plan o no.
 */
const TICKETS: Record<string, number> = {
  [DEVELOPER_ID]: 5,
  [FULL_DEVELOPER_ID]: 2,
  [OVER_DEVELOPER_ID]: 3,
}

/**
 * La declaracion de un tecnico: tantos tickets como declara `TICKETS`.
 *
 * Un identificador que no este en el mapa responde sin tickets: es el caso de las pruebas que se
 * fabrican sus propias filas. El nombre viaja igual en la respuesta —el backend lo sigue publicando—
 * pero la vista no lo lee de aqui.
 */
function declarationResponse(developerId: string) {
  return okResponse(
    declarationsFixture({
      developer: { id: developerId, name: null },
      items: declarationsFixture().items.slice(0, TICKETS[developerId] ?? 0),
    }),
  )
}

type Served = ReturnType<typeof okResponse> | ReturnType<typeof errorResponse>

/**
 * Sirve las cinco lecturas por su direccion.
 *
 * La vista lee los cuatro endpoints de conjunto —el padron, la fotografia, las alertas y las
 * renegociaciones— y **una declaracion por persona de la tabla**, que es de donde salen los tickets. Las
 * pruebas tienen que poder mover una sin mover las otras: es lo que distingue «la vista se cae» de
 * «las renegociaciones se cayeron y la tabla sigue en pie».
 */
function serve({
  team,
  metrics,
  alerts,
  renegotiations,
  declarations,
}: {
  team?: Served
  metrics?: Served
  alerts?: Served
  renegotiations?: Served
  declarations?: (developerId: string) => Served
} = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (url === TEAM_URL) {
      return Promise.resolve(team ?? okResponse(teamCatalogFixture()))
    }

    if (url === METRICS_URL) {
      return Promise.resolve(metrics ?? okResponse(planningMetricsFixture()))
    }

    if (url === ALERTS_URL) {
      return Promise.resolve(alerts ?? okResponse(alertsFixture()))
    }

    if (url === RENEGOTIATIONS_URL) {
      return Promise.resolve(renegotiations ?? okResponse(renegotiationsFixture()))
    }

    if (url.startsWith(DECLARATIONS_PREFIX)) {
      const developerId = url.slice(DECLARATIONS_PREFIX.length)
      return Promise.resolve(declarations ? declarations(developerId) : declarationResponse(developerId))
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

/** El texto de una celda concreta, para las columnas cuyas cifras pueden repetirse en la fila. */
function cellOf(container: HTMLElement, developerId: string, slot: string): string {
  return rowOf(container, developerId).querySelector(`[data-slot="${slot}"]`)?.textContent ?? ''
}

/** Ordena por la cabecera, como lo haria una persona: la cabecera es un boton. */
function sortBy(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

async function tableRendered() {
  await screen.findByText('Personas')
}

/** Las direcciones que se pidieron, para las pruebas que miran a quien se le pregunto y a quien no. */
function requestedUrls(): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Resources', () => {
  it('consolida el equipo con el padron y las lecturas que ya existian', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()
    await screen.findByText('Ana Perez')

    expect(teamRows(container)).toHaveLength(3)

    // El padron decide quien esta en la tabla; la fotografia, las alertas y las renegociaciones ya
    // existian, y los tickets de cada persona los publica la declaracion del tecnico. Lo que no hay es
    // una lectura que traiga la capacidad y los tickets juntos, y esa no se inventa aqui.
    expect(requestedUrls().sort()).toEqual(
      [
        ALERTS_URL,
        METRICS_URL,
        RENEGOTIATIONS_URL,
        TEAM_URL,
        declarationsUrl(DEVELOPER_ID),
        declarationsUrl(FULL_DEVELOPER_ID),
        declarationsUrl(OVER_DEVELOPER_ID),
      ].sort(),
    )
  })

  it('nombra a las personas con lo que publica el padron, no con una lectura por persona', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    expect(await screen.findByText('Ana Perez')).toBeInTheDocument()
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()
    expect(screen.getByText('Diana Lopez')).toBeInTheDocument()

    // El nombre va en la primera celda, que es la que se lee al recorrer la tabla.
    expect(cellOf(container, DEVELOPER_ID, 'team-name')).toContain('Ana Perez')
    expect(rowOf(container, DEVELOPER_ID).getAttribute('data-name')).toBe('Ana Perez')

    // Y sale del padron: una lectura para todo el equipo, y no una por persona. La declaracion del
    // tecnico se pide igual —por los tickets— pero no es de donde sale el nombre.
    expect(requestedUrls().filter((url) => url === TEAM_URL)).toHaveLength(1)
  })

  it('deja el identificador como dato tecnico, en su columna y sin ser la identificacion', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()
    await screen.findByText('Ana Perez')

    const fila = rowOf(container, DEVELOPER_ID)

    // El identificador sigue en la tabla —es la clave con la que se pide todo lo demas— pero en su
    // columna, y la celda que identifica la fila no lo lleva.
    expect(cellOf(container, DEVELOPER_ID, 'team-developer-id')).toBe(DEVELOPER_ID)
    expect(fila.querySelector('td')?.textContent).not.toContain(DEVELOPER_ID)
    expect(fila.getAttribute('data-developer')).toBe(DEVELOPER_ID)
  })

  it('una persona con plan trae su nombre, sus tickets, su capacidad y su plan', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()
    await screen.findByText('Ana Perez')

    const fila = rowOf(container, DEVELOPER_ID)

    expect(within(fila).getByText('5')).toBeInTheDocument()
    expect(within(fila).getByText('80')).toBeInTheDocument()
    expect(within(fila).getByText('71')).toBeInTheDocument()
    expect(within(fila).getByText('9')).toBeInTheDocument()
    expect(within(fila).getByText(PLAN_ID)).toBeInTheDocument()
    expect(fila.getAttribute('data-remaining')).toBe('ok')
  })

  it('a quien no tiene plan vigente se le ven sus tickets como a cualquier otro', async () => {
    // Solo uno de los tres tiene plan: los otros dos estan en el equipo, pero sin nada planificado.
    const soloUno = planningMetricsFixture()
    serve({
      metrics: okResponse({
        ...soloUno,
        current: { ...soloUno.current, byDeveloper: [soloUno.current.byDeveloper[0]] },
      }),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()
    await screen.findByText('Ana Perez')

    // Estar en el equipo no depende del plan: los tres siguen en la tabla.
    expect(teamRows(container)).toHaveLength(3)
    expect(cellOf(container, FULL_DEVELOPER_ID, 'team-name')).toContain('Carlos Ruiz')
    // Y su capacidad no es un cero: no se le ha calculado ninguna.
    expect(cellOf(container, FULL_DEVELOPER_ID, 'team-displaced')).toBe('—')
    expect(rowOf(container, FULL_DEVELOPER_ID).getAttribute('data-remaining')).toBe('sin-plan')

    // Los tickets tampoco dependen del plan. La columna es del equipo, asi que se le pregunta a todo
    // el que esta en la tabla: antes se pedia solo por quien tenia plan vigente y esta fila salia
    // «Sin dato» sin que se hubiera intentado leer nunca —el defecto que esta prueba reproduce—.
    expect(requestedUrls()).toContain(declarationsUrl(FULL_DEVELOPER_ID))
    expect(requestedUrls()).toContain(declarationsUrl(OVER_DEVELOPER_ID))
    expect(cellOf(container, FULL_DEVELOPER_ID, 'team-tickets')).toBe('2')

    // El recuento de la cabecera dice cuantas de las que se ven no tienen plan.
    expect(screen.getByText(/2 sin plan vigente/)).toBeInTheDocument()
  })

  it('publica los tickets de cada persona, y distingue cero de una lectura que fallo', async () => {
    // Los tres desenlaces de la lectura de tickets: cinco, ninguno y una que no respondio.
    serve({
      declarations: (developerId) => {
        if (developerId === FULL_DEVELOPER_ID) {
          return okResponse(
            declarationsFixture({
              developer: { id: developerId, name: 'Carlos Ruiz' },
              items: [],
            }),
          )
        }

        if (developerId === OVER_DEVELOPER_ID) {
          return errorResponse(404, { message: 'El tecnico no existe en GLPI' })
        }

        return declarationResponse(developerId)
      },
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()
    await screen.findByText('Ana Perez')

    expect(cellOf(container, DEVELOPER_ID, 'team-tickets')).toBe('5')
    // Cero tickets es una respuesta completa, y se dice con palabras para que no se lea como un hueco.
    expect(cellOf(container, FULL_DEVELOPER_ID, 'team-tickets')).toBe('Sin tickets')
    // Una lectura que no respondio no es cero: no se sabe cuantos tiene.
    expect(cellOf(container, OVER_DEVELOPER_ID, 'team-tickets')).toBe('Sin dato')
  })

  it('la captura: el equipo entero sin planes, y cada uno con su cifra de tickets', async () => {
    // El escenario de la captura que abrio la fase: personas visibles en la tabla y «Sin dato» en la
    // columna de tickets. La causa no estaba en GLPI sino aqui: la vista solo preguntaba por quien
    // tenia plan vigente, asi que sin planes no preguntaba por nadie y nadie tenia dato que enseñar.
    const sinPlanes = planningMetricsFixture()
    serve({
      metrics: okResponse({
        ...sinPlanes,
        current: { ...sinPlanes.current, byDeveloper: [] },
      }),
      declarations: (developerId) =>
        developerId === DEVELOPER_ID
          ? errorResponse(502, { message: 'GLPI no respondio' })
          : declarationResponse(developerId),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()
    await screen.findByText('Ana Perez')

    // Se pregunto por las tres, y las tres tienen su cifra: la columna ya no depende de que haya plan.
    expect(teamRows(container)).toHaveLength(3)
    expect(requestedUrls()).toContain(declarationsUrl(DEVELOPER_ID))
    expect(requestedUrls()).toContain(declarationsUrl(FULL_DEVELOPER_ID))
    expect(requestedUrls()).toContain(declarationsUrl(OVER_DEVELOPER_ID))
    expect(cellOf(container, FULL_DEVELOPER_ID, 'team-tickets')).toBe('2')
    expect(cellOf(container, OVER_DEVELOPER_ID, 'team-tickets')).toBe('3')

    // Y «Sin dato» queda para lo unico que significa: una lectura que de verdad no se pudo hacer.
    expect(cellOf(container, DEVELOPER_ID, 'team-tickets')).toBe('Sin dato')
  })

  it('los desplazamientos son los de cada persona, no la cifra del conjunto', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    expect(cellOf(container, FULL_DEVELOPER_ID, 'team-displaced')).toBe('5')
    expect(cellOf(container, DEVELOPER_ID, 'team-displaced')).toBe('0')
    expect(cellOf(container, OVER_DEVELOPER_ID, 'team-displaced')).toBe('0')
  })

  it('cuenta las renegociaciones pendientes de cada persona con una sola lectura', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // El fixture tiene una acordada (dev-001) y dos pendientes (dev-002 y dev-003).
    await screen.findByText('Ana Perez')
    expect(cellOf(container, DEVELOPER_ID, 'team-pending')).toBe('0')
    expect(cellOf(container, FULL_DEVELOPER_ID, 'team-pending')).toBe('1')
    expect(cellOf(container, OVER_DEVELOPER_ID, 'team-pending')).toBe('1')

    // Una sola peticion para todo el equipo: la lista trae el identificador en cada fila.
    expect(requestedUrls().filter((url) => url === RENEGOTIATIONS_URL)).toHaveLength(1)

    expect(
      within(rowOf(container, FULL_DEVELOPER_ID))
        .getByRole('link', { name: 'Ver las renegociaciones' })
        .getAttribute('href'),
    ).toBe('/renegociaciones')
  })

  it('señala en cada fila las condiciones que esa persona produce', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // Con holgura y sin desplazamientos: ninguna.
    expect(rowOf(container, DEVELOPER_ID).querySelector('[data-slot="team-alerts"]')?.getAttribute('data-alerts')).toBe('0')
    // Agotada y con desplazamientos: dos.
    expect(rowOf(container, FULL_DEVELOPER_ID).querySelector('[data-slot="team-alerts"]')?.getAttribute('data-alerts')).toBe('2')
    // Capacidad negativa: una.
    expect(rowOf(container, OVER_DEVELOPER_ID).querySelector('[data-slot="team-alerts"]')?.getAttribute('data-alerts')).toBe('1')

    // Y lleva al centro donde esa condicion esta contada.
    expect(
      within(rowOf(container, OVER_DEVELOPER_ID))
        .getByRole('link', { name: /Ver la alerta/ })
        .getAttribute('href'),
    ).toBe('/alertas')
  })

  it('ordena por las columnas nuevas: nombre, tickets y pendientes', async () => {
    serve({})

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()
    await screen.findByText('Ana Perez')

    sortBy('Nombre')
    expect(orderOf(container)).toEqual([DEVELOPER_ID, FULL_DEVELOPER_ID, OVER_DEVELOPER_ID])

    sortBy('Nombre')
    expect(orderOf(container)).toEqual([OVER_DEVELOPER_ID, FULL_DEVELOPER_ID, DEVELOPER_ID])

    // 2, 3 y 5 tickets: como numero, y no como texto.
    sortBy('Tickets')
    expect(orderOf(container)).toEqual([FULL_DEVELOPER_ID, OVER_DEVELOPER_ID, DEVELOPER_ID])

    sortBy('Renegociaciones pendientes')
    expect(orderOf(container)).toEqual([DEVELOPER_ID, FULL_DEVELOPER_ID, OVER_DEVELOPER_ID])

    sortBy('Renegociaciones pendientes')
    // El empate a uno se desempata por identificador: sin eso, dos ordenaciones iguales podrian
    // pintar las filas al reves.
    expect(orderOf(container)).toEqual([FULL_DEVELOPER_ID, OVER_DEVELOPER_ID, DEVELOPER_ID])
  })

  it('sin equipo no pide nada por persona ni inventa filas', async () => {
    const vacio = planningMetricsFixture()
    serve({
      team: okResponse(teamCatalogFixture({ people: [] })),
      metrics: okResponse({
        ...vacio,
        current: { ...vacio.current, byDeveloper: [] },
      }),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })

    expect(await screen.findByText('No hay nadie en el equipo')).toBeInTheDocument()
    expect(container.querySelector('table')).toBeNull()
    expect(teamRows(container)).toHaveLength(0)

    // Sin personas a las que contar sus tickets no se consulta nada: una peticion por fila y sin filas
    // son cero.
    expect(requestedUrls().filter((url) => url.startsWith(DECLARATIONS_PREFIX))).toHaveLength(0)
  })

  it('a quien GLPI no le publica nombre lo deja con su identificador y el motivo', async () => {
    // El padron trae a la persona con el nombre en nulo —GLPI conoce la cuenta pero no publica un
    // nombre utilizable— y las otras dos nombradas.
    serve({
      team: okResponse(
        teamCatalogFixture({
          people: teamCatalogFixture().people.map((person) =>
            person.developerId === OVER_DEVELOPER_ID ? { ...person, name: null } : person,
          ),
        }),
      ),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    const sinNombre = rowOf(container, OVER_DEVELOPER_ID)
    expect(await within(sinNombre).findByText(/GLPI no publica un nombre/)).toBeInTheDocument()
    // El identificador queda como respaldo y se dice que lo es.
    expect(sinNombre.querySelector('[data-slot="team-name"]')?.textContent).toContain(OVER_DEVELOPER_ID)

    // Y las otras filas siguen nombradas: el nulo es de una persona, no de la lectura.
    expect(screen.getByText('Ana Perez')).toBeInTheDocument()
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()
  })

  it('si las renegociaciones fallan, la tabla sigue y la columna lo declara', async () => {
    serve({
      renegotiations: errorResponse(500, { message: 'El servicio de renegociacion no responde' }),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    expect(await screen.findByText(/las pendientes de cada persona quedan sin dato/)).toBeInTheDocument()
    expect(teamRows(container)).toHaveLength(3)
    // Y no se pinta un cero: no se sabe cuantas quedan pendientes.
    expect(cellOf(container, FULL_DEVELOPER_ID, 'team-pending')).toBe('Sin dato')
  })

  it('con el equipo vacio lo declara, sin tabla y sin inventar capacidad', async () => {
    serve({
      team: okResponse(teamCatalogFixture({ people: [] })),
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

    expect(await screen.findByText('No hay nadie en el equipo')).toBeInTheDocument()
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
      // El padron no los conoce: aparecen solo por su plan, que es justo el caso que esta prueba
      // necesita aislado para poder afirmar el orden de dos cifras y nada mas.
      team: okResponse(teamCatalogFixture({ people: [] })),
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

    // Ordenar no es consultar: siguen siendo las mismas peticiones —cuatro de conjunto y una por fila—.
    expect(fetchMock).toHaveBeenCalledTimes(6)
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
  /*
   * El padron es una lectura mas, y las cuatro pruebas que siguen son las que la fase existe para
   * poder escribir: quien entra sin plan, quien entra por una excepcion, que pasa cuando GLPI no
   * responde y que pasa con un plan que el padron no conoce.
   */

  it('un plan pedido por el numero de GLPI se cuelga de esa persona, y no de una fila aparte', async () => {
    // Nicolas Alejandro Suarez Flores: esta en el equipo por una excepcion declarada a mano y su plan
    // se pidio tecleando su numero de GLPI. Es una sola persona, y la tabla tiene que enseñar una fila.
    const [base] = planningMetricsFixture().current.byDeveloper

    serve({
      team: okResponse(
        teamCatalogFixture({
          people: [
            {
              developerId: NICOLAS_LOGIN,
              glpiId: NICOLAS_GLPI_ID,
              name: 'Nicolas Alejandro Suarez Flores',
              active: true,
              sourceType: 'EXCEPTION',
              operational: true,
            },
          ],
        }),
      ),
      metrics: okResponse({
        ...planningMetricsFixture(),
        current: {
          ...planningMetricsFixture().current,
          byDeveloper: [{ ...base, developerId: String(NICOLAS_GLPI_ID) }],
        },
      }),
      // Responde por cualquier clave: es lo que hace el backend, que resuelve el tecnico por el login o
      // por su numero indistintamente.
      declarations: () =>
        okResponse(
          declarationsFixture({
            developer: { id: NICOLAS_LOGIN, name: null },
            items: declarationsFixture().items.slice(0, 4),
          }),
        ),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // Una fila, con su nombre y con el plan que se pidio por su numero.
    expect(orderOf(container)).toEqual([NICOLAS_LOGIN])
    expect(screen.getByText('Nicolas Alejandro Suarez Flores')).toBeInTheDocument()
    expect(rowOf(container, NICOLAS_LOGIN).getAttribute('data-remaining')).toBe('ok')
    expect(cellOf(container, NICOLAS_LOGIN, 'team-displaced')).toBe('0')

    // Los tickets se piden por el login, que es como el sistema nombra a la persona y como la resuelve
    // el backend. La clave del plan —el numero— no se pide aparte: es la misma persona, y preguntar por
    // las dos serian dos lecturas a GLPI para un solo dato.
    expect(requestedUrls()).toContain(declarationsUrl(NICOLAS_LOGIN))
    expect(requestedUrls()).not.toContain(declarationsUrl(String(NICOLAS_GLPI_ID)))
    expect(cellOf(container, NICOLAS_LOGIN, 'team-tickets')).toBe('4')
  })

  it('marca el origen de quien no viene de GLPI, y calla el de quien si', async () => {
    serve({
      team: okResponse(
        teamCatalogFixture({
          people: [
            ...teamCatalogFixture().people,
            {
              developerId: 'AnaExcepcion',
              glpiId: null,
              name: 'Ana Excepcion',
              active: true,
              sourceType: 'EXCEPTION',
              operational: true,
            },
          ],
          unusedExceptions: ['AnaPerez'],
        }),
      ),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // La fila de GLPI no lleva insignia: en cuarenta filas del grupo seria ruido, y no dice nada.
    expect(rowOf(container, DEVELOPER_ID).querySelector('[data-slot="team-origin"]')).toBeNull()
    // La de la excepcion si, porque esa fila no se puede explicar mirando GLPI.
    expect(
      rowOf(container, 'AnaExcepcion').querySelector('[data-slot="team-origin"]')?.textContent,
    ).toBe('Excepción')

    // Y sus tickets se le piden como a cualquiera, por su login. No tiene numero de GLPI —la excepcion
    // existe justo porque no hay cuenta que leer— y eso no puede dejar la columna sin dato: la lectura
    // va por el login, que es lo unico que esta persona tiene.
    expect(requestedUrls()).toContain(declarationsUrl('AnaExcepcion'))
    expect(cellOf(container, 'AnaExcepcion', 'team-tickets')).toBe('Sin tickets')

    // Y una excepcion que GLPI ya entrega se declara en vez de callarse: es una decision de alguien
    // que quedo sin efecto.
    expect(
      container.querySelector('[data-slot="team-unused-exceptions"]')?.textContent,
    ).toContain('AnaPerez')
  })

  it('declara que GLPI no respondio, con el motivo, en vez de dejar el equipo a medias', async () => {
    const vacio = planningMetricsFixture()

    serve({
      team: okResponse(
        teamCatalogFixture({
          glpi: {
            available: false,
            groupId: 1,
            groupName: 'Desarrollo N2',
            detail: 'Connection refused',
          },
          // Lo unico que sobrevive a un GLPI caido: las excepciones declaradas a mano.
          people: [
            {
              developerId: NICOLAS_LOGIN,
              glpiId: NICOLAS_GLPI_ID,
              name: 'Nicolas Alejandro Suarez Flores',
              active: true,
              sourceType: 'EXCEPTION',
              operational: true,
            },
          ],
        }),
      ),
      metrics: okResponse({ ...vacio, current: { ...vacio.current, byDeveloper: [] } }),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // El fallo se dice entero: que no se pudo, que grupo se intento leer y por que. No se esconde.
    const aviso = container.querySelector('[data-slot="team-glpi-down"]')
    expect(aviso?.textContent).toContain('Desarrollo N2')
    expect(aviso?.textContent).toContain('Connection refused')

    // Y la tabla sigue en pie con quien se pudo saber: la lectura caida no se lleva la pantalla.
    expect(teamRows(container)).toHaveLength(1)
    expect(screen.getByText('Nicolas Alejandro Suarez Flores')).toBeInTheDocument()
    expect(screen.queryByText('No fue posible cargar la vista del equipo')).not.toBeInTheDocument()
  })

  it('un plan que el padron no conoce sigue apareciendo, y dice que solo se le conoce por el', async () => {
    // Un plan ya guardado no puede desaparecer de la pantalla porque el padron no lo liste: seria
    // perder trabajo hecho. Se enseña, marcado con la procedencia que de verdad tiene.
    const [base] = planningMetricsFixture().current.byDeveloper

    serve({
      team: okResponse(teamCatalogFixture({ people: [] })),
      metrics: okResponse({
        ...planningMetricsFixture(),
        current: { ...planningMetricsFixture().current, byDeveloper: [base] },
      }),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    const fila = rowOf(container, DEVELOPER_ID)

    expect(fila.getAttribute('data-source')).toBe('PLAN')
    expect(fila.querySelector('[data-slot="team-origin"]')?.textContent).toBe('Solo plan')
    // Sin nombre se dice por que, en vez de dejar la celda en blanco.
    expect(fila.textContent).toContain('Solo se conoce por su plan')
    // Y su plan se sigue pudiendo abrir.
    expect(within(fila).getByText(PLAN_ID)).toBeInTheDocument()

    // Su columna de tickets tambien se pregunta: la clave del plan es la unica forma de nombrar a esta
    // persona, asi que es la que se pide cuando el padron no la reclama.
    expect(requestedUrls()).toContain(declarationsUrl(DEVELOPER_ID))
    expect(cellOf(container, DEVELOPER_ID, 'team-tickets')).toBe('5')
  })
})

/**
 * El equipo operativo: con quien se trabaja a diario.
 *
 * El padron sigue trayendo a todo el mundo y estas pruebas lo comprueban en cada caso —nadie desaparece
 * del catalogo—; lo que cambia es a quien enseña la tabla por defecto. La cuarta persona del padron de
 * abajo es el caso que el brief quiere cubrir: alguien que GLPI publica y que nadie ha declarado como
 * equipo operativo, que es lo que pasa con cualquiera que se dé de alta mañana.
 */
const OUTSIDER_ID = 'dev-004'

/** El padron del fixture mas alguien de GLPI a quien nadie ha declarado operativo. */
function teamWithOutsider() {
  return teamCatalogFixture({
    people: [
      ...teamCatalogFixture().people,
      {
        developerId: OUTSIDER_ID,
        glpiId: 104,
        name: 'Elena Fuera',
        active: true,
        sourceType: 'GLPI',
        operational: false,
      },
    ],
  })
}

/** Pulsa uno de los dos modos, como lo haria una persona. */
function switchTo(label: 'Solo equipo operativo' | 'Mostrar todos') {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

/** El recuento de cabecera: cuantas personas hay, cuantas quedan fuera y cuantas sin plan. */
function summary(container: HTMLElement): string {
  return container.querySelector('[data-slot="team-summary"]')?.textContent ?? ''
}

describe('Resources · el equipo operativo', () => {
  it('abre con el equipo operativo, y quien no esta declarado no ocupa la tabla', async () => {
    serve({ team: okResponse(teamWithOutsider()) })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    expect(orderOf(container)).toEqual([DEVELOPER_ID, FULL_DEVELOPER_ID, OVER_DEVELOPER_ID])
  })

  it('dice cuantas personas quedan fuera, que es lo que hace visible el subconjunto', async () => {
    serve({ team: okResponse(teamWithOutsider()) })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    expect(summary(container)).toContain('3 de 4 personas')
    expect(summary(container)).toContain('1 fuera del equipo operativo')
  })

  it('«Mostrar todos» devuelve el padron entero y marca a quien esta fuera', async () => {
    serve({ team: okResponse(teamWithOutsider()) })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    switchTo('Mostrar todos')

    expect(orderOf(container)).toEqual([
      DEVELOPER_ID,
      FULL_DEVELOPER_ID,
      OVER_DEVELOPER_ID,
      OUTSIDER_ID,
    ])
    // La marca es lo unico que distingue, en este modo, a quien pertenece de quien no.
    expect(rowOf(container, OUTSIDER_ID).getAttribute('data-operational')).toBe('false')
    expect(
      within(rowOf(container, OUTSIDER_ID)).getByText('Fuera del equipo operativo'),
    ).toBeInTheDocument()
    // Y quien si pertenece no la lleva: la insignia dice algo, no decora todas las filas.
    expect(
      within(rowOf(container, DEVELOPER_ID)).queryByText('Fuera del equipo operativo'),
    ).not.toBeInTheDocument()
  })

  it('se puede volver al equipo operativo, y volver no pide nada', async () => {
    serve({ team: okResponse(teamWithOutsider()) })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    switchTo('Mostrar todos')
    expect(teamRows(container)).toHaveLength(4)

    const asked = requestedUrls().length
    switchTo('Solo equipo operativo')

    expect(orderOf(container)).toEqual([DEVELOPER_ID, FULL_DEVELOPER_ID, OVER_DEVELOPER_ID])
    // El filtro es de la vista: cambiar de modo no vuelve a preguntar nada. Si aqui apareciera una
    // peticion, el recorte estaria puesto antes de tiempo y cada cambio de modo costaria una lectura.
    expect(requestedUrls()).toHaveLength(asked)
  })

  it('el filtro no cambia lo que se pregunta: la columna de tickets es del equipo, no de la vista', async () => {
    serve({ team: okResponse(teamWithOutsider()) })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // Se pregunta por los cuatro aunque solo se enseñen tres: es la decision de la fase anterior —la
    // columna de tickets es del equipo— y este cambio no la enmienda.
    expect(requestedUrls()).toContain(declarationsUrl(OUTSIDER_ID))
    expect(cellOf(container, DEVELOPER_ID, 'team-tickets')).toBe('5')

    switchTo('Mostrar todos')

    // Y las cifras son las mismas en los dos modos: filtrar mueve filas, no recalcula nada.
    expect(cellOf(container, DEVELOPER_ID, 'team-tickets')).toBe('5')
  })

  it('una persona declarada como excepcion y operativa sale en el modo por defecto', async () => {
    serve({
      team: okResponse(
        teamCatalogFixture({
          people: [
            ...teamCatalogFixture().people,
            {
              developerId: NICOLAS_LOGIN,
              glpiId: NICOLAS_GLPI_ID,
              name: 'Nicolas Alejandro Suarez Flores',
              active: true,
              sourceType: 'EXCEPTION',
              operational: true,
            },
          ],
        }),
      ),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // La pertenencia no la decide el origen: una excepcion marcada es del equipo igual que quien viene
    // del grupo, y su insignia de origen sigue diciendo de donde salio.
    expect(orderOf(container)).toContain(NICOLAS_LOGIN)
    expect(
      within(rowOf(container, NICOLAS_LOGIN)).getByText('Excepción'),
    ).toBeInTheDocument()
  })

  it('avisa de las marcas de equipo operativo que no corresponden a nadie', async () => {
    serve({
      team: okResponse(teamCatalogFixture({ unusedOperational: ['AnaPerezz', 'NicoSuar'] })),
    })

    renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // Una errata en un login no saca a nadie de la vista y no avisa por su cuenta: este es el unico
    // sitio donde se ve, y por eso se publica.
    expect(screen.getByText(/marcas de equipo operativo que no corresponden a nadie/)).toBeVisible()
    expect(screen.getByText(/AnaPerezz, NicoSuar/)).toBeVisible()
  })

  it('con el padron lleno y nadie operativo no dice que no hay equipo', async () => {
    serve({
      team: okResponse(
        teamCatalogFixture({
          people: teamCatalogFixture().people.map((person) => ({ ...person, operational: false })),
        }),
      ),
    })

    const { container } = renderWithClient(<Resources />, { route: '/recursos' })
    await tableRendered()

    // Hay tres personas y ninguna es del equipo operativo: es un estado distinto de «no hay equipo», y
    // decirla mal mandaria a buscar el problema en GLPI, que es justo donde no esta.
    expect(teamRows(container)).toHaveLength(0)
    expect(screen.queryByText('No hay nadie en el equipo')).not.toBeInTheDocument()
    expect(screen.getByText('Nadie está en el equipo operativo')).toBeVisible()

    // Y el conmutador sigue a mano: es la unica salida que hay en la pantalla.
    switchTo('Mostrar todos')

    expect(orderOf(container)).toEqual([DEVELOPER_ID, FULL_DEVELOPER_ID, OVER_DEVELOPER_ID])
  })
})
