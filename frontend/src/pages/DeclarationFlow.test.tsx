import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { Declarations } from '@/pages/Declarations'
import { Incidents } from '@/pages/Incidents'
import { ROUTES } from '@/routes/navigation'
import {
  declarationItemFixture,
  declarationsFixture,
  planningMetadataFixture,
  teamCatalogFixture,
} from '@/test/fixtures'
import { renderWithClient } from '@/test/render'
import type { DeclarationItem } from '@/types/declarations'
import type { TeamPerson } from '@/types/team'

/**
 * El recorrido entero: de la lista de trabajo a la declaración y de vuelta.
 *
 * Vive en su propio fichero porque **cruza las dos pantallas**. `Incidents.test.tsx` tiene un
 * servidor que lanza ante cualquier dirección que no sea una de las dos suyas, y aflojarlo para que
 * también sirviera la escritura debilitaría lo que ese fichero fija —que Incidentes no pide nada
 * más—. Las dos pantallas se montan bajo **un solo** `QueryClient`, que es lo que hace que compartan
 * caché y que el flujo se pueda medir de verdad.
 *
 * No se monta `AppRoutes`: `MainLayout` llama a `window.matchMedia`, que el arnés no polyfillea. Las
 * dos rutas que hacen falta se declaran aquí.
 */

const fetchMock = vi.fn()

const TEAM_URL = '/api/team'
const DECLARATIONS_PREFIX = '/api/planning-metadata/declarations/'
const CREATE_URL = '/api/planning-metadata'
const TEAM_TIMELINE_URL = '/api/planning/team/timeline'
const RENEGOTIATIONS_URL = '/api/renegotiations'

/**
 * La política de caché de producción, declarada aquí a propósito.
 *
 * El arnés de las demás pruebas usa caché cero, y con eso **cualquier remontaje relee**: la prueba de
 * que la fila cambia al volver pasaría aunque nadie invalidara nada, porque lo que probaría es que
 * hay una pantalla al final del enlace que lee del servidor. Con la política real —`staleTime` de
 * treinta segundos y una entrada que sobrevive a la navegación— la relectura solo puede venir de la
 * invalidación, que es justo lo que hay que demostrar.
 */
const PRODUCTION_CACHE = { staleTime: 30_000, gcTime: 300_000 }

/** Las personas del padrón, por el papel que juegan en cada caso. */
const ANA = 'dev-001'
const CARLOS = 'dev-002'
const ELENA = 'dev-004'

function person(
  developerId: string,
  name: string,
  glpiId: number,
  operational: boolean,
): TeamPerson {
  return { developerId, glpiId, name, active: true, sourceType: 'GLPI', operational }
}

const ANA_PERSON = person(ANA, 'Ana Perez', 101, true)
const CARLOS_PERSON = person(CARLOS, 'Carlos Ruiz', 102, true)
/** Alguien del grupo de GLPI que **no** está declarado en el equipo operativo. */
const ELENA_PERSON = person(ELENA, 'Elena Vargas', 104, false)

const PEOPLE: readonly TeamPerson[] = [ANA_PERSON, CARLOS_PERSON, ELENA_PERSON]

/** Un ticket al que no le falta una cosa sino todas: el que el atajo tiene que ofrecer. */
function pendiente(workItemId: string): DeclarationItem {
  return declarationItemFixture({
    workItemId,
    title: `Ticket ${workItemId}`,
    declarationStatus: 'SIN_DECLARACION',
    discards: [
      {
        code: 'SIN_ESTIMACION_DECLARADA',
        reason: 'no hay planificacion declarada para este elemento',
      },
      {
        code: 'SIN_FECHA_EN_GLPI',
        reason: 'GLPI no trae ni internal_time_to_resolve ni time_to_resolve',
      },
    ],
    declaration: null,
    operationalDate: null,
    operationalDateSource: null,
  })
}

