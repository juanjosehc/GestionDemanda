import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Incidents } from '@/pages/Incidents'
import { declarationItemFixture, declarationsFixture, teamCatalogFixture } from '@/test/fixtures'
import { renderWithClient } from '@/test/render'
import type { DeclarationItem } from '@/types/declarations'
import type { TeamPerson } from '@/types/team'

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const TEAM_URL = '/api/team'
const DECLARATIONS_PREFIX = '/api/planning-metadata/declarations/'

/** Las tres personas del padrón de las pruebas, por el papel que juegan en cada caso. */
const ANA = 'dev-001'
const CARLOS = 'dev-002'
const DIANA = 'dev-003'

/** Alguien del grupo de GLPI que **no** está declarado en el equipo operativo. */
const ELENA = 'dev-004'
const ELENA_PERSON: TeamPerson = {
  developerId: ELENA,
  glpiId: 104,
  name: 'Elena Vargas',
  active: true,
  sourceType: 'GLPI',
  operational: false,
}

/**
 * Un ticket, con lo mínimo que la prueba necesita contradecir.
 *
 * El resto sale del elemento 501 del fixture, que ya es un incidente activo y planificable con su
 * declaración: así lo que cada caso afirma es su propia diferencia y no un dato de relleno.
 */
function ticket(overrides: Partial<DeclarationItem> = {}): DeclarationItem {
  return declarationItemFixture(overrides)
}

/** Un incidente activo cualquiera, para el caso que solo necesita que haya trabajo. */
const INCIDENTE = ticket({
  workItemId: '901',
  type: 'INCIDENTE',
  status: 'EN_ATENCION',
  title: 'La impresora de contabilidad no imprime',
})

const REQUERIMIENTO = ticket({
  workItemId: '902',
  type: 'REQUERIMIENTO',
  status: 'EN_EJECUCION',
  title: 'Acceso al reporte de cartera',
})

type Served = ReturnType<typeof okResponse> | ReturnType<typeof errorResponse>

function declarationsUrl(developerId: string) {
  return `${DECLARATIONS_PREFIX}${developerId}`
}

/**
 * Sirve las dos únicas lecturas de la pantalla: el padrón y el trabajo de cada persona que se enseña.
 *
 * **Una dirección que no sea una de esas dos lanza**, y eso es lo que fija que esta pantalla no pide
 * las métricas ni las alertas: si algún día las pidiera, la prueba fallaría aquí en vez de pasar
 * enseñando una segunda copia del tablero.
 */
function serve({
  team,
  declarations,
}: {
  team?: Served
  declarations?: (developerId: string) => Served
} = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (url === TEAM_URL) {
      return Promise.resolve(team ?? okResponse(teamCatalogFixture()))
    }

    if (url.startsWith(DECLARATIONS_PREFIX)) {
      const developerId = url.slice(DECLARATIONS_PREFIX.length)

      return Promise.resolve(
        declarations
          ? declarations(developerId)
          : okResponse(
              declarationsFixture({ developer: { id: developerId, name: null }, items: [] }),
            ),
      )
    }

    throw new Error(`Peticion inesperada: ${url}`)
  })
}

/** El trabajo de una persona, en una respuesta con la forma real del endpoint. */
function work(developerId: string, items: DeclarationItem[]): Served {
  return okResponse(declarationsFixture({ developer: { id: developerId, name: null }, items }))
}

/** Reparte el trabajo por persona, y responde sin tickets a quien no esté en el mapa. */
function byDeveloper(workByDeveloper: Record<string, DeclarationItem[]>) {
  return (developerId: string) => work(developerId, workByDeveloper[developerId] ?? [])
}

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]))
}

function requestedDeclarations(): string[] {
  return requestedUrls().filter((url) => url.startsWith(DECLARATIONS_PREFIX))
}

function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="incident-row"]')]
}

/** Los tickets en el orden en que están pintados, que es lo que el orden por defecto decide. */
function orderOf(container: HTMLElement): (string | null)[] {
  return rows(container).map((row) => row.getAttribute('data-work-item'))
}

