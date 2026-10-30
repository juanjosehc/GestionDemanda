/**
 * El interruptor del Modo DEMO.
 *
 * **No hay autenticacion todavia** —el encabezado dice que llega en la Fase 2—, asi que «visible
 * solo para administradores» se resuelve como una bandera de despliegue: `VITE_DEMO_ADMIN=false` en
 * el build que va a produccion esconde el boton y desactiva la capa entera. Quien pueda editar el
 * bundle puede saltarselo; hoy no hay nada mas fuerte que ofrecer, y decirlo es parte del contrato.
 *
 * El estado vive en `localStorage` y **se relee en cada peticion**: activar o desactivar recarga la
 * pagina para que el QueryClient no mezcle datos reales con sinteticos, pero si alguien escribiera
 * la clave a mano, la siguiente lectura ya viaja por la capa DEMO.
 */

const STORAGE_KEY = 'gd:demo'

/**
 * Si el navegador deja guardar. Se comprueba una vez, al cargar, porque el modo **depende** de
 * recordarse: sin almacenamiento, encenderlo duraria hasta la recarga que el propio boton dispara, y
 * el usuario veria el boton volver solo. Mejor no ofrecerlo que ofrecerlo roto.
 */
const CAN_REMEMBER: boolean = (() => {
  try {
    const probe = `${STORAGE_KEY}:probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
})()

/** Si este despliegue permite el Modo DEMO. Por defecto si: es una herramienta de demostracion. */
export const DEMO_AVAILABLE: boolean = import.meta.env.VITE_DEMO_ADMIN !== 'false' && CAN_REMEMBER

function stored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

/** Si la aplicacion debe consumir el escenario sintetico en vez del backend. */
export function isDemoActive(): boolean {
  return DEMO_AVAILABLE && stored()
}

/**
 * Enciende o apaga el modo. **No recarga**: quien llama decide, y la pantalla lo hace con
 * `window.location.reload()` para que ninguna consulta ya cacheada sobreviva al cambio.
 */
export function setDemoActive(active: boolean): void {
  try {
    if (active) {
      localStorage.setItem(STORAGE_KEY, 'on')
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Solo alcanzable si el almacenamiento se bloquea despues de cargar; el modo no se ofrece entonces.
  }
}
