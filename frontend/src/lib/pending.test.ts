import { describe, expect, it } from 'vitest'

import {
  conflictsByDeveloper,
  pendingAgreements,
  pendingCounts,
  pendingGroups,
  pendingOf,
  plannedByDeveloper,
  teamPending,
} from '@/lib/pending'
import {
  DEVELOPER_ID,
  FULL_DEVELOPER_ID,
  OVER_DEVELOPER_ID,
  PENDIENTE_ID,
  REMOVIDO_ID,
  declarationItemFixture,
  declarationsFixture,
  renegotiationsFixture,
} from '@/test/fixtures'

/**
 * La capa de trabajo pendiente, probada por lo que decide: qué ticket está fuera del plan y por qué.
 *
 * Son pruebas de la función pura y no de la pantalla a propósito. Aquí vive la única regla que esta
 * fase añade, y equivocarla no rompe nada: solo hace que la vista afirme que hay trabajo pendiente
 * donde no lo hay, o que lo esconda. Aislarla es lo que permite comprobar las cuatro preguntas del
 * gestor —falta información, no cupo, falta acuerdo, no entró en el plan—, el orden entre ellas y el
 * caso de la lectura que no llegó sin montar React.
 */

const NADA: ReadonlySet<string> = new Set()

describe('pendingOf', () => {
  it('deja fuera los tickets que ya no son carga', () => {
    // Un ticket resuelto sigue llegando en la respuesta —el backend filtra por grupo de estados y por
    // eso no debería, pero la guarda es de pantalla— y no puede contarse como pendiente.
    const declaration = declarationsFixture({
      items: [
        declarationItemFixture({ workItemId: '900', status: 'RESUELTO', declarationStatus: 'SIN_DECLARACION' }),
        declarationItemFixture({ workItemId: '901', status: 'FINALIZADO', declarationStatus: 'SIN_DECLARACION' }),
        declarationItemFixture({ workItemId: '902', status: 'ABIERTO', declarationStatus: 'PLANIFICABLE' }),
      ],
    })

    expect(pendingOf('dev-1', declaration, NADA).map((item) => item.workItemId)).toEqual(['902'])
  })

  it('da por pendiente todo lo que no se puede planificar, sin mirar el plan', () => {
    const declaration = declarationsFixture({
      items: [
        declarationItemFixture({ workItemId: '501', declarationStatus: 'PLANIFICABLE' }),
        declarationItemFixture({ workItemId: '502', declarationStatus: 'SIN_ESTIMACION' }),
        declarationItemFixture({ workItemId: '503', declarationStatus: 'SIN_COMPROMISO' }),
        declarationItemFixture({ workItemId: '504', declarationStatus: 'SIN_DECLARACION' }),
        declarationItemFixture({ workItemId: '505', declarationStatus: 'NO_TRADUCIBLE' }),
      ],
    })

    // Los cuatro estados que no son `PLANIFICABLE` son pendientes, y cada uno conserva su causa: no
    // se agrupan en un rótulo común, porque «falta la estimación» y «falta el compromiso» se arreglan
    // con datos distintos. La causa **es** el `declarationStatus` del backend, sin traducción.
    //
    // `501` va en el plan a propósito: con el plan vacío saldría pendiente por el **otro** motivo, y
    // esta prueba dejaría de hablar de la declaración para hablar de la pertenencia.
    expect(
      pendingOf('dev-1', declaration, new Set(['501'])).map(({ workItemId, cause, declarationStatus }) => ({
        workItemId,
        cause,
        declarationStatus,
      })),
    ).toEqual([
      { workItemId: '502', cause: 'SIN_ESTIMACION', declarationStatus: 'SIN_ESTIMACION' },
      { workItemId: '503', cause: 'SIN_COMPROMISO', declarationStatus: 'SIN_COMPROMISO' },
      { workItemId: '504', cause: 'SIN_DECLARACION', declarationStatus: 'SIN_DECLARACION' },
      { workItemId: '505', cause: 'NO_TRADUCIBLE', declarationStatus: 'NO_TRADUCIBLE' },
    ])
  })

  it('separa el planificable que el motor rechazó del que ya está dentro', () => {
    const declaration = declarationsFixture({
      items: [
        declarationItemFixture({ workItemId: '501', declarationStatus: 'PLANIFICABLE' }),
        declarationItemFixture({ workItemId: '506', declarationStatus: 'PLANIFICABLE' }),
      ],
    })

    // `501` está en el plan y `506` no: mismo estado de declaración, desenlace distinto. Y `506`
    // aparece en los conflictos del plan, que es lo que prueba que el motor lo conoció y no cupo.
    expect(
      pendingOf('dev-1', declaration, new Set(['501']), NADA, new Set(['506'])).map(
        ({ workItemId, cause }) => ({ workItemId, cause }),
      ),
    ).toEqual([{ workItemId: '506', cause: 'FUERA_POR_CAPACIDAD' }])
  })

  it('distingue el trabajo que no cupo del que no entró en la planificación', () => {
    // La misma declaración y el mismo plan para los dos: lo único que los separa es la lista de
    // conflictos. `506` lo intentó y no cupo; `511` no estaba en la entrada del plan cuando se
    // calculó. Sin esa lista habría que llamar «capacidad» a las dos cosas, y la mitad sería falso.
    const declaration = declarationsFixture({
      items: [
        declarationItemFixture({ workItemId: '506', declarationStatus: 'PLANIFICABLE' }),
        declarationItemFixture({ workItemId: '511', declarationStatus: 'PLANIFICABLE' }),
      ],
    })

    expect(
      pendingOf('dev-1', declaration, NADA, NADA, new Set(['506'])).map(
        ({ workItemId, cause }) => ({ workItemId, cause }),
      ),
    ).toEqual([
      { workItemId: '506', cause: 'FUERA_POR_CAPACIDAD' },
      { workItemId: '511', cause: 'NO_INCLUIDO_EN_EL_PLAN' },
    ])
  })

  it('marca sin acuerdo lo que está en el plan esperando una fecha', () => {
    // El único motivo que se da **dentro** del plan: el motor lo colocó en otro día y todavía nadie
    // aceptó esa fecha. Sin este caso la capa diría que todo está en su sitio solo porque hay tramo.
    const declaration = declarationsFixture({
      items: [declarationItemFixture({ workItemId: '507', declarationStatus: 'PLANIFICABLE' })],
    })

    expect(
      pendingOf('dev-1', declaration, new Set(['507']), new Set(['507']))[0],
    ).toMatchObject({ workItemId: '507', cause: 'SIN_ACUERDO' })
  })

  it('respeta la precedencia: declaración, luego plan, luego acuerdo', () => {
    const declaration = declarationsFixture({
      items: [
        declarationItemFixture({ workItemId: '508', declarationStatus: 'SIN_ESTIMACION' }),
        declarationItemFixture({ workItemId: '509', declarationStatus: 'PLANIFICABLE' }),
        declarationItemFixture({ workItemId: '510', declarationStatus: 'PLANIFICABLE' }),
      ],
    })

    // Los tres esperan un acuerdo y cada uno tiene además otro motivo. Solo el tercero llega al
    // motivo del acuerdo: una fila con un solo rótulo tiene que decir qué hacer primero.
    expect(
      pendingOf(
        'dev-1',
        declaration,
        new Set(['510']),
        new Set(['508', '509', '510']),
        new Set(['509']),
      ).map(({ workItemId, cause }) => ({ workItemId, cause })),
    ).toEqual([
      { workItemId: '508', cause: 'SIN_ESTIMACION' },
      { workItemId: '509', cause: 'FUERA_POR_CAPACIDAD' },
      { workItemId: '510', cause: 'SIN_ACUERDO' },
    ])
  })

  it('manda el estado de declaración sobre la presencia en el plan', () => {
    // Un ticket que el plan viejo todavía tiene pero que hoy no se puede planificar es un resto del
    // plan, no trabajo colocado: si ganara la pertenencia, la capa diría que todo está en su sitio.
    const declaration = declarationsFixture({
      items: [declarationItemFixture({ workItemId: '501', declarationStatus: 'SIN_COMPROMISO' })],
    })

    expect(pendingOf('dev-1', declaration, new Set(['501']))[0]?.cause).toBe('SIN_COMPROMISO')
  })

  it('el motivo viaja con lo que hace falta para arreglarlo', () => {
    // El panel enlaza a la declaración del ticket, así que necesita el técnico y el ticket; y el título
    // es lo que hace reconocible la fila. Un pendiente sin esos tres datos no se puede accionar.
    const declaration = declarationsFixture({
      items: [
        declarationItemFixture({
          workItemId: '504',
          title: 'Ajuste de reporte 504',
          type: 'REQUERIMIENTO',
          declarationStatus: 'SIN_DECLARACION',
        }),
      ],
    })

    expect(pendingOf('dev-1', declaration, NADA)[0]).toMatchObject({
      developerId: 'dev-1',
      workItemId: '504',
      title: 'Ajuste de reporte 504',
      type: 'REQUERIMIENTO',
    })
  })

  it('no inventa pendientes cuando la lectura no llegó', () => {
    // Sin respuesta no se sabe si hay pendientes. Devolver la lista vacía es lo que permite al panel
    // distinguir «no hay ninguno» de «no se pudo leer» mirando el estado de la consulta.
    expect(pendingOf('dev-1', undefined, NADA)).toEqual([])
  })
})

