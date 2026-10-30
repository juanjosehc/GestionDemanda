import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AGREED,
  DISPLACED,
  PENDING_AGREEMENT,
  PLANNED,
  WITH_PLAN,
  WITHOUT_PLAN,
} from '@/lib/incidents'
import { Incidents } from '@/pages/Incidents'
import {
  declarationItemFixture,
  declarationsFixture,
  renegotiationsFixture,
  teamCatalogFixture,
  teamTimelineFixture,
} from '@/test/fixtures'
import { renderWithClient } from '@/test/render'
import type { DeclarationItem } from '@/types/declarations'
import type { RenegotiationsResponse } from '@/types/renegotiations'
import type { TeamPerson } from '@/types/team'
import type { TimelineItem } from '@/types/timeline'

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const TEAM_URL = '/api/team'
const DECLARATIONS_PREFIX = '/api/planning-metadata/declarations/'
const TEAM_TIMELINE_URL = '/api/planning/team/timeline'
const RENEGOTIATIONS_URL = '/api/renegotiations'

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

/**
 * Un tramo del plan para un ticket de una persona: lo único que la columna Plan lee.
 *
 * Sale de un tramo real del fixture y se cambia lo que la prueba necesita —de quién es, qué ticket
 * es y cómo quedó—, para no inventar un contrato paralelo al del backend.
 */
function block(
  developerId: string,
  workItemId: string,
  planningStatus: TimelineItem['planningStatus'],
): TimelineItem {
  return { ...teamTimelineFixture().items[0], developerId, workItemId, planningStatus }
}

/** Un acuerdo registrado para un ticket, con lo mínimo que la columna Acuerdo lee. */
function agreement(
  workItemId: string,
  status: RenegotiationsResponse['items'][number]['status'],
): RenegotiationsResponse['items'][number] {
  return { ...renegotiationsFixture().items[0], workItemId, status }
}

type Served = ReturnType<typeof okResponse> | ReturnType<typeof errorResponse>

function declarationsUrl(developerId: string) {
  return `${DECLARATIONS_PREFIX}${developerId}`
}

/**
 * Sirve las cuatro lecturas de la pantalla: el padrón, el trabajo de cada persona que se enseña, la
 * agenda del equipo y las renegociaciones.
 *
 * **Una dirección que no sea una de esas cuatro lanza**, y eso es lo que fija que esta pantalla no
 * pide las métricas ni las alertas: si algún día las pidiera, la prueba fallaría aquí en vez de pasar
 * enseñando una segunda copia del tablero.
 *
 * Las dos últimas llegan **vacías por defecto**, porque la mayoría de los casos solo necesitan que la
 * lectura conteste algo: un plan sin tramos dice «Sin plan» y una renegociación sin acuerdos deja el
 * hueco. Las pruebas que afirman sobre ellos los sirven a propósito.
 */
