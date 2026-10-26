import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Declarations } from '@/pages/Declarations'
import { ROUTES } from '@/routes/navigation'
import {
  DECLARATION_DEVELOPER_ID,
  declarationItemFixture,
  declarationsFixture,
  planningMetadataFixture,
  teamCatalogFixture,
} from '@/test/fixtures'
import { renderWithClient } from '@/test/render'
import type { DeclarationStatus } from '@/types/declarations'
import type { TeamCatalogResponse, TeamPerson } from '@/types/team'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()

const TEAM_URL = '/api/team'
const LIST_URL = `/api/planning-metadata/declarations/${DECLARATION_DEVELOPER_ID}`
const ITEM_URL = '/api/planning-metadata/501'
const CREATE_URL = '/api/planning-metadata'
/**
 * El listado de un tecnico y el recurso de un ticket comparten prefijo, y el listado lo lleva dentro:
 * las dos comprobaciones van **de la mas larga a la mas corta**, o el listado se tomaria por el
 * recurso de un ticket llamado «declarations».
 */
const LIST_PREFIX = '/api/planning-metadata/declarations/'
const ITEM_PREFIX = '/api/planning-metadata/'

/** Lo que `fetch` devuelve en estas pruebas: solo se usan `ok`, `status` y `json()`. */
type Served = { ok: boolean; status: number; json: () => Promise<unknown> }

function okResponse(body: unknown, status = 200): Served {
  return { ok: true, status, json: async () => body }
}

function errorResponse(status: number, body: unknown): Served {
  return { ok: false, status, json: async () => body }
}

/**
 * Sirve una respuesta, o varias en orden —la ultima se repite—.
 *
 * La cola existe para las pruebas que provocan una relectura: tras guardar, la lista se vuelve a
 * pedir, y lo que hay que poder afirmar es que la segunda respuesta es la que se ve.
 */
function queue(responses: Served | Served[]): () => Served {
  const list = Array.isArray(responses) ? [...responses] : [responses]

  return () => (list.length > 1 ? (list.shift() as Served) : (list[0] as Served))
}

interface Routes {
  /** El padron del equipo: es lo que llena el desplegable de tecnicos. */
  team?: Served | Served[]
  /** La lista de tickets del tecnico, por `GET`. */
  declarations?: Served | Served[]
  /** La planificacion declarada de un ticket, por `GET`: lo que el formulario lee antes de escribir. */
  declaration?: Served | Served[]
  /** La respuesta de la escritura, sea `POST` o `PUT`. */
  write?: Served | Served[]
}

/**
 * Sirve por direccion y metodo.
 *
 * El metodo importa porque la ruta de un ticket es la misma para las dos operaciones: `GET` para
 * leerlo antes de modificarlo y `PUT` para reemplazarlo. Una peticion que no este en la tabla falla
 * con su nombre en vez de devolver algo parecido: es lo que convierte «la pantalla pidio otra cosa»
 * en una prueba que se cae.
 */
function serve({ team, declarations, declaration, write }: Routes) {
  const catalog = queue(team ?? okResponse(TEAM))
  const list = queue(declarations ?? okResponse(declarationsFixture()))
  const read = queue(declaration ?? okResponse(planningMetadataFixture()))
  const saved = queue(write ?? okResponse(planningMetadataFixture()))

  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (url === TEAM_URL) {
      return Promise.resolve(catalog())
    }
    // El listado antes que el recurso: su direccion tambien empieza por el prefijo del recurso.
    if (url.startsWith(LIST_PREFIX) && method === 'GET') {
      return Promise.resolve(list())
    }
    // El recurso de un ticket, por prefijo y no por una direccion fija: el atajo abre el que toca, y
    // con una sola direccion escrita aqui la prueba del atajo no podria abrir dos tickets distintos.
    if (url.startsWith(ITEM_PREFIX) && method === 'GET') {
      return Promise.resolve(read())
    }
    if (url.startsWith(ITEM_PREFIX) && method === 'PUT') {
      return Promise.resolve(saved())
    }
    if (url === CREATE_URL && method === 'POST') {
      return Promise.resolve(saved())
    }

    throw new Error(`Peticion inesperada: ${method} ${url}`)
  })
}

/** Las peticiones de un metodo, con su cuerpo ya leido, para afirmar lo que se envio. */
function writes(method: 'POST' | 'PUT') {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) as unknown }))
}

/** Cuantas veces se pidio una direccion con un metodo. */
function calls(url: string, method = 'GET') {
  return fetchMock.mock.calls.filter(
    ([called, init]) => called === url && (init?.method ?? 'GET') === method,
  )
}

/** Las peticiones con su metodo, en el orden en que salieron: es lo que prueba «leer antes de escribir». */
function order(): string[] {
  return fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
}

function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="declaration-row"]')]
}

