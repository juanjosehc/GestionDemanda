/** Espeja el DTO GlpiHealthResponse del backend (GET /api/glpi/health). */
export interface GlpiHealth {
  /** El servidor GLPI respondio la peticion. */
  connected: boolean
  /** Las credenciales fueron aceptadas y la sesion es valida. */
  authenticated: boolean
  /** URL configurada en el backend (solo lectura, no es secreto). */
  baseUrl: string
  /** Marca de tiempo ISO-8601 del momento de la verificacion. */
  checkedAt: string
  /** Explicacion legible del resultado. */
  detail: string
}