/** El mismo ticket, ya declarado: es lo que el backend devuelve después de guardar. */
function writeAsDeclared(item: DeclarationItem): DeclarationItem {
  return {
    ...item,
    declarationStatus: 'PLANIFICABLE',
    discards: [],
    declaration: planningMetadataFixture({ workItemId: item.workItemId }),
  }
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

/**
 * El servidor de esta prueba: **con estado**.
 *
 * Lo declarado lo lleva el hecho —se escribió o no— y no el número de llamada. Una cola posicional
 * probaría que la respuesta cambia en la segunda petición, que no es lo mismo que probar que cambia
 * porque se guardó: si el guardado se rompiera, la cola seguiría devolviendo la respuesta buena y la
 * prueba pasaría afirmando lo contrario de lo que dice.
 */
function serve({ work, people = PEOPLE }: { work: Record<string, DeclarationItem[]>; people?: readonly TeamPerson[] }) {
  const declared = new Set<string>()

  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (url === TEAM_URL) {
      return Promise.resolve(okResponse(teamCatalogFixture({ people: [...people] })))
    }

    // Las dos lecturas que Incidentes comparte con el Timeline para las columnas Plan y Acuerdo.
    // Se sirven vacías: este flujo mide la declaración, no el plan, y una tabla sin tramos ni
    // acuerdos deja esas dos columnas en su hueco sin inventar filas.
    if (url === TEAM_TIMELINE_URL) {
      return Promise.resolve(
        okResponse({ from: null, to: null, resources: [], items: [], plans: [], conflicts: [] }),
      )
    }

    if (url === RENEGOTIATIONS_URL) {
      return Promise.resolve(
        okResponse({
          source: 'plan_snapshot',
          scope: 'vigente',
          generatedAt: '2026-10-07T15:00:00Z',
          summary: { displaced: 0, pending: 0, agreed: 0 },
          items: [],
        }),
      )
    }

    if (url.startsWith(DECLARATIONS_PREFIX)) {
      const developerId = url.slice(DECLARATIONS_PREFIX.length)
      const items = (work[developerId] ?? []).map((item) =>
        declared.has(item.workItemId) ? writeAsDeclared(item) : item,
      )

      return Promise.resolve(
        okResponse(
          declarationsFixture({
            developer: {
              id: developerId,
              name: people.find((one) => one.developerId === developerId)?.name ?? null,
            },
            items,
          }),
        ),
      )
    }

    if (url === CREATE_URL && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { workItemId: string }
      declared.add(body.workItemId)

      return Promise.resolve(okResponse(planningMetadataFixture({ workItemId: body.workItemId })))
    }

    throw new Error(`Peticion inesperada: ${method} ${url}`)
  })
}

/** Las dos pantallas del flujo, bajo un solo cliente de consultas. */
function renderFlow(route: string = ROUTES.incidents) {
  return renderWithClient(
    <Routes>
      <Route path={ROUTES.incidents} element={<Incidents />} />
      <Route path={ROUTES.declarations} element={<Declarations />} />
    </Routes>,
    { route, ...PRODUCTION_CACHE },
  )
}

/** Las peticiones con su método, en orden: es lo que atribuye el cambio de estado a su causa. */
function order(): string[] {
  return fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
}

