import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TeamTimeline } from '@/pages/TeamTimeline'
import {
  DEVELOPER_GLPI_ID,
  DEVELOPER_ID,
  FULL_DEVELOPER_ID,
  OVER_DEVELOPER_ID,
  PLAN_ID,
  alertsFixture,
  declarationItemFixture,
  declarationsFixture,
  planningMetadataFixture,
  teamCatalogFixture,
  teamTimelineFixture,
} from '@/test/fixtures'
import type { TimelineItem } from '@/types/timeline'
import { renderWithClient } from '@/test/render'

/**
 * El timeline del equipo, probado por lo que promete la fase: que la aplicación abra aquí y responda
 * quién tiene trabajo, en qué está, cuánto le queda libre y qué sigue pendiente **sin pedir un plan**.
 *
 * **El servidor de esta prueba lanza ante cualquier dirección que no sea una de las suyas.** Es lo
 * único que convierte «no requiere un planId» en algo comprobable: si la pantalla pidiera la agenda de
 * un plan —la lectura de la que viene—, esa dirección no estaría servida y la prueba fallaría aquí en
 * vez de pasar por casualidad con un `404` silencioso.
 *
 * También lanza ante cualquier lectura que no esté servida, y las declaraciones se sirven solo para
 * las personas que se preguntan: así una prueba puede contar cuántas peticiones se hicieron para
 * pintar la capa de pendientes, que es lo que la fase dejó de multiplicar por técnico.
 */

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const TEAM_TIMELINE_URL = '/api/planning/team/timeline'
const TEAM_URL = '/api/team'
const RENEGOTIATIONS_URL = '/api/renegotiations'
const DECLARATIONS_URL = '/api/planning-metadata/declarations'
const ALERTS_URL = '/api/planning/alerts'

/** Ninguna alerta: es el estado por defecto de estas pruebas. */
function noAlerts() {
  return { generatedAt: '2026-10-07T15:00:00Z', alerts: [] }
}

/** Ningún desplazamiento: es el estado por defecto de estas pruebas. */
function noRenegotiations() {
  return {
    source: 'plan_snapshot',
    scope: 'vigente',
    generatedAt: '2026-10-07T15:00:00Z',
    summary: { displaced: 0, pending: 0, agreed: 0 },
    items: [],
  }
}

/**
 * Un desplazamiento de `dev-001`, con el estado que el backend le haya calculado al leer.
 *
 * `source` es de donde vino el acuerdo, y solo tiene sentido cuando hay uno: un requerimiento
 * pendiente no tiene origen porque no tiene acuerdo que lo tenga.
 */
function renegotiationsFor(
  ticket: string,
  status: 'PENDIENTE_DE_ACUERDO' | 'ACORDADA',
  source: 'HTTP' | 'GLPI' = 'HTTP',
) {
  return {
    source: 'plan_snapshot',
    scope: 'vigente',
    generatedAt: '2026-10-07T15:00:00Z',
    summary: { displaced: 1, pending: status === 'PENDIENTE_DE_ACUERDO' ? 1 : 0, agreed: status === 'ACORDADA' ? 1 : 0 },
    items: [
      {
        developerId: DEVELOPER_ID,
        planId: PLAN_ID,
        calculatedAt: '2026-10-07T14:00:00Z',
        workItemId: ticket,
        status,
        events: [
          {
            timestamp: '2026-10-05T14:00:00Z',
            incidentId: 'INC-1',
            requirementId: ticket,
            originalDate: '2026-10-05',
            rescheduledDate: '2026-10-06',
            appliedRule: 'UMBRAL_INCIDENTE_EXCEDIDO',
            severity: 'MEDIO',
            reason: 'Un incidente supero el umbral de horas',
          },
        ],
        renegotiation:
          status === 'ACORDADA'
            ? {
                workItemId: ticket,
                agreedDate: '2026-10-08',
                agreedBy: source === 'GLPI' ? 'GLPI' : 'ana',
                agreedReason: 'Se acordó con quien pidió el requerimiento',
                agreedAt: '2026-10-07T10:00:00Z',
                source,
              }
            : null,
      },
    ],
  }
}

interface ServeOptions {
  timeline?: unknown
  timelineStatus?: number
  team?: unknown
  /** La declaración de cada técnico, por identificador. La que falte viaja en `unknownDevelopers`. */
  declarations?: Record<string, unknown>
  /** Fuerza el fallo de la lectura por lote, para ver que la rejilla no se cae con ella. */
  declarationsStatus?: number
  /** La lectura de renegociaciones. Por defecto, ninguna: el caso de la mayoría de las pruebas. */
  renegotiations?: unknown
  /** Fuerza el fallo de la lectura de renegociaciones. */
  renegotiationsStatus?: number
  /** La salud operativa. Por defecto, ninguna alerta: el estado de un equipo sano. */
  alerts?: unknown
  /** Lo que responde la lectura fresca de un ticket. Por defecto, la declaración del fixture. */
  declarationRead?: unknown
}

function serve({
  timeline = teamTimelineFixture(),
  timelineStatus = 200,
  team = teamCatalogFixture(),
  declarations = {},
  declarationsStatus = 200,
  renegotiations = noRenegotiations(),
  renegotiationsStatus = 200,
  alerts = noAlerts(),
  declarationRead,
}: ServeOptions = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (url === TEAM_TIMELINE_URL) {
      return Promise.resolve(
        timelineStatus === 200
          ? okResponse(timeline)
          : errorResponse(timelineStatus, { message: 'No se pudo leer la agenda del equipo' }),
      )
    }

    if (url === TEAM_URL) {
      return Promise.resolve(okResponse(team))
    }

    if (url === RENEGOTIATIONS_URL) {
      return Promise.resolve(
        renegotiationsStatus === 200
          ? okResponse(renegotiations)
          : errorResponse(renegotiationsStatus, { message: 'No disponible' }),
      )
    }

    if (url === ALERTS_URL) {
      return Promise.resolve(okResponse(alerts))
    }

    if (url.startsWith(DECLARATIONS_URL)) {
      if (declarationsStatus !== 200) {
        return Promise.resolve(errorResponse(declarationsStatus, { message: 'GLPI no responde' }))
      }

      // El timeline pide a todo el equipo en un viaje: `?developerId=a&developerId=b`. El cuerpo es
      // el del lote, y quien no esté en el mapa de esta prueba es un desconocido —lo que antes era su
      // `404` por persona—. Se responde solo a lo preguntado, igual que el backend.
      const ids = new URL(url, 'http://prueba').searchParams.getAll('developerId')

      return Promise.resolve(
        okResponse({
          developers: ids.filter((id) => declarations[id]).map((id) => declarations[id]),
          unknownDevelopers: ids.filter((id) => !declarations[id]),
        }),
      )
    }

    // El recurso de un ticket: la lectura previa al `PUT` y la respuesta de la escritura. El cuerpo
    // lo arma el mismo formulario que usa la pantalla de declaración.
    if (url === '/api/planning-metadata' || url.startsWith('/api/planning-metadata/')) {
      const workItemId = url === '/api/planning-metadata'
        ? 'INC-1'
        : decodeURIComponent(url.slice('/api/planning-metadata/'.length))

      return Promise.resolve(
        okResponse(
          declarationRead ?? planningMetadataFixture({ workItemId }),
        ),
      )
    }

    // Una dirección de más es un fallo, no un silencio.
    throw new Error(`direccion no servida: ${url}`)
  })
}

/**
 * Las declaraciones de las dos personas del fixture.
 *
 * `dev-001` trae los dos tipos de pendiente de una vez: `501` es planificable y no está en su plan,
 * y como el motor no lo rechazó es trabajo que **no entró en la última planificación**; `502` todavía
 * no se puede planificar porque le falta el compromiso. `dev-002` tiene su único ticket dentro del
 * plan, así que no arrastra ningún pendiente.
 */
