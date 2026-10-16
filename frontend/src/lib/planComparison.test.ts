import { describe, expect, it } from 'vitest'

import { planComparison } from '@/lib/planComparison'
import { comparisonOf, previousPlanOf } from '@/lib/planComparison'
import { planOutcome } from '@/lib/planResult'
import type { PlanElement, PlanOutcome, PlanSources } from '@/lib/planResult'
import {
  DEVELOPER_ID,
  developerPlansFixture,
  PLAN_ID,
  planInputFixture,
  planRenegotiationsFixture,
  planSnapshotFixture,
  PREVIOUS_PLAN_ID,
  previousPlanInputFixture,
  previousPlanSnapshotFixture,
  previousTimelineFixture,
  timelineFixture,
} from '@/test/fixtures'

/** El plan nuevo, contado. */
function nuevo(overrides: Partial<PlanSources> = {}): PlanOutcome {
  const timeline = timelineFixture()

  return planOutcome({
    snapshot: planSnapshotFixture(),
    input: planInputFixture(),
    items: timeline.items,
    capacity: timeline.resources.flatMap((resource) => resource.capacity),
    renegotiations: planRenegotiationsFixture().items,
    ...overrides,
  })
}

/** El plan anterior, contado. Los acuerdos son los mismos: sus filas hablan del plan nuevo. */
function anterior(overrides: Partial<PlanSources> = {}): PlanOutcome {
  const timeline = previousTimelineFixture()

  return planOutcome({
    snapshot: previousPlanSnapshotFixture(),
    input: previousPlanInputFixture(),
    items: timeline.items,
    capacity: timeline.resources.flatMap((resource) => resource.capacity),
    renegotiations: planRenegotiationsFixture().items,
    ...overrides,
  })
}

/** El sello del plan anterior, que es contra el que se fecha la pregunta 6. */
const SELLO = previousPlanSnapshotFixture().createdAt

/** Los identificadores de una lista de elementos, que es lo que casi todas las pruebas afirman. */
function ids(elements: readonly PlanElement[]): string[] {
  return elements.map((one) => one.workItemId)
}