function rowOf(container: HTMLElement, workItemId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-slot="incident-row"][data-work-item="${workItemId}"]`,
  )

  if (!row) {
    throw new Error(`No hay fila para el ticket "${workItemId}"`)
  }

  return row
}

/** El texto de una celda concreta, para las columnas cuya cifra puede repetirse en la fila. */
function cellOf(row: HTMLElement, slot: string): string {
  return row.querySelector(`[data-slot="${slot}"]`)?.textContent ?? ''
}

/** Espera a que la tarjeta esté pintada. El título es único y está en todos los estados de la vista. */
async function tableRendered() {
  await screen.findByText('Trabajo activo')
}

/** Aplica un filtro por su etiqueta, como lo haría una persona. */
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

describe('Incidents', () => {
  it('pide el padrón y el trabajo de cada persona, y nada más', async () => {
    serve({ declarations: byDeveloper({ [ANA]: [INCIDENTE] }) })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    expect(rows(container)).toHaveLength(1)

    // Las dos únicas lecturas: el padrón, una vez, y una declaración por persona visible.
    expect(requestedUrls()).toContain(TEAM_URL)
    expect(requestedDeclarations().sort()).toEqual([declarationsUrl(ANA), declarationsUrl(CARLOS), declarationsUrl(DIANA)])

    // Y ninguna del tablero: las cifras de esta pantalla son de la vista, no del negocio.
    expect(requestedUrls().filter((url) => url.startsWith('/api/planning/'))).toEqual([])
    expect(requestedUrls()).not.toContain('/api/renegotiations')
  })

  it('pinta un incidente activo con su tipo, su estado, su persona y su declaración', async () => {
    serve({ declarations: byDeveloper({ [ANA]: [INCIDENTE] }) })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    const row = rowOf(container, '901')

    expect(row.getAttribute('data-type')).toBe('INCIDENTE')
    expect(row.getAttribute('data-status')).toBe('EN_ATENCION')
    expect(row.getAttribute('data-developer')).toBe(ANA)
    // El nombre lo publica el padrón, no la respuesta de la declaración.
    expect(cellOf(row, 'incident-person')).toBe('Ana Perez')
    expect(within(row).getByText('La impresora de contabilidad no imprime')).toBeInTheDocument()
    // El estado de declaración llega calculado y la tabla no lo deduce: lo pinta.
    expect(row.getAttribute('data-declaration')).toBe('PLANIFICABLE')
    expect(within(row).getByText('PLANIFICABLE')).toBeInTheDocument()
  })

  it('pinta un requerimiento activo y lo distingue del incidente', async () => {
    serve({ declarations: byDeveloper({ [ANA]: [INCIDENTE, REQUERIMIENTO] }) })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    expect(rows(container)).toHaveLength(2)
    expect(rowOf(container, '902').getAttribute('data-type')).toBe('REQUERIMIENTO')
    // El tipo cambia el vocabulario del estado, y los dos vienen del backend sin traducir en la vista.
    expect(rowOf(container, '902').getAttribute('data-status')).toBe('EN_EJECUCION')
    expect(rowOf(container, '901').getAttribute('data-status')).toBe('EN_ATENCION')
  })

  it('el trabajo ya resuelto no produce fila', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [INCIDENTE, ticket({ workItemId: '903', status: 'RESUELTO', title: 'Ya resuelto' })],
      }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    // El backend ya no lo publica —`activeTicketsOf` pide los estados 1 a 4— y la vista lo descarta
    // igual: la regla del brief es una garantía de pantalla, no una confianza.
    expect(orderOf(container)).toEqual(['901'])
  })

  it('el trabajo ya cerrado no produce fila', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [
          INCIDENTE,
          ticket({
            workItemId: '904',
            type: 'REQUERIMIENTO',
            status: 'FINALIZADO',
            title: 'Ya finalizado',
          }),
        ],
      }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    expect(orderOf(container)).toEqual(['901'])
  })

  it('un ticket que no se pudo traducir no se descarta: se enseña con su hueco', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [ticket({ workItemId: '905', type: null, status: null, title: 'Ticket raro' })],
      }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    // No saber si está cerrado no es saber que lo está: descartarlo escondería trabajo real.
    const row = rowOf(container, '905')

    expect(row.getAttribute('data-type')).toBe('')
    expect(row.getAttribute('data-status')).toBe('')
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('quien no tiene tickets no aporta filas y sigue en el filtro de persona', async () => {
    serve({ declarations: byDeveloper({ [ANA]: [INCIDENTE] }) })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    expect(rows(container)).toHaveLength(1)
    expect(container.querySelector(`[data-developer="${CARLOS}"]`)).toBeNull()

    // Filtrar por quien no tiene nada contesta «no tiene nada», que es distinto de que no exista.
    const options = [...screen.getByLabelText('Persona').querySelectorAll('option')]

    expect(options.map((option) => option.textContent)).toEqual([
      'Todas',
      'Ana Perez',
      'Carlos Ruiz',
      'Diana Lopez',
    ])
  })

  it('ordena por tipo, luego por prioridad descendente y luego por la fecha más antigua', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [
          ticket({ workItemId: '901', type: 'INCIDENTE', priority: 2, createdAt: '2026-10-01T08:00:00Z' }),
          ticket({ workItemId: '902', type: 'INCIDENTE', priority: 4, createdAt: '2026-10-05T08:00:00Z' }),
          ticket({ workItemId: '903', type: 'REQUERIMIENTO', priority: 5, createdAt: '2026-10-01T08:00:00Z' }),
          ticket({ workItemId: '904', type: 'INCIDENTE', priority: 4, createdAt: '2026-10-02T08:00:00Z' }),
        ],
      }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    // Incidentes primero (901, 902, 904); entre los de prioridad 4 gana el más antiguo (904 antes que
    // 902) y el de prioridad 2 va detrás; el requerimiento cierra la lista aunque su prioridad sea la
    // más alta, porque el tipo manda antes que la urgencia.
    expect(orderOf(container)).toEqual(['904', '902', '901', '903'])
  })

  it('una prioridad que GLPI no publica cae al final, a la vista', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [
          ticket({ workItemId: '905', type: 'INCIDENTE', priority: null }),
          ticket({ workItemId: '906', type: 'INCIDENTE', priority: 1 }),
        ],
      }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    // No es una prioridad baja: es un dato que falta, y por eso se ve al final en vez de mezclarse.
    expect(orderOf(container)).toEqual(['906', '905'])
  })

  it('el filtro de persona deja solo sus tickets', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [INCIDENTE],
        [CARLOS]: [ticket({ workItemId: '907', title: 'Del otro' })],
      }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    chooseFilter('Persona', CARLOS)

    expect(orderOf(container)).toEqual(['907'])
    expect(cellOf(rowOf(container, '907'), 'incident-person')).toBe('Carlos Ruiz')
  })

  it('los filtros de tipo y de estado acotan sin volver a consultar', async () => {
    serve({ declarations: byDeveloper({ [ANA]: [INCIDENTE, REQUERIMIENTO] }) })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    chooseFilter('Tipo', 'REQUERIMIENTO')
    expect(orderOf(container)).toEqual(['902'])

    chooseFilter('Tipo', '')
    chooseFilter('Estado', 'EN_ATENCION')
    expect(orderOf(container)).toEqual(['901'])

    // Filtrar es mirar de otra forma lo que ya está: ninguna lectura nueva.
    expect(requestedDeclarations()).toHaveLength(3)
  })

  it('el filtro de declaración separa lo declarado de lo que necesita declaración', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [
          INCIDENTE,
          ticket({
            workItemId: '908',
            declarationStatus: 'SIN_ESTIMACION',
            discards: [
              {
                code: 'SIN_ESTIMACION_DECLARADA',
                reason: 'la planificacion declarada no tiene estimacion',
              },
            ],
          }),
        ],
      }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    chooseFilter('Declaración', 'DECLARADO')
    expect(orderOf(container)).toEqual(['901'])

    chooseFilter('Declaración', 'PENDIENTE')
    expect(orderOf(container)).toEqual(['908'])

    // Lo que falta se nombra con el código de la regla: es lo que convierte «Pendiente» en un motivo.
    expect(
      within(rowOf(container, '908')).getByText('SIN_ESTIMACION_DECLARADA'),
    ).toBeInTheDocument()
  })

  it('por defecto solo se pregunta por el equipo operativo', async () => {
    serve({
      team: okResponse(teamCatalogFixture({ people: [...teamCatalogFixture().people, ELENA_PERSON] })),
      declarations: byDeveloper({
        [ANA]: [INCIDENTE],
        [ELENA]: [ticket({ workItemId: '909', title: 'De alguien de fuera' })],
      }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    expect(requestedDeclarations()).not.toContain(declarationsUrl(ELENA))
    expect(orderOf(container)).toEqual(['901'])
    expect(container.querySelector('[data-developer="dev-004"]')).toBeNull()
  })

  it('«Mostrar todo Desarrollo N2» añade a quien está fuera y pide lo que faltaba', async () => {
    serve({
      team: okResponse(teamCatalogFixture({ people: [...teamCatalogFixture().people, ELENA_PERSON] })),
      declarations: byDeveloper({
        [ANA]: [INCIDENTE],
        [ELENA]: [ticket({ workItemId: '909', title: 'De alguien de fuera' })],
      }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todo Desarrollo N2' }))

    expect(await screen.findByText('De alguien de fuera')).toBeInTheDocument()
    expect(requestedDeclarations()).toContain(declarationsUrl(ELENA))
    expect(orderOf(container).sort()).toEqual(['901', '909'])
  })

  it('sin equipo operativo lo declara, y no lo confunde con no tener trabajo', async () => {
    serve({
      team: okResponse(
        teamCatalogFixture({
          people: teamCatalogFixture().people.map((person) => ({ ...person, operational: false })),
        }),
      ),
    })

    renderWithClient(<Incidents />)

    expect(await screen.findByText('Nadie está declarado en el equipo operativo')).toBeInTheDocument()
    // Se dice de dónde sale la pertenencia, que es lo que hay que ir a cambiar.
    expect(screen.getByText(/La pertenencia la decide la configuración del backend/)).toBeInTheDocument()
    // Y se ofrece la salida sin salir de la pantalla.
    expect(screen.getByRole('button', { name: 'Mostrar todo Desarrollo N2' })).toBeInTheDocument()
  })

  it('sin trabajo activo lo declara como estado legítimo, no como dato que falta', async () => {
    serve({ declarations: byDeveloper({}) })

    renderWithClient(<Incidents />)

    expect(await screen.findByText('Nadie de la vista tiene trabajo activo')).toBeInTheDocument()
    expect(screen.getByText(/no porque no haya carga|no que falte un dato/)).toBeInTheDocument()
  })

  it('sin padrón lo declara y no promete una tabla', async () => {
    serve({ team: okResponse(teamCatalogFixture({ people: [] })) })

    const { container } = renderWithClient(<Incidents />)

    expect(await screen.findByText('El padrón no trae ninguna persona')).toBeInTheDocument()
    expect(container.querySelector('table')).toBeNull()
  })

  it('un fallo del padrón se puede reintentar', async () => {
    serve({ team: errorResponse(500, { message: 'GLPI no responde' }) })

    renderWithClient(<Incidents />)

    expect(await screen.findByText('No fue posible cargar el trabajo del equipo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('un filtro que no deja pasar nada lo dice sin vaciar la pantalla', async () => {
    serve({ declarations: byDeveloper({ [ANA]: [INCIDENTE] }) })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    chooseFilter('Declaración', 'PENDIENTE')

    expect(await screen.findByText('Ningún ticket coincide con los filtros')).toBeInTheDocument()
    // El vacío del filtro no es el vacío del equipo: la tabla desaparece, los filtros se quedan.
    expect(rows(container)).toHaveLength(0)
    expect(screen.getByLabelText('Declaración')).toBeInTheDocument()
  })

  it('el trabajo que no se pudo leer se declara y no se cuenta como carga', async () => {
    serve({
      declarations: (developerId) => {
        if (developerId === CARLOS) {
          return errorResponse(404, { message: 'GLPI no tiene ese usuario' })
        }

        return work(developerId, developerId === ANA ? [INCIDENTE] : [])
      },
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    expect(orderOf(container)).toEqual(['901'])
    expect(screen.getByText(/No fue posible leer el trabajo de 1 de las 3 personas/)).toBeInTheDocument()
  })
})
