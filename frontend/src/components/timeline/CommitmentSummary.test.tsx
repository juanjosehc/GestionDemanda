import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CommitmentSummary } from '@/components/timeline/CommitmentSummary'

function counter(risk: string | undefined) {
  return document.querySelector<HTMLElement>(
    risk === undefined
      ? '[data-slot="timeline-commitment-counter"]:not([data-risk])'
      : `[data-slot="timeline-commitment-counter"][data-risk="${risk}"]`,
  )
}

describe('CommitmentSummary', () => {
  it('cuenta cada tramo de riesgo y deja fuera lo que no vence pronto', () => {
    render(
      <CommitmentSummary
        risks={{
          a: 'VENCIDA',
          b: 'VENCIDA',
          c: 'HOY',
          d: 'PROXIMA',
          e: 'FUTURA',
        }}
        withoutEstimate={3}
      />,
    )

    expect(counter('VENCIDA')?.textContent).toContain('2')
    expect(counter('HOY')?.textContent).toContain('1')
    expect(counter('PROXIMA')?.textContent).toContain('1')
    expect(counter(undefined)?.textContent).toContain('3')

    // Lo que todavía no corre riesgo no tiene contador propio: no es una excepción que vigilar.
    expect(counter('FUTURA')).toBeNull()
  })

  it('los contadores se solapan: un ticket sin estimación y vencido suma en los dos', () => {
    // Responden preguntas distintas —cuántas promesas se incumplieron y cuánto no se puede
    // planificar— y forzar que cada ticket cupiera en una sola casilla escondería una de las dos.
    render(<CommitmentSummary risks={{ a: 'VENCIDA' }} withoutEstimate={1} />)

    expect(counter('VENCIDA')?.textContent).toContain('1')
    expect(counter(undefined)?.textContent).toContain('1')
  })

  it('el cero se pinta apagado y no se esconde', () => {
    render(<CommitmentSummary risks={{}} withoutEstimate={0} />)

    expect(screen.getByText('Compromisos vencidos')).toBeTruthy()
    expect(counter('VENCIDA')?.dataset.empty).toBe('true')
  })

  it('la etiqueta acompaña al número, no solo el color', () => {
    render(<CommitmentSummary risks={{ a: 'HOY' }} withoutEstimate={0} />)

    // El lector de pantalla oye «1 entregas hoy», y quien no distingue el naranja lee el rótulo.
    expect(counter('HOY')?.textContent).toContain('Entregas hoy')
  })
})