describe('planComparison', () => {
  it('entraron los que estan en el nuevo y no estaban en el anterior', () => {
    // REQ-2 y REQ-4 no existian en el plan anterior: el primero se ubico y el segundo el motor lo
    // excluyo, y las dos cosas cuentan como haber entrado.
    expect(ids(planComparison(anterior(), nuevo(), SELLO).entered)).toEqual(['REQ-2', 'REQ-4'])
  })

  it('salieron los que estaban en el anterior y ya no estan', () => {
    expect(ids(planComparison(anterior(), nuevo(), SELLO).left)).toEqual(['REQ-6'])
  })

  it('el que sigue en los dos no cuenta como entrante ni como saliente', () => {
    // Es la mitad que distingue una comparacion de dos listas de una resta de conjuntos: INC-1 y REQ-3
    // estan en los dos planes, asi que no pueden aparecer en ninguna de las dos orillas.
    const comparison = planComparison(anterior(), nuevo(), SELLO)

    expect(ids(comparison.entered)).not.toContain('INC-1')
    expect(ids(comparison.entered)).not.toContain('REQ-3')
    expect(ids(comparison.left)).not.toContain('INC-1')
    expect(ids(comparison.left)).not.toContain('REQ-3')
    expect(comparison.elementCounts).toEqual({ from: 4, to: 5 })
  })

  it('la capacidad se resta dia a dia y con los dos planes iguales el delta es cero', () => {
    const comparison = planComparison(anterior(), nuevo(), SELLO)

    expect(comparison.capacity.delta).toEqual({
      availableHours: 0,
      occupiedHours: 0,
      remainingHours: 0,
      saturatedDays: 0,
      overDays: 0,
    })
  })

  it('un delta de capacidad distinto se lee con su signo', () => {
    // El plan anterior tenia un dia mas de jornada: 20 horas disponibles contra 16. El delta lo dice
    // restando, no diciendo cual es mayor.
    const conTercerDia = anterior({
      capacity: [
        { date: '2026-10-05', availableHours: 8, occupiedHours: 8, remainingHours: 0 },
        { date: '2026-10-06', availableHours: 8, occupiedHours: 2, remainingHours: 6 },
        { date: '2026-10-07', availableHours: 4, occupiedHours: 0, remainingHours: 4 },
      ],
    })

    const { delta, from, to } = planComparison(conTercerDia, nuevo(), SELLO).capacity

    expect(from.availableHours).toBe(20)
    expect(to.availableHours).toBe(16)
    expect(delta.availableHours).toBe(-4)
    expect(delta.remainingHours).toBe(-4)
    // Lo ocupado no se movio: el dia que sobraba no tenia trabajo encima.
    expect(delta.occupiedHours).toBe(0)
  })

  it('los desplazamientos que aparecieron son los del nuevo que no lo estaban antes', () => {
    // REQ-1 estaba planificado y ahora esta desplazado; REQ-2 es nuevo y ya nace desplazado. Los dos
    // son desplazamientos que aparecieron, que es lo que el brief pregunta.
    const comparison = planComparison(anterior(), nuevo(), SELLO)

    expect(ids(comparison.newDisplacements)).toEqual(['REQ-1', 'REQ-2'])
  })

  it('los desplazamientos que desaparecieron son los del anterior que ya no lo estan', () => {
    // REQ-6 desaparecio entero, asi que su desplazamiento tambien.
    expect(ids(planComparison(anterior(), nuevo(), SELLO).goneDisplacements)).toEqual(['REQ-6'])
  })

  it('un desplazamiento que siguio desplazado no aparece ni como aparecido ni como desaparecido', () => {
    // El mismo elemento desplazado en los dos planes, con las mismas fechas y la misma caja: no es un
    // cambio, y contarlo en las dos listas lo pintaria dos veces.
    const comparison = planComparison(nuevo(), nuevo(), SELLO)

    expect(comparison.newDisplacements).toEqual([])
    expect(comparison.goneDisplacements).toEqual([])
  })

  it('un acuerdo registrado despues del sello del plan anterior cuenta', () => {
    // El acuerdo de REQ-1 se firmo a las 09:30 y el plan anterior se calculo a las 09:00.
    const comparison = planComparison(anterior(), nuevo(), SELLO)

    expect(ids(comparison.newAgreements)).toEqual(['REQ-1'])
    expect(comparison.agreementsKnown).toBe(true)
  })

  it('un acuerdo anterior al sello no cuenta', () => {
    // El mismo acuerdo, mirado desde un plan que ya lo conocia: no surgio entre los dos, estaba antes.
    const posterior = planComparison(anterior(), nuevo(), '2026-10-06T10:00:00Z')

    expect(posterior.newAgreements).toEqual([])
    // Y sigue constando que la lectura habla de este plan: vacio no es «no se sabe».
    expect(posterior.agreementsKnown).toBe(true)
  })

  it('sin lectura de acuerdos ligada al plan nuevo la pregunta no se contesta', () => {
    // El plan mirado es el anterior, y los acuerdos que llegan son del nuevo: sus filas hablan de otro
    // desplazamiento. La respuesta honesta es «no consta», no una lista vacia que se lea como un cero.
    const sinAcuerdos = nuevo({ renegotiations: [] })
    const comparison = planComparison(anterior(), sinAcuerdos, SELLO)

    expect(comparison.newAgreements).toEqual([])
    expect(comparison.agreementsKnown).toBe(false)
  })

  it('sigue igual lo que esta en los dos con la misma fila', () => {
    // El orden es el de los elementos del plan nuevo, que salen con los problematicos primero: REQ-3
    // no cupo y va antes que INC-1, que quedo donde se comprometio.
    const comparison = planComparison(anterior(), nuevo(), SELLO)

    expect(ids(comparison.unchanged)).toEqual(['REQ-3', 'INC-1'])
  })

  it('cambia lo que esta en los dos con otra fecha, aunque la caja sea la misma', () => {
    // Es el caso que un diff por veredicto se comeria: REQ-2 sigue DESPLAZADO en los dos planes, pero
    // su compromiso se corrio del 6 al 7. La caja no cambio; la fila si.
    //
    // La fecha se cambia en la **foto de entrada** y no en el tramo, porque es de donde sale: para un
    // requerimiento, la fecha compromiso es su `plannedDate` y el tramo solo es el respaldo cuando no
    // hay foto. Mover el tramo no habria movido nada, y la prueba habria pasado por el motivo
    // equivocado.
    const entrada = planInputFixture({
      requirements: planInputFixture().requirements.map((one) =>
        one.id === 'REQ-2' ? { ...one, plannedDate: '2026-10-07' } : one,
      ),
    })
    const timeline = timelineFixture()
    const corrido = timeline.items.map((one) =>
      one.workItemId === 'REQ-2' ? { ...one, committedDate: '2026-10-07' } : one,
    )

    const comparison = planComparison(nuevo(), nuevo({ input: entrada, items: corrido }), SELLO)

    expect(ids(comparison.changed)).toEqual(['REQ-2'])
    expect(ids(comparison.unchanged)).toEqual(['REQ-3', 'REQ-1', 'REQ-4', 'INC-1'])
    expect(comparisonOf(comparison)).toBe('con-diferencias')
  })
})