describe('conflictsByDeveloper', () => {
  it('indexa por persona y ticket lo que el motor rechazó', () => {
    // La causa no se guarda dos veces: aquí solo se indexa el hecho —el motor conoció este ticket y
    // no lo colocó—. El texto del conflicto lo sigue enseñando el panel de conflictos.
    expect(
      conflictsByDeveloper([
        { developerId: 'dev-1', workItemId: 'REQ-7' },
        { developerId: 'dev-1', workItemId: 'REQ-8' },
        { developerId: 'dev-2', workItemId: 'REQ-7' },
      ] as never),
    ).toEqual({ 'dev-1': new Set(['REQ-7', 'REQ-8']), 'dev-2': new Set(['REQ-7']) })
  })
})

describe('pendingAgreements', () => {
  it('indexa los pendientes de acuerdo por técnico y deja fuera los ya acordados', () => {
    // El estado llega calculado: `REQ-1` está acordado y no es trabajo pendiente, aunque tenga su
    // desplazamiento. Se agrupa por persona porque la pantalla pregunta por persona.
    expect(pendingAgreements(renegotiationsFixture())).toEqual({
      [FULL_DEVELOPER_ID]: new Set([PENDIENTE_ID]),
      [OVER_DEVELOPER_ID]: new Set([REMOVIDO_ID]),
    })
  })

  it('no inventa acuerdos cuando la lectura no llegó', () => {
    expect(pendingAgreements(undefined)).toEqual({})
  })
})

