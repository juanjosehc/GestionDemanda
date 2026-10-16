/**
 * Un numero del resultado, con el rotulo encima.
 *
 * **Se cuentan listas; no se recalcula nada.** El `slot` es el nombre con el que cada prueba agarra
 * la cifra, y existe porque un numero sin identidad estable solo se puede afirmar por su posicion,
 * que cambia en cuanto se anade una cifra al lado.
 *
 * Vive aqui y no en la pantalla que lo estreno porque tres vistas lo comparten —planificacion, su
 * vista previa y la declaracion— y un componente importando de una pagina es una inversion de capas
 * que se paga despues.
 */
function Figure({
  label,
  value,
  slot,
  hint,
}: {
  label: string
  value: number | string
  slot: string
  hint?: string
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd data-slot={slot} className="tabular-nums">
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export { Figure }
