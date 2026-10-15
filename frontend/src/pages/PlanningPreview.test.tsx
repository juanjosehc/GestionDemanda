import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PlanningPreview } from '@/pages/PlanningPreview'
import { declarationsFixture, teamCatalogFixture } from '@/test/fixtures'
import { renderWithClient } from '@/test/render'
import type { DeclarationItem, DeclarationStatus } from '@/types/declarations'
import type { TeamPerson } from '@/types/team'

/**
 * La vista previa del estado de entrada, probada por lo que promete: que sus cifras sean las que el
 * motor va a mirar.
 *
 * **El servidor de esta prueba lanza ante cualquier dirección que no sea una de las dos suyas**, como
 * el de Incidentes: es lo que fija que esta pantalla no pide las métricas del tablero —otro
 * denominador, y el brief pide no duplicar el Dashboard— ni ninguna otra lectura. Si algún día las
 * pidiera, la prueba falla aquí en vez de pasar enseñando una segunda copia del tablero.
 */

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const TEAM_URL = '/api/team'
const DECLARATIONS_PREFIX = '/api/planning-metadata/declarations/'

const ANA = 'dev-001'
const CARLOS = 'dev-002'
const DIANA = 'dev-003'

function person(developerId: string, name: string, glpiId: number): TeamPerson {
  return { developerId, glpiId, name, active: true, sourceType: 'GLPI', operational: true }
}

const ANA_PERSON = person(ANA, 'Ana Perez', 101)
const CARLOS_PERSON = person(CARLOS, 'Carlos Ruiz', 102)
const DIANA_PERSON = person(DIANA, 'Diana Lopez', 103)

const PEOPLE: readonly TeamPerson[] = [ANA_PERSON, CARLOS_PERSON, DIANA_PERSON]

/** Los cinco estados, en el orden en que la tabla los publica. */
const BUCKETS: readonly DeclarationStatus[] = [
  'PLANIFICABLE',
  'SIN_ESTIMACION',
  'SIN_COMPROMISO',
  'SIN_DECLARACION',
  'NO_TRADUCIBLE',
]

/**
 * Un ticket con el estado de declaración que el caso necesita, sacado del fixture que ya trae los
 * cinco.
 *
 * **No se construye a mano.** Los `discards` y la fila declarada del fixture son los que el backend
 * produce de verdad —cada parcial nombra el campo que le falta y trae su fila, `SIN_DECLARACION` no
 * tiene fila y nombra las dos carencias, y `NO_TRADUCIBLE` no tiene ni tipo ni estado—, así que
 * inventarse el estado aquí haría que la prueba afirmara sobre datos que el backend no genera.
 */
function ticketWith(status: DeclarationStatus, workItemId: string): DeclarationItem {
  const item = declarationsFixture().items.find((one) => one.declarationStatus === status)

  if (!item) {
    throw new Error(`El fixture no trae ningún ticket en ${status}`)
  }

  return { ...item, workItemId }
}

/**
 * Sirve las dos únicas lecturas de la pantalla: el padrón y el trabajo de cada persona.
 *
 * `failing` marca a quién se le responde con un error, que es como se prueba que una lectura caída no
 * se lleve por delante a las demás.
 */
function serve({
  work = {},
  people = PEOPLE,
  failing = [],
}: {
  work?: Record<string, DeclarationItem[]>
  people?: readonly TeamPerson[]
  failing?: readonly string[]
} = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (url === TEAM_URL) {
      return Promise.resolve(okResponse(teamCatalogFixture({ people: [...people] })))
    }

    if (url.startsWith(DECLARATIONS_PREFIX)) {
      const developerId = url.slice(DECLARATIONS_PREFIX.length)

      if (failing.includes(developerId)) {
        return Promise.resolve(errorResponse(500, { message: 'GLPI no responde' }))
      }

      return Promise.resolve(
        okResponse(
          declarationsFixture({ developer: { id: developerId, name: null }, items: work[developerId] ?? [] }),
        ),
      )
    }

    throw new Error(`Peticion inesperada: ${url}`)
  })
}

/**
 * Monta la pantalla y espera a su contenido: el titular solo se pinta cuando ya hay lecturas que
 * enseñar, así que esperarlo es esperar a que las consultas hayan llegado.
 */
async function preview() {
  const { container } = renderWithClient(<PlanningPreview />)

  await screen.findByText('Estado de entrada, persona a persona')

  return container
}