function rowOf(container: HTMLElement, workItemId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-slot="declaration-row"][data-work-item="${workItemId}"]`,
  )

  if (!row) {
    throw new Error(`No hay fila para el ticket "${workItemId}"`)
  }

  return row
}

/** Una cifra del resumen operativo, por su `data-slot`: el `<dd>` cuyo texto es el numero. */
function figureOf(container: HTMLElement, slot: string): number {
  const cell = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)

  if (!cell) {
    throw new Error(`No hay cifra "${slot}"`)
  }

  return Number(cell.textContent)
}

/**
 * Consulta los tickets de un tecnico, como lo haria una persona: elige y envia.
 *
 * `espera` es lo que se aguarda a ver: la tabla, o el vacio declarado. Una consulta tiene dos
 * desenlaces legitimos y la prueba tiene que decir cual esta mirando.
 */
async function consultar(container: HTMLElement, espera = 'Tickets asignados') {
  // El desplegable se llena con el padron: sin el no hay ninguna opcion que elegir, y asignarle un
  // valor a un `select` que no la tiene lo deja en blanco. Esperar aqui es lo que haria una persona.
  await screen.findByRole('option', { name: 'Ana Perez' })

  fireEvent.change(screen.getByLabelText('Técnico'), { target: { value: DECLARATION_DEVELOPER_ID } })
  fireEvent.click(screen.getByRole('button', { name: 'Consultar' }))

  await screen.findByText(espera)
  return container
}

/** Abre el formulario de una fila por su boton. */
async function abrir(container: HTMLElement, workItemId: string) {
  const row = rowOf(container, workItemId)
  fireEvent.click(within(row).getByRole('button'))

  return screen.findByRole('button', { name: 'Guardar' })
}

/**
 * Espera a que la escritura termine, mirando que el formulario se haya cerrado.
 *
 * **Estas pruebas esperaban antes a ver el nombre del tecnico, y dejo de servir**: desde que el
 * desplegable trae el padron, ese nombre esta tambien en una opcion y la consulta encuentra dos. El
 * cierre del formulario es lo que de verdad dice que la escritura termino —ocurre en el `onSuccess`
 * de la llamada—, y no se confunde con nada.
 *
 * Es ademas un ancla **mas fuerte** que la anterior: `useSaveDeclaration` invalida la lista antes de
 * cerrar, asi que cuando el boton desaparece la relectura ya se pidio, y las afirmaciones de despues
 * —cuantas veces se leyo la lista— no dependen de un turno del bucle de eventos.
 */
async function esperarGuardado() {
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull())
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

function escribir(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } })
}

/** La lista con el ticket 501 en un estado concreto, para las pruebas que provocan una relectura. */
function listWith501(status: DeclarationStatus) {
  return declarationsFixture({
    items: [
      declarationItemFixture({
        declarationStatus: status,
        discards:
          status === 'PLANIFICABLE'
            ? []
            : [
                {
                  code: 'SIN_ESTIMACION_DECLARADA',
                  reason: 'la planificacion declarada no tiene estimacion',
                },
              ],
      }),
    ],
  })
}

/**
 * Una persona del padron, con los campos que no importan al caso ya puestos.
 *
 * `operational` en verdadero es el estado normal, y quien quiera otro lo pide por `overrides` en vez
 * de darlo por supuesto: es la misma convencion que `teamCatalogFixture`, y por el mismo motivo.
 */
function person(
  developerId: string,
  glpiId: number,
  name: string,
  overrides: Partial<TeamPerson> = {},
): TeamPerson {
  return {
    developerId,
    glpiId,
    name,
    active: true,
    sourceType: 'GLPI',
    operational: true,
    ...overrides,
  }
}

/**
 * El padron que sirve esta prueba: el tecnico de la declaracion y dos personas mas.
 *
 * **`DECLARATION_DEVELOPER_ID` no esta en `teamCatalogFixture()`**, cuyas tres personas son las de la
 * fotografia operativa del tablero. Aqui hace falta que quien tiene los tickets del fixture —`dev-1`—
 * este en el padron, o el desplegable no tendria su opcion y todas las consultas fallarian por una
 * razon que no es la que se quiere probar.
 *
 * Las otras dos existen para los dos casos del brief que no se pueden probar con una sola persona:
 * quien esta **fuera del equipo operativo** y quien entro por la **via de excepcion**.
 */
const ANA = person(DECLARATION_DEVELOPER_ID, 201, 'Ana Perez')
/** Fuera del equipo operativo: no se le reparte trabajo, pero tiene tickets que hay que declarar. */
const OUTSIDE = person('dev-2', 202, 'Beto Salas', { operational: false })
/** Declarada a mano en la configuracion, no en el grupo de GLPI. */
const EXCEPTION = person('dev-3', 203, 'Caro Mena', { operational: false, sourceType: 'EXCEPTION' })

const PEOPLE: readonly TeamPerson[] = [ANA, OUTSIDE, EXCEPTION]

const TEAM: TeamCatalogResponse = teamCatalogFixture({ people: [...PEOPLE] })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // El firmante se recuerda entre visitas, y eso es de una persona y no de una prueba: sin limpiarlo,
  // lo que escribio una se veria precargado en la siguiente y las afirmaciones dependerian del orden.
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Declarations', () => {
  it('carga los tickets del tecnico y no pide nada mas', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)

    expect(rows(container)).toHaveLength(5)
    expect(rowOf(container, '501').getAttribute('data-status')).toBe('PLANIFICABLE')

    // Dos lecturas y ni una mas: el padron, que es lo que llena el desplegable, y el listado
    // consolidado del tecnico. Y ninguna escritura: consultar no declara nada.
    expect(order()).toEqual([`GET ${TEAM_URL}`, `GET ${LIST_URL}`])
    expect(calls(LIST_URL)).toHaveLength(1)
    expect(writes('POST')).toHaveLength(0)
    expect(writes('PUT')).toHaveLength(0)

    // El nombre lo pone GLPI; la pantalla no lo compone. Se lee dentro de la frase del listado y no
    // suelto: desde que el desplegable trae el padron, ese mismo nombre esta tambien en una opcion.
    expect(screen.getByText(/5 tickets asignados/)).toHaveTextContent('Ana Perez')
  })

  it('con un tecnico sin tickets lo declara, sin tabla y sin inventar filas', async () => {
    serve({ declarations: okResponse(declarationsFixture({ items: [] })) })

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container, 'Este técnico no tiene tickets asignados')

    expect(container.querySelector('table')).toBeNull()
    expect(rows(container)).toHaveLength(0)

    // Una lista vacia es una respuesta completa: no es un error, y lo unico que se pide de mas es el
    // padron que llena el desplegable.
    expect(order()).toEqual([`GET ${TEAM_URL}`, `GET ${LIST_URL}`])
  })

  it('pinta los cinco estados con su codigo y su motivo, tal como llegan', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)

    // El orden es el que devolvio GLPI: la tabla no reordena.
    expect(rows(container).map((row) => row.getAttribute('data-status'))).toEqual([
      'PLANIFICABLE',
      'SIN_ESTIMACION',
      'SIN_COMPROMISO',
      'SIN_DECLARACION',
      'NO_TRADUCIBLE',
    ])

    // Los motivos son los del backend, con su codigo al lado: la pantalla no los reescribe. Desde la
    // Fase 66b cada carencia nombra a quien tiene que arreglarla: el desarrollador las horas y GLPI
    // la fecha.
    const sinDeclaracion = rowOf(container, '504')
    expect(
      within(sinDeclaracion).getByText('no hay planificacion declarada para este elemento'),
    ).toBeInTheDocument()
    expect(
      within(sinDeclaracion).getByText(
        'GLPI no trae ni internal_time_to_resolve ni time_to_resolve',
      ),
    ).toBeInTheDocument()
    expect(within(sinDeclaracion).getByText('SIN_ESTIMACION_DECLARADA')).toBeInTheDocument()
    expect(within(sinDeclaracion).getByText('SIN_FECHA_EN_GLPI')).toBeInTheDocument()

    const intraducible = rowOf(container, '505')
    expect(within(intraducible).getByText('TIPO_DESCONOCIDO')).toBeInTheDocument()
    // Sin tipo ni estado que enseñar, el hueco se declara: no se rellena con algo parecido.
    expect(within(intraducible).getAllByText('—')).toHaveLength(2)
  })

  it('crea la planificacion de un ticket que no tenia ninguna', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '504')

    // Sin fila no hay nada que leer: la creacion no estrena lectura.
    expect(calls(ITEM_URL)).toHaveLength(0)

    escribir('Horas estimadas', '8')
    escribir('Fecha compromiso', '2026-11-02')
    escribir('Quién declara', 'carlos')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await esperarGuardado()

    expect(writes('POST')).toEqual([
      {
        url: CREATE_URL,
        body: {
          workItemId: '504',
          estimatedHours: 8,
          committedDate: '2026-11-02',
          changedBy: 'carlos',
        },
      },
    ])
    // No se reemplaza lo que no existe: para un ticket sin fila el verbo es POST, no PUT.
    expect(writes('PUT')).toHaveLength(0)
    // Y la lista se vuelve a leer sola, sin recargar la pagina.
    expect(calls(LIST_URL)).toHaveLength(2)
  })

  it('reemplaza la planificacion de un ticket que ya la tenia, y lee antes de escribir', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '501')

    // Abrir el formulario solo lee: el padron, la lista del tecnico y despues el recurso del ticket,
    // en ese orden. Todavia no hay ninguna escritura.
    expect(order()).toEqual([`GET ${TEAM_URL}`, `GET ${LIST_URL}`, `GET ${ITEM_URL}`])

    escribir('Quién declara', 'carlos')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await esperarGuardado()

    // Y la lectura sigue estando antes que la escritura, que es la razon de que exista: el PUT
    // reemplaza, asi que hay que saber que hay que reemplazar antes de mandarlo.
    expect(order().indexOf(`GET ${ITEM_URL}`)).toBeLessThan(order().indexOf(`PUT ${ITEM_URL}`))

    expect(writes('PUT')).toEqual([
      {
        url: ITEM_URL,
        body: { estimatedHours: 6, committedDate: '2026-10-20', changedBy: 'carlos' },
      },
    ])
    expect(writes('POST')).toHaveLength(0)
  })

  it('invalida la lectura afectada y solo esa: la lista se refresca, el ticket no se relee', async () => {
    // La segunda respuesta del listado es la que tiene que verse tras guardar.
    serve({
      declarations: [
        okResponse(declarationsFixture()),
        okResponse(listWith501('SIN_ESTIMACION')),
      ],
    })

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '501')

    escribir('Quién declara', 'carlos')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    // La fila cambia de estado sin que nadie recargue nada: lo que se ve es la relectura.
    await screen.findByText('SIN_ESTIMACION')

    expect(rowOf(container, '501').getAttribute('data-status')).toBe('SIN_ESTIMACION')
    expect(calls(LIST_URL)).toHaveLength(2)
    // El recurso del ticket se invalidó, pero el formulario ya se cerró: no se relee de más.
    expect(calls(ITEM_URL)).toHaveLength(1)

    // La conversación entera, en orden: el padron, la lista, la lectura previa, la escritura y la
    // relectura de la lista. Ni una peticion mas: no se recargo la pantalla ni se toco nada que no
    // fuera esto.
    expect(order()).toEqual([
      `GET ${TEAM_URL}`,
      `GET ${LIST_URL}`,
      `GET ${ITEM_URL}`,
      `PUT ${ITEM_URL}`,
      `GET ${LIST_URL}`,
    ])
  })

  it('enseña el 400 del backend con su mensaje, sin reinterpretarlo', async () => {
    serve({
      write: errorResponse(400, {
        error: 'VALIDATION_ERROR',
        message: 'hay que declarar al menos la estimacion o la fecha compromiso',
      }),
    })

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '504')

    escribir('Quién declara', 'carlos')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    // El texto es el del backend, palabra por palabra: la pantalla no lo traduce ni lo resume.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'hay que declarar al menos la estimacion o la fecha compromiso',
    )
    // El formulario sigue abierto con lo que se escribio, y no se invalidó nada: no hubo escritura.
    expect(field('Quién declara').value).toBe('carlos')
    expect(calls(LIST_URL)).toHaveLength(1)
  })

  it('enseña el 409 del conflicto con su mensaje y deja la fila como estaba', async () => {
    serve({
      write: errorResponse(409, {
        error: 'PLANNING_METADATA_ALREADY_EXISTS',
        message: 'el elemento de trabajo 504 ya tiene planificacion declarada',
      }),
    })

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '504')

    escribir('Horas estimadas', '8')
    escribir('Quién declara', 'carlos')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'el elemento de trabajo 504 ya tiene planificacion declarada',
    )
    // Nada cambio en la tabla: el conflicto lo resolvio el backend, no la pantalla.
    expect(rowOf(container, '504').getAttribute('data-status')).toBe('SIN_DECLARACION')
    expect(calls(LIST_URL)).toHaveLength(1)
  })

  it('precarga el formulario con lo declarado y no borra lo que no se toca', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '501')

    // Los campos salen de la lectura, no de lo que traia la lista.
    expect(field('Horas estimadas').value).toBe('6')
    expect(field('Fecha compromiso').value).toBe('2026-10-20')
    // Quien declara es de esta operacion, no del recurso: nunca viene precargado.
    expect(field('Quién declara').value).toBe('')

    // Se cambia solo la fecha. Como el PUT reemplaza, las horas tienen que viajar igualmente: si el
    // formulario enviara medio cuerpo, guardar la fecha borraria la estimacion.
    escribir('Fecha compromiso', '2026-12-01')
    escribir('Quién declara', 'carlos')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await esperarGuardado()

    expect(writes('PUT')[0]?.body).toEqual({
      estimatedHours: 6,
      committedDate: '2026-12-01',
      changedBy: 'carlos',
    })
  })

  it('no reclasifica: con una declaracion que parece completa y un estado que dice lo contrario, gana el backend', async () => {
    // El caso imposible para la vista y posible para el backend: hay fila, con horas y fecha, y el
    // estado dice que falta la estimacion. Si la pantalla dedujera el estado de los valores, diria
    // PLANIFICABLE y esta prueba se caeria.
    serve({
      declarations: okResponse(
        declarationsFixture({
          items: [
            declarationItemFixture({
              declarationStatus: 'SIN_ESTIMACION',
              discards: [
                {
                  code: 'SIN_ESTIMACION_DECLARADA',
                  reason: 'la planificacion declarada no tiene estimacion',
                },
              ],
              declaration: planningMetadataFixture(),
            }),
          ],
        }),
      ),
    })

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)

    const row = rowOf(container, '501')
    expect(row.getAttribute('data-status')).toBe('SIN_ESTIMACION')
    expect(within(row).getByText('SIN_ESTIMACION')).toBeInTheDocument()
    expect(within(row).getByText('SIN_ESTIMACION_DECLARADA')).toBeInTheDocument()
    expect(screen.queryByText('PLANIFICABLE')).toBeNull()

    // Y la accion sigue saliendo de la fila, no del estado: hay declaracion, asi que se reemplaza.
    expect(within(row).getByRole('button')).toHaveTextContent('Editar')

    // Clasificar tampoco escribe: la consulta no produjo ninguna peticion de escritura.
    expect(writes('POST')).toHaveLength(0)
    expect(writes('PUT')).toHaveLength(0)
  })

describe('Declarations · el selector de persona', () => {
  it('ofrece el equipo operativo primero y el resto después, por nombre y sin identificadores', async () => {
    serve({})

    renderWithClient(<Declarations />, { route: '/declaraciones' })
    await screen.findByRole('option', { name: 'Ana Perez' })

    const select = screen.getByLabelText('Técnico') as HTMLSelectElement
    const groups = [...select.querySelectorAll('optgroup')]

    // Dos listas y en este orden: con quien se trabaja a diario primero, y despues el resto.
    expect(groups.map((group) => group.label)).toEqual(['Equipo operativo', 'Resto del padrón'])
    expect([...groups[0].querySelectorAll('option')].map((one) => one.textContent)).toEqual([
      'Ana Perez',
    ])
    expect([...groups[1].querySelectorAll('option')].map((one) => one.textContent)).toEqual([
      'Beto Salas',
      'Caro Mena · excepción',
    ])

    // Y ninguna opcion enseña un identificador tecnico: es lo que esta fase viene a retirar.
    expect(select.textContent).not.toContain(DECLARATION_DEVELOPER_ID)
  })

  it('nadie queda fuera: quien está fuera del equipo operativo se puede elegir y consultar', async () => {
    serve({
      declarations: okResponse(
        declarationsFixture({ developer: { id: 'dev-2', name: 'Beto Salas' } }),
      ),
    })

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await screen.findByRole('option', { name: 'Beto Salas' })

    fireEvent.change(screen.getByLabelText('Técnico'), { target: { value: 'dev-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }))

    await screen.findByText('Tickets asignados')

    // Se le pidio su listado, y el nombre que la pantalla enseña es el del padron.
    expect(calls(`${LIST_PREFIX}dev-2`)).toHaveLength(1)
    expect(screen.getByText(/5 tickets asignados/)).toBeInTheDocument()
    expect(within(rowOf(container, '501')).getByRole('button')).toHaveTextContent('Editar')
  })

  it('una excepción del catálogo se distingue de una persona de GLPI', async () => {
    serve({})

    renderWithClient(<Declarations />, { route: '/declaraciones' })
    await screen.findByRole('option', { name: 'Caro Mena · excepción' })

    // La marca es la unica señal, y solo la lleva quien no viene de GLPI: es la convencion de la
    // Fase 30, que señala lo que no es GLPI y nada mas.
    expect(screen.getByRole('option', { name: 'Caro Mena · excepción' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Ana Perez · excepción' })).toBeNull()
  })

  it('si el padrón no carga lo dice, en vez de ofrecer un desplegable vacío', async () => {
    serve({ team: errorResponse(500, { message: 'GLPI no responde' }) })

    renderWithClient(<Declarations />, { route: '/declaraciones' })

    expect(await screen.findByText('No fue posible cargar el equipo')).toBeInTheDocument()

    // Sin padron no hay a quien elegir, y no se pide ninguna declaracion: no habria a quien pedirla.
    expect(screen.queryByLabelText('Técnico')).toBeNull()
    expect(order()).toEqual([`GET ${TEAM_URL}`])
  })
})

describe('Declarations · la entrada directa', () => {
  it('con técnico y ticket en la dirección se abre sola, sin teclear nada', async () => {
    serve({})

    renderWithClient(<Declarations />, {
      route: `/declaraciones?tecnico=${DECLARATION_DEVELOPER_ID}&ticket=504`,
    })

    // El formulario del ticket pedido esta abierto sin haber tocado el desplegable ni la tabla.
    await screen.findByRole('button', { name: 'Guardar' })

    expect(screen.getByText('Declarar la planificación')).toBeInTheDocument()
    expect(screen.getByLabelText('Técnico')).toHaveValue(DECLARATION_DEVELOPER_ID)

    // Y no se pidio nada de mas: el 504 no tiene fila, asi que no hay recurso que leer.
    expect(order()).toEqual([`GET ${TEAM_URL}`, `GET ${LIST_URL}`])
  })

  it('sin contexto no pide ninguna declaración: solo el padrón que llena el desplegable', async () => {
    serve({})

    renderWithClient(<Declarations />, { route: '/declaraciones' })

    await screen.findByText('Elige un técnico')

    expect(order()).toEqual([`GET ${TEAM_URL}`])
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('una entrada directa a un ticket intraducible no abre el formulario, y lo explica', async () => {
    serve({})

    renderWithClient(<Declarations />, {
      route: `/declaraciones?tecnico=${DECLARATION_DEVELOPER_ID}&ticket=505`,
    })

    // El mensaje llega en vez del formulario: declarar horas y fecha no cambia el tipo que GLPI
    // entrega, que es lo unico que impide planificarlo.
    const notice = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-slot="not-declarable"]')

      if (!found) {
        throw new Error('No apareció el aviso del ticket intraducible')
      }

      return found
    })

    expect(notice).toHaveTextContent('505')
    expect(notice).toHaveTextContent('no entra al plan')
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()

    // Y no se pidió el recurso del ticket: sin formulario no hay nada que leer.
    expect(order()).toEqual([`GET ${TEAM_URL}`, `GET ${LIST_URL}`])
  })

  it('el enlace de vuelta nombra la pantalla de la que se salió', async () => {
    serve({})

    renderWithClient(<Declarations />, {
      route: `/declaraciones?tecnico=${DECLARATION_DEVELOPER_ID}&volver=${ROUTES.resources}`,
    })

    // No dice «Incidentes» desde cualquier sitio: dice a donde vuelve de verdad.
    expect(await screen.findByRole('link', { name: 'Volver a Recursos' })).toHaveAttribute(
      'href',
      ROUTES.resources,
    )
  })

  it('sin vuelta declarada el enlace sigue llevando a la lista de trabajo', async () => {
    serve({})

    renderWithClient(<Declarations />, { route: '/declaraciones' })

    // El flujo empieza en la lista de trabajo, asi que ese es el respaldo.
    expect(await screen.findByRole('link', { name: 'Volver a Tickets' })).toHaveAttribute(
      'href',
      ROUTES.incidents,
    )
  })
})

describe('Declarations · el resumen y el atajo', () => {
  it('el resumen cuenta lo mismo que la tabla, y declarados y pendientes no se solapan', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)

    // El fixture trae los cinco estados, uno de cada: un planificable y cuatro pendientes.
    expect(figureOf(container, 'declaration-active')).toBe(5)
    expect(figureOf(container, 'declaration-declared')).toBe(1)
    expect(figureOf(container, 'declaration-pending')).toBe(4)
    expect(figureOf(container, 'declaration-without-estimation')).toBe(1)
    expect(figureOf(container, 'declaration-without-commitment')).toBe(1)

    // Declarados y pendientes parten a los activos: suman, no se solapan. Las dos carencias, en
    // cambio, son causas de estar pendiente y por eso no se exige que sumen nada.
    expect(
      figureOf(container, 'declaration-declared') + figureOf(container, 'declaration-pending'),
    ).toBe(figureOf(container, 'declaration-active'))
  })

  it('«Declarar siguiente pendiente» abre el primero que falta y salta el que ya está abierto', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)

    // El 501 es planificable y el 505 intraducible: ninguno de los dos se ofrece.
    fireEvent.click(screen.getByRole('button', { name: 'Declarar siguiente pendiente' }))
    await screen.findByRole('button', { name: 'Guardar' })

    expect(calls(`${ITEM_PREFIX}502`)).toHaveLength(1)

    // El segundo clic avanza al 503 en vez de reabrir el 502: es lo que hace que el atajo sirva dos
    // veces seguidas.
    fireEvent.click(screen.getByRole('button', { name: 'Declarar siguiente pendiente' }))
    await screen.findByRole('button', { name: 'Guardar' })

    expect(calls(`${ITEM_PREFIX}503`)).toHaveLength(1)
    expect(calls(`${ITEM_PREFIX}502`)).toHaveLength(1)
  })

  it('sin nada que declarar el atajo no se ofrece', async () => {
    serve({
      declarations: okResponse(
        declarationsFixture({
          items: [
            declarationItemFixture({ declarationStatus: 'PLANIFICABLE' }),
            declarationItemFixture({ workItemId: '505', declarationStatus: 'NO_TRADUCIBLE' }),
          ],
        }),
      ),
    })

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)

    // Hay un pendiente —el intraducible— y no se ofrece: no se arregla declarando, asi que el boton
    // llevaria a rellenar un formulario que no cambia nada.
    expect(figureOf(container, 'declaration-pending')).toBe(1)
    expect(screen.queryByRole('button', { name: 'Declarar siguiente pendiente' })).toBeNull()
  })

  it('un ticket intraducible se ve pero no se puede declarar, y la fila dice por qué', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)

    // La fila sigue a la vista —esconderla dejaria al gestor sin saber que existe—, pero no ofrece
    // ninguna accion: un formulario aqui no cambia lo que el motor haria con el ticket.
    const row = within(rowOf(container, '505'))
    expect(row.queryByRole('button')).toBeNull()
    expect(row.getByText('No entra al plan')).toBeInTheDocument()
    expect(
      row.getByText(/GLPI no lo entrega de una forma que el contrato pueda leer/),
    ).toBeInTheDocument()

    // Las otras cuatro filas si se pueden declarar o editar.
    expect(rows(container).filter((other) => within(other).queryByRole('button') === null)).toEqual([
      rowOf(container, '505'),
    ])
  })
})

describe('Declarations · la declaración en lote', () => {
  const BATCH_ROUTE = `/declaraciones?tecnico=${DECLARATION_DEVELOPER_ID}&lote=1`

  function batchRows(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('[data-slot="batch-row"]')]
  }

  function fieldOf(container: HTMLElement, workItemId: string, kind: 'Horas' | 'Fecha') {
    const row = container.querySelector<HTMLElement>(
      `[data-slot="batch-row"][data-work-item="${workItemId}"]`,
    )

    if (!row) {
      throw new Error(`No hay fila de lote para el ticket "${workItemId}"`)
    }

    return within(row).getByLabelText(new RegExp(`^${kind}`)) as HTMLInputElement
  }

  it('abre la persona entera: una fila por pendiente, un solo firmante y sin el atajo por ticket', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: BATCH_ROUTE })
    await screen.findByText('Declaración en lote · Ana Perez')

    // Solo lo que se arregla declarando: 501 ya es planificable y 505 no se puede traducir.
    expect(batchRows(container).map((row) => row.getAttribute('data-work-item'))).toEqual([
      '502',
      '503',
      '504',
    ])

    // Un firmante para el lote, no uno por fila: es la persona que opera, no un dato del ticket.
    expect(screen.getAllByLabelText('Quién declara')).toHaveLength(1)

    // La tabla sigue siendo la fuente del estado y el atajo por ticket deja de ofrecerse: la lista ya
    // tiene todas las filas.
    expect(rows(container)).toHaveLength(5)
    expect(screen.queryByRole('button', { name: 'Declarar siguiente pendiente' })).toBeNull()

    // Abrir el lote no escribe ni pide nada de mas.
    expect(order()).toEqual([`GET ${TEAM_URL}`, `GET ${LIST_URL}`])
    expect(writes('POST')).toHaveLength(0)
    expect(writes('PUT')).toHaveLength(0)
  })

  it('guarda varias declaraciones con un solo firmante y una sola relectura', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: BATCH_ROUTE })
    await screen.findByText('Declaración en lote · Ana Perez')

    // El boton no se ofrece sin nada escrito ni sin firmante.
    expect(screen.getByRole('button', { name: /Guardar/ })).toBeDisabled()

    fireEvent.change(fieldOf(container, '502', 'Horas'), { target: { value: '3' } })
    fireEvent.change(fieldOf(container, '504', 'Horas'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Quién declara'), { target: { value: 'maury' } })

    const save = screen.getByRole('button', { name: 'Guardar 2 declaraciones' })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await screen.findByText('2 declaraciones guardadas')

    // Cada fila conserva su propia escritura: el 502 ya tenia fecha y el PUT la reenvia para no
    // borrarla; el 504 no tenia nada y se crea con la fecha vacia dicha como nula.
    expect(writes('PUT')).toEqual([
      {
        url: `${ITEM_PREFIX}502`,
        body: { estimatedHours: 3, committedDate: '2026-10-21', changedBy: 'maury' },
      },
    ])
    expect(writes('POST')).toEqual([
      {
        url: CREATE_URL,
        body: {
          workItemId: '504',
          estimatedHours: 5,
          committedDate: null,
          changedBy: 'maury',
        },
      },
    ])

    // Una sola relectura para el lote entero, y ninguna escritura para las filas que no se tocaron.
    expect(calls(LIST_URL)).toHaveLength(2)
    expect(writes('PUT').map((write) => write.url)).not.toContain(`${ITEM_PREFIX}503`)
  })

  it('no envia las filas vacias ni las que quedaron como estaban', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: BATCH_ROUTE })
    await screen.findByText('Declaración en lote · Ana Perez')

    // Las dos filas con declaracion llegan precargadas con lo suyo.
    expect(fieldOf(container, '502', 'Fecha').value).toBe('2026-10-21')
    expect(fieldOf(container, '503', 'Horas').value).toBe('4')

    // Se cambia solo las horas del 503. El 502 esta precargado pero intacto, y el 504 en blanco.
    fireEvent.change(fieldOf(container, '503', 'Horas'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Quién declara'), { target: { value: 'maury' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 declaración' }))

    await screen.findByText('Declaración guardada')

    expect(writes('PUT')).toEqual([
      {
        url: `${ITEM_PREFIX}503`,
        body: { estimatedHours: 6, committedDate: null, changedBy: 'maury' },
      },
    ])
    expect(writes('POST')).toHaveLength(0)
  })

  it('encadena el resto del ciclo con el tecnico ya puesto', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: BATCH_ROUTE })
    await screen.findByText('Declaración en lote · Ana Perez')

    fireEvent.change(fieldOf(container, '504', 'Horas'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Quién declara'), { target: { value: 'maury' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 declaración' }))

    const panel = await screen.findByText('Declaración guardada')

    // Declarar no es cubrir: el panel dice lo que falta y lleva a las pantallas que lo hacen, sin
    // volver a teclear a quien se acaba de declarar.
    expect(panel.closest('[data-slot="cycle-close"]')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Generar plan de Ana Perez' })).toHaveAttribute(
      'href',
      `/planificar?tecnico=${DECLARATION_DEVELOPER_ID}`,
    )
    expect(screen.getByRole('link', { name: 'Registrar acuerdos' })).toHaveAttribute(
      'href',
      ROUTES.renegotiations,
    )
    expect(screen.getByRole('link', { name: 'Volver al Timeline' })).toHaveAttribute(
      'href',
      ROUTES.teamTimeline,
    )
  })

  it('recuerda quien declara entre visitas', async () => {
    serve({})

    const first = renderWithClient(<Declarations />, { route: BATCH_ROUTE })
    await screen.findByText('Declaración en lote · Ana Perez')

    fireEvent.change(fieldOf(first.container, '504', 'Horas'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Quién declara'), { target: { value: 'maury' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 declaración' }))

    await screen.findByText('Declaración guardada')

    first.unmount()

    // La misma persona vuelve a la pantalla y no vuelve a teclear su nombre.
    renderWithClient(<Declarations />, { route: BATCH_ROUTE })
    expect(await screen.findByLabelText('Quién declara')).toHaveValue('maury')
  })
})

describe('Declarations · el formulario vive en un panel', () => {
  /** El panel lateral abierto: un `role="dialog"` no modal, el mismo del Timeline. */
  function panel(): HTMLElement {
    return screen.getByRole('dialog')
  }

  it('declarar abre un panel fijo con el formulario dentro y la tabla detrás', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '504')

    // Fuera del flujo: es un panel `fixed` y la tabla sigue montada, en su sitio y completa.
    expect(panel()).toHaveClass('fixed')
    expect(within(panel()).getByRole('button', { name: 'Guardar' })).toBeInTheDocument()
    expect(within(panel()).getByLabelText('Horas estimadas')).toBeInTheDocument()
    expect(rows(container)).toHaveLength(5)

    // La fila sigue marcada como abierta, que es de donde vendra el foco al cerrar.
    expect(within(rowOf(container, '504')).getByRole('button')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('el foco entra en el primer campo util al abrir y vuelve al boton de la fila al cerrar', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '501')

    // El formulario se monta después de la lectura previa, y al montarse toma el foco.
    expect(field('Horas estimadas')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(rowOf(container, '501')).getByRole('button')).toHaveFocus()
  })

  it('Escape cierra el panel y devuelve el foco a la fila', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '502')

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(rowOf(container, '502')).getByRole('button')).toHaveFocus()
  })

  it('pulsar otra fila cambia el contenido del mismo panel, sin duplicarlo', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '501')

    expect(panel()).toHaveTextContent('501')

    fireEvent.click(within(rowOf(container, '503')).getByRole('button'))

    // Un solo panel, con el ticket nuevo y su foco en el primer campo.
    await waitFor(() => expect(panel()).toHaveTextContent('503'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    // La lectura del ticket nuevo tarda un turno: el foco llega con los campos.
    expect(await screen.findByLabelText('Horas estimadas')).toHaveFocus()
  })

  it('el atajo abre el pendiente en el mismo panel y no lo duplica', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)

    fireEvent.click(screen.getByRole('button', { name: 'Declarar siguiente pendiente' }))
    await screen.findByRole('button', { name: 'Guardar' })

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(panel()).toHaveTextContent('502')
  })
})
})
