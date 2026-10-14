import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAlerts } from '@/hooks/useAlerts'
import { usePlanningMetrics } from '@/hooks/usePlanningMetrics'
import { useRenegotiations } from '@/hooks/useRenegotiations'
import { Planning } from '@/pages/Planning'
import {
  GENERATED_DEVELOPER_ID,
  GENERATED_PLAN_ID,
  alertsFixture,
  planningFromGlpiFixture,
  planningMetricsFixture,
  renegotiationsFixture,
} from '@/test/fixtures'
import { renderWithClient } from '@/test/render'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()

const GENERATE_URL = '/api/planning/from-glpi'
const METRICS_URL = '/api/planning/metrics'
const ALERTS_URL = '/api/planning/alerts'
const RENEGOTIATIONS_URL = '/api/renegotiations'

/**
 * El 404 que el backend produce de verdad, copiado de su excepcion.
 *
 * No se inventa aqui: la prueba de que la pantalla no reescribe un error afirmaria algo sobre un texto
 * que el servidor nunca manda si este no fuera el suyo.
 */
const NOT_FOUND_MESSAGE = `GLPI no tiene un usuario con identificador ${GENERATED_DEVELOPER_ID}`

/**
 * El 503, con la forma que arma el cliente de GLPI —«No fue posible alcanzar GLPI en <url> durante
 * <operacion>: <causa>»—.
 *
 * La causa es de las que produce un fallo de red de verdad. Lo que esta prueba afirma no es el texto
 * —que depende de la red de cada instalacion— sino que la pantalla repite el que llegue, sin
 * sustituirlo por uno propio.
 */
const UNAVAILABLE_MESSAGE =
  'No fue posible alcanzar GLPI en http://glpi.local/apirest.php durante la lectura del tecnico ' +
  `${GENERATED_DEVELOPER_ID}: Connection refused`

/** Lo que `fetch` devuelve en estas pruebas: solo se usan `ok`, `status` y `json()`. */
type Served = { ok: boolean; status: number; json: () => Promise<unknown> }

function okResponse(body: unknown, status = 200): Served {
  return { ok: true, status, json: async () => body }
}

/** El contrato `ApiError` del backend: la pantalla enseña `message` tal cual. */
function errorResponse(status: number, message: string): Served {
  return { ok: false, status, json: async () => ({ status, message }) }
}

/** Sirve una respuesta, o varias en orden —la ultima se repite—. */
function queue(responses: Served | Served[]): () => Served {
  const list = Array.isArray(responses) ? [...responses] : [responses]

  return () => (list.length > 1 ? (list.shift() as Served) : (list[0] as Served))
}

interface Routes {
  /** La generacion, por `POST`. */
  generate?: Served | Served[]
  /** La fotografia operativa, por `GET`. */
  metrics?: Served | Served[]
  /** El centro de alertas, por `GET`. */
  alerts?: Served | Served[]
  /** La lista consolidada de renegociaciones, por `GET`. */
  list?: Served | Served[]
}

/**
 * Sirve por direccion y metodo.
 *
 * El metodo importa porque la coleccion de renegociaciones es la misma direccion para leerla (`GET`) y
 * para crear (`POST`): una peticion que no este en la tabla falla con su nombre en vez de devolver algo
 * parecido, y eso es lo que convierte «la pantalla pidio otra cosa» en una prueba que se cae.
 */
function serve({ generate, metrics, alerts, list }: Routes) {
  const plan = queue(generate ?? okResponse(planningFromGlpiFixture()))
  const fotografia = queue(metrics ?? okResponse(planningMetricsFixture()))
  const alertas = queue(alerts ?? okResponse(alertsFixture()))
  const lista = queue(list ?? okResponse(renegotiationsFixture()))

  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (url === GENERATE_URL && method === 'POST') {
      return Promise.resolve(plan())
    }
    if (url === METRICS_URL && method === 'GET') {
      return Promise.resolve(fotografia())
    }
    if (url === ALERTS_URL && method === 'GET') {
      return Promise.resolve(alertas())
    }
    if (url === RENEGOTIATIONS_URL && method === 'GET') {
      return Promise.resolve(lista())
    }

    throw new Error(`Peticion inesperada: ${method} ${url}`)
  })
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

/** Las generaciones, con su cuerpo ya leido, para afirmar lo que se envio. */
function posts() {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) as unknown }))
}

function escribirTecnico(value: string) {
  fireEvent.change(screen.getByLabelText('Técnico'), { target: { value } })
}

