interface ItemDetailProps {
  item: TimelineItem
  /** El nombre de la persona, el mismo que usa la rejilla. */
  name: string
  /** La cobertura de esa persona, si su declaración se pudo leer. Es la fila que ya calculó la tabla. */
  coverage: DeveloperCoverage | undefined
  /** La renegociación del elemento, si el plan lo desplazó y la lectura llegó. */
  renegotiation: RenegotiationItem | undefined
  /** Los conflictos del mismo elemento, si los hubiera. */
  conflicts: readonly TeamConflict[]
  onClose: () => void
}

/**
 * El detalle de un tramo, como panel lateral.
 *
 * **Es un panel fijo, no una caja en el flujo.** Antes se pintaba debajo de la agenda y el gestor
 * tenía que bajar hasta él; al cerrarlo, la página volvía a su sitio. Ahora se abre a la derecha
 * —`fixed`, fuera del flujo— así que la rejilla no se mueve, y pulsar otro tramo cambia el contenido
 * del mismo panel en vez de tener que cerrarlo primero. **Se eligió panel lateral y no modal**: un
 * modal tapa la agenda y bloquea justo el clic con el que se cambia de ticket.
 *
 * **No calcula nada.** La causa es el evento que el plan auditó al moverlo —fecha original, fecha
 * nueva, regla, incidente y motivo—, el estado de la renegociación es el que el backend publica al
 * leer y la cobertura es la fila que la tabla de cobertura ya calculó. Esta sección solo pinta y
 * ofrece las acciones que llevan a pantallas existentes.
 *
 * **Cada acción aparece solo si el dato la sostiene.** «Renegociar» no está en los tramos que no se
 * movieron, porque la pantalla de renegociaciones no tendría nada que enseñar: una acción visible que
 * lleva a una lista vacía enseña a desconfiar de la pantalla entera.
 */
function ItemDetail({ item, name, coverage, renegotiation, conflicts, onClose }: ItemDetailProps) {
  const displaced = item.planningStatus === 'DESPLAZADO'
  const panelRef = useRef<HTMLElement>(null)

  // Al abrirse, el foco entra en el panel para que el teclado opere el detalle sin recorrer la
  // agenda. `TeamTimeline` lo devuelve al tramo al cerrar, que es quien sabe de dónde se abrió.
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside
      role="dialog"
      aria-labelledby="detalle-tramo"
      data-slot="item-detail"
      tabIndex={-1}
      ref={panelRef}
      // z-50: por encima de la barra lateral (z-40) y de la rejilla. El ancho deja ver la agenda a
      // la izquierda en escritorio; en móvil ocupa la pantalla, que es lo único que cabe.
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl outline-none"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h2 id="detalle-tramo" className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>{item.workItemType === 'INCIDENTE' ? 'Incidente' : 'Requerimiento'}</span>
            <span className="font-mono">{item.workItemId}</span>
            <Badge variant={displaced ? 'warning' : 'info'}>
              {displaced ? 'Desplazado' : 'Planificado'}
            </Badge>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {name} · {formatDay(item.startsAt.slice(0, 10))} · {formatTime(item.startsAt)}–
            {formatTime(item.endsAt)} · {formatHours(item.durationHours)} h de{' '}
            {formatHours(item.estimatedHours)} h estimadas
            {item.committedDate && ` · compromiso ${formatDay(item.committedDate)}`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Plan <span className="font-mono">{item.sourcePlanId}</span>
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Cerrar detalle"
          className="shrink-0"
        >
          <X />
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {/* Las acciones van justo bajo la cabecera: lo que se va a hacer queda a la vista sin bajar
            por el resto del detalle. */}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              to={declarationPath({
                developerId: item.developerId,
                workItemId: item.workItemId,
                from: ROUTES.teamTimeline,
              })}
            >
              Declarar
            </Link>
          </Button>

          {(item.displacement || renegotiation) && (
            <Button asChild variant="outline" size="sm">
              <Link to={renegotiationPath(item.workItemId)}>Renegociar</Link>
            </Button>
          )}

          <Button asChild variant="ghost" size="sm">
            <Link to={calendarPath(item.sourcePlanId)}>Abrir detalle</Link>
          </Button>

          {/*
            Comparar vive en el calendario y sigue viviendo ahi: no se trae la pantalla, se enlaza.
            Lo que cambia es desde donde se llega —de una barra del timeline en vez de la lista de
            planes—, que es lo que convierte la comparacion en un modo del timeline.
          */}
          <Button asChild variant="ghost" size="sm">
            <Link to={comparisonPath(item.sourcePlanId)}>Comparar</Link>
          </Button>
        </div>

        {coverage && (
          <p data-slot="item-coverage" className="text-xs text-muted-foreground">
            Cobertura de {name}: {coverage.covered} de {coverage.active} tickets activos en el plan ·{' '}
            {coverage.pending} pendientes · {coverage.blockedByInformation} recuperables declarando.
          </p>
        )}

        {item.displacement && (
          <dl
            data-slot="item-displacement"
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs"
          >
            <dt className="text-muted-foreground">Fecha original</dt>
            <dd>{formatDay(item.displacement.originalDate)}</dd>
            <dt className="text-muted-foreground">Fecha nueva</dt>
            <dd>{formatDay(item.displacement.newDate)}</dd>
            <dt className="text-muted-foreground">Regla aplicada</dt>
            <dd className="font-mono">{item.displacement.appliedRule}</dd>
            <dt className="text-muted-foreground">Incidente causante</dt>
            <dd className="font-mono">
              {item.displacement.incidentId ?? 'Ocupación previa de la jornada'}
              {item.displacement.incidentSeverity && ` · ${item.displacement.incidentSeverity}`}
            </dd>
            <dt className="text-muted-foreground">Motivo</dt>
            <dd>{item.displacement.reason}</dd>
          </dl>
        )}

        {renegotiation && (
          <p
            data-slot="item-renegotiation"
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <Badge variant={renegotiation.status === 'ACORDADA' ? 'success' : 'warning'}>
              {renegotiation.status === 'ACORDADA' ? 'Acordada' : 'Pendiente de acuerdo'}
            </Badge>
            {renegotiation.renegotiation ? (
              <>
                <span>Fecha acordada: {formatDay(renegotiation.renegotiation.agreedDate)}</span>
                <span className="text-muted-foreground">
                  por {renegotiation.renegotiation.agreedBy}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Todavía no hay una fecha acordada.</span>
            )}
          </p>
        )}

        {conflicts.length > 0 && (
          <p data-slot="item-conflict" className="flex flex-wrap items-baseline gap-2 text-xs">
            <Badge variant="danger">Sin hueco</Badge>
            <span className="text-muted-foreground">{conflicts[0]?.reason}</span>
          </p>
        )}
      </div>
    </aside>
  )
}
