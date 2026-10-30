/// <reference types="vite/client" />

/** Variables de entorno expuestas al cliente. Todas deben llevar el prefijo VITE_. */
interface ImportMetaEnv {
  /**
   * URL base del backend. Vacio (por defecto) = rutas relativas, resueltas por el proxy de
   * Vite en desarrollo y por el reverse proxy en produccion.
   */
  readonly VITE_API_BASE_URL?: string
  /**
   * Si este despliegue ofrece el Modo DEMO. `false` esconde el boton y desactiva la capa sintetica.
   *
   * Es la unica forma de decir «solo para administradores» mientras no exista autenticacion: el
   * control es del despliegue, no de la sesion, y por eso quien edite el bundle puede saltarselo.
   */
  readonly VITE_DEMO_ADMIN?: string
}