function figureOf(container: HTMLElement, slot: string): number {
  const cell = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)

  if (!cell) {
    throw new Error(`No hay cifra "${slot}"`)
  }

  return Number(cell.textContent)
}

function verdictOf(container: HTMLElement): HTMLElement {
  const sentence = container.querySelector<HTMLElement>('[data-slot="plan-verdict"]')

  if (!sentence) {
    throw new Error('No hay frase de veredicto')
  }

  return sentence
}

function rowsOf(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="entry-person-row"]')]
}

function rowOf(container: HTMLElement, developerId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-slot="entry-person-row"][data-developer="${developerId}"]`,
  )

  if (!row) {
    throw new Error(`No hay fila para "${developerId}"`)
  }

  return row
}

/** El cajón de un estado dentro de una fila: la cifra y el estado al que pertenece, sin contar. */
function bucketOf(row: HTMLElement, status: DeclarationStatus): number {
  const cell = row.querySelector<HTMLElement>(
    `[data-slot="entry-bucket"][data-declaration="${status}"]`,
  )

  if (!cell) {
    throw new Error(`La fila no trae el cajón "${status}"`)
  }

  return Number(cell.textContent)
}

/** Los cinco cajones de una fila, sumados. */
function bucketsSum(row: HTMLElement): number {
  return BUCKETS.reduce((total, status) => total + bucketOf(row, status), 0)
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('el estado de entrada del plan', () => {
  it('un ticket planificable cuenta como entrada del motor y no ofrece bloqueadores', async () => {
    serve({ work: { [ANA]: [ticketWith('PLANIFICABLE', '908')] }, people: [ANA_PERSON] })

    const container = await preview()

    expect(figureOf(container, 'preview-plannable')).toBe(1)
    expect(figureOf(container, 'preview-blocked')).toBe(0)
    expect(verdictOf(container)).toHaveTextContent('1 elemento planificable')
    expect(verdictOf(container)).toHaveTextContent('producirá un plan')

    // Y el límite se nombra en la misma frase: la pantalla explica la entrada, no las reglas.
    expect(verdictOf(container)).toHaveTextContent('que esta pantalla no publica')

    const row = rowOf(container, ANA)
    expect(row).toHaveAttribute('data-plannable', '1')
    expect(bucketOf(row, 'PLANIFICABLE')).toBe(1)
    expect(within(row).queryByRole('link', { name: /bloquean/ })).toBeNull()
  })

  it('un ticket sin estimación no cuenta como planificable y su fila lleva a los pendientes', async () => {
    serve({ work: { [ANA]: [ticketWith('SIN_ESTIMACION', '907')] }, people: [ANA_PERSON] })

    const container = await preview()

    expect(figureOf(container, 'preview-plannable')).toBe(0)
    expect(figureOf(container, 'preview-without-estimation')).toBe(1)
    expect(figureOf(container, 'preview-blocked')).toBe(1)

    // El veredicto dice que el plan saldría vacío y nombra la causa, en vez de decir que no hay
    // trabajo: hay trabajo, y está bloqueado.
    expect(verdictOf(container)).toHaveTextContent('no recibiría ningún elemento planificable')
    expect(verdictOf(container)).toHaveTextContent('de 1 ticket activo, 1 sin estimación')

    // Quién bloquea se ve aquí; qué bloquea, en Incidentes, con el filtro ya puesto y el modo
    // con él para que la fila siga visible al otro lado.
    expect(within(rowOf(container, ANA)).getByRole('link', { name: /bloquean/ })).toHaveAttribute(
      'href',
      '/incidentes?persona=dev-001&declaracion=PENDIENTE',
    )
  })

  it('sin compromiso no se confunde con sin estimación: cada carencia tiene su cajón', async () => {
    serve({ work: { [ANA]: [ticketWith('SIN_COMPROMISO', '906')] }, people: [ANA_PERSON] })

    const container = await preview()

    expect(figureOf(container, 'preview-without-commitment')).toBe(1)
    expect(figureOf(container, 'preview-without-estimation')).toBe(0)

    const row = rowOf(container, ANA)
    expect(bucketOf(row, 'SIN_COMPROMISO')).toBe(1)
    expect(bucketOf(row, 'SIN_ESTIMACION')).toBe(0)
  })

  it('los cinco cajones de una persona con mezcla suman sus activos, sin solaparse', async () => {
    serve({
      work: {
        [ANA]: [
          ticketWith('PLANIFICABLE', '901'),
          ticketWith('SIN_ESTIMACION', '902'),
          ticketWith('SIN_COMPROMISO', '903'),
          ticketWith('SIN_DECLARACION', '904'),
          ticketWith('NO_TRADUCIBLE', '905'),
        ],
      },
      people: [ANA_PERSON],
    })

    const container = await preview()

    const row = rowOf(container, ANA)
    expect(row).toHaveAttribute('data-active', '5')
    expect(bucketsSum(row)).toBe(5)
    expect(bucketOf(row, 'PLANIFICABLE')).toBe(1)

    // Los no planificables son los otros cuatro, y `NO_TRADUCIBLE` no entra en lo que se arregla
    // declarando: no es un campo que falte, es un tipo que el contrato no sabe leer.
    expect(Number(row.querySelector('[data-slot="entry-blocked"]')?.textContent)).toBe(4)
    expect(figureOf(container, 'preview-needing-people')).toBe(1)
    expect(figureOf(container, 'preview-ready-people')).toBe(1)
  })

  it('el resumen del equipo cuadra con las filas y con el veredicto', async () => {
    serve({
      work: {
        [ANA]: [ticketWith('PLANIFICABLE', '901'), ticketWith('SIN_DECLARACION', '904')],
        [CARLOS]: [ticketWith('NO_TRADUCIBLE', '905')],
      },
    })

    const container = await preview()

    const rows = rowsOf(container)
    const activosDeLasFilas = rows.reduce((total, row) => total + Number(row.dataset.active), 0)
    const cajonesDeLasFilas = rows.reduce((total, row) => total + bucketsSum(row), 0)

    // Las tres cuentas son la misma: la tabla, el reparto del resumen y el total.
    expect(activosDeLasFilas).toBe(3)
    expect(cajonesDeLasFilas).toBe(3)
    expect(figureOf(container, 'preview-active')).toBe(3)

    // Y el veredicto sale de esas cifras, no de otra cuenta.
    expect(verdictOf(container)).toHaveTextContent('1 elemento planificable listo')
    expect(verdictOf(container)).toHaveTextContent('en 1 persona')
  })

  it('sin trabajo no se lee como un fallo de lectura: son dos estados distintos', async () => {
    serve()

    const container = await preview()

    expect(verdictOf(container)).toHaveTextContent('No hay nada que planificar hoy')
    expect(verdictOf(container)).toHaveTextContent('se preguntó por 3 personas')
    expect(screen.queryByText(/No se pudo leer el trabajo de nadie/)).toBeNull()
    expect(rowsOf(container)).toHaveLength(0)
  })

  it('no lee de más: solo el padrón y la declaración de cada persona, y solo lecturas', async () => {
    serve({ work: { [ANA]: [ticketWith('PLANIFICABLE', '908')] } })

    await preview()

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      method: init?.method ?? 'GET',
    }))

    expect(calls.map((call) => call.url)).toEqual([
      TEAM_URL,
      `${DECLARATIONS_PREFIX}${ANA}`,
      `${DECLARATIONS_PREFIX}${CARLOS}`,
      `${DECLARATIONS_PREFIX}${DIANA}`,
    ])
    expect(calls.some((call) => call.url.includes('/metrics'))).toBe(false)
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('un fallo de lectura deja fuera a esa persona y no borra a las demás', async () => {
    serve({
      work: { [ANA]: [ticketWith('PLANIFICABLE', '901')], [CARLOS]: [ticketWith('SIN_ESTIMACION', '902')] },
      failing: [DIANA],
    })

    const container = await preview()

    expect(screen.getByText(/No fue posible leer el trabajo de 1 de las 3 personas/)).toBeInTheDocument()

    // Diana no tiene fila y sus tickets no cuentan en las cifras: un cero afirmaría que no tiene
    // carga, y lo que pasó es que nadie pudo preguntarle. El orden es el de la tabla —bloqueadores
    // de arriba abajo—, así que Carlos, que es quien bloquea, va antes que Ana.
    expect(rowsOf(container).map((row) => row.dataset.developer)).toEqual([CARLOS, ANA])
    expect(container.querySelector('[data-developer="dev-003"]')).toBeNull()
    expect(figureOf(container, 'preview-active')).toBe(2)
    expect(container.querySelector('[data-slot="preview-people"]')?.textContent).toBe('2 de 3')
  })
})
