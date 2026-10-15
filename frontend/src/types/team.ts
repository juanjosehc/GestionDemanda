/**
 * Contrato de `GET /api/team`: el padrón del equipo.
 *
 * Es la única lectura del sistema que enumera personas. Todo lo demás pregunta por alguien que ya se
 * conoce —el plan por desarrollador, la declaración por desarrollador, los tickets por usuario de
 * GLPI—, y por eso hasta ahora la pantalla de recursos tenía que consolidar planes: era lo único
 * enumerable.
 *
 * **Quién está en el equipo lo decide esta respuesta, no la fotografía operativa.** Es la separación
 * que la vista necesitaba: aquí está el padrón con el origen de cada persona, y en
 * `/api/planning/metrics` sigue estando la capacidad. Cruzar dos respuestas es lo que permite que el
 * equipo siga en pie cuando GLPI no responde —una de las dos fuentes cae, la otra no—.
 */

/** De dónde salió una fila del padrón. */
export type TeamPersonSource = 'GLPI' | 'EXCEPTION'

/** Una persona del equipo, con su origen. */
export interface TeamPerson {
  /** El login con el que el sistema la nombra en todo lo demás. */
  developerId: string
  /** Su identificador numérico en GLPI, o nulo si no tiene cuenta. */
  glpiId: number | null
  /** Su nombre legible, o nulo si GLPI no publica ninguno utilizable. */
  name: string | null
  /** Si su cuenta está vigente. */
  active: boolean
  sourceType: TeamPersonSource
  /**
   * Si forma parte del equipo operativo: con quien se trabaja a diario.
   *
   * **No es una segunda lista de personas.** GLPI sigue enumerando a todo el mundo y esta respuesta los
   * publica a todos; lo que cambia es a quien enseña por defecto la vista del equipo. La pertenencia la
   * decide la configuración local —`team.operational` en el backend—, y por eso una persona nueva en el
   * grupo llega aquí con `false`: entra al padrón el día que GLPI la publique, y al equipo operativo el
   * día que alguien la declare.
   */
  operational: boolean
}

/**
 * Cómo fue la lectura del grupo de GLPI.
 *
 * `available` en falso no significa que el equipo esté vacío: significa que no se pudo preguntar. En
 * ese estado el padrón trae solo las excepciones, y por eso el motivo viaja en `detail` en vez de
 * quedarse en el registro del servidor.
 */
export interface TeamGlpiStatus {
  available: boolean
  groupId: number | null
  groupName: string | null
  /** El motivo por el que no se pudo leer, o nulo si sí se pudo. */
  detail: string | null
}

/** De dónde sale cada mitad del padrón, tal como lo declara el backend. */
export interface TeamCatalogSource {
  glpi: string
  exceptions: string
}

/** Respuesta completa de GET /api/team. */
export interface TeamCatalogResponse {
  /** Instante UTC en que se armó el catálogo. */
  generatedAt: string
  source: TeamCatalogSource
  glpi: TeamGlpiStatus
  /** Las personas del equipo, ordenadas por identificador. */
  people: TeamPerson[]
  /**
   * Logins declarados como excepción que GLPI ya entregaba, y que por tanto no se aplicaron.
   *
   * Van en la respuesta para poder verlos: una excepción que no hace nada es una decisión de alguien
   * que quedó sin efecto, y callarla deja una entrada muerta que solo se descubre el día que alguien
   * la lee y no entiende para qué está.
   */
  unusedExceptions: string[]
  /**
   * Marcas de equipo operativo que no corresponden a ninguna persona del padrón.
   *
   * Existe por el mismo motivo que la lista de arriba, y aquí es además la única defensa contra una
   * errata: la pertenencia se escribe a mano en la configuración, y un login mal escrito no saca a nadie
   * de la vista por defecto —la persona marcada no está en el padrón y la que se quería marcar sigue
   * fuera—. Sin publicarlas, ese error no haría nada y no avisaría.
   */
  unusedOperational: string[]
}
