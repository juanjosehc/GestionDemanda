import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Renegotiations } from '@/pages/Renegotiations'
import {
  ACORDADO_ID,
  PENDIENTE_ID,
  REMOVIDO_ID,
  renegotiationHistoryFixture,
  renegotiationsFixture,
} from '@/test/fixtures'
import { renderWithClient } from '@/test/render'
import type { RenegotiationStatus } from '@/types/renegotiations'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()

const LIST_URL = '/api/renegotiations'
const CREATE_URL = '/api/renegotiations'
const detail = (workItemId: string) => `/api/renegotiations/${workItemId}`
const history = (workItemId: string) => `/api/renegotiations/${workItemId}/history`

/**
 * Los dos mensajes que el backend produce de verdad, copiados de sus excepciones.
 *
 * No se inventan aqui: la prueba de que la pantalla no reescribe un error afirmaria algo sobre un
 * texto que el servidor nunca manda si estos no fueran los suyos.
 */
const NOT_FOUND_MESSAGE = `No hay renegociacion registrada para el elemento de trabajo ${ACORDADO_ID}`
const CONFLICT_MESSAGE =
  `Ya hay renegociacion registrada para el elemento de trabajo ${PENDIENTE_ID}; ` +
  'para modificarla se usa PUT'

/** Lo que `fetch` devuelve en estas pruebas: solo se usan `ok`, `status` y `json()`. */
type Served = { ok: boolean; status: number; json: () => Promise<unknown> }

function okResponse(body: unknown, status = 200): Served {
  return { ok: true, status, json: async () => body }
}

/** El contrato `ApiError` del backend: la pantalla enseña `message` tal cual. */
function errorResponse(status: number, message: string): Served {
  return { ok: false, status, json: async () => ({ status, message }) }
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
  /** La lectura consolidada, por `GET`. Es la unica fuente de la tabla. */
  list?: Served | Served[]
  /** El acuerdo de un requerimiento, por `GET`: lo que el formulario lee antes de escribir. */
  detail?: Served | Served[]
  /** El historial de un requerimiento, por `GET`. */
  history?: Served | Served[]
  /** La respuesta de la escritura, sea `POST` o `PUT`. */
  write?: Served | Served[]
}

/**
 * Sirve por direccion y metodo.
 *
 * El metodo importa porque dos rutas son la misma para operaciones distintas: la del requerimiento
 * sirve para leerlo antes de modificarlo (`GET`) y para reemplazarlo (`PUT`), y la coleccion para
 * listarla (`GET`) y para crear (`POST`). Una peticion que no este en la tabla falla con su nombre en
 * vez de devolver algo parecido: es lo que convierte «la pantalla pidio otra cosa» en una prueba que
 * se cae —y lo que prueba que no hay una peticion por fila—.
 */
function serve({ list, detail: read, history: log, write }: Routes) {
  const listado = queue(list ?? okResponse(renegotiationsFixture()))
  const acuerdo = queue(read ?? okResponse(renegotiationsFixture().items[0]?.renegotiation))
  const historial = queue(log ?? okResponse(renegotiationHistoryFixture()))
  const guardado = queue(write ?? okResponse(renegotiationsFixture().items[0]?.renegotiation))

  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (url === LIST_URL && method === 'GET') {
      return Promise.resolve(listado())
    }
    if (url === CREATE_URL && method === 'POST') {
      return Promise.resolve(guardado())
    }
    if ((url === detail(ACORDADO_ID) || url === detail(REMOVIDO_ID)) && method === 'GET') {
      return Promise.resolve(acuerdo())
    }
    if ((url === detail(ACORDADO_ID) || url === detail(REMOVIDO_ID)) && method === 'PUT') {
      return Promise.resolve(guardado())
    }
    if (url === history(ACORDADO_ID) || url === history(REMOVIDO_ID)) {
      return Promise.resolve(historial())
    }

    throw new Error(`Peticion inesperada: ${method} ${url}`)
  })
}

/**
 * La misma lista con el acuerdo de un requerimiento cambiado: lo que el backend devuelve despues.
 *
 * El resumen se recuenta sobre las filas, como lo cuenta el backend, para que las dos mitades de la
 * respuesta no puedan discrepar —una prueba que afirmara un total que las filas no sostienen
 * afirmaria algo sobre datos que el servidor no produce—.
 */
