import { describe, expect, it } from 'vitest'

import {
  EMPTY_FILTERS,
  UNSCHEDULED_HEIGHT,
  addDays,
  blockState,
  commitmentRisksOf,
  dayPositions,
  filterItems,
  formatHours,
  formatWeek,
  hourAxis,
  isoDate,
  isoWeekNumber,
  itemsByDate,
  minutesOfDay,
  parseLocalDateTime,
  resourcePresence,
  riskOf,
  timelineDays,
  weekAnchor,
  weekDaysOf,
  unscheduledOf,
  unscheduledPlacements,
  weekStartOf,
} from '@/lib/timeline'
import { declarationsFixture, timelineFixture } from '@/test/fixtures'
import type { TimelineItem } from '@/types/timeline'

const plan = timelineFixture()

describe('parseLocalDateTime', () => {
  it('lee una fecha sin hora como hora local, no como UTC', () => {
    // Con `new Date("2026-10-05")` esto devolveria el dia 4 en cualquier huso negativo.
    const date = parseLocalDateTime('2026-10-05')

    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(9)
    expect(date.getDate()).toBe(5)
  })

  it('conserva la hora de una fecha-hora local', () => {
    const date = parseLocalDateTime('2026-10-05T09:30:15')

    expect(date.getDate()).toBe(5)
    expect(date.getHours()).toBe(9)
    expect(date.getMinutes()).toBe(30)
    expect(date.getSeconds()).toBe(15)
  })
})

describe('minutesOfDay', () => {
  it('devuelve los minutos desde medianoche', () => {
    expect(minutesOfDay('2026-10-05T09:00:00')).toBe(540)
    expect(minutesOfDay('2026-10-05T17:00:00')).toBe(1020)
  })
})

describe('hourAxis', () => {
  it('sin tramos usa la jornada por defecto', () => {
    // La jornada oficial: lunes a viernes, 07:00-17:30.
    expect(hourAxis([])).toEqual({ startMinutes: 420, endMinutes: 1050 })
  })

  it('la jornada es fija aunque los tramos ocupen solo una parte', () => {
    // 09:00 a 17:00 no encoge el eje: un dia con poco trabajo se lee contra la misma escala que
    // uno lleno, y la forma de la rejilla no cambia al cambiar de semana.
    expect(hourAxis(plan.items)).toEqual({ startMinutes: 420, endMinutes: 1050 })
  })

  it('un tramo que termina en el cierre oficial no estira el eje', () => {
    // 17:30 es el cierre de la jornada: el eje ya llega ahi, asi que no se agranda hasta las 18:00.
    const cierre = [{ ...plan.items[0], startsAt: '2026-10-05T07:00:00', endsAt: '2026-10-05T17:30:00' }]
    expect(hourAxis(cierre)).toEqual({ startMinutes: 420, endMinutes: 1050 })
  })

  it('se estira solo cuando un tramo se sale de la jornada', () => {
    // La jornada fija no puede esconder trabajo: lo que cae fuera agranda el eje lo justo.
    const fuera = [
      { ...plan.items[0], startsAt: '2026-10-05T07:15:00', endsAt: '2026-10-05T19:30:00' },
    ]
    expect(hourAxis(fuera)).toEqual({ startMinutes: 420, endMinutes: 1200 })
  })
})

describe('timelineDays', () => {
  it('toma los dias de la capacidad del recurso, en orden', () => {
    expect(timelineDays(plan.resources, plan.items)).toEqual(['2026-10-05', '2026-10-06'])
  })

  it('suma los dias de los tramos que no estuvieran en la capacidad', () => {
    expect(timelineDays([], plan.items)).toEqual(['2026-10-05', '2026-10-06'])
  })
})

describe('itemsByDate', () => {
  it('agrupa los tramos por su fecha de inicio', () => {
    const byDate = itemsByDate(plan.items)

    expect(byDate.get('2026-10-05')?.map((item) => item.workItemId)).toEqual(['INC-1', 'REQ-1'])
    expect(byDate.get('2026-10-06')?.map((item) => item.workItemId)).toEqual(['REQ-2'])
  })
})

