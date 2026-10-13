/**
 * Cliente HTTP centralizado.
 *
 * Todo acceso al backend pasa por aqui: un solo lugar para la URL base, las cabeceras,
 * el parseo de errores y la cancelacion de peticiones.
 *
 * Las tres operaciones que la aplicacion usa —leer, crear y reemplazar— comparten el mismo
 * transporte. Lo unico que cambia entre ellas es el metodo y si llevan cuerpo, asi que el manejo de
 * errores y la deteccion de cancelacion viven una sola vez.
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
 * Una peticion a la API, con el cuerpo ya serializado a JSON.
 *
 * El mensaje del error **es el que manda el backend**, sin traduccion: un 400, un 404 y un 409
 * explican cada uno un problema distinto y con sus propias palabras, y reescribirlos aqui seria
 * sustituir el diagnostico por uno peor. El estado viaja en el `ApiError` por si quien llama
 * necesita distinguirlos —la pantalla de declaracion no lo hace: enseña el texto y ya—.
 *
 * @param body `undefined` para las lecturas, que no llevan cuerpo ni `Content-Type`.
 * @param signal Solo en las lecturas: una escritura cancelada a medias deja la duda de si aplico.
 */
async function call(
  path: string,
  method: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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

  return response
}

/**
 * GET sobre la API del backend.
 *
 * @param path  Ruta absoluta, p. ej. "/api/glpi/health".
 * @param signal Señal para cancelar la peticion (TanStack Query la entrega al desmontar).
 */
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await call(path, 'GET', undefined, signal)

  return (await response.json()) as T
}

/**
 * POST sobre la API del backend: crea un recurso y devuelve el que quedo guardado.
 *
 * Sin señal de cancelacion a proposito. Una lectura cancelada no deja rastro; una escritura
 * cancelada deja la duda de si el servidor la aplico antes de cortar, y esa duda se resuelve
 * recargando la lista, no adivinando.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await call(path, 'POST', body)

  return (await response.json()) as T
}

/** PUT sobre la API del backend: **reemplaza** el recurso y devuelve como quedo entero. */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await call(path, 'PUT', body)

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