function conAcuerdo(
  workItemId: string,
  acuerdo: { agreedDate: string; agreedBy: string; status: RenegotiationStatus },
) {
  const items = renegotiationsFixture().items.map((item) =>
    item.workItemId === workItemId
      ? {
          ...item,
          status: acuerdo.status,
          renegotiation: {
            workItemId,
            agreedDate: acuerdo.agreedDate,
            agreedBy: acuerdo.agreedBy,
            agreedAt: '2026-10-08T10:00:00Z',
            source: 'HTTP',
          },
        }
      : item,
  )
  const agreed = items.filter((item) => item.status === 'ACORDADA').length

  return renegotiationsFixture({
    items,
    summary: { displaced: items.length, pending: items.length - agreed, agreed },
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

/** Las peticiones con su metodo, en el orden en que salieron. */
function order(): string[] {
  return fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
}

/**
 * La posicion de una peticion en la traza, por nombre.
 *
 * Se afirma con esto y no con la secuencia entera porque dos consultas que arrancan a la vez —el
 * acuerdo y su historial, al elegir una fila— salen en un orden que no es una decision de la
 * pantalla. Lo que si es una decision es que una peticion vaya **antes** que otra, y eso es lo que
 * estas posiciones comprueban.
 */
function at(call: string): number {
  const index = order().indexOf(call)

  if (index < 0) {
    throw new Error(`No salio la peticion "${call}". Salieron: ${order().join(', ')}`)
  }

  return index
}

function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="renegotiation-row"]')]
}

function rowOf(container: HTMLElement, workItemId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-slot="renegotiation-row"][data-work-item="${workItemId}"]`,
  )

  if (!row) {
    throw new Error(`No hay fila para el requerimiento "${workItemId}"`)
  }

  return row
}

/** Las parejas «de que fecha a que fecha» de los desplazamientos de una fila. */
function eventos(row: HTMLElement): string[] {
  return [...row.querySelectorAll<HTMLElement>('[data-slot="renegotiation-event"]')].map(
    (event) => `${event.getAttribute('data-original')}→${event.getAttribute('data-rescheduled')}`,
  )
}

function cambios(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="history-change"]')]
}

/** Monta la pantalla y aguarda la tabla. */
async function cargar() {
  const view = renderWithClient(<Renegotiations />, { route: '/renegociaciones' })
  await screen.findByText('Requerimientos desplazados')

  return view
}

/**
 * Abre el formulario de una fila por su boton.
 *
 * `espera` es lo que se aguarda a ver: el formulario listo para escribir, o el error de su lectura
 * previa. Abrir una fila tiene dos desenlaces legitimos y la prueba tiene que decir cual mira.
 */
async function abrir(container: HTMLElement, workItemId: string, espera = 'Guardar') {
  const row = rowOf(container, workItemId)
  fireEvent.click(within(row).getByRole('button'))

  return screen.findByRole('button', { name: espera })
}

/** Elige una opcion del filtro de estado, como lo haria una persona. */
function filtrar(value: string) {
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value } })
}

function escribir(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

/** Rellena el formulario y guarda. */
function guardar(agreedDate: string, agreedBy: string) {
  escribir('Nueva fecha acordada', agreedDate)
  escribir('Quién acuerda', agreedBy)
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
}

/** Aguarda a que la fila de un requerimiento traiga una fecha acordada concreta. */
function esperarAcuerdo(container: HTMLElement, workItemId: string, agreedDate: string) {
  return waitFor(() =>
    expect(rowOf(container, workItemId).getAttribute('data-agreed-date')).toBe(agreedDate),
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Renegotiations', () => {
  it('carga la lista consolidada con una sola peticion, sin una por fila', async () => {
    serve({})

    const { container } = await cargar()

    expect(rows(container)).toHaveLength(3)

    // Una sola lectura para toda la pantalla: es lo que descarta el N+1. El acuerdo y el historial de
    // cada fila no se piden hasta que alguien la elige.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls(LIST_URL)).toHaveLength(1)
    expect(writes('POST')).toHaveLength(0)
    expect(writes('PUT')).toHaveLength(0)

    // Los tres numeros son los del backend, contados sobre las mismas filas que hay debajo.
    expect(
      screen.getByText('Desplazados: 3 · Pendientes: 2 · Acordadas: 1'),
    ).toBeInTheDocument()
  })

  it('con la lista vacia lo declara, sin tabla y sin inventar filas', async () => {
    serve({
      list: okResponse(
        renegotiationsFixture({ items: [], summary: { displaced: 0, pending: 0, agreed: 0 } }),
      ),
    })

    renderWithClient(<Renegotiations />, { route: '/renegociaciones' })
    await screen.findByText('Ningún requerimiento está desplazado')

    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    // Una lista vacia es una respuesta completa: no es un error y no se pide nada mas.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('filtra los pendientes usando el estado que publico el backend', async () => {
    serve({})

    const { container } = await cargar()
    filtrar('PENDIENTE_DE_ACUERDO')

    expect(rows(container).map((row) => row.getAttribute('data-work-item'))).toEqual([
      PENDIENTE_ID,
      REMOVIDO_ID,
    ])
    expect(rows(container).map((row) => row.getAttribute('data-status'))).toEqual([
      'PENDIENTE_DE_ACUERDO',
      'PENDIENTE_DE_ACUERDO',
    ])

    // `REQ-3` esta pendiente **y** tiene acuerdo: el filtro lo cuenta como pendiente porque eso es lo
    // que el backend dijo, no porque la vista haya mirado si habia acuerdo.
    expect(rowOf(container, REMOVIDO_ID).getAttribute('data-agreed')).toBe('true')
  })

  it('filtra las acordadas y enseña la fecha, quien la acordó y cuando', async () => {
    serve({})

    const { container } = await cargar()
    filtrar('ACORDADA')

    expect(rows(container)).toHaveLength(1)

    const row = rowOf(container, ACORDADO_ID)
    expect(row.getAttribute('data-status')).toBe('ACORDADA')

    // La fecha acordada y su autor son los del contrato, sin derivar ni reinterpretar.
    expect(row.getAttribute('data-agreed-date')).toBe('2026-10-08')
    expect(row.getAttribute('data-agreed-by')).toBe('ana')

    // Y se pintan formateados, con el sello de registro en su elemento de tiempo.
    expect(within(row).getByText(/8 de oct/)).toBeInTheDocument()
    expect(within(row).getByText('ana')).toBeInTheDocument()
    expect(row.querySelector('time[datetime="2026-10-06T09:30:00Z"]')).not.toBeNull()
  })

  it('crea el acuerdo de un requerimiento que no tenia ninguno', async () => {
    serve({ list: [okResponse(renegotiationsFixture()), okResponse(conAcuerdo(PENDIENTE_ID, {
      agreedDate: '2026-10-12',
      agreedBy: 'ana',
      status: 'ACORDADA',
    }))] })

    const { container } = await cargar()
    await abrir(container, PENDIENTE_ID)

    // Sin acuerdo no hay nada que leer: la creacion no estrena lectura.
    expect(calls(detail(PENDIENTE_ID), 'GET')).toHaveLength(0)

    guardar('2026-10-12', 'ana')
    await esperarAcuerdo(container, PENDIENTE_ID, '2026-10-12')

    // El identificador viaja en el cuerpo del `POST`, no en el camino.
    expect(writes('POST')).toEqual([
      {
        url: CREATE_URL,
        body: { workItemId: PENDIENTE_ID, agreedDate: '2026-10-12', agreedBy: 'ana' },
      },
    ])
    expect(writes('PUT')).toHaveLength(0)

    // La fila refleja lo que el backend devolvio despues: el estado lo recalculo el, no la vista.
    expect(rowOf(container, PENDIENTE_ID).getAttribute('data-status')).toBe('ACORDADA')
    expect(screen.getByText('Desplazados: 3 · Pendientes: 1 · Acordadas: 2')).toBeInTheDocument()
  })

  it('reemplaza el acuerdo existente con PUT, y lo hace despues de leerlo', async () => {
    serve({
      list: [
        okResponse(renegotiationsFixture()),
        okResponse(
          conAcuerdo(ACORDADO_ID, {
            agreedDate: '2026-10-15',
            agreedBy: 'carlos',
            status: 'ACORDADA',
          }),
        ),
      ],
    })

    const { container } = await cargar()
    await abrir(container, ACORDADO_ID)

    guardar('2026-10-15', 'carlos')
    await esperarAcuerdo(container, ACORDADO_ID, '2026-10-15')

    // Leer antes de escribir: la lectura del recurso sale antes que su reemplazo.
    expect(at(`GET ${detail(ACORDADO_ID)}`)).toBeLessThan(at(`PUT ${detail(ACORDADO_ID)}`))

    // El identificador va en el camino y no se repite en el cuerpo.
    expect(writes('PUT')).toEqual([
      { url: detail(ACORDADO_ID), body: { agreedDate: '2026-10-15', agreedBy: 'carlos' } },
    ])
    expect(writes('POST')).toHaveLength(0)
  })

  it('precarga la fecha del recurso leido, no la que traia la lista', async () => {
    // El recurso cambio despues de que se generara la lectura consolidada: la lista dice una fecha y
    // el recurso dice otra. Es lo que distingue «leer antes de reemplazar» de «reemplazar a ciegas».
    serve({
      detail: okResponse({
        workItemId: ACORDADO_ID,
        agreedDate: '2026-10-09',
        agreedBy: 'ana',
        agreedAt: '2026-10-06T09:30:00Z',
        source: 'HTTP',
      }),
    })

    const { container } = await cargar()
    expect(rowOf(container, ACORDADO_ID).getAttribute('data-agreed-date')).toBe('2026-10-08')

    await abrir(container, ACORDADO_ID)

    // La fecha que se va a reemplazar es la de la lectura fresca, y se enseña antes de escribirla.
    expect(screen.getByLabelText('Nueva fecha acordada')).toHaveValue('2026-10-09')
    expect(screen.getByText('Fecha anterior')).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="previous-date"]')?.textContent,
    ).toContain('9 de oct')
  })

  it('enseña el historial tal como lo publica el backend, en su orden', async () => {
    serve({})

    const { container } = await cargar()
    await abrir(container, ACORDADO_ID)
    await waitFor(() => expect(cambios(container)).toHaveLength(2))

    // El historial se pide a su propia ruta, y solo al elegir la fila.
    expect(calls(history(ACORDADO_ID))).toHaveLength(1)

    // Dos entradas, en el orden en que llegaron: la vista no las reordena ni las reconstruye.
    expect(cambios(container).map((change) => change.getAttribute('data-new'))).toEqual([
      '2026-10-06',
      '2026-10-08',
    ])

    // La primera no tiene fecha anterior: es el primer acuerdo, y se dice en vez de dejarlo en blanco.
    expect(cambios(container)[0]?.getAttribute('data-previous')).toBe('')
    expect(
      within(cambios(container)[0] as HTMLElement).getByText(/primer acuerdo/),
    ).toBeInTheDocument()
    expect(within(cambios(container)[1] as HTMLElement).getByText(/por carlos/)).toBeInTheDocument()
  })

  it('no pide el historial de un requerimiento que no tiene acuerdo', async () => {
    serve({})

    const { container } = await cargar()
    await abrir(container, PENDIENTE_ID)

    await screen.findByText('Todavía no hay acuerdo registrado')

    // Sin acuerdo no hay historial que leer: la ruta responde 404 y ese 404 es el estado normal de un
    // requerimiento desplazado que nadie ha renegociado todavia.
    expect(calls(history(PENDIENTE_ID))).toHaveLength(0)
    expect(calls(detail(PENDIENTE_ID), 'GET')).toHaveLength(0)
  })

  it('invalida solo la lista, el detalle afectado y el historial afectado', async () => {
    serve({
      list: [
        okResponse(renegotiationsFixture()),
        okResponse(
          conAcuerdo(ACORDADO_ID, {
            agreedDate: '2026-10-15',
            agreedBy: 'carlos',
            status: 'ACORDADA',
          }),
        ),
      ],
    })

    const { container } = await cargar()
    await abrir(container, ACORDADO_ID)

    guardar('2026-10-15', 'carlos')
    await esperarAcuerdo(container, ACORDADO_ID, '2026-10-15')

    // La lista se relee —de ahi sale el estado de la fila— y el historial tambien, porque sigue a la
    // vista. El detalle no: el formulario se cerro, asi que se marca obsoleto sin volver a pedirlo.
    expect(calls(LIST_URL)).toHaveLength(2)
    expect(calls(detail(ACORDADO_ID), 'GET')).toHaveLength(1)
    expect(calls(history(ACORDADO_ID))).toHaveLength(2)

    // Nada de las otras filas, y ninguna ruta ajena a la escritura. Tampoco se recarga la pagina.
    const traza = order().join(' ')
    expect(traza).not.toContain(PENDIENTE_ID)
    expect(traza).not.toContain(REMOVIDO_ID)
    expect(traza).not.toContain('/api/planning')
  })

  it('enseña el 404 del backend tal cual cuando la fila traia un acuerdo que ya no esta', async () => {
    serve({ detail: errorResponse(404, NOT_FOUND_MESSAGE) })

    const { container } = await cargar()
    await abrir(container, ACORDADO_ID, 'Reintentar')

    await screen.findByText('No fue posible leer el acuerdo')

    // El mensaje es el del servidor, sin reinterpretar.
    expect(screen.getByText(NOT_FOUND_MESSAGE)).toBeInTheDocument()

    // Y no se cae al `POST` por cuenta propia: eso crearia un acuerdo que la fila decia que existia.
    expect(writes('POST')).toHaveLength(0)
    expect(writes('PUT')).toHaveLength(0)
  })

  it('enseña el 409 del backend tal cual y no reintenta con PUT', async () => {
    serve({ write: errorResponse(409, CONFLICT_MESSAGE) })

    const { container } = await cargar()
    await abrir(container, PENDIENTE_ID)

    guardar('2026-10-12', 'ana')
    await screen.findByText(CONFLICT_MESSAGE)

    // El camino que el mensaje propone —ir a `PUT`— lo decide quien lo lee, no la pantalla.
    expect(writes('POST')).toHaveLength(1)
    expect(writes('PUT')).toHaveLength(0)
  })

  it('no recalcula el estado: pinta el del backend aunque el acuerdo exista', async () => {
    serve({})

    const { container } = await cargar()

    // `REQ-3` se movio despues de haberse acordado: el backend lo publica pendiente **y** con su
    // acuerdo. La vista enseña las dos cosas y no elige por su cuenta.
    const row = rowOf(container, REMOVIDO_ID)
    expect(row.getAttribute('data-status')).toBe('PENDIENTE_DE_ACUERDO')
    expect(row.getAttribute('data-agreed')).toBe('true')
    expect(row.getAttribute('data-agreed-by')).toBe('carlos')

    // Las dos parejas de fechas son las que el plan audito, en su orden, sin compararlas con el
    // acuerdo ni resumirlas en una sola.
    expect(eventos(row)).toEqual(['2026-10-06→2026-10-07', '2026-10-07→2026-10-09'])

    // El verbo lo decide la existencia del acuerdo y no el estado: hay recurso que reemplazar.
    expect(within(row).getByRole('button', { name: 'Editar acuerdo' })).toBeInTheDocument()
  })

  it('escribe con PUT en un requerimiento pendiente que ya tiene acuerdo', async () => {
    serve({
      list: [
        okResponse(renegotiationsFixture()),
        okResponse(
          conAcuerdo(REMOVIDO_ID, {
            agreedDate: '2026-10-20',
            agreedBy: 'ana',
            status: 'ACORDADA',
          }),
        ),
      ],
    })

    const { container } = await cargar()
    await abrir(container, REMOVIDO_ID)

    guardar('2026-10-20', 'ana')
    await esperarAcuerdo(container, REMOVIDO_ID, '2026-10-20')

    // Si el verbo saliera del estado visual, esto seria un `POST` contra un recurso que ya existe.
    expect(writes('PUT')).toEqual([
      { url: detail(REMOVIDO_ID), body: { agreedDate: '2026-10-20', agreedBy: 'ana' } },
    ])
    expect(writes('POST')).toHaveLength(0)
  })

  it('aplica los filtros en memoria, sin volver a consultar nada', async () => {
    serve({})

    const { container } = await cargar()
    const antes = fetchMock.mock.calls.length

    filtrar('ACORDADA')
    expect(rows(container)).toHaveLength(1)

    filtrar('PENDIENTE_DE_ACUERDO')
    expect(rows(container)).toHaveLength(2)

    filtrar('TODOS')
    expect(rows(container)).toHaveLength(3)

    // Tres cambios de filtro, cero peticiones: el filtro trabaja sobre lo ya recibido.
    expect(fetchMock.mock.calls.length).toBe(antes)
  })

  it('declara cuando el filtro deja fuera a todas las filas, sin pintar una tabla vacia', async () => {
    serve({
      list: okResponse(
        renegotiationsFixture({
          summary: { displaced: 3, pending: 0, agreed: 3 },
          items: renegotiationsFixture().items.map((item) => ({
            ...item,
            status: 'ACORDADA' as const,
          })),
        }),
      ),
    })

    const { container } = await cargar()
    filtrar('PENDIENTE_DE_ACUERDO')

    expect(rows(container)).toHaveLength(0)
    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByText('Ningún requerimiento coincide con el filtro')).toBeInTheDocument()

    // Y sigue sin pedir nada: el filtro no vuelve a consultar.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