describe('filterItems', () => {
  it('sin filtros devuelve todo', () => {
    expect(filterItems(plan.items, EMPTY_FILTERS)).toHaveLength(3)
  })

  it('filtra por estado de planificacion', () => {
    const displaced = filterItems(plan.items, { ...EMPTY_FILTERS, planningStatus: 'DESPLAZADO' })

    expect(displaced.map((item) => item.workItemId)).toEqual(['REQ-1', 'REQ-2'])
  })

  it('filtra por tipo y por severidad', () => {
    expect(filterItems(plan.items, { ...EMPTY_FILTERS, workItemType: 'INCIDENTE' })).toHaveLength(1)
    expect(filterItems(plan.items, { ...EMPTY_FILTERS, severity: 'MEDIO' })).toHaveLength(1)
    // La severidad solo la traen los incidentes: filtrar por ella descarta los requerimientos.
    expect(filterItems(plan.items, { ...EMPTY_FILTERS, severity: 'BAJO' })).toHaveLength(0)
  })
})

describe('formatHours', () => {
  it('no arrastra decimales de relleno', () => {
    expect(formatHours(8)).toBe('8')
    expect(formatHours(0)).toBe('0')
    expect(formatHours(2.5)).toMatch(/^2[.,]5$/)
  })
})

/*
 * La navegación semanal, que es lo que la Fase 58 pone en la agenda. Se prueba aparte de la
 * rejilla porque es aritmética de fechas: si el lunes o el número de semana se calculan mal, la
 * vista navega a la semana equivocada sin fallar en ningún sitio visible.
 */
