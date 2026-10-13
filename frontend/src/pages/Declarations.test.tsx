import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Declarations } from '@/pages/Declarations'
import {
  DECLARATION_DEVELOPER_ID,
  declarationItemFixture,
  declarationsFixture,
  planningMetadataFixture,
} from '@/test/fixtures'
import { renderWithClient } from '@/test/render'
import type { DeclarationStatus } from '@/types/declarations'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()

const LIST_URL = `/api/planning-metadata/declarations/${DECLARATION_DEVELOPER_ID}`
const ITEM_URL = '/api/planning-metadata/501'
const CREATE_URL = '/api/planning-metadata'

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
function serve({ declarations, declaration, write }: Routes) {
  const list = queue(declarations ?? okResponse(declarationsFixture()))
  const read = queue(declaration ?? okResponse(planningMetadataFixture()))
  const saved = queue(write ?? okResponse(planningMetadataFixture()))

  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (url === LIST_URL && method === 'GET') {
      return Promise.resolve(list())
    }
    if (url === ITEM_URL && method === 'GET') {
      return Promise.resolve(read())
    }
    if (url === ITEM_URL && method === 'PUT') {
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

/**
 * Consulta los tickets de un tecnico, como lo haria una persona: escribe y envia.
 *
 * `espera` es lo que se aguarda a ver: la tabla, o el vacio declarado. Una consulta tiene dos
 * desenlaces legitimos y la prueba tiene que decir cual esta mirando.
 */
async function consultar(container: HTMLElement, espera = 'Tickets asignados') {
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

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
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

    // Una sola lectura, la del listado consolidado. Y ninguna escritura: consultar no declara nada.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls(LIST_URL)).toHaveLength(1)
    expect(writes('POST')).toHaveLength(0)
    expect(writes('PUT')).toHaveLength(0)

    // El nombre lo pone GLPI; la pantalla no lo compone.
    expect(screen.getByText('Ana Perez')).toBeInTheDocument()
    expect(screen.getByText(/5 tickets asignados/)).toBeInTheDocument()
  })

  it('con un tecnico sin tickets lo declara, sin tabla y sin inventar filas', async () => {
    serve({ declarations: okResponse(declarationsFixture({ items: [] })) })

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container, 'Este técnico no tiene tickets asignados')

    expect(container.querySelector('table')).toBeNull()
    expect(rows(container)).toHaveLength(0)

    // Una lista vacia es una respuesta completa: no es un error y no se pide nada mas.
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

    // Los motivos son los del backend, con su codigo al lado: la pantalla no los reescribe.
    const sinDeclaracion = rowOf(container, '504')
    expect(
      within(sinDeclaracion).getAllByText('no hay planificacion declarada para este elemento'),
    ).toHaveLength(2)
    expect(within(sinDeclaracion).getByText('SIN_ESTIMACION_DECLARADA')).toBeInTheDocument()
    expect(within(sinDeclaracion).getByText('SIN_COMPROMISO_DECLARADO')).toBeInTheDocument()

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

    await screen.findByText('Ana Perez')

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

    // Abrir el formulario solo lee: la lista del tecnico y despues el recurso del ticket, en ese
    // orden. Todavia no hay ninguna escritura.
    expect(order()).toEqual([`GET ${LIST_URL}`, `GET ${ITEM_URL}`])

    escribir('Quién declara', 'carlos')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await screen.findByText('Ana Perez')

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

    // La conversación entera, en orden: la lista, la lectura previa, la escritura y la relectura de
    // la lista. Ni una peticion mas: no se recargo la pantalla ni se toco nada que no fuera esto.
    expect(order()).toEqual([
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

    await screen.findByText('Ana Perez')

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
})
