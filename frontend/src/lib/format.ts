/** Formato de los instantes del contrato, en la hora del navegador. */
const INSTANT_FORMAT = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Un instante UTC del contrato, en la hora del navegador.
 *
 * Vive aqui porque lo usan tres vistas —el tablero, el centro de alertas y la vista de equipo— y el
 * formato de una fecha es exactamente el tipo de hecho que se copia tres veces y acaba escrito de
 * tres formas.
 */
export function formatInstant(isoInstant: string): string {
  return INSTANT_FORMAT.format(new Date(isoInstant))
}
