/// <reference types="vite/client" />

/** Variables de entorno expuestas al cliente. Todas deben llevar el prefijo VITE_. */
interface ImportMetaEnv {
  /**
   * URL base del backend. Vacio (por defecto) = rutas relativas, resueltas por el proxy de
   * Vite en desarrollo y por el reverse proxy en produccion.
   */
  readonly VITE_API_BASE_URL?: string
}
