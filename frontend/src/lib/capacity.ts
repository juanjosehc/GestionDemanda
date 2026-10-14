/**
 * Estado de la capacidad restante de un plan vigente.
 *
 * Son los dos casos que el backend ya senala —restante exactamente cero y restante negativo—, no
 * umbrales: `0` es el punto en el que el siguiente requerimiento desplaza a otro, y `< 0` el estado
 * que contradice el propio contexto del plan. Ninguna vista anade criterio propio.
 */
export type RemainingState = 'ok' | 'full' | 'over'

/**
 * El estado de un restante. Vive aqui, y no dentro de una tabla, porque tiene dos consumidores —el
 * resumen de cuellos de botella del tablero y la tabla de equipo— y un hecho con dos copias acaba
 * teniendo dos formas.
 *
 * El estado se pinta con el **numero**, nunca con una palabra: el signo es la informacion, y una
 * etiqueta al lado del cero diria dos veces lo mismo.
 */
export function remainingState(remainingHours: number): RemainingState {
  if (remainingHours < 0) return 'over'
  if (remainingHours === 0) return 'full'
  return 'ok'
}