/** Escribe el identificador y pulsa el boton, como lo haria una persona. */
async function generar(value = GENERATED_DEVELOPER_ID) {
  escribirTecnico(value)
  fireEvent.click(screen.getByRole('button', { name: /Generar plan/ }))

  return screen.findByText('Plan generado')
}

/** El texto de una casilla del resultado, por su costura. */
function figura(container: HTMLElement, slot: string): string {
  return container.querySelector(`[data-slot="${slot}"]`)?.textContent ?? ''
}

function descartes(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="discarded-ticket"]')]
}

/**
 * La pantalla con las tres lecturas que dependen del plan vigente montadas al lado.
 *
 * Hace falta para poder **observar** la invalidacion: `invalidateQueries` solo vuelve a pedir lo que
 * esta activo, asi que una consulta que nadie tiene montada se marca obsoleta sin salir a la red —y
 * entonces la prueba no podria distinguir «no se invalido» de «se invalido y no habia nadie
 * mirando»—. Aqui se montan las tres de verdad, como las tienen el tablero, el centro de alertas y la
 * pantalla de renegociacion, y lo que se afirma es que se releen.
 */
function Harness() {
  usePlanningMetrics()
  useAlerts()
  useRenegotiations()

  return <Planning />
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Planning', () => {
  it('genera el plan invocando el endpoint que ya existia, con el tecnico en el cuerpo', async () => {
    serve({})

    const { container } = renderWithClient(<Planning />, { route: '/planificar' })

    // Abrir la pantalla no genera nada: generar escribe, y eso lo dispara una persona.
    expect(fetchMock).not.toHaveBeenCalled()

    await generar()

    expect(posts()).toEqual([
      { url: GENERATE_URL, body: { developerId: GENERATED_DEVELOPER_ID } },
    ])

    // Lo que devolvio el backend, tal cual: el plan, el tecnico que GLPI reconocio y su sello.
    expect(figura(container, 'generated-plan-id')).toBe(GENERATED_PLAN_ID)
    expect(figura(container, 'generated-developer')).toBe(GENERATED_DEVELOPER_ID)
    expect(container.querySelector('time[datetime="2026-10-13T14:00:00Z"]')).not.toBeNull()

    // Y los tres numeros, contados sobre las listas que llegaron y sin cruzarlos entre si.
    expect(figura(container, 'generated-allocations')).toBe('2')
    expect(figura(container, 'generated-displaced')).toBe('1')
    expect(figura(container, 'generated-conflicts')).toBe('1')
  })

  it('abre el timeline del plan recien generado, sin armar la direccion a mano', async () => {
    serve({})

    renderWithClient(<Planning />, { route: '/planificar' })
    await generar()

    // La direccion sale de la plantilla de la aplicacion, no de un literal escrito aqui: es la misma
    // que usa la tabla de renegociaciones para enlazar un plan.
    expect(screen.getByRole('link', { name: /Abrir timeline/ })).toHaveAttribute(
      'href',
      `/calendario/${GENERATED_PLAN_ID}`,
    )

    // Y los otros tres destinos del flujo son enlaces, no recargas.
    expect(screen.getByRole('link', { name: /Métricas/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /Alertas/ })).toHaveAttribute('href', '/alertas')
    expect(screen.getByRole('link', { name: /Renegociaciones/ })).toHaveAttribute(
      'href',
      '/renegociaciones',
    )
  })

  it('enseña el 404 del backend tal cual, con su estado y sin inventar un resultado', async () => {
    serve({ generate: errorResponse(404, NOT_FOUND_MESSAGE) })

    renderWithClient(<Planning />, { route: '/planificar' })
    escribirTecnico('999')
    fireEvent.click(screen.getByRole('button', { name: /Generar plan/ }))

    await screen.findByText('El backend no pudo generar el plan')

    // El mensaje es el del servidor, sin reinterpretar, y el estado viaja con el.
    expect(screen.getByText(NOT_FOUND_MESSAGE)).toBeInTheDocument()
    expect(screen.getByText('HTTP 404')).toBeInTheDocument()

    // Un fallo no deja un plan en pantalla: no hay ninguno que enseñar.
    expect(screen.queryByText('Plan generado')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Abrir timeline/ })).not.toBeInTheDocument()
  })

  it('enseña un 5xx sin traducirlo ni reintentar por su cuenta', async () => {
    serve({ generate: errorResponse(503, UNAVAILABLE_MESSAGE) })

    renderWithClient(<Planning />, { route: '/planificar' })
    escribirTecnico(GENERATED_DEVELOPER_ID)
    fireEvent.click(screen.getByRole('button', { name: /Generar plan/ }))

    await screen.findByText('El backend no pudo generar el plan')

    // Ni el 503 ni ningun otro se convierte en un mensaje propio: la pantalla repite el que llega.
    expect(screen.getByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument()
    expect(screen.getByText('HTTP 503')).toBeInTheDocument()

    // Un solo intento: no se reintenta solo, porque cada intento guardaria un plan. El reintento lo
    // decide quien lee, y el formulario de arriba sigue ahi con el identificador escrito.
    expect(posts()).toHaveLength(1)
  })

  it('no sale a la red con un identificador vacio, ni escribiendolo ni enviando el formulario', async () => {
    serve({})

    const { container } = renderWithClient(<Planning />, { route: '/planificar' })
    const boton = screen.getByRole('button', { name: /Generar plan/ })
    const formulario = container.querySelector('form') as HTMLFormElement

    // Sin nada escrito no hay nada que generar, y el boton lo dice antes de que se pulse.
    expect(boton).toBeDisabled()

    // Un espacio no es un identificador.
    escribirTecnico('   ')
    expect(boton).toBeDisabled()

    fireEvent.submit(formulario)
    expect(fetchMock).not.toHaveBeenCalled()

    // El backend responderia 400 a una peticion que no hacia falta enviar: el hueco se explica aqui.
    expect(screen.queryByText('El backend no pudo generar el plan')).not.toBeInTheDocument()
  })

  it('refresca las metricas, las alertas y las renegociaciones, y ninguna otra direccion', async () => {
    serve({})

    renderWithClient(<Harness />, { route: '/planificar' })

    // Las tres lecturas que dependen del plan vigente ya estan resueltas antes de generar.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(3))

    await generar()

    // Cada una se relee una vez: la invalidacion alcanza a las tres.
    await waitFor(() => expect(calls(METRICS_URL)).toHaveLength(2))
    expect(calls(ALERTS_URL)).toHaveLength(2)
    expect(calls(RENEGOTIATIONS_URL)).toHaveLength(2)

    // Y nada mas se toco. Ni el timeline —cada plan tiene su propio identificador, asi que el recien
    // creado no tiene nada que releer y el anterior sigue siendo la lectura correcta de *su* plan— ni
    // la salud de GLPI, que es un diagnostico de conectividad y no un dato que un plan nuevo cambie.
    expect(new Set(order())).toEqual(
      new Set([
        `GET ${METRICS_URL}`,
        `GET ${ALERTS_URL}`,
        `GET ${RENEGOTIATIONS_URL}`,
        `POST ${GENERATE_URL}`,
      ]),
    )
  })

  it('lista los descartes tal como llegan, contando causas y no tickets', async () => {
    serve({})

    const { container } = renderWithClient(<Planning />, { route: '/planificar' })
    await generar()

    const filas = descartes(container)

    // Dos filas para el mismo ticket: cada una es una causa, y agrupar por ticket daria 1 donde el
    // backend publica 2.
    expect(filas.map((fila) => fila.getAttribute('data-ticket'))).toEqual(['504', '504'])
    expect(filas.map((fila) => fila.getAttribute('data-code'))).toEqual([
      'SIN_ESTIMACION_DECLARADA',
      'SIN_COMPROMISO_DECLARADO',
    ])

    // El motivo que se enseña es el que redacto el backend, no el codigo de la causa.
    expect(screen.getByText('la planificacion declarada no tiene estimacion')).toBeInTheDocument()
    expect(screen.getByText(/2 descartes/)).toBeInTheDocument()
  })

  it('genera otra vez al mismo tecnico y enseña el plan nuevo, que es otro plan', async () => {
    const segundo = '55555555-5555-5555-5555-555555555555'
    serve({
      generate: [
        okResponse(planningFromGlpiFixture()),
        okResponse(planningFromGlpiFixture({ planId: segundo })),
      ],
    })

    const { container } = renderWithClient(<Planning />, { route: '/planificar' })

    await generar()
    expect(figura(container, 'generated-plan-id')).toBe(GENERATED_PLAN_ID)

    // Volver a planificar al mismo tecnico es lo normal: lo declarado cambio. Cada corrida guarda un
    // plan nuevo, asi que la segunda no reemplaza a la primera —tiene su propio identificador—.
    await generar()
    await screen.findByText(segundo)

    expect(posts()).toHaveLength(2)
    expect(figura(container, 'generated-plan-id')).toBe(segundo)
  })
})
