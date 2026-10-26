import { describe, expect, it } from 'vitest'

import { agreementStates } from '@/lib/renegotiations'
import {
  ACORDADO_ID,
  PENDIENTE_ID,
  REMOVIDO_ID,
  renegotiationsFixture,
} from '@/test/fixtures'

describe('agreementStates', () => {
  it('traduce los tres desenlaces del fixture a un estado por ticket', () => {
    // El fixture cubre los tres casos que la pantalla tiene que distinguir: acordado por una
    // persona, pendiente sin acuerdo, y pendiente con un acuerdo anterior que ya no vale.
    expect(agreementStates(renegotiationsFixture())).toEqual({
      [ACORDADO_ID]: 'ACORDADO_MANUAL',
      [PENDIENTE_ID]: 'PENDIENTE_DE_ACUERDO',
      // Pendiente gana al acuerdo anterior: lo que hay que hacer es volver a acordar.
      [REMOVIDO_ID]: 'PENDIENTE_DE_ACUERDO',
    })
  })

  it('un acuerdo conciliado desde GLPI no se pinta como manual', () => {
    const fixture = renegotiationsFixture()
    const glpi = fixture.items.map((item) =>
      item.workItemId === ACORDADO_ID && item.renegotiation
        ? { ...item, renegotiation: { ...item.renegotiation, source: 'GLPI' as const } }
        : item,
    )

    expect(agreementStates({ ...fixture, items: glpi })[ACORDADO_ID]).toBe('ACORDADO_GLPI')
  })

  it('sin respuesta no hay estados, y el plan decide solo', () => {
    expect(agreementStates(undefined)).toEqual({})
  })
})