function rowWithSlot(container: HTMLElement, slot: string, workItemId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-slot="${slot}"][data-work-item="${workItemId}"]`,
  )

  if (!row) {
    throw new Error(`No hay fila "${slot}" para el ticket "${workItemId}"`)
  }

  return row
}

function incidentRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="incident-row"]')]
}

/** Aplica un filtro por su etiqueta, como lo haría una persona. */
function chooseFilter(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

/** Espera a la tabla de Incidentes, que es el punto de partida y el de vuelta. */
async function listaDeTrabajo() {
  await screen.findByText('Trabajo activo')
}

/**
 * Espera a que la fila de un ticket esté pintada.
 *
 * La tabla se enseña en cuanto hay una fila, y las demás llegan con su lectura: esperar a la tabla no
 * es esperar a una fila concreta, y afirmar sobre el orden de las peticiones exige que ya hayan salido.
 */
async function esperarFila(container: HTMLElement, workItemId: string) {
  await waitFor(() => rowWithSlot(container, 'incident-row', workItemId))
}

/** Pulsa el atajo de una fila, por su nombre accesible —el único que distingue dos tickets iguales—. */
async function declararDesde(container: HTMLElement, workItemId: string, personName: string) {
  await esperarFila(container, workItemId)

  fireEvent.click(
    within(rowWithSlot(container, 'incident-row', workItemId)).getByRole('link', {
      name: `Declarar el ticket ${workItemId} de ${personName}`,
    }),
  )

  return screen.findByRole('button', { name: 'Guardar' })
}

/** La vuelta, que es la única salida que la pantalla de declaración ofrece. */
async function volverAIncidentes() {
  // El rótulo sale del menú, que desde la Fase 61 nombra esa pantalla «Tickets».
  fireEvent.click(screen.getByRole('link', { name: 'Volver a Tickets' }))

  await listaDeTrabajo()
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('de Incidentes a la declaración y de vuelta', () => {
  it('el atajo abre la declaración del ticket pendiente sin teclear nada', async () => {
    serve({ work: { [ANA]: [pendiente('908')] } })

    const { container } = renderFlow()
    await listaDeTrabajo()

    // Lo que Incidentes ya había pedido, con la fila ya pintada: su lectura está hecha.
    await esperarFila(container, '908')
    const antes = order()

    await declararDesde(container, '908', 'Ana Perez')

    // Se llega con el técnico ya consultado y el formulario ya abierto: los pasos que el atajo
    // ahorra —teclear el identificador, pulsar Consultar y buscar la fila a ojo— no ocurren.
    expect(screen.getByLabelText('Técnico')).toHaveValue(ANA)
    expect(
      within(rowWithSlot(container, 'declaration-row', '908')).getByText('SIN_DECLARACION'),
    ).toBeInTheDocument()

    // Y sin pedir de más: pulsar el atajo no añade ni una petición, porque la declaración de este
    // técnico es la misma lectura que Incidentes ya tenía en caché.
    expect(order()).toEqual(antes)
  })

  it('se vuelve a la lista por su enlace, sin pasar por el menú', async () => {
    serve({ work: { [ANA]: [pendiente('908')] } })

    const { container } = renderFlow()
    await listaDeTrabajo()
    await declararDesde(container, '908', 'Ana Perez')

    await volverAIncidentes()

    expect(incidentRows(container)).toHaveLength(1)
  })

  it('la vuelta conserva el filtro con el que se salió', async () => {
    serve({ work: { [ANA]: [pendiente('908')], [CARLOS]: [pendiente('907')] } })

    const { container } = renderFlow()
    await listaDeTrabajo()

    chooseFilter('Persona', CARLOS)
    expect(incidentRows(container).map((row) => row.getAttribute('data-work-item'))).toEqual(['907'])

    await declararDesde(container, '907', 'Carlos Ruiz')
    await volverAIncidentes()

    // El filtro vuelve puesto: lo que viaja en el enlace es a dónde volver, con la vista tal como
    // estaba en el momento del clic.
    expect(screen.getByLabelText('Persona')).toHaveValue(CARLOS)
    expect(incidentRows(container).map((row) => row.getAttribute('data-work-item'))).toEqual(['907'])
  })

  it('la vuelta conserva el modo: el ticket de quien está fuera del equipo sigue visible', async () => {
    serve({ work: { [ELENA]: [pendiente('909')] } })

    const { container } = renderFlow()
    await listaDeTrabajo()

    // En la vista por defecto Elena no está: es lo que el conmutador decide.
    expect(container.querySelector('[data-developer="dev-004"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todo Desarrollo N2' }))
    await declararDesde(container, '909', 'Elena Vargas')
    await volverAIncidentes()

    // Sin el modo en la vuelta esta fila no estaría, y el estado nuevo no se vería justo en el caso
    // en el que el atajo sirve para algo.
    expect(screen.getByRole('button', { name: 'Mostrar todo Desarrollo N2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(rowWithSlot(container, 'incident-row', '909')).toBeInTheDocument()
  })

  it('al volver, la fila ya está declarada: el cambio se ve sin recargar nada', async () => {
    serve({ work: { [ANA]: [pendiente('908')] }, people: [ANA_PERSON] })

    const { container } = renderFlow()
    await listaDeTrabajo()

    expect(rowWithSlot(container, 'incident-row', '908').getAttribute('data-declaration')).toBe(
      'SIN_DECLARACION',
    )

    await declararDesde(container, '908', 'Ana Perez')

    fireEvent.change(screen.getByLabelText('Horas estimadas'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Quién declara'), { target: { value: 'carlos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    // La declaración se escribe con el verbo que le toca: el ticket no tenía fila, así que es un POST.
    await waitFor(() => expect(order()).toContain(`POST ${CREATE_URL}`))

    await volverAIncidentes()

    // La fila cambia de estado, y el cambio se ve **al volver**: el dato nuevo entró por la relectura
    // que la escritura dispara, no por una consulta de la pantalla al montarse.
    await waitFor(() =>
      expect(rowWithSlot(container, 'incident-row', '908').getAttribute('data-declaration')).toBe(
        'PLANIFICABLE',
      ),
    )

    // La conversación entera, en orden y sin una petición de más: la lista, la escritura, la
    // relectura que la invalidación provoca. Ni al pulsar el atajo ni al volver se pide nada —las dos
    // pantallas comparten la misma entrada de caché, y el atajo no estrena lectura—.
    expect(order()).toEqual([
      `GET ${TEAM_URL}`,
      `GET ${TEAM_TIMELINE_URL}`,
      `GET ${RENEGOTIATIONS_URL}`,
      `GET ${DECLARATIONS_PREFIX}${ANA}`,
      `POST ${CREATE_URL}`,
      `GET ${DECLARATIONS_PREFIX}${ANA}`,
    ])
  })
})
