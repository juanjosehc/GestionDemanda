/**
 * Quien declara, recordado entre visitas.
 *
 * **Es una comodidad del navegador, no un dato del dominio.** El firmante no se autentica —la
 * aplicacion no tiene sesion— y por eso lo unico que se guarda es el texto que la persona escribio
 * la ultima vez, para no teclearlo en cada ticket ni en cada lote. La declaracion que llega al
 * backend sigue llevando su `changedBy` explicito: si este almacenamiento no esta disponible, el
 * campo se abre vacio y el flujo funciona igual.
 *
 * `localStorage` puede lanzar en ventanas privadas o con el almacenamiento bloqueado, asi que las dos
 * operaciones lo tratan como opcional. No se guarda un valor vacio: borrar el campo y guardar no debe
 * convertir la ausencia de firma en una firma en blanco para la proxima vez.
 */
const KEY = 'gestion-demanda:firmante'

export function readFirmante(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberFirmante(value: string): void {
  const trimmed = value.trim()

  if (trimmed === '') return

  try {
    localStorage.setItem(KEY, trimmed)
  } catch {
    // Sin almacenamiento disponible el campo se vuelve a teclear; no es un error del flujo.
  }
}