function declarationsForBoth() {
  return {
    [DEVELOPER_ID]: declarationsFixture({
      developer: { id: DEVELOPER_ID, name: 'Ana Perez' },
      items: [
        declarationItemFixture({ workItemId: '501', declarationStatus: 'PLANIFICABLE' }),
        declarationItemFixture({
          workItemId: '502',
          title: 'Ajuste de reporte 502',
          declarationStatus: 'SIN_COMPROMISO',
        }),
      ],
    }),
    [FULL_DEVELOPER_ID]: declarationsFixture({
      developer: { id: FULL_DEVELOPER_ID, name: 'Carlos Ruiz' },
      items: [declarationItemFixture({ workItemId: 'REQ-9', declarationStatus: 'PLANIFICABLE' })],
    }),
  }
}

/**
 * La fila de una persona en la rejilla, para poder preguntar por lo que hay dentro de ella.
 *
 * Se busca entre las filas y no en el documento entero porque el nombre aparece dos veces en la
 * pantalla: en la rejilla y en el panel de pendientes.
 */
function fila(name: string): HTMLElement {
  const row = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="timeline-resource"]'),
  ).find((candidate) => candidate.textContent?.includes(name))

  if (!row) {
    throw new Error(`no hay fila para ${name}`)
  }

  return row
}