function serve({
  team,
  declarations,
  timeline,
  renegotiations,
}: {
  team?: Served
  declarations?: (developerId: string) => Served
  timeline?: Served
  renegotiations?: Served
} = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (url === TEAM_URL) {
      return Promise.resolve(team ?? okResponse(teamCatalogFixture()))
    }

    if (url === TEAM_TIMELINE_URL) {
      return Promise.resolve(
        timeline ??
          okResponse(teamTimelineFixture({ resources: [], items: [], plans: [], conflicts: [] })),
      )
    }

    if (url === RENEGOTIATIONS_URL) {
      return Promise.resolve(
        renegotiations ??
          okResponse(
            renegotiationsFixture({ summary: { displaced: 0, pending: 0, agreed: 0 }, items: [] }),
          ),
      )
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

/** El texto de un bloque, con los saltos de línea de la plantilla colapsados a un espacio. */
function textOf(container: HTMLElement, slot: string): string {
  const node = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)

  if (!node) {
    throw new Error(`No hay bloque "${slot}"`)
  }

  return (node.textContent ?? '').replace(/\s+/g, ' ').trim()
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
  it('pide el padrón, el trabajo de cada persona, el plan y los acuerdos, y nada más', async () => {
    serve({ declarations: byDeveloper({ [ANA]: [INCIDENTE] }) })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    expect(rows(container)).toHaveLength(1)

    // Cuatro lecturas, ni una más: el padrón una vez, una declaración por persona visible, y las
    // dos de las que salen las columnas Plan y Acuerdo. Estas dos son **las mismas consultas del
    // Timeline** —misma clave de caché—, no una lectura por ticket ni por filtro.
    expect(requestedUrls()).toContain(TEAM_URL)
    expect(requestedUrls()).toContain(TEAM_TIMELINE_URL)
    expect(requestedUrls()).toContain(RENEGOTIATIONS_URL)
    expect(requestedDeclarations().sort()).toEqual([declarationsUrl(ANA), declarationsUrl(CARLOS), declarationsUrl(DIANA)])

    // Y ninguna del tablero ni de alertas: las cifras de esta pantalla son de la vista, no del negocio.
    expect(requestedUrls().filter((url) => url.startsWith('/api/planning/metrics'))).toEqual([])
    expect(requestedUrls().filter((url) => url.startsWith('/api/alerts'))).toEqual([])
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
    // El estado de declaración llega calculado y la tabla no lo deduce: lo pinta en palabras, y el
    // código del backend queda en el `title`, que es lo que permite contrastarlo con la regla.
    expect(row.getAttribute('data-declaration')).toBe('PLANIFICABLE')
    expect(within(row).getByText('Planificable')).toHaveAttribute('title', 'PLANIFICABLE')
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
    chooseFilter('Estado GLPI', 'EN_ATENCION')
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

  /**
   * Un ticket sin declaración ninguna: el caso que el atajo existe para servir.
   *
   * Es el mismo `504` del fixture —las dos carencias informadas, porque son dos personas distintas
   * las que tienen que actuar— con un identificador propio, para poder afirmar sobre su destino sin
   * confundirlo con el de otro ticket.
   */
  const SIN_DECLARAR = ticket({
    workItemId: '908',
    declarationStatus: 'SIN_DECLARACION',
    discards: [
      { code: 'SIN_ESTIMACION_DECLARADA', reason: 'no hay planificacion declarada para este elemento' },
      { code: 'SIN_FECHA_EN_GLPI', reason: 'GLPI no trae ni internal_time_to_resolve ni time_to_resolve' },
    ],
    declaration: null,
    operationalDate: null,
    operationalTime: null,
    operationalDateSource: null,
  })

  it('un ticket pendiente ofrece el atajo, con el técnico, el ticket y la vuelta', async () => {
    serve({ declarations: byDeveloper({ [ANA]: [SIN_DECLARAR] }) })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    // El nombre accesible lleva el ticket y la persona: sin él, un ticket compartido produciría dos
    // enlaces con el mismo texto y destinos distintos.
    const link = within(rowOf(container, '908')).getByRole('link', {
      name: 'Declarar el ticket 908 de Ana Perez',
    })

    // El destino lleva las tres cosas: a quién se declara, qué ticket se abre y a dónde se vuelve.
    // La vuelta es esta misma vista tal como está en el momento del clic —aquí, sin filtros—, y va
    // codificada porque es una dirección dentro de otra.
    expect(link).toHaveAttribute(
      'href',
      '/declaraciones?tecnico=dev-001&ticket=908&volver=%2Fincidentes',
    )
  })

  it('la vuelta del atajo lleva el filtro y el modo puestos', async () => {
    serve({
      team: okResponse(
        teamCatalogFixture({ people: [...teamCatalogFixture().people, ELENA_PERSON] }),
      ),
      declarations: byDeveloper({ [ANA]: [INCIDENTE, SIN_DECLARAR] }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    chooseFilter('Declaración', 'PENDIENTE')
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todo Desarrollo N2' }))

    const href = within(rowOf(container, '908'))
      .getByRole('link', { name: /^Declarar el ticket 908/ })
      .getAttribute('href')

    // El modo viaja aunque no sea el de por defecto, y los filtros van con su nombre de la interfaz.
    // Sin el modo, la fila de alguien de fuera del equipo operativo desaparecería justo al volver,
    // que es cuando hay que ver el estado nuevo.
    expect(href).toContain('&volver=%2Fincidentes%3F')
    expect(decodeURIComponent(href ?? '')).toContain('declaracion=PENDIENTE')
    expect(decodeURIComponent(href ?? '')).toContain('modo=todos')
  })

  it('un ticket ya declarado no ofrece declarar ni renegociar: solo la salida al Timeline', async () => {
    serve({ declarations: byDeveloper({ [ANA]: [INCIDENTE] }) })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    const row = rowOf(container, '901')

    expect(row.getAttribute('data-declaration')).toBe('PLANIFICABLE')
    // Declarar se sigue haciendo desde la declaración, y sin acuerdo pendiente no hay nada que
    // renegociar: la fila no ofrece ninguna de las dos acciones.
    expect(within(row).queryByRole('link', { name: /^Declarar/ })).toBeNull()
    expect(within(row).queryByRole('link', { name: /^Renegociar/ })).toBeNull()

    // La salida al Timeline sí está siempre: es una vista, no una acción que dependa del estado.
    expect(
      within(row).getByRole('link', { name: 'Ver el ticket 901 de Ana Perez en el Timeline' }),
    ).toHaveAttribute('href', '/?tecnico=dev-001&ticket=901')

    expect(cellOf(row, 'incident-action')).toBe('Timeline')
  })

  it('el desglose cuenta declarados, pendientes, sin estimación y sin compromiso', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [
          INCIDENTE, // PLANIFICABLE: nada le falta.
          SIN_DECLARAR, // sin fila: cuenta como pendiente, pero no en los dos parciales.
          ticket({ workItemId: '902', declarationStatus: 'SIN_ESTIMACION' }),
          ticket({ workItemId: '903', declarationStatus: 'SIN_COMPROMISO' }),
        ],
      }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    // Un ticket sin fila **no** engrosa «sin estimación»: ese parcial cuenta las filas que existen y
    // les falta el valor, que es otra cosa. Por eso los parciales suman 1 y 1, y no 2 y 2.
    expect(textOf(container, 'declaration-breakdown')).toBe(
      'De esos 4 tickets: 1 en estado declarado —nada les falta para planificarse— y 3 con algo ' +
        'pendiente. De estos últimos, 1 con su fila ya creada y la estimación sin declarar, y 1 con ' +
        'su fila creada y sin fecha que GLPI publique. Las cuentas se solapan —un ticket sin ' +
        'estimación también está pendiente—: es un desglose, no un reparto.',
    )
  })

  it('la columna Plan dice dónde está cada ticket, y «Sin plan» no es no haber leído', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [
          INCIDENTE, // 901: el plan lo colocó.
          ticket({ workItemId: '902', title: 'El que el plan movió' }),
          ticket({ workItemId: '903', title: 'El que no está en el plan' }),
        ],
      }),
      timeline: okResponse(
        teamTimelineFixture({
          resources: [],
          plans: [],
          conflicts: [],
          items: [block(ANA, '901', 'PLANIFICADO'), block(ANA, '902', 'DESPLAZADO')],
        }),
      ),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    expect(cellOf(rowOf(container, '901'), 'incident-plan')).toBe('Planificado')
    expect(cellOf(rowOf(container, '902'), 'incident-plan')).toBe('Desplazado')
    // El plan se leyó y no trae tramo para el 903: eso es un hecho —«Sin plan»—, no un hueco.
    expect(cellOf(rowOf(container, '903'), 'incident-plan')).toBe('Sin plan')
    expect(rowOf(container, '903').getAttribute('data-plan')).toBe('')
  })

  it('la columna Acuerdo dice qué espera una fecha, y solo el pendiente ofrece renegociar', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [
          INCIDENTE, // 901
          ticket({ workItemId: '902' }),
          ticket({ workItemId: '903' }),
        ],
      }),
      renegotiations: okResponse(
        renegotiationsFixture({
          summary: { displaced: 2, pending: 1, agreed: 1 },
          items: [agreement('901', 'ACORDADA'), agreement('902', 'PENDIENTE_DE_ACUERDO')],
        }),
      ),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    expect(cellOf(rowOf(container, '901'), 'incident-agreement')).toBe('Acordado')
    expect(cellOf(rowOf(container, '902'), 'incident-agreement')).toBe('Pendiente de acuerdo')
    // Sin acuerdo registrado no hay nada que esperar ni que renegociar: la celda dice el hueco.
    expect(cellOf(rowOf(container, '903'), 'incident-agreement')).toBe('—')

    // La acción abre la renegociación de ese ticket, con su fila ya seleccionada.
    expect(
      within(rowOf(container, '902')).getByRole('link', {
        name: 'Renegociar el ticket 902 de Ana Perez',
      }),
    ).toHaveAttribute('href', '/renegociaciones?ticket=902')

    expect(within(rowOf(container, '901')).queryByRole('link', { name: /^Renegociar/ })).toBeNull()
  })

  it('los filtros de planificación y de renegociación acotan sin volver a consultar', async () => {
    serve({
      declarations: byDeveloper({
        [ANA]: [
          INCIDENTE, // 901
          ticket({ workItemId: '902' }),
          ticket({ workItemId: '903' }),
        ],
      }),
      timeline: okResponse(
        teamTimelineFixture({
          resources: [],
          plans: [],
          conflicts: [],
          items: [block(ANA, '901', 'PLANIFICADO'), block(ANA, '902', 'DESPLAZADO')],
        }),
      ),
      renegotiations: okResponse(
        renegotiationsFixture({
          summary: { displaced: 2, pending: 1, agreed: 1 },
          items: [agreement('901', 'ACORDADA'), agreement('902', 'PENDIENTE_DE_ACUERDO')],
        }),
      ),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    // Planificación es una sola escala: la pertenencia —con plan, sin plan— y el estado del tramo.
    chooseFilter('Planificación', WITH_PLAN)
    expect(orderOf(container)).toEqual(['901', '902'])

    chooseFilter('Planificación', WITHOUT_PLAN)
    expect(orderOf(container)).toEqual(['903'])

    chooseFilter('Planificación', PLANNED)
    expect(orderOf(container)).toEqual(['901'])

    chooseFilter('Planificación', DISPLACED)
    expect(orderOf(container)).toEqual(['902'])

    chooseFilter('Planificación', '')
    chooseFilter('Renegociación', PENDING_AGREEMENT)
    expect(orderOf(container)).toEqual(['902'])

    chooseFilter('Renegociación', AGREED)
    expect(orderOf(container)).toEqual(['901'])

    // Filtrar es mirar de otra forma lo que ya está leído: ninguna lectura nueva, ni por filtro ni
    // por ticket.
    expect(requestedUrls().filter((url) => url === TEAM_TIMELINE_URL)).toHaveLength(1)
    expect(requestedUrls().filter((url) => url === RENEGOTIATIONS_URL)).toHaveLength(1)
    expect(requestedDeclarations()).toHaveLength(3)
  })

  it('si el plan o los acuerdos no se pudieron leer, la columna queda en hueco y se dice', async () => {
    serve({
      declarations: byDeveloper({ [ANA]: [INCIDENTE] }),
      timeline: errorResponse(500, { message: 'El motor no responde' }),
      renegotiations: errorResponse(500, { message: 'El motor no responde' }),
    })

    const { container } = renderWithClient(<Incidents />)
    await tableRendered()

    // El hueco es no haber podido leer, no un hecho sobre el ticket.
    expect(cellOf(rowOf(container, '901'), 'incident-plan')).toBe('—')
    expect(cellOf(rowOf(container, '901'), 'incident-agreement')).toBe('—')
    expect(screen.getByText(/El plan vigente no se pudo leer/)).toBeInTheDocument()
    expect(screen.getByText(/Los acuerdos no se pudieron leer/)).toBeInTheDocument()

    // «Sin plan» afirmaría que se comprobó que no tiene tramo, y no se pudo comprobar: el filtro
    // deja la tabla vacía en vez de inventar el hecho.
    chooseFilter('Planificación', WITHOUT_PLAN)
    expect(rows(container)).toHaveLength(0)
  })
})
