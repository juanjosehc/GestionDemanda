
describe('Declarations · el formulario vive en un panel', () => {
  /** El panel lateral abierto: un `role="dialog"` no modal, el mismo del Timeline. */
  function panel(): HTMLElement {
    return screen.getByRole('dialog')
  }

  it('declarar abre un panel fijo con el formulario dentro y la tabla detrás', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '504')

    // Fuera del flujo: es un panel `fixed` y la tabla sigue montada, en su sitio y completa.
    expect(panel()).toHaveClass('fixed')
    expect(within(panel()).getByRole('button', { name: 'Guardar' })).toBeInTheDocument()
    expect(within(panel()).getByLabelText('Horas estimadas')).toBeInTheDocument()
    expect(rows(container)).toHaveLength(5)

    // La fila sigue marcada como abierta, que es de donde vendra el foco al cerrar.
    expect(within(rowOf(container, '504')).getByRole('button')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('el foco entra en el primer campo util al abrir y vuelve al boton de la fila al cerrar', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '501')

    // El formulario se monta después de la lectura previa, y al montarse toma el foco.
    expect(field('Horas estimadas')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(rowOf(container, '501')).getByRole('button')).toHaveFocus()
  })

  it('Escape cierra el panel y devuelve el foco a la fila', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '502')

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(rowOf(container, '502')).getByRole('button')).toHaveFocus()
  })

  it('pulsar otra fila cambia el contenido del mismo panel, sin duplicarlo', async () => {
    serve({})

    const { container } = renderWithClient(<Declarations />, { route: '/declaraciones' })
    await consultar(container)
    await abrir(container, '501')

    expect(panel()).toHaveTextContent('501')

    fireEvent.click(within(rowOf(container, '503')).getByRole('button'))

    // Un solo panel, con el ticket nuevo y su foco en el primer campo.
    await waitFor(() => expect(panel()).toHaveTextContent('503'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(field('Horas estimadas')).toHaveFocus()
  })

  it('el atajo abre el pendiente en el mismo panel y no lo duplica', async () => {
    serve({})

    renderWithClient(<Declarations />, { route: '/declaraciones' })
    await screen.findByText('Tickets asignados')

    fireEvent.click(screen.getByRole('button', { name: 'Declarar siguiente pendiente' }))
    await screen.findByRole('button', { name: 'Guardar' })

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(panel()).toHaveTextContent('502')
  })
})
