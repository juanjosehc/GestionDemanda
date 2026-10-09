/**
 * Cliente HTTP centralizado.
 *
 * Todo acceso al backend pasa por aqui: un solo lugar para la URL base, las cabeceras,
 * el parseo de errores y la cancelacion de peticiones.
 */

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''

/** Error de transporte o de respuesta HTTP de la API. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * GET sobre la API del backend.
 *
 * @param path  Ruta absoluta, p. ej. "/api/glpi/health".
 * @param signal Señal para cancelar la peticion (TanStack Query la entrega al desmontar).
 */
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (cause) {
    // fetch solo rechaza por fallo de red o cancelacion, nunca por codigos HTTP.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause
    }
    throw new ApiError('No fue posible contactar el backend', 0)
  }

  if (!response.ok) {
    throw new ApiError(await describeError(response), response.status)
  }

  return (await response.json()) as T
}

/** Extrae el mensaje del contrato ApiError del backend si esta disponible. */
async function describeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string }
    if (body.message) {
      return body.message
    }
  } catch {
    // Respuesta sin cuerpo JSON: se usa el mensaje generico.
  }

  return `La API respondio con estado ${response.status}`
}