beforeEach(() => {
  fetchMock.mockReset()
  // El firmante se recuerda en `localStorage`: sin limpiarlo, una prueba heredaría el de la anterior.
  window.localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TeamTimeline', () => {
  it('abre la agenda del equipo sin pedir el identificador de ningún plan', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)

    // Las dos personas del equipo, con su nombre del padrón y no su login: el nombre es lo que hace
    // reconocible la fila, y solo lo publica `/api/team`.
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())
    expect(fila('Carlos Ruiz')).toBeDefined()

    // Y lo que se pidió no incluye ninguna agenda de un plan: el servidor habría lanzado. Se comprueba
    // sobre las llamadas y no sobre un mock permisivo, para que la afirmación sea sobre lo que pasó.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(TEAM_TIMELINE_URL, expect.anything()))

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    // La ruta de un plan es `/api/planning/<uuid>/timeline`: se busca por la forma del identificador y
    // no por «algo entre dos barras», que es lo que casaba con la propia ruta de equipo.
    expect(urls.filter((url) => /^\/api\/planning\/[0-9a-f-]{36}\/timeline$/.test(url))).toEqual([])
  })

  it('no le inventa una fila a quien el padrón no conoce, y dice cuánto quedó fuera', async () => {
    // `dev-002` tiene plan y un tramo, pero el padrón solo publica a `dev-001`. Es el caso de un plan
    // guardado para alguien que no está en el grupo: el trabajo no se dibuja —las filas son el
    // equipo—, pero tampoco se esconde: la pantalla dice qué quedó fuera y de quién es.
    serve({
      team: teamCatalogFixture({
        people: [
          {
            developerId: DEVELOPER_ID,
            glpiId: DEVELOPER_GLPI_ID,
            name: 'Ana Perez',
            active: true,
            sourceType: 'GLPI',
            operational: true,
          },
        ],
      }),
      declarations: declarationsForBoth(),
    })

    renderWithClient(<TeamTimeline />)

    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())
    expect(() => fila('Carlos Ruiz')).toThrow()

    const fuera = document.querySelector('[data-slot="timeline-outside"]')
    expect(fuera?.textContent).toContain('dev-002')
    expect(fuera?.textContent).toContain('1 tramo')
  })

  it('deja la fila de una persona operativa con plan con su capacidad y su trabajo', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())

    // El plan enriquece la fila y no la crea: la persona ya está en el padrón, y esto es lo que se le
    // cuelga. Tres tramos, tres días de capacidad y ningún aviso de «sin plan».
    const ana = within(fila('Ana Perez'))
    expect(ana.getByText('3 tramos')).toBeDefined()
    expect(ana.getAllByText('8 disp')).toHaveLength(3)
    expect(ana.queryByText('Sin plan')).toBeNull()
  })

  it('enseña a una persona operativa sin plan, marcada como tal, en vez de omitirla', async () => {
    // `dev-003` está en el padrón y no tiene plan vigente. Antes no existía para la pantalla; ahora es
    // una fila más y la falta se dice en la fila misma, no se deja en blanco.
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await waitFor(() => expect(fila('Diana Lopez')).toBeDefined())

    const diana = within(fila('Diana Lopez'))
    expect(diana.getByText('Sin plan')).toBeDefined()
    expect(diana.queryByText(/ tramos/)).toBeNull()
  })

  it('no deja que un identificador de demostración cree una fila', async () => {
    // Los datos de demostración viven en planes guardados, no en el padrón. Aunque el timeline los
    // devuelva —lo hace—, no son personas del equipo y no se dibujan: se cuentan aparte.
    serve({
      timeline: teamTimelineFixture({
        resources: [
          ...teamTimelineFixture().resources,
          {
            developerId: 'demo-f38',
            capacity: [
              { date: '2026-10-07', availableHours: 8, occupiedHours: 4, remainingHours: 4 },
            ],
          },
        ],
        items: [
          ...teamTimelineFixture().items,
          {
            workItemId: 'REQ-F38E-1',
            workItemType: 'REQUERIMIENTO',
            startsAt: '2026-10-07T09:00:00',
            endsAt: '2026-10-07T13:00:00',
            durationHours: 4,
            developerId: 'demo-f38',
            estimatedHours: 4,
            committedDate: '2026-10-07',
            severity: null,
            planningStatus: 'PLANIFICADO',
            sourcePlanId: '33333333-3333-3333-3333-333333333333',
            displacement: null,
          },
        ],
      }),
    })

    renderWithClient(<TeamTimeline />)
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())

    expect(() => fila('demo-f38')).toThrow()
    expect(document.querySelector('[data-slot="timeline-outside"]')?.textContent).toContain(
      'demo-f38',
    )
  })

  it('enseña a todo el equipo operativo y solo a él, tenga plan o no', async () => {
    // Patrón de aceptación de la fase: las filas son el padrón. Las tres operativas aparecen —con plan
    // o sin él— y la persona del padrón que no es operativa no entra.
    serve({
      team: teamCatalogFixture({
        people: [
          ...teamCatalogFixture().people,
          {
            developerId: 'dev-004',
            glpiId: 104,
            name: 'Elena Mora',
            active: true,
            sourceType: 'GLPI',
            operational: false,
          },
        ],
      }),
      declarations: declarationsForBoth(),
    })

    renderWithClient(<TeamTimeline />)
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())

    expect(document.querySelectorAll('[data-slot="timeline-resource"]')).toHaveLength(3)
    expect(() => fila('Elena Mora')).toThrow()
  })

  it('enseña la cobertura del plan y a quién llamar primero', async () => {
    // `501` es planificable y no está en el plan de Ana: es P4. `502` le falta el compromiso: es P1.
    // El único ticket de Carlos —`REQ-9`— sí está en su plan, así que es el único cubierto.
    serve({
      declarations: {
        [DEVELOPER_ID]: declarationsFixture({
          developer: { id: DEVELOPER_ID, name: 'Ana Perez' },
          items: [
            declarationItemFixture({ workItemId: '501', declarationStatus: 'PLANIFICABLE' }),
            declarationItemFixture({ workItemId: '502', declarationStatus: 'SIN_COMPROMISO' }),
          ],
        }),
        [FULL_DEVELOPER_ID]: declarationsFixture({
          developer: { id: FULL_DEVELOPER_ID, name: 'Carlos Ruiz' },
          items: [
            declarationItemFixture({ workItemId: 'REQ-9', declarationStatus: 'PLANIFICABLE' }),
          ],
        }),
        [OVER_DEVELOPER_ID]: declarationsFixture({
          developer: { id: OVER_DEVELOPER_ID, name: 'Diana Lopez' },
          items: [],
        }),
      },
    })

    renderWithClient(<TeamTimeline />)

    const panel = await screen.findByRole('region', { name: 'Cobertura del plan' })

    // La cobertura se cuenta sobre tickets, no sobre filas: 1 de 3 activos está en el plan. La
    // lectura llega después de montar la página, así que se espera a que el panel deje de leer.
    expect(await within(panel).findByText(/1 de 3 tickets activos en el plan \(33,3%\)/)).toBeDefined()
    // Y las dos causas se separan: falta información (P1) no es lo mismo que un plan viejo (P4).
    expect(within(panel).getByText('Falta información: 1')).toBeDefined()
    expect(within(panel).getByText('No incluido en el último plan: 1')).toBeDefined()

    // Fase 51: la misma línea dice qué universo recibe el motor y cuánto se queda fuera. Son las
    // cifras que ya estaban en la tabla —3 activos, 2 planificables—, no una cuenta nueva.
    const engine = panel.querySelector('[data-slot="coverage-engine"]')
    expect(engine?.textContent).toContain('El motor recibe los mismos 3 tickets activos')
    expect(engine?.textContent).toContain('2 llegan planificables')
    expect(engine?.textContent).toContain('1 se descarta antes de planificar')

    // La llamada de hoy: solo Ana tiene tickets que una declaración desbloquea.
    const priority = panel.querySelector('[data-slot="coverage-priority"]')
    expect(priority?.textContent).toContain('Ana Perez')
    expect(priority?.textContent).toContain('1 ticket bloqueado')
    expect(priority?.textContent).not.toContain('Carlos Ruiz')

    // La fila de la tabla, no la de la lista de llamadas: las dos llevan el identificador.
    const ana = panel.querySelector('[data-slot="coverage-row"][data-developer-id="dev-001"]')
    const carlos = panel.querySelector('[data-slot="coverage-row"][data-developer-id="dev-002"]')
    const diana = panel.querySelector('[data-slot="coverage-row"][data-developer-id="dev-003"]')

    expect(ana?.textContent).toContain('0 de 2')
    expect(carlos?.textContent).toContain('1 de 1')
    expect(carlos?.textContent).toContain('100%')
    // Diana no tiene plan ni tickets: se dice con la misma etiqueta que la rejilla, no se esconde.
    expect(diana?.textContent).toContain('Sin plan')
    expect(diana?.textContent).toContain('—')
  })

  it('enseña la cobertura potencial y la lista de tickets que la desbloquea', async () => {
    // Los mismos datos que la prueba anterior: Ana cubre 0 de 2 y le falta información en uno (502);
    // Carlos cubre 1 de 1; Diana no tiene nada. Por tanto el equipo está en 1 de 3 y puede quedar en
    // 2 de 3 declarando.
    serve({
      declarations: {
        [DEVELOPER_ID]: declarationsFixture({
          developer: { id: DEVELOPER_ID, name: 'Ana Perez' },
          items: [
            // 501 está planificable pero no en el plan: es P4, y declararlo no lo desbloquea.
            declarationItemFixture({
              workItemId: '501',
              title: 'Ticket sin colocar',
              declarationStatus: 'PLANIFICABLE',
            }),
            declarationItemFixture({
              workItemId: '502',
              title: 'Falla en produccion',
              declarationStatus: 'SIN_COMPROMISO',
              priority: 3,
              createdAt: '2026-10-01T08:00:00Z',
            }),
          ],
        }),
        [FULL_DEVELOPER_ID]: declarationsFixture({
          developer: { id: FULL_DEVELOPER_ID, name: 'Carlos Ruiz' },
          items: [
            declarationItemFixture({ workItemId: 'REQ-9', declarationStatus: 'PLANIFICABLE' }),
          ],
        }),
        [OVER_DEVELOPER_ID]: declarationsFixture({
          developer: { id: OVER_DEVELOPER_ID, name: 'Diana Lopez' },
          items: [],
        }),
      },
    })

    renderWithClient(<TeamTimeline />)

    const panel = await screen.findByRole('region', { name: 'Cobertura del plan' })

    // La cobertura potencial se dice al lado de la de hoy: lo que hay, lo que una declaración
    // recupera y dónde queda el equipo si se completa.
    expect(
      await within(panel).findByText(
        /1 recuperable mediante declaración · cobertura potencial 2 de 3 \(66,7%\)/,
      ),
    ).toBeDefined()

    // La lista de tickets es el paso siguiente a la de personas, y trae solo los que declarar
    // desbloquea: 501 es P4 y no aparece.
    const tickets = panel.querySelector('[data-slot="priority-tickets"]')
    expect(tickets?.textContent).toContain('502')
    expect(tickets?.textContent).toContain('Ana Perez')
    expect(tickets?.textContent).not.toContain('501')

    // La llamada dice dónde queda la persona, no solo cuánto tiene bloqueado.
    const priority = panel.querySelector('[data-slot="coverage-priority"]')
    expect(priority?.textContent).toContain('quedaría en 1 de 2')

    // La columna de recuperables y la marca de la fila: el mismo número en los dos sitios. La
    // columna es la séptima celda: desde la Fase 50 las acciones ocupan la segunda, delante de Plan.
    expect(within(panel).getByRole('columnheader', { name: 'Recuperables' })).toBeDefined()
    const ana = panel.querySelector('[data-slot="coverage-row"][data-developer-id="dev-001"]')
    expect(ana?.querySelectorAll('td')[7]?.textContent).toBe('1')
    expect(within(fila('Ana Perez')).getByText('1 recuperable')).toBeDefined()

    // Desde la fila se llega a los tickets que faltan: el nombre es el enlace, y la rejilla deja de
    // ser solo un contador para decir cuáles. Abre la persona entera en modo lote —`lote=1`—, que es
    // la forma en que la unidad de trabajo es la persona y no el ticket.
    expect(within(fila('Ana Perez')).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('tecnico=dev-001'),
    )
    expect(within(fila('Ana Perez')).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('lote=1'),
    )
  })

  it('abre la rejilla compacta, que es la densidad en la que caben varias personas', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // La agenda de un plan tiene una fila y abre normal; la del equipo tiene una por persona y abre
    // en la densidad más apretada, que es la única en la que se ven varias de un vistazo. El control
    // sigue ahí: lo que cambia es el valor con el que arranca.
    expect(screen.getByRole('button', { name: 'Compacta' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('enseña la capacidad de cada persona, incluidos los días en que no tiene trabajo', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // El miércoles no tiene ningún tramo de Ana, pero sí una columna: la capacidad se mide contra la
    // ventana del equipo y no contra la de su plan, que solo llegaba al martes. Con la fila recortada a
    // su propio plan esta celda no existiría. La semana se pinta entera, de lunes a domingo: siete
    // columnas, tengan o no capacidad esos días.
    const dias = fila('Ana Perez').querySelectorAll('[data-slot="timeline-cell"]')
    expect(dias).toHaveLength(7)

    // El día lleno y el día con holgura se distinguen por el número, tal como lo publicó el backend.
    const celda = within(fila('Ana Perez'))
    // Disponible son ocho horas en los tres días: se cuentan las tres celdas, no se busca una.
    expect(celda.getAllByText('8 disp')).toHaveLength(3)
    expect(celda.getAllByText('0 libre')).toHaveLength(1)
    expect(celda.getAllByText('6 libre')).toHaveLength(1)
    expect(celda.getAllByText('8 libre')).toHaveLength(1)
  })

  it('pinta el trabajo planificado de cada persona en su propia fila', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // Los tramos del fixture: tres de Ana y uno de Carlos, cada uno en su fila. Antes de esta fase la
    // rejilla agrupaba por fecha sin mirar de quién era cada tramo, así que con dos filas cada una
    // habría pintado los del otro.
    const ana = within(fila('Ana Perez'))
    expect(ana.getByText('INC-1')).toBeDefined()
    expect(ana.getByText('REQ-1')).toBeDefined()
    expect(ana.queryByText('REQ-9')).toBeNull()

    const carlos = within(fila('Carlos Ruiz'))
    expect(carlos.getByText('REQ-9')).toBeDefined()
    expect(carlos.queryByText('INC-1')).toBeNull()
  })

  it('enseña el trabajo pendiente y a quién le toca, con su motivo', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // El aviso en la fila: dónde hay pendientes. Es la marca que la rejilla puede dar, porque un
    // pendiente no tiene tramo y por tanto no tiene columna donde pintarse.
    const aviso = await within(fila('Ana Perez')).findByText('2 pendientes')
    expect(aviso).toBeDefined()
    expect(within(fila('Carlos Ruiz')).queryByText(/pendientes/)).toBeNull()

    // Y el detalle: cuáles son y por qué. `501` ya se puede planificar pero no entró en la última
    // planificación; `502` todavía no se puede planificar.
    const panel = document.querySelector('[data-slot="pending-panel"]') as HTMLElement
    // Agrupado por persona y con el mismo nombre que la rejilla: un identificador suelto no dice
    // «a quién le toca».
    expect(within(panel).getByText('Ana Perez')).toBeDefined()
    expect(within(panel).getByText('No incluido en el último plan')).toBeDefined()
    expect(within(panel).getByText('Sin compromiso')).toBeDefined()
    expect(within(panel).getByText('501')).toBeDefined()
    expect(within(panel).getByText('502')).toBeDefined()

    // El resumen separa información de capacidad sin abrir ninguna fila: un pendiente de información
    // y uno que el motor nunca vio. Es la pregunta del gestor contestada antes de leer el detalle.
    const resumen = document.querySelector('[data-slot="pending-summary"]') as HTMLElement
    expect(within(resumen).getByText('Falta información: 1')).toBeDefined()
    expect(within(resumen).getByText('No incluido en el último plan: 1')).toBeDefined()
    expect(within(resumen).queryByText(/Fuera por capacidad/)).toBeNull()
  })

  it('lee las declaraciones del equipo en una sola petición, no una por técnico', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // Es lo que la fase vino a quitar: la capa de pendientes necesita a todo el equipo, y antes
    // costaba una lectura por persona. Se cuenta sobre las llamadas reales, no sobre el mock.
    await waitFor(() =>
      expect(within(fila('Ana Perez')).getByText('2 pendientes')).toBeDefined(),
    )

    const lecturas = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.startsWith(DECLARATIONS_URL))

    expect(lecturas).toHaveLength(1)
    // Se pregunta por las tres personas del padrón, no solo por las dos que tienen plan: la columna
    // de pendientes es de todo el equipo.
    expect(new URL(lecturas[0] ?? '', 'http://prueba').searchParams.getAll('developerId')).toEqual([
      DEVELOPER_ID,
      FULL_DEVELOPER_ID,
      OVER_DEVELOPER_ID,
    ])
  })

  it('distingue el trabajo que el motor rechazó del que nunca recibió', async () => {
    // `501` sale de la declaración exactamente igual que en la prueba anterior. Lo que cambia es que
    // el plan lo conoce: aparece en `conflicts`. Entonces no es «no incluido» sino «fuera por
    // capacidad», y la pantalla tiene que decir cuál de las dos.
    serve({
      declarations: declarationsForBoth(),
      timeline: teamTimelineFixture({
        conflicts: [
          {
            developerId: DEVELOPER_ID,
            workItemId: '501',
            workItemType: 'REQUERIMIENTO',
            reason: 'Sin capacidad en el horizonte de 1 dias',
          },
        ],
      }),
    })

    renderWithClient(<TeamTimeline />)
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())

    const panel = document.querySelector('[data-slot="pending-panel"]') as HTMLElement

    expect(await within(panel).findByText('Fuera por capacidad')).toBeDefined()
    expect(within(panel).queryByText('No incluido en el último plan')).toBeNull()

    const resumen = document.querySelector('[data-slot="pending-summary"]') as HTMLElement
    expect(within(resumen).getByText('Fuera por capacidad: 1')).toBeDefined()
    expect(within(resumen).getByText('Falta información: 1')).toBeDefined()
  })

  it('dice que el equipo está operativo completo cuando no queda nada fuera', async () => {
    // La séptima pregunta del gestor: y si no hay pendientes, ¿es que no hay trabajo o que está todo
    // colocado? La frase tiene que afirmar lo segundo, porque es lo que se comprobó. Los tickets que
    // se sirven son exactamente los tramos del plan: nada sobra y nada falta.
    serve({
      declarations: {
        [DEVELOPER_ID]: declarationsFixture({
          developer: { id: DEVELOPER_ID, name: 'Ana Perez' },
          items: [
            declarationItemFixture({ workItemId: 'INC-1', declarationStatus: 'PLANIFICABLE' }),
            declarationItemFixture({ workItemId: 'REQ-1', declarationStatus: 'PLANIFICABLE' }),
          ],
        }),
        [FULL_DEVELOPER_ID]: declarationsFixture({
          developer: { id: FULL_DEVELOPER_ID, name: 'Carlos Ruiz' },
          items: [declarationItemFixture({ workItemId: 'REQ-9', declarationStatus: 'PLANIFICABLE' })],
        }),
        // La tercera persona del equipo no tiene plan: su declaración se lee y viene vacía. Sin esta
        // fila la lectura contaría una persona «sin leer» y el panel diría que falta algo.
        [OVER_DEVELOPER_ID]: declarationsFixture({
          developer: { id: OVER_DEVELOPER_ID, name: 'Diana Lopez' },
          items: [],
        }),
      },
    })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    const panel = document.querySelector('[data-slot="pending-panel"]') as HTMLElement

    expect(
      await within(panel).findByText('Todo el trabajo asignado está dentro del plan vigente.'),
    ).toBeDefined()
    // Sin pendientes no hay reparto que enseñar: el resumen aparece solo cuando hay algo que contar.
    expect(document.querySelector('[data-slot="pending-summary"]')).toBeNull()
  })

  it('deja de contar un desplazamiento que ya tiene acuerdo', async () => {
    // El sexto escenario, visto desde el lado contrario al de «sin acuerdo»: el desplazamiento sigue
    // existiendo y sigue en el plan, pero alguien aceptó la fecha nueva. Entonces no hay nada que
    // hacer y no puede aparecer como pendiente.
    serve({
      renegotiations: renegotiationsFor('REQ-1', 'ACORDADA'),
      declarations: {
        [DEVELOPER_ID]: declarationsFixture({
          developer: { id: DEVELOPER_ID, name: 'Ana Perez' },
          items: [declarationItemFixture({ workItemId: 'REQ-1', declarationStatus: 'PLANIFICABLE' })],
        }),
        [FULL_DEVELOPER_ID]: declarationsFixture({
          developer: { id: FULL_DEVELOPER_ID, name: 'Carlos Ruiz' },
          items: [declarationItemFixture({ workItemId: 'REQ-9', declarationStatus: 'PLANIFICABLE' })],
        }),
        // La tercera persona del equipo no tiene plan: su declaración se lee y viene vacía. Sin esta
        // fila la lectura contaría una persona «sin leer» y el panel diría que falta algo.
        [OVER_DEVELOPER_ID]: declarationsFixture({
          developer: { id: OVER_DEVELOPER_ID, name: 'Diana Lopez' },
          items: [],
        }),
      },
    })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    const panel = document.querySelector('[data-slot="pending-panel"]') as HTMLElement

    await waitFor(() =>
      expect(
        within(panel).getByText('Todo el trabajo asignado está dentro del plan vigente.'),
      ).toBeDefined(),
    )
    expect(within(panel).queryByText('Sin acuerdo')).toBeNull()
  })

  it('enlaza cada pendiente a donde se arregla, sin armar la ruta a mano', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // La falta de información se declara, y el enlace lleva el técnico, el ticket y la vuelta: es lo
    // que convierte «abre Declaración y busca la fila a ojo» en un clic. Se comprueba que lleva los
    // tres, no la cadena exacta.
    const declarar = (await screen.findAllByRole('link', { name: /502/ }))[0]
    const destino = declarar?.getAttribute('href') ?? ''

    expect(destino.startsWith('/declaraciones?')).toBe(true)
    expect(destino).toContain(`tecnico=${DEVELOPER_ID}`)
    expect(destino).toContain('ticket=502')
    expect(destino).toContain('volver=%2F')

    // El que no entró en el plan no se arregla declarando —ya está declarado—: se arregla generando
    // el plan otra vez, y por eso su enlace va a Planificación y no a la declaración del ticket.
    const replanificar = (await screen.findAllByRole('link', { name: /501/ }))[0]
    expect(replanificar).toHaveAttribute('href', '/planificar?tecnico=dev-001')
  })

  it('sigue pintando la agenda cuando la declaración no se puede leer', async () => {
    // GLPI puede no responder. La rejilla se arma con los planes guardados, que son datos del propio
    // sistema: si cayera con la declaración, la pantalla de entrada dependería de un tercero.
    serve({ declarationsStatus: 500 })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    expect(within(fila('Ana Perez')).getByText('INC-1')).toBeDefined()

    const panel = document.querySelector('[data-slot="pending-panel"]') as HTMLElement
    await waitFor(() =>
      expect(within(panel).getByText(/No se pudo leer la declaración/)).toBeDefined(),
    )
    expect(within(panel).getByText(/3 sin leer/)).toBeDefined()
  })

  it('dice que no hay planes vigentes en vez de inventar un error', async () => {
    serve({ timeline: teamTimelineFixture({ resources: [], items: [], plans: [], from: null, to: null }) })

    renderWithClient(<TeamTimeline />)

    // Sin planes no hay ventana que dibujar, y eso es un estado del sistema, no un fallo de la
    // lectura. El texto cuenta al equipo: las filas existen, lo que falta es el calendario.
    expect(await screen.findByText('El equipo no tiene planes todavía')).toBeDefined()
    expect(screen.getByText(/3 personas y ninguna tiene un plan vigente/)).toBeDefined()
    expect(screen.getByRole('link', { name: 'Generar un plan' })).toHaveAttribute(
      'href',
      '/planificar',
    )
  })

  it('enseña el fallo de la agenda del equipo tal cual, sin inventar un resultado', async () => {
    serve({ timelineStatus: 503 })

    renderWithClient(<TeamTimeline />)

    expect(await screen.findByText('No fue posible cargar la agenda del equipo')).toBeDefined()
    expect(screen.getByText('No se pudo leer la agenda del equipo')).toBeDefined()
  })

  /**
   * Un tramo desplazado, con la causa que el plan auditó.
   *
   * Es un `TimelineItem` completo y no un objeto suelto: el desplazamiento no se inventa aquí, se
   * copia con la forma que publica el backend —fecha original, fecha nueva, regla, incidente, motivo—.
   */
  const DESPLAZADO: TimelineItem = {
    workItemId: 'REQ-1',
    workItemType: 'REQUERIMIENTO',
    startsAt: '2026-10-06T09:00:00',
    endsAt: '2026-10-06T11:00:00',
    durationHours: 2,
    developerId: DEVELOPER_ID,
    estimatedHours: 2,
    committedDate: '2026-10-05',
    severity: null,
    planningStatus: 'DESPLAZADO',
    sourcePlanId: PLAN_ID,
    displacement: {
      originalDate: '2026-10-05',
      newDate: '2026-10-06',
      appliedRule: 'UMBRAL_INCIDENTE_EXCEDIDO',
      incidentId: 'INC-1',
      incidentSeverity: null,
      reason: 'Un incidente supero el umbral de horas y ocupo la jornada pactada',
    },
  }

  it('abre el detalle del tramo con su causa y sus tres acciones', async () => {
    serve({ declarations: declarationsForBoth(), timeline: teamTimelineFixture({ items: [DESPLAZADO] }) })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // El tramo es un botón: se elige con el teclado y con el ratón, no es una caja con un manejador.
    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ }))

    const detalle = await screen.findByRole('dialog', { name: /REQ-1/ })

    // La causa, tal como la auditó el plan: regla, incidente y motivo. Las fechas las formatea la
    // vista, así que se comprueba lo que no depende del idioma.
    expect(within(detalle).getByText('Fecha original')).toBeDefined()
    expect(within(detalle).getByText('Fecha nueva')).toBeDefined()
    expect(within(detalle).getByText('UMBRAL_INCIDENTE_EXCEDIDO')).toBeDefined()
    expect(within(detalle).getByText(/INC-1/)).toBeDefined()
    expect(within(detalle).getByText(/ocupo la jornada pactada/)).toBeDefined()

    // El bloque de la causa es el mismo componente que usa la Renegociación: una sola explicación.
    expect(detalle.querySelector('[data-slot="displacement-cause"]')).not.toBeNull()

    // Las tres acciones, y cada una a la pantalla que ya existía.
    const declarar = within(detalle).getByRole('link', { name: 'Declarar' })
    expect(declarar.getAttribute('href')).toContain(`tecnico=${DEVELOPER_ID}`)
    expect(declarar.getAttribute('href')).toContain('ticket=REQ-1')

    expect(within(detalle).getByRole('link', { name: 'Renegociar' })).toHaveAttribute(
      'href',
      '/renegociaciones?ticket=REQ-1',
    )
    expect(within(detalle).getByRole('link', { name: 'Abrir detalle' })).toHaveAttribute(
      'href',
      `/calendario/${PLAN_ID}`,
    )
  })

  it('siembra la vista desde la dirección: deja la fila del técnico y abre su ticket', async () => {
    // Es la acción «Ver el Timeline» de Tickets: se aterriza en la persona y en el tramo, no en la
    // agenda entera con el gestor buscando a mano. La dirección no lleva la clave del tramo —no la
    // conoce—, así que la pantalla la resuelve buscando el primero del ticket.
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />, {
      route: `/?tecnico=${DEVELOPER_ID}&ticket=REQ-1`,
    })

    await screen.findByText('Ana Perez')

    const filas = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="timeline-resource"]'),
    )

    expect(filas).toHaveLength(1)
    expect(filas[0].textContent).toContain('Ana Perez')

    // El detalle se abre solo, con el mismo panel que se abre pulsando el tramo.
    expect(await screen.findByRole('dialog', { name: /REQ-1/ })).toBeDefined()
  })

  it('no ofrece renegociar un tramo que no se movió', async () => {
    // Una acción visible que lleva a una lista donde no hay nada que hacer enseña a desconfiar de la
    // pantalla. El tramo planificado no desplazado tiene dos acciones, no tres.
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /INC-1/ }))

    const detalle = await screen.findByRole('dialog', { name: /INC-1/ })

    expect(within(detalle).queryByRole('link', { name: 'Renegociar' })).toBeNull()
    expect(within(detalle).getByRole('link', { name: 'Declarar' })).toBeDefined()
    expect(within(detalle).getByRole('link', { name: 'Abrir detalle' })).toBeDefined()
  })

  it('marca sin acuerdo el trabajo desplazado que espera una fecha', async () => {
    // El tercer motivo de la capa: el trabajo **está** en el plan y aun así falta algo — que alguien
    // acepte la fecha nueva. Se arregla en Renegociaciones, y el enlace lo lleva directo.
    serve({
      renegotiations: renegotiationsFor('REQ-1', 'PENDIENTE_DE_ACUERDO'),
      declarations: {
        [DEVELOPER_ID]: declarationsFixture({
          developer: { id: DEVELOPER_ID, name: 'Ana Perez' },
          items: [declarationItemFixture({ workItemId: 'REQ-1', declarationStatus: 'PLANIFICABLE' })],
        }),
      },
    })

    renderWithClient(<TeamTimeline />)
    // El nombre aparece en la rejilla, en la cobertura y ahora también en el panel de acuerdos.
    await screen.findAllByText('Ana Perez')

    const panel = document.querySelector('[data-slot="pending-panel"]') as HTMLElement

    expect(await within(panel).findByText('Sin acuerdo')).toBeDefined()

    const enlace = within(panel).getByRole('link', { name: /REQ-1/ })
    expect(enlace).toHaveAttribute('href', '/renegociaciones?ticket=REQ-1')
  })

  it('enseña el trabajo que el motor no pudo ubicar, con su motivo', async () => {
    // Un conflicto no tiene tramo: no se puede pintar en una columna, y sin este panel la pantalla
    // diría «sin capacidad» sin poder decir por qué. El texto es el del motor, no uno de la vista.
    serve({
      timeline: teamTimelineFixture({
        conflicts: [
          {
            developerId: DEVELOPER_ID,
            workItemId: 'REQ-7',
            workItemType: 'REQUERIMIENTO',
            reason: 'Sin capacidad en el horizonte de 1 dias',
          },
        ],
      }),
    })

    renderWithClient(<TeamTimeline />)
    // La fila y no el nombre: el panel de conflictos también lo escribe, y buscarlo por texto
    // encontraría dos.
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())

    const panel = await screen.findByRole('region', { name: /no cupo/ })

    expect(within(panel).getByText('REQ-7')).toBeDefined()
    expect(within(panel).getByText('Sin capacidad en el horizonte de 1 dias')).toBeDefined()
    expect(within(panel).getByText('Ana Perez')).toBeDefined()
  })

  it('muestra en el propio tramo de qué fecha a qué fecha se movió', async () => {
    serve({ declarations: declarationsForBoth(), timeline: teamTimelineFixture({ items: [DESPLAZADO] }) })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // El bloque enseña el rango corto y el incidente: lo que hace falta para saber que hay un
    // desplazamiento sin abrir nada. El motivo completo está en el título del bloque.
    const bloque = within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ })

    expect(bloque.textContent).toContain('05/10 → 06/10')
    expect(bloque.getAttribute('title')).toContain('ocupo la jornada pactada')
  })

  /**
   * La Fase 50 convierte la cobertura en el puesto de mando: cada fila ofrece el paso siguiente sin
   * salir del Timeline. Las dos acciones que navegan usan las direcciones de siempre, con el técnico
   * ya puesto; las dos que miran un panel filtran lo que ya está calculado.
   */
  it('ofrece desde la fila de cobertura las acciones de esa persona', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)

    const panel = await screen.findByRole('region', { name: 'Cobertura del plan' })

    // La tabla existe desde el primer render; sus filas llegan con la declaración del equipo.
    await waitFor(() =>
      expect(
        panel.querySelector('[data-slot="coverage-row"][data-developer-id="dev-001"]'),
      ).not.toBeNull(),
    )

    const ana = panel.querySelector(
      '[data-slot="coverage-row"][data-developer-id="dev-001"]',
    ) as HTMLElement

    // Declarar abre la persona en lote, como el nombre de la fila.
    expect(within(ana).getByRole('link', { name: 'Declarar' })).toHaveAttribute(
      'href',
      expect.stringContaining('tecnico=dev-001'),
    )
    expect(within(ana).getByRole('link', { name: 'Declarar' })).toHaveAttribute(
      'href',
      expect.stringContaining('lote=1'),
    )

    // Generar plan abre la planificación con el técnico sembrado: no hay que volver a teclearlo.
    expect(within(ana).getByRole('link', { name: 'Generar plan' })).toHaveAttribute(
      'href',
      '/planificar?tecnico=dev-001',
    )

    // Las dos acciones de panel solo aparecen cuando hay algo que enseñar. Carlos no tiene
    // pendientes ni acuerdos, así que su fila no ofrece ninguna de las dos.
    expect(within(ana).getByRole('button', { name: 'Pendientes' })).toBeDefined()
    expect(within(ana).queryByRole('button', { name: 'Acuerdos' })).toBeNull()
  })

  it('filtra el panel de pendientes al elegir una persona', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    const coverage = await screen.findByRole('region', { name: 'Cobertura del plan' })
    const ana = coverage.querySelector(
      '[data-slot="coverage-row"][data-developer-id="dev-001"]',
    ) as HTMLElement

    fireEvent.click(within(ana).getByRole('button', { name: 'Pendientes' }))

    const panel = document.querySelector('[data-slot="pending-panel"]') as HTMLElement
    const aviso = await within(panel).findByText(/Solo los pendientes de/)

    expect(aviso.textContent).toContain('Ana Perez')

    // Volver al equipo entero no es otra lectura: se quita el foco.
    fireEvent.click(within(panel).getByRole('button', { name: 'Ver todo el equipo' }))

    await waitFor(() =>
      expect(document.querySelector('[data-slot="pending-focus"]')).toBeNull(),
    )
  })

  it('el chip de pendientes lleva directo al ticket cuando la persona tiene uno solo', async () => {
    // Ana con un solo pendiente: `502`, que todavía no se puede planificar. Un chip que solo dice
    // «1 pendiente» deja al gestor buscando el ticket en otra pantalla; enlazado, es el clic que
    // elimina la búsqueda.
    serve({
      declarations: {
        [DEVELOPER_ID]: declarationsFixture({
          developer: { id: DEVELOPER_ID, name: 'Ana Perez' },
          items: [
            declarationItemFixture({
              workItemId: '502',
              title: 'Ajuste de reporte 502',
              declarationStatus: 'SIN_COMPROMISO',
            }),
          ],
        }),
        [FULL_DEVELOPER_ID]: declarationsFixture({
          developer: { id: FULL_DEVELOPER_ID, name: 'Carlos Ruiz' },
          items: [declarationItemFixture({ workItemId: 'REQ-9', declarationStatus: 'PLANIFICABLE' })],
        }),
      },
    })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // El chip aparece cuando llega la declaración, no con la rejilla.
    const chip = (await within(fila('Ana Perez')).findByText('1 pendiente')).closest(
      'a',
    ) as HTMLAnchorElement
    const destino = chip?.getAttribute('href') ?? ''

    // La misma ruta que usa la fila del panel: técnico, ticket y vuelta al Timeline.
    expect(chip).not.toBeNull()
    expect(destino.startsWith('/declaraciones?')).toBe(true)
    expect(destino).toContain(`tecnico=${DEVELOPER_ID}`)
    expect(destino).toContain('ticket=502')
    expect(destino).toContain('volver=%2F')
  })

  it('el chip con varios pendientes abre el panel filtrado por esa persona', async () => {
    // Con dos pendientes no hay un ticket único que abrir: el chip lleva al panel donde están los
    // dos, ya filtrado por Ana, en vez de dejarla perdida entre el resto del equipo.
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    const chip = await within(fila('Ana Perez')).findByRole('button', { name: '2 pendientes' })
    fireEvent.click(chip)

    const panel = document.querySelector('[data-slot="pending-panel"]') as HTMLElement
    const aviso = await within(panel).findByText(/Solo los pendientes de/)

    expect(aviso.textContent).toContain('Ana Perez')
  })

  it('enseña los acuerdos pendientes del equipo dentro del Timeline', async () => {
    // La cola de acuerdos era una pantalla que se abría para descubrir a quién le tocaba. Ahora el
    // Timeline la resume con la misma lectura, y cada fila abre la renegociación con el ticket puesto.
    serve({ renegotiations: renegotiationsFor('REQ-1', 'PENDIENTE_DE_ACUERDO') })

    renderWithClient(<TeamTimeline />)

    const panel = await screen.findByRole('region', { name: 'Acuerdos pendientes' })

    await waitFor(() => expect(within(panel).getByText('Ana Perez')).toBeDefined())
    expect(within(panel).getByText(/1 en el equipo/)).toBeDefined()

    const filaAcuerdo = panel.querySelector('[data-slot="agreement-row"]') as HTMLElement
    expect(filaAcuerdo.textContent).toContain('REQ-1')
    // Las dos fechas del último desplazamiento, en el formato de la rejilla.
    expect(filaAcuerdo.textContent).toContain('5 de oct')
    expect(filaAcuerdo.textContent).toContain('6 de oct')
    expect(filaAcuerdo).toHaveAttribute('href', '/renegociaciones?ticket=REQ-1')
  })

  it('no afirma acuerdos pendientes cuando la lectura falla', async () => {
    serve({ renegotiationsStatus: 503 })

    renderWithClient(<TeamTimeline />)

    const panel = await screen.findByRole('region', { name: 'Acuerdos pendientes' })
    await waitFor(() =>
      expect(
        within(panel).getByText(/No se pudo leer la renegociación/),
      ).toBeDefined(),
    )
  })

  it('lee la salud operativa en el Timeline y enlaza el desglose', async () => {
    serve({ alerts: alertsFixture() })

    renderWithClient(<TeamTimeline />)

    const panel = await screen.findByRole('region', { name: 'Salud operativa' })

    // Seis alertas, cuatro en el panel: el resto sigue en el centro, y se dice.
    expect(await within(panel).findByText(/6 condiciones/)).toBeDefined()
    expect(within(panel).getAllByText(/CRITICAL|WARNING|INFO/).length).toBe(4)
    expect(within(panel).getByText(/2 más en el centro de alertas/)).toBeDefined()

    // El desglose sale del `detailUrl` del backend traducido, no de una ruta escrita a mano: las
    // alertas sin listado propio —las de capacidad— no ofrecen enlace.
    const desgloses = within(panel).getAllByRole('link', { name: 'Ver desglose →' })
    expect(
      desgloses.some((link) => link.getAttribute('href') === '/metricas/desplazados'),
    ).toBe(true)
    expect(within(panel).getByRole('link', { name: 'Centro de alertas' })).toHaveAttribute(
      'href',
      '/alertas',
    )
  })

  /**
   * La Fase 52: buscar y filtrar filas, y demostrar un incidente sin tocar datos.
   *
   * La búsqueda es por fila: un ticket lleva a la persona que lo tiene y deja ver todo su trabajo.
   * Los filtros usan las señales que la fila ya enseña. El simulador es una capa en memoria sobre la
   * agenda cargada; nada de esto escribe ni pide nada nuevo al servidor.
   */
  it('busca por nombre, login, GLPI y número de ticket', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    const buscar = screen.getByLabelText('Buscar por persona, login, GLPI o ticket')

    fireEvent.change(buscar, { target: { value: 'carlos' } })
    await waitFor(() => expect(() => fila('Ana Perez')).toThrow())
    expect(fila('Carlos Ruiz')).toBeDefined()

    // El login y el número de GLPI son la misma persona por dos nombres.
    fireEvent.change(buscar, { target: { value: 'dev-003' } })
    await waitFor(() => expect(fila('Diana Lopez')).toBeDefined())
    expect(() => fila('Carlos Ruiz')).toThrow()

    fireEvent.change(buscar, { target: { value: '102' } })
    await waitFor(() => expect(fila('Carlos Ruiz')).toBeDefined())

    // Un ticket planificado de Ana y un pendiente suyo llevan a Ana; REQ-9 lleva a Carlos.
    fireEvent.change(buscar, { target: { value: 'INC-1' } })
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())
    expect(() => fila('Carlos Ruiz')).toThrow()

    fireEvent.change(buscar, { target: { value: 'REQ-9' } })
    await waitFor(() => expect(fila('Carlos Ruiz')).toBeDefined())
    expect(() => fila('Ana Perez')).toThrow()

    fireEvent.change(buscar, { target: { value: '502' } })
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())
  })

  it('filtra por tipo, plan y señales de la fila sin mover las columnas', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // Las columnas salen de la semana visible: filtrar no acorta el calendario.
    const columnas = () =>
      document.querySelectorAll('[data-slot="timeline-day"]').length
    expect(columnas()).toBe(7)

    fireEvent.click(screen.getByRole('button', { name: 'Incidentes' }))
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())
    expect(() => fila('Carlos Ruiz')).toThrow()
    expect(() => fila('Diana Lopez')).toThrow()
    expect(columnas()).toBe(7)

    fireEvent.click(screen.getByRole('button', { name: 'Sin plan' }))
    // Incidentes y «sin plan» son un Y: Diana no tiene incidentes, así que no queda nadie.
    await waitFor(() =>
      expect(document.querySelectorAll('[data-slot="timeline-resource"]')).toHaveLength(0),
    )
    expect(screen.getByText('0 de 3 personas')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Con pendientes' }))
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())
    expect(() => fila('Carlos Ruiz')).toThrow()

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recuperables' }))
    // Solo Ana tiene un pendiente que una declaración desbloquea.
    await waitFor(() => expect(fila('Ana Perez')).toBeDefined())
    expect(() => fila('Diana Lopez')).toThrow()
  })

  it('simula un incidente como capa de demostración y la quita sin tocar la agenda', async () => {
    serve({ declarations: declarationsForBoth() })

    const { unmount } = renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // La agenda real, antes de simular: tres tramos en la fila de Ana.
    expect(within(fila('Ana Perez')).getAllByRole('button')).toHaveLength(3)
    expect(document.querySelector('[data-slot="timeline-demo-incident"]')).toBeNull()

    // Ana, el 5 (día lleno) y 4 h: no cabe, así que mueve el final del día.
    fireEvent.click(screen.getByRole('button', { name: 'Simular incidente' }))

    await waitFor(() =>
      expect(document.querySelector('[data-slot="timeline-demo-incident"]')).not.toBeNull(),
    )

    // La capa se marca en los tres sitios: el día del incidente, la celda y cada tramo que movería.
    const aviso = document.querySelector('[data-slot="timeline-demo-incident"]')
    expect(aviso?.textContent).toContain('DEMO')
    expect(aviso?.textContent).toContain('4 h')
    expect(document.querySelectorAll('[data-slot="timeline-cell"][data-demo="true"]')).toHaveLength(1)

    const movidos = within(fila('Ana Perez')).getAllByText(/DEMO →/)
    expect(movidos).toHaveLength(2)
    expect(
      within(fila('Ana Perez'))
        .getAllByRole('button')
        .filter((block) => block.getAttribute('data-demo') === 'true'),
    ).toHaveLength(2)

    // El resumen dice qué se mueve y qué necesitaría renegociarse; solo REQ-1 es un requerimiento.
    const resultado = document.querySelector('[data-slot="simulation-result"]') as HTMLElement
    expect(resultado.textContent).toContain('SIMULADO')
    expect(resultado.textContent).toContain('Desplazaría 2 tramos')
    expect(within(resultado).getByText('Posible renegociación')).toBeDefined()

    // La capacidad que consume el incidente se ve en el propio día, junto al DEMO.
    const capacidad = document.querySelector('[data-slot="timeline-demo-capacity"]')
    expect(capacidad?.textContent).toContain('quedan')

    // La fila simulada queda marcada aunque su día se salga de la vista.
    expect(document.querySelector('[data-slot="timeline-demo-row"]')).not.toBeNull()

    // Y el desplazamiento produce su renegociación simulada: fecha original, fecha nueva, causa y
    // el estado pendiente, todo marcado DEMO. Nada de esto está en la lista real de renegociaciones.
    const renegociaciones = document.querySelector(
      '[data-slot="simulation-renegotiations"]',
    ) as HTMLElement
    const simuladas = renegociaciones.querySelectorAll(
      '[data-slot="simulation-renegotiation"]',
    )
    expect(simuladas).toHaveLength(1)
    expect(simuladas[0].getAttribute('data-work-item')).toBe('REQ-1')
    expect(simuladas[0].textContent).toContain('→')
    expect(simuladas[0].textContent).toContain('causa: incidente DEMO')
    expect(renegociaciones.textContent).toContain('Pendiente de acuerdo · DEMO')

    // La agenda real sigue igual: los tramos no se han movido, solo se marcan. Se cuentan los
    // tramos y no todos los botones de la fila: desde la Fase 60 el chip de pendientes también se
    // pulsa, y sigue ahí sin que la simulación lo toque.
    const tramos = within(fila('Ana Perez'))
      .getAllByRole('button')
      .filter((boton) => boton.dataset.slot === 'timeline-block')
    expect(tramos).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Quitar simulación' }))
    await waitFor(() =>
      expect(document.querySelector('[data-slot="timeline-demo-incident"]')).toBeNull(),
    )
    expect(document.querySelector('[data-slot="simulation-result"]')).toBeNull()
    expect(document.querySelector('[data-slot="simulation-renegotiations"]')).toBeNull()
    expect(document.querySelector('[data-slot="timeline-demo-row"]')).toBeNull()
    expect(document.querySelectorAll('[data-demo="true"]')).toHaveLength(0)

    // Recargar es montar de nuevo con una caché nueva: la simulación no está en ninguna parte.
    unmount()
    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')
    expect(document.querySelector('[data-slot="timeline-demo-incident"]')).toBeNull()
    // La simulación entera —no solo el día— desaparece con la recarga: nada se guardó.
    expect(document.querySelector('[data-slot="simulation-renegotiations"]')).toBeNull()
    expect(document.querySelector('[data-slot="timeline-demo-row"]')).toBeNull()
  })

  it('no simula sobre un día no laborable ni sobre una fecha fuera de la ventana', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    // El campo limita la fecha a la ventana, y el navegador no deja enviarla fuera de rango. Se envía
    // el formulario directamente para comprobar que, aun así, el cálculo se defiende solo.
    const fecha = screen.getByLabelText('Fecha')
    fireEvent.change(fecha, { target: { value: '2026-10-20' } })
    fireEvent.submit(fecha.closest('form') as HTMLFormElement)

    const error = await screen.findByText('Esa fecha está fuera de la ventana del plan.')
    expect(error).toBeDefined()
    expect(document.querySelector('[data-slot="timeline-demo-incident"]')).toBeNull()
  })

  /**
   * La Fase 53 cambia el detalle de sitio, no de contenido: las mismas acciones, ahora en un panel
   * fijo a la derecha. El panel no tapa la agenda ni mueve la página, y el tramo elegido se puede
   * cambiar sin cerrarlo.
   */
  it('abre el detalle como panel lateral y deja la agenda a la vista', async () => {
    serve({ declarations: declarationsForBoth(), timeline: teamTimelineFixture({ items: [DESPLAZADO] }) })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ }))

    const detalle = await screen.findByRole('dialog', { name: /REQ-1/ })

    // El panel está fuera del flujo: la rejilla sigue montada, con sus columnas y sus tramos.
    expect(detalle.className).toContain('fixed')
    expect(screen.getByRole('region', { name: 'Agenda del equipo' })).toBeDefined()
    expect(document.querySelectorAll('[data-slot="timeline-block"]').length).toBeGreaterThan(0)
  })

  it('cambia el contenido del panel al elegir otro tramo, sin cerrarlo', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ }))
    expect(await screen.findByRole('dialog', { name: /REQ-1/ })).toBeDefined()

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /INC-1/ }))

    // Un solo panel, con el detalle del segundo tramo: no se apila otro ni hay que cerrar el primero.
    expect(await screen.findByRole('dialog', { name: /INC-1/ })).toBeDefined()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('distingue en el detalle un acuerdo conciliado de uno manual', async () => {
    // El gestor no vuelve a teclear lo que ya cambió en GLPI: el acuerdo llega conciliado. Pero
    // «hay acuerdo» no dice de dónde vino, y la pregunta que se hace al verlo es quién lo acordó.
    serve({
      declarations: declarationsForBoth(),
      timeline: teamTimelineFixture({ items: [DESPLAZADO] }),
      renegotiations: renegotiationsFor('REQ-1', 'ACORDADA', 'GLPI'),
    })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')
    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ }))

    const detalle = await screen.findByRole('dialog', { name: /REQ-1/ })
    const estado = await within(detalle).findByText('Acordada en GLPI')

    // La etiqueta dice el origen y el atributo lo deja afirmable sin leer el texto.
    expect(estado.getAttribute('data-source')).toBe('GLPI')
  })

  it('distingue un acuerdo registrado a mano', async () => {
    serve({
      declarations: declarationsForBoth(),
      timeline: teamTimelineFixture({ items: [DESPLAZADO] }),
      renegotiations: renegotiationsFor('REQ-1', 'ACORDADA', 'HTTP'),
    })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')
    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ }))

    const detalle = await screen.findByRole('dialog', { name: /REQ-1/ })
    const estado = await within(detalle).findByText('Acordada manualmente')

    expect(estado.getAttribute('data-source')).toBe('HTTP')
  })

  it('cierra con el botón y con Escape, y devuelve el foco al tramo', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    const bloque = within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ })
    // El clic no enfoca en jsdom: se enfoca explícitamente para comprobar la vuelta del foco.
    bloque.focus()
    fireEvent.click(bloque)

    const detalle = await screen.findByRole('dialog', { name: /REQ-1/ })
    fireEvent.click(within(detalle).getByRole('button', { name: 'Cerrar detalle' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(bloque)

    // Escape también cierra: el teclado no depende de acertar la X.
    fireEvent.click(bloque)
    expect(await screen.findByRole('dialog', { name: /REQ-1/ })).toBeDefined()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('enseña la cobertura de la persona dentro del detalle', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ }))

    const detalle = await screen.findByRole('dialog', { name: /REQ-1/ })
    expect(detalle.querySelector('[data-slot="item-coverage"]')?.textContent).toContain(
      'Cobertura de Ana Perez',
    )
  })

  /**
   * La Fase 54: declarar deja de ser una salida del Timeline. El formulario es el mismo de
   * `/declaraciones` —misma lectura previa, mismas validaciones, mismo servicio—, montado dentro del
   * panel; guardar lo cierra y el panel vuelve al detalle sin haberse cerrado.
   */
  it('declara un ticket dentro del panel, sin salir del Timeline', async () => {
    serve({
      declarations: {
        [DEVELOPER_ID]: declarationsFixture({
          developer: { id: DEVELOPER_ID, name: 'Ana Perez' },
          items: [
            declarationItemFixture({
              workItemId: 'INC-1',
              title: 'Falla en producción 1',
              declarationStatus: 'SIN_DECLARACION',
              declaration: null,
            }),
          ],
        }),
      },
    })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /INC-1/ }))

    const detalle = await screen.findByRole('dialog', { name: /INC-1/ })

    // Planificar sigue siendo navegación, con el técnico ya puesto.
    expect(within(detalle).getByRole('link', { name: 'Generar plan' })).toHaveAttribute(
      'href',
      `/planificar?tecnico=${DEVELOPER_ID}`,
    )

    // Con la fila de declaración leída, «Declarar» ya no navega: abre el formulario en el panel.
    fireEvent.click(within(detalle).getByRole('button', { name: 'Declarar' }))
    expect(within(detalle).getByLabelText('Horas estimadas')).toBeDefined()
    expect(screen.getByRole('region', { name: 'Agenda del equipo' })).toBeDefined()

    fireEvent.change(within(detalle).getByLabelText('Horas estimadas'), {
      target: { value: '8' },
    })
    fireEvent.change(within(detalle).getByLabelText('Fecha compromiso'), {
      target: { value: '2026-10-30' },
    })
    fireEvent.change(within(detalle).getByLabelText('Quién declara'), {
      target: { value: 'ana' },
    })
    fireEvent.click(within(detalle).getByRole('button', { name: 'Guardar' }))

    // Guardar cierra el formulario, no el panel: el detalle vuelve donde estaba.
    await waitFor(() => expect(within(detalle).queryByLabelText('Horas estimadas')).toBeNull())
    expect(screen.getByRole('dialog', { name: /INC-1/ })).toBe(detalle)

    const write = fetchMock.mock.calls.find(([url]) => url === '/api/planning-metadata')
    expect(write?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(write?.[1]?.body))).toEqual({
      workItemId: 'INC-1',
      estimatedHours: 8,
      committedDate: '2026-10-30',
      changedBy: 'ana',
    })
  })

  it('edita la declaración existente desde el panel con la lectura fresca', async () => {
    serve({
      declarationRead: planningMetadataFixture({
        workItemId: 'REQ-1',
        estimatedHours: 4,
        committedDate: '2026-10-30',
      }),
      declarations: {
        [DEVELOPER_ID]: declarationsFixture({
          developer: { id: DEVELOPER_ID, name: 'Ana Perez' },
          items: [
            declarationItemFixture({
              workItemId: 'REQ-1',
              declaration: planningMetadataFixture({
                workItemId: 'REQ-1',
                estimatedHours: 4,
                committedDate: '2026-10-30',
              }),
            }),
          ],
        }),
      },
    })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ }))
    const detalle = await screen.findByRole('dialog', { name: /REQ-1/ })

    fireEvent.click(within(detalle).getByRole('button', { name: 'Declarar' }))

    // El formulario se rellena con la lectura fresca del recurso, no con lo que traía la lista.
    const horas = (await within(detalle).findByLabelText('Horas estimadas')) as HTMLInputElement
    expect(horas.value).toBe('4')

    fireEvent.change(horas, { target: { value: '5' } })
    fireEvent.change(within(detalle).getByLabelText('Quién declara'), {
      target: { value: 'ana' },
    })
    fireEvent.click(within(detalle).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(within(detalle).queryByLabelText('Horas estimadas')).toBeNull())

    // Un ticket que ya tenía declaración se reemplaza con `PUT`, no se crea otra vez.
    const write = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/planning-metadata/REQ-1' && init?.method === 'PUT',
    )
    expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({
      estimatedHours: 5,
      committedDate: '2026-10-30',
      changedBy: 'ana',
    })
  })
})