describe('plannedByDeveloper', () => {
  it('agrupa por técnico y no mezcla los tramos de dos personas', () => {
    const planned = plannedByDeveloper([
      { developerId: 'dev-1', workItemId: '501' },
      { developerId: 'dev-1', workItemId: '501' },
      { developerId: 'dev-2', workItemId: '501' },
    ] as never)

    // El mismo ticket en dos personas son dos entradas distintas, y los dos tramos del mismo ticket en
    // la misma persona no lo cuentan dos veces.
    expect(planned['dev-1']).toEqual(new Set(['501']))
    expect(planned['dev-2']).toEqual(new Set(['501']))
  })
})

describe('pendingGroups', () => {
  it('reparte el equipo en las cuatro preguntas del gestor', () => {
    const declaration = declarationsFixture({
      items: [
        declarationItemFixture({ workItemId: '601', declarationStatus: 'SIN_ESTIMACION' }),
        declarationItemFixture({ workItemId: '602', declarationStatus: 'SIN_COMPROMISO' }),
        declarationItemFixture({ workItemId: '603', declarationStatus: 'PLANIFICABLE' }),
        declarationItemFixture({ workItemId: '604', declarationStatus: 'PLANIFICABLE' }),
        declarationItemFixture({ workItemId: '605', declarationStatus: 'PLANIFICABLE' }),
      ],
    })

    const pending = pendingOf(
      DEVELOPER_ID,
      declaration,
      // 605 está en el plan; 603 y 604 no, y solo 603 lo rechazó el motor.
      new Set(['605']),
      new Set(['605']),
      new Set(['603']),
    )

    // Dos de información, uno de capacidad, uno de acuerdo y uno que no entró: la respuesta de una
    // línea es «¿es un problema de información o de capacidad?» sin abrir una sola fila.
    expect(pendingGroups(pending)).toEqual({ P1: 2, P2: 1, P3: 1, P4: 1 })
  })

  it('devuelve los cuatro grupos aunque no haya ningún pendiente', () => {
    // La forma del resumen no cambia con los datos: un grupo que desaparece se confunde con uno que
    // no se midió.
    expect(pendingGroups([])).toEqual({ P1: 0, P2: 0, P3: 0, P4: 0 })
  })
})

describe('teamPending y pendingCounts', () => {
  it('empareja cada respuesta con su técnica por posición', () => {
    const conPendientes = declarationsFixture({
      items: [declarationItemFixture({ workItemId: '504', declarationStatus: 'SIN_DECLARACION' })],
    })

    const pending = teamPending(['dev-1', 'dev-2'], [conPendientes, undefined], {})

    // La segunda no respondió: se queda sin pendientes y sin afirmar nada.
    expect(pending.map((item) => item.developerId)).toEqual(['dev-1'])
    expect(pendingCounts(pending)).toEqual({ 'dev-1': 1 })
  })

  it('no confunde una persona sin pendientes con una que no tiene plan', () => {
    const sinPendientes = declarationsFixture({
      items: [declarationItemFixture({ workItemId: '501', declarationStatus: 'PLANIFICABLE' })],
    })

    expect(teamPending(['dev-1'], [sinPendientes], { 'dev-1': new Set(['501']) })).toEqual([])
  })
})