/**
 * Un plan con los elementos que se le pasen y nada mas.
 *
 * `conFoto` es lo unico que cambia entre las dos pruebas de abajo: la misma agenda, leida con la foto
 * de entrada y sin ella.
 */
function planDe(ids: readonly string[], conFoto: boolean): PlanOutcome {
  return planOutcome({
    snapshot: planSnapshotFixture({
      allocations: ids.map((id) => ({
        workItemId: id,
        workItemType: 'REQUERIMIENTO' as const,
        developerId: DEVELOPER_ID,
        date: '2026-10-05',
        hours: 2,
      })),
      rescheduleEvents: [],
      conflicts: [],
    }),
    input: conFoto
      ? planInputFixture({
          incidents: [],
          requirements: ids.map((id) => ({
            id,
            estimatedHours: 2,
            plannedDate: '2026-10-05',
            status: 'ABIERTO',
          })),
        })
      : null,
    items: [],
    capacity: [],
    renegotiations: [],
  })
}

describe('comparisonOf', () => {
  it('con las dos fotos, un elemento que solo esta en el plan nuevo es una diferencia', () => {
    const comparacion = planComparison(
      planDe(['REQ-1'], true),
      planDe(['REQ-1', 'REQ-9'], true),
      SELLO,
    )

    expect(comparacion.photosKnown).toBe(true)
    expect(ids(comparacion.entered)).toEqual(['REQ-9'])
    expect(comparisonOf(comparacion)).toBe('con-diferencias')
  })

  it('sin una de las dos fotos, las orillas no deciden el token: son un suelo, no una cuenta', () => {
    // El universo de un plan sin foto son solo sus asignaciones y sus conflictos, asi que lo que
    // «entro» se cuenta sobre lo que la foto ausente conocia y puede haber mas. La lista se sigue
    // enseñando —es cierta— pero el token no puede afirmar que eso sea todo el cambio.
    const comparacion = planComparison(
      planDe(['REQ-1'], false),
      planDe(['REQ-1', 'REQ-9'], false),
      SELLO,
    )

    expect(comparacion.photosKnown).toBe(false)
    expect(ids(comparacion.entered)).toEqual(['REQ-9'])
    expect(comparisonOf(comparacion)).toBe('sin-diferencias')
  })

  it('dos planes identicos son «sin diferencias»', () => {
    // El sello es el del propio plan nuevo, asi que su acuerdo de REQ-1 no es posterior: no hay nada
    // que contar y las dos fotos dicen lo mismo.
    const comparison = planComparison(nuevo(), nuevo(), planSnapshotFixture().createdAt)

    expect(comparisonOf(comparison)).toBe('sin-diferencias')
  })

  it('dos planes sin elementos no son «sin diferencias», son «sin elementos»', () => {
    // No coinciden en nada: lo que pasa es que no hay nada que comparar. Decir «sin diferencias» sobre
    // dos agendas vacias afirmaria una igualdad que nadie comprobo.
    const vacio = planOutcome({
      snapshot: planSnapshotFixture({ allocations: [], rescheduleEvents: [], conflicts: [] }),
      input: planInputFixture({ incidents: [], requirements: [] }),
      items: [],
      capacity: [],
      renegotiations: [],
    })

    const comparison = planComparison(vacio, vacio, SELLO)

    expect(comparison.elementCounts).toEqual({ from: 0, to: 0 })
    expect(comparisonOf(comparison)).toBe('sin-elementos')
  })

  it('un plan con diferencias reales lo dice', () => {
    expect(comparisonOf(planComparison(anterior(), nuevo(), SELLO))).toBe('con-diferencias')
  })
})

describe('previousPlanOf', () => {
  it('devuelve el plan que va justo antes, por posicion en la lista', () => {
    // La lista viene del backend del mas antiguo al mas reciente, y no se reordena aqui.
    const plans = developerPlansFixture().plans

    expect(previousPlanOf(plans, PLAN_ID)?.planId).toBe(PREVIOUS_PLAN_ID)
  })

  it('el primero de la lista no tiene anterior, y un identificador que no esta tampoco', () => {
    const plans = developerPlansFixture().plans

    // El primer plan guardado de un tecnico no tiene con que compararse. Nulo es la respuesta, y quien
    // llama lo pinta como una ausencia y no como un fallo.
    expect(previousPlanOf(plans, PREVIOUS_PLAN_ID)).toBeNull()
    // Un identificador que no esta en la lista tampoco tiene anterior. Distinguirlo de «es el primero»
    // no le toca a esta funcion: el `404` de un plan que no existe lo contesta su propia lectura.
    expect(previousPlanOf(plans, '99999999-9999-9999-9999-999999999999')).toBeNull()
    expect(previousPlanOf([], PLAN_ID)).toBeNull()
  })
})
