
  /**
   * La Fase 53 cambia el detalle de sitio, no de contenido: las mismas acciones, ahora en un panel
   * fijo a la derecha. El panel no tapa la agenda ni mueve la página, y el tramo elegido se puede
   * cambiar sin cerrarlo.
   */
  it('abre el detalle como panel lateral y deja la agenda a la vista', async () => {
    serve({ declarations: declarationsForBoth(), timeline: teamTimelineFixture({ items: [DESPLAZADO] }) })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ }))

    const detalle = await screen.findByRole('dialog', { name: /REQ-1/ })

    // El panel está fuera del flujo: la rejilla sigue montada, con sus columnas y sus tramos.
    expect(detalle.className).toContain('fixed')
    expect(screen.getByRole('region', { name: 'Agenda del equipo' })).toBeDefined()
    expect(document.querySelectorAll('[data-slot="timeline-block"]').length).toBeGreaterThan(0)
  })

  it('cambia el contenido del panel al elegir otro tramo, sin cerrarlo', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ }))
    expect(await screen.findByRole('dialog', { name: /REQ-1/ })).toBeDefined()

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /INC-1/ }))

    // Un solo panel, con el detalle del segundo tramo: no se apila otro ni hay que cerrar el primero.
    expect(await screen.findByRole('dialog', { name: /INC-1/ })).toBeDefined()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('cierra con el botón y con Escape, y devuelve el foco al tramo', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    const bloque = within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ })
    // El clic no enfoca en jsdom: se enfoca explícitamente para comprobar la vuelta del foco.
    bloque.focus()
    fireEvent.click(bloque)

    const detalle = await screen.findByRole('dialog', { name: /REQ-1/ })
    fireEvent.click(within(detalle).getByRole('button', { name: 'Cerrar detalle' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(bloque)

    // Escape también cierra: el teclado no depende de acertar la X.
    fireEvent.click(bloque)
    expect(await screen.findByRole('dialog', { name: /REQ-1/ })).toBeDefined()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('enseña la cobertura de la persona dentro del detalle', async () => {
    serve({ declarations: declarationsForBoth() })

    renderWithClient(<TeamTimeline />)
    await screen.findByText('Ana Perez')

    fireEvent.click(within(fila('Ana Perez')).getByRole('button', { name: /REQ-1/ }))

    const detalle = await screen.findByRole('dialog', { name: /REQ-1/ })
    expect(detalle.querySelector('[data-slot="item-coverage"]')?.textContent).toContain(
      'Cobertura de Ana Perez',
    )
  })