describe('semanas', () => {
  it('suma días sin pasar por zonas horarias', () => {
    expect(addDays('2026-10-19', 6)).toBe('2026-10-25')
    expect(addDays('2026-10-19', -7)).toBe('2026-10-12')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('el lunes es el ancla de la semana', () => {
    // Lunes, miércoles y domingo de la misma semana caen en el mismo ancla.
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19')
    expect(weekStartOf('2026-10-21')).toBe('2026-10-19')
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19')
    // Cruzando el mes y el año.
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26')
    expect(weekStartOf('2026-01-01')).toBe('2025-12-29')
  })

  it('la semana son siete días de lunes a domingo', () => {
    expect(weekDaysOf('2026-10-19')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ])
  })

  it('numera la semana como ISO-8601, no como el mes', () => {
    expect(isoWeekNumber('2026-10-19')).toBe(43)
    expect(isoWeekNumber('2026-10-25')).toBe(43)
    // El 1 de enero de 2026 es jueves: pertenece a la semana 1.
    expect(isoWeekNumber('2026-01-01')).toBe(1)
    // El lunes de esa misma semana cae en diciembre de 2025, y sigue siendo la semana 1 de 2026.
    expect(isoWeekNumber('2025-12-29')).toBe(1)
    // 2026 tiene 53 semanas: el 31 de diciembre, jueves, cierra la última.
    expect(isoWeekNumber('2026-12-31')).toBe(53)
  })

  it('la etiqueta dice el número de semana y sus extremos', () => {
    expect(formatWeek('2026-10-19')).toMatch(/^Semana 43 · /)
    expect(formatWeek('2026-10-19')).toContain('25')
  })

  it('abre en la semana de hoy si la ventana la contiene', () => {
    expect(weekAnchor(['2026-10-05', '2026-10-31'], '2026-10-21')).toBe('2026-10-19')
    // El domingo es el último día de su semana, no el primero de la siguiente.
    expect(weekAnchor(['2026-10-05', '2026-10-31'], '2026-10-25')).toBe('2026-10-19')
  })

  it('si hoy queda fuera de la ventana, abre en el borde y no en un hueco', () => {
    // Una semana sin datos sería una pantalla vacía que no significa «no hay trabajo».
    expect(weekAnchor(['2026-10-05', '2026-10-07'], '2026-10-21')).toBe('2026-10-05')
    expect(weekAnchor(['2026-11-02', '2026-11-06'], '2026-10-21')).toBe('2026-11-02')
    expect(weekAnchor([], '2026-10-21')).toBe('2026-10-19')
  })

  it('una fecha local se escribe como la habla el contrato', () => {
    expect(isoDate(new Date(2026, 9, 5))).toBe('2026-10-05')
    expect(isoDate(new Date(2026, 0, 1))).toBe('2026-01-01')
  })
})

/** Un tramo con lo que cada prueba necesita cambiarle. */
function block(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return { ...timelineFixture().items[0], ...overrides }
}

describe('dayPositions', () => {
  it('numera los días de un trabajo de dos jornadas y marca el último como entrega', () => {
    const positions = dayPositions([
      block({ workItemId: 'REQ-9', startsAt: '2026-10-20T08:00:00', endsAt: '2026-10-20T17:30:00' }),
      block({ workItemId: 'REQ-9', startsAt: '2026-10-21T08:00:00', endsAt: '2026-10-21T12:00:00' }),
    ])

    // El plan guarda un tramo por jornada: sin esta cuenta se leen como dos trabajos distintos.
    expect(positions.get('REQ-9@2026-10-20T08:00:00')).toEqual({
      day: 1,
      days: 2,
      delivery: false,
    })
    expect(positions.get('REQ-9@2026-10-21T08:00:00')).toEqual({
      day: 2,
      days: 2,
      delivery: true,
    })
  })

  it('dos tramos de la misma jornada son un día, no dos', () => {
    // La franja de la mañana y la de la tarde son el mismo día de trabajo: contar tramos diría
    // «día 2 de 2» en la tarde y marcaría como entrega un trabajo que sigue mañana.
    const positions = dayPositions([
      block({ workItemId: 'REQ-9', startsAt: '2026-10-20T08:00:00', endsAt: '2026-10-20T10:00:00' }),
      block({ workItemId: 'REQ-9', startsAt: '2026-10-20T14:00:00', endsAt: '2026-10-20T17:30:00' }),
    ])

    expect(positions.get('REQ-9@2026-10-20T08:00:00')).toEqual({ day: 1, days: 1, delivery: true })
    expect(positions.get('REQ-9@2026-10-20T14:00:00')).toEqual({ day: 1, days: 1, delivery: true })
  })

  it('un tramo suelto de una jornada es su propio día de entrega', () => {
    const positions = dayPositions([block({ workItemId: 'INC-1' })])

    expect(positions.get('INC-1@2026-10-05T09:00:00')).toEqual({
      day: 1,
      days: 1,
      delivery: true,
    })
  })

  it('el mismo ticket de dos personas son dos trabajos y no se mezclan', () => {
    // Un ticket compartido es carga de cada una por separado; contar los tramos de las dos juntas
    // diría que cada persona tarda el doble.
    const positions = dayPositions([
      block({ workItemId: 'REQ-9', developerId: 'ana', startsAt: '2026-10-20T08:00:00' }),
      block({ workItemId: 'REQ-9', developerId: 'bea', startsAt: '2026-10-21T08:00:00' }),
    ])

    expect(positions.get('REQ-9@2026-10-20T08:00:00')).toEqual({ day: 1, days: 1, delivery: true })
    expect(positions.get('REQ-9@2026-10-21T08:00:00')).toEqual({ day: 1, days: 1, delivery: true })
  })
})

describe('blockState', () => {
  it('sin lectura de acuerdos, el estado es el del plan', () => {
    expect(blockState({ workItemId: 'REQ-1', planningStatus: 'PLANIFICADO' })).toBe('PLANIFICADO')
    expect(blockState({ workItemId: 'REQ-1', planningStatus: 'DESPLAZADO' })).toBe('DESPLAZADO')
  })

  it('el acuerdo manda sobre el estado del plan cuando lo hay', () => {
    expect(
      blockState({ workItemId: 'REQ-1', planningStatus: 'DESPLAZADO' }, {
        'REQ-1': 'ACORDADO_GLPI',
      }),
    ).toBe('ACORDADO_GLPI')
    expect(
      blockState({ workItemId: 'REQ-1', planningStatus: 'DESPLAZADO' }, {
        'REQ-1': 'PENDIENTE_DE_ACUERDO',
      }),
    ).toBe('PENDIENTE_DE_ACUERDO')
  })

  it('el acuerdo de otro ticket no pinta este', () => {
    expect(
      blockState({ workItemId: 'REQ-2', planningStatus: 'DESPLAZADO' }, {
        'REQ-1': 'ACORDADO_MANUAL',
      }),
    ).toBe('DESPLAZADO')
  })
})

describe('unscheduledOf', () => {
  const OPEN = { from: null, to: null }

  /** El 68428 tal como lo publica la declaración: fecha en GLPI y ninguna hora. */
  const sinHoras = declarationsFixture({
    items: [
      {
        ...declarationsFixture().items[1],
        workItemId: '68428',
        type: 'REQUERIMIENTO',
        declarationStatus: 'SIN_ESTIMACION',
        operationalDate: '2026-11-19',
        operationalTime: null,
        operationalDateSource: 'internal_time_to_resolve',
      },
    ],
  })

  it('enseña el ticket con día en GLPI y sin horas', () => {
    const unscheduled = unscheduledOf({ ana: sinHoras }, new Set(), OPEN)

    expect(unscheduled).toEqual([
      {
        workItemId: '68428',
        workItemType: 'REQUERIMIENTO',
        developerId: 'ana',
        date: '2026-11-19',
        time: null,
        cause: 'Sin estimación',
      },
    ])
  })

  it('la hora del Internal TTR viaja con el día, recortada a HH:mm', () => {
    // El mismo ticket con la hora que GLPI sí publica: 13:53:48 es el caso 66222.
    const conHora = declarationsFixture({
      items: [{ ...sinHoras.items[0], operationalTime: '13:53:48' }],
    })

    expect(unscheduledOf({ ana: conHora }, new Set(), OPEN)[0]?.time).toBe('13:53')
  })

  it('no lo repite si el plan ya lo ubicó', () => {
    // Si el ticket entró al plan, su tramo ya lo dice todo: enseñarlo otra vez como ausente sería
    // afirmar dos cosas contrarias en el mismo día.
    expect(unscheduledOf({ ana: sinHoras }, new Set(['68428']), OPEN)).toEqual([])
  })

  it('no enseña lo que no tiene fecha, porque no hay día donde ponerlo', () => {
    const sinFecha = declarationsFixture({
      items: [{ ...sinHoras.items[0], operationalDate: null }],
    })

    expect(unscheduledOf({ ana: sinFecha }, new Set(), OPEN)).toEqual([])
  })

  it('respeta la ventana cuando se le da una', () => {
    expect(
      unscheduledOf({ ana: sinHoras }, new Set(), { from: '2026-11-01', to: '2026-11-15' }),
    ).toEqual([])
  })

  it('un ticket en otro estado no es un ticket sin estimación', () => {
    const planificable = declarationsFixture({
      items: [{ ...sinHoras.items[0], declarationStatus: 'PLANIFICABLE' }],
    })

    expect(unscheduledOf({ ana: planificable }, new Set(), OPEN)).toEqual([])
  })
})

describe('riskOf', () => {
  const today = '2026-10-27'

  it('reparte los cuatro tramos por días enteros', () => {
    expect(riskOf('2026-10-26', today)).toBe('VENCIDA')
    expect(riskOf('2026-10-27', today)).toBe('HOY')
    expect(riskOf('2026-10-28', today)).toBe('PROXIMA')
    expect(riskOf('2026-10-30', today)).toBe('PROXIMA')
    expect(riskOf('2026-10-31', today)).toBe('FUTURA')
  })

  it('no cuenta las horas: un ticket de las 23:00 vence el mismo día', () => {
    // El horizonte es una conversación de negocio —«los próximos tres días»— y no un instante.
    expect(riskOf('2026-10-27T23:59:00', today)).toBe('HOY')
    expect(riskOf('2026-10-30T00:01:00', today)).toBe('PROXIMA')
  })

  it('cruza el cambio de mes sin desviarse', () => {
    expect(riskOf('2026-12-03', '2026-11-30')).toBe('PROXIMA')
    expect(riskOf('2026-11-29', '2026-11-30')).toBe('VENCIDA')
  })
})

describe('commitmentRisksOf', () => {
  it('mapea por ticket y salta los que no tienen fecha', () => {
    // El 501 del fixture es una incidencia sin fecha operativa: no hay compromiso que medir, y
    // meterlo como «vencido» afirmaría un incumplimiento que GLPI nunca prometió.
    const risks = commitmentRisksOf({ ana: declarationsFixture() }, '2026-10-27')

    expect(risks['501']).toBeUndefined()
    expect(risks['68428']).toBeUndefined()
  })

  it('cruza a los dos desarrolladores en un solo mapa', () => {
    const conFecha = declarationsFixture({
      items: [
        {
          ...declarationsFixture().items[1],
          workItemId: '68428',
          declarationStatus: 'SIN_ESTIMACION',
          operationalDate: '2026-10-27',
        },
      ],
    })
    const vencido = declarationsFixture({
      items: [
        {
          ...declarationsFixture().items[1],
          workItemId: '66222',
          declarationStatus: 'SIN_ESTIMACION',
          operationalDate: '2026-10-20',
        },
      ],
    })

    expect(commitmentRisksOf({ ana: conFecha, beto: vencido }, '2026-10-27')).toEqual({
      '68428': 'HOY',
      '66222': 'VENCIDA',
    })
  })
})


describe('unscheduledPlacements', () => {
  const AXIS = { startMinutes: 7 * 60, endMinutes: 17 * 60 + 30 }
  const HOUR = 44
  const BODY = ((AXIS.endMinutes - AXIS.startMinutes) / 60) * HOUR

  /** Un ticket sin estimación del 21 de octubre de 2026. */
  function ghost(workItemId: string, time: string | null, developerId = 'ana') {
    return {
      workItemId,
      workItemType: 'REQUERIMIENTO' as const,
      developerId,
      date: '2026-10-21',
      time,
      cause: 'Sin estimación',
    }
  }

  function top(placements: Map<string, { top: number }>, id: string) {
    return placements.get(id)?.top ?? -1
  }

  it('coloca cada ticket en su hora, con alto fijo y sin medir trabajo', () => {
    const placements = unscheduledPlacements([ghost('A', '07:00'), ghost('B', '13:53')], AXIS, HOUR, BODY)

    expect(top(placements, 'A')).toBe(0)
    expect(top(placements, 'B')).toBeCloseTo(((13 * 60 + 53 - AXIS.startMinutes) / 60) * HOUR, 5)

    // El alto es el del marcador, no las horas del ticket: no hay horas que medir.
    expect(placements.get('B')?.height).toBe(UNSCHEDULED_HEIGHT)
  })

  it('los de la misma hora se apilan hacia abajo', () => {
    const placements = unscheduledPlacements(
      [ghost('A', '17:30'), ghost('B', '17:30'), ghost('C', '17:30')],
      AXIS,
      HOUR,
      BODY,
    )

    expect(top(placements, 'B') - top(placements, 'A')).toBeCloseTo(UNSCHEDULED_HEIGHT, 5)
    expect(top(placements, 'C') - top(placements, 'B')).toBeCloseTo(UNSCHEDULED_HEIGHT, 5)
  })

  it('si la pila no cabe en el día sube entera y no deja ninguna fuera', () => {
    const placements = unscheduledPlacements(
      [ghost('A', '17:30'), ghost('B', '17:30'), ghost('C', '17:30')],
      AXIS,
      HOUR,
      BODY,
    )

    for (const id of ['A', 'B', 'C']) {
      const place = placements.get(id)!
      expect(place.top).toBeGreaterThanOrEqual(0)
      expect(place.top + place.height).toBeLessThanOrEqual(BODY + 0.5)
    }
    // Sigue apilado: subir el grupo no lo aplasta.
    expect(top(placements, 'C') - top(placements, 'A')).toBeCloseTo(2 * UNSCHEDULED_HEIGHT, 5)
  })

  it('una hora fuera del eje se pega al borde y se declara fuera', () => {
    const placements = unscheduledPlacements([ghost('NOCHE', '23:30'), ghost('PRONTO', '05:00')], AXIS, HOUR, BODY)

    expect(placements.get('NOCHE')).toEqual({ top: BODY - UNSCHEDULED_HEIGHT, height: UNSCHEDULED_HEIGHT, outside: true })
    expect(placements.get('PRONTO')?.top).toBe(0)
    expect(placements.get('PRONTO')?.outside).toBe(true)
  })

  it('sin hora cae al inicio del día, que es lo único que se sabe', () => {
    const placements = unscheduledPlacements([ghost('SINHORA', null)], AXIS, HOUR, BODY)

    expect(placements.get('SINHORA')?.top).toBe(0)
  })

  it('cada persona y cada día tienen su propia pila', () => {
    const placements = unscheduledPlacements(
      [ghost('A', '10:00', 'ana'), ghost('B', '10:00', 'beto'), { ...ghost('C', '10:00'), date: '2026-10-22' }],
      AXIS,
      HOUR,
      BODY,
    )

    // Tres tickets a la misma hora en tres celdas distintas no compiten por el mismo renglón.
    expect(top(placements, 'A')).toBeCloseTo(top(placements, 'B'), 5)
    expect(top(placements, 'C')).toBeCloseTo(top(placements, 'A'), 5)
  })
})

describe('resourcePresence', () => {
  const sinTrabajo = { tramos: 0, sinEstimacion: 0, pendientes: 0, recuperables: 0 }

  it('con tramos cuenta tramos, que es una cifra que la fila no da en otro sitio', () => {
    expect(resourcePresence({ ...sinTrabajo, tramos: 1 })).toEqual({ kind: 'TRAMOS', label: '1 tramo' })
    expect(resourcePresence({ ...sinTrabajo, tramos: 3 })).toEqual({
      kind: 'TRAMOS',
      label: '3 tramos',
    })
  })

  it('con trabajo y sin tramos no dice nada: los chips de pendientes ya lo cuentan', () => {
    // El caso de la fase: «Sin estimación» encima de «7 pendientes» repetía el mismo hecho dos veces.
    expect(resourcePresence({ ...sinTrabajo, sinEstimacion: 2 })).toBeNull()
    expect(resourcePresence({ ...sinTrabajo, pendientes: 7, recuperables: 7 })).toBeNull()
    expect(resourcePresence({ ...sinTrabajo, recuperables: 1 })).toBeNull()
  })

  it('los tramos mandan sobre los compromisos sin horas: no se pierde lo colocado', () => {
    expect(resourcePresence({ ...sinTrabajo, tramos: 2, sinEstimacion: 5 })).toEqual({
      kind: 'TRAMOS',
      label: '2 tramos',
    })
  })

  it('sin nada de lo anterior no hay trabajo activo, y se dice así', () => {
    expect(resourcePresence(sinTrabajo)).toEqual({ kind: 'SIN_TRABAJO', label: 'Sin trabajo activo' })
  })
})
