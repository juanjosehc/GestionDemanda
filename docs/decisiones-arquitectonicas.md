# Decisiones arquitectónicas

Registro de las decisiones tomadas durante la construcción del sistema, con el contexto y las alternativas que se descartaron. El objetivo es que quien retome el proyecto en una fase posterior no tenga que reconstruir el razonamiento.

- [Fase 1 — Integración con GLPI](#fase-1--integración-con-glpi) (decisiones 1–14)
- [Fase 2 — Núcleo de dominio](#fase-2--núcleo-de-dominio) (decisiones 15–23)
- [Fase 3 — Priorización por severidad](#fase-3--priorización-por-severidad) (decisiones 24–30)
- [Fase 4 — Tiempo hábil](#fase-4--tiempo-hábil) (decisiones 31–36)
- [Fase 5 — Modelo temporal unificado](#fase-5--modelo-temporal-unificado) (decisiones 37–44)

---

# Fase 1 — Integración con GLPI

---

## 1. Aislamiento de GLPI

**Decisión.** Todo el conocimiento de GLPI vive en `client/GlpiClient.java`. Las capas `service/` y `controller/` solo manejan objetos del dominio (`GlpiHealthResponse`).

**Motivo.** El requerimiento explícito era no acoplar la lógica de negocio futura a GLPI. La lógica de priorización entre Incidentes y Requerimientos es el corazón del sistema, y GLPI es una fuente de datos entre varias posibles.

**Consecuencia.** En la Fase 2, la priorización se escribe contra interfaces del dominio. Añadir o sustituir una fuente no toca la lógica de negocio.

**Descartado.** Llamar a GLPI directamente desde el servicio, o exponer los DTO de GLPI al exterior. Menos código al principio, pero ata el modelo de dominio al formato de un proveedor externo.

---

## 2. `connected` y `authenticated` como campos separados

**Decisión.** El endpoint devuelve ambos booleanos por separado, respaldados por dos excepciones distintas: `GlpiUnreachableException` (fallo de red) y `GlpiConnectionException` (respuesta HTTP recibida).

**Motivo.** `initSession` de GLPI usa el `user_token`, así que un token inválido hace fallar la llamada aunque el servidor esté perfectamente accesible. Con un único booleano, "el servidor está caído" y "las credenciales están mal" serían indistinguibles, y son dos incidentes con dos responsables distintos.

**Consecuencia.** El diagnóstico desde la UI es inmediato: `connected:true, authenticated:false` apunta a los tokens; `connected:false` apunta a la red o a la URL.

**Coste.** Dos clases de excepción y mapeo de errores en el cliente. Se consideró asumible porque el contrato del endpoint exigía ambos campos.

---

## 3. WebClient en una aplicación servlet

**Decisión.** El backend es Spring MVC (servlet), pero el cliente HTTP saliente es `WebClient` (reactivo).

**Motivo.** `WebClient` es el cliente recomendado por Spring desde hace varias versiones, con mejor soporte de timeouts y de traducción de errores que `RestTemplate`, que está en modo mantenimiento. Al convivir `starter-web` y `starter-webflux` en el classpath, Spring Boot arranca en modo **SERVLET** — verificado en los logs de arranque.

**Consecuencia.** Todo el camino hacia GLPI es reactivo; el bloqueo ocurre en un único punto controlado (`.block(timeout)` en el servicio).

**Descartado.** `RestTemplate` — API en mantenimiento y gestión de timeouts más torpe. Migrar todo a WebFlux — sobredimensionado: la aplicación no tiene carga concurrente que lo justifique y complicaría el modelo de programación sin beneficio.

---

## 4. Carga del archivo `.env` sin herramientas externas

**Decisión.** `spring.config.import=optional:file:./.env[.properties]` en `application.properties`.

**Motivo.** Permite tener las credenciales en un `.env` sin añadir dependencias (`dotenv-java`) ni obligar a exportar variables en cada terminal. El prefijo `optional:` hace que la aplicación arranque aunque el archivo no exista.

**Consecuencia.** Se importan dos rutas (`./` y `../`) para que funcione tanto ejecutando desde `backend/` como desde la raíz.

**Nota.** El archivo se lee como *properties*, no como *dotenv*: sin `export` y sin comillas envolventes.

---

## 5. La aplicación arranca sin GLPI configurado

**Decisión.** `GlpiProperties` no se valida al arrancar. Si faltan credenciales, la aplicación levanta con normalidad y `/api/glpi/health` lo reporta.

**Motivo.** Permite trabajar en el frontend y en el resto del backend sin depender de un GLPI accesible. Un fallo de configuración no debe impedir arrancar.

**Descartado.** `@Validated` + `@NotBlank` en las propiedades. Habría hecho fallar el arranque con un mensaje claro, pero bloquea el desarrollo sin GLPI.

---

## 6. El endpoint de salud nunca falla

**Decisión.** `/api/glpi/health` siempre responde `200`. El estado va en el cuerpo, no en el código HTTP.

**Motivo.** Su propósito es *reportar* el estado, no operar. Devolver `503` cuando GLPI está caído haría que un monitor de disponibilidad interpretase que **nuestro** backend está caído, cuando en realidad está funcionando correctamente y lo que falla es una dependencia. Además, `503` haría que el frontend tuviese que leer el error para pintar la tarjeta, en lugar de pintarla con la respuesta.

**Consecuencia.** Los errores reales de la API sí usan códigos HTTP correctos, gestionados por `GlobalExceptionHandler`.

---

## 7. Sin CORS: proxy de Vite y reverse proxy en nginx

**Decisión.** El frontend usa rutas relativas (`/api/...`). En desarrollo, Vite redirige a `localhost:8080`; en producción, nginx.

**Motivo.** Evita configurar CORS en el backend y evita que el navegador haga peticiones cross-origin. La configuración de red vive donde corresponde: en el servidor web.

**Consecuencia.** `VITE_API_BASE_URL` queda como escape hatch para apuntar a un backend remoto sin proxy, pero el valor por defecto (vacío) es el correcto.

---

## 8. shadcn/ui escrito a mano

**Decisión.** Las cuatro primitivas usadas (`button`, `card`, `badge`, `skeleton`) están escritas en el repositorio, siguiendo la convención de shadcn, junto con un `components.json` válido.

**Motivo.** La CLI de shadcn es interactiva, depende de la red y su salida varía entre versiones. Escribirlas deja un resultado determinista y reproducible, sin dejar de ser el mismo código que generaría la CLI.

**Consecuencia.** `npx shadcn@latest add <componente>` sigue funcionando para añadir nuevos componentes en el futuro, porque `components.json` está configurado con los alias correctos.

**Extra.** `Badge` incorpora variantes semánticas (`success`, `warning`, `danger`, `info`) además de las estándar, porque el dashboard necesita representar estados operativos. Se apoyan en la paleta de Tailwind y no en tokens de marca, ya que son señales funcionales.

---

## 9. Tailwind v4 con configuración CSS-first

**Decisión.** Sin `tailwind.config.js`. Los tokens se declaran en `src/index.css` con `@theme inline` sobre variables CSS en `:root` y `.dark`.

**Motivo.** Es el modelo de Tailwind v4. Las variables CSS en `:root` permiten además alternar el tema (`.dark`) sin recompilar.

**Consecuencia.** El modo oscuro ya está preparado a nivel de tokens: basta con añadir la clase `dark` al elemento raíz. No se expone todavía en la UI porque la Fase 1 pedía modo claro.

---

## 10. Timeline sin librería

**Decisión.** `components/timeline/ResourceTimeline.tsx` es un componente propio que hoy solo pinta el estado vacío, con los tipos (`Resource`, `PlanningItem`, `TimelineWindow`) ya definidos en `types/resource.ts`.

**Motivo.** El requerimiento permitía usar una librería de resource planning, pero pedía explícitamente dejar solo preparada la base y la abstracción. Añadir una librería antes de conocer la forma real de los datos obligaría a adaptarla después.

**Consecuencia.** El contrato del componente (`PlanningItem[]` + `TimelineWindow`) es el que debe consumir la librería que se elija en la Fase 2. Sustituir el interior no afecta a quien lo use.

---

## 11. Datos mockeados aislados en un servicio

**Decisión.** Los datos falsos del dashboard viven en `services/metricsService.ts`, con la misma firma (`Promise`) que tendrá la llamada real, y expuestos vía `useResourceMetrics`.

**Motivo.** Evitar que datos de prueba se filtren a componentes y queden ahí cuando lleguen los reales.

**Consecuencia.** La Fase 2 sustituye el cuerpo de `fetchResourceMetrics` por una llamada HTTP y no toca ningún componente.

---

## 12. `lucide-react` y árbol de rutas

**Decisión.** Rutas declaradas en `routes/navigation.ts` (constante `ROUTES` + `NAV_ITEMS`) y consumidas tanto por el router como por el sidebar.

**Motivo.** Una única fuente de verdad: añadir una sección es una línea, no tres sitios que hay que mantener sincronizados.

**Consecuencia.** La ruta activa del sidebar, el título del header y el router no pueden desincronizarse.

---

## 13. Logs estructurados opcionales

**Decisión.** `logging.structured.format.console=ecs` en `application-prod.properties`, activo solo con `SPRING_PROFILES_ACTIVE=prod`.

**Motivo.** En desarrollo, el log legible por humanos es más útil; en producción, JSON en formato ECS es lo que esperan los recolectores (Elastic, Loki, CloudWatch).

**Consecuencia.** Cero dependencias añadidas: es una funcionalidad nativa de Spring Boot 3.4+.

---

## 14. Los tokens nunca se registran en el log

**Decisión.** `GlpiClient` no incluye `appToken`, `userToken` ni `sessionToken` en ningún mensaje de log. Solo se registra el resultado de la operación y su duración.

**Motivo.** Los logs se envían a sistemas centralizados con retención larga y acceso más amplio que el del propio servicio. Un token en un log es un token comprometido.

**Consecuencia.** Para depurar un problema de autenticación se usan los códigos de error de GLPI (que no contienen el token), no su valor.

---

# Fase 2 — Núcleo de dominio

La Fase 2 construye el motor de planificación. El requerimiento explícito era no acoplar la lógica de planificación a los controladores ni a GLPI, y evitar dependencias con Spring y JPA «siempre que sea posible». Las decisiones siguientes son, en su mayoría, formas concretas de cumplir esa restricción sin caer en un dominio que no se pueda conectar a nada.

---

## 15. El dominio es Java puro

**Decisión.** El paquete `domain/` (enums, modelos, reglas, motor, idempotencia) no importa ninguna clase de Spring, de Jakarta Persistence ni del cliente de GLPI. Sus únicas dependencias son `java.*` y `java.time`.

**Motivo.** Es la condición para que el motor sea probable sin infraestructura. `PlanningEngineTest` instancia el motor con `new` y corre en 0,4 s sin levantar contexto: 10 pruebas del comportamiento de negocio en menos tiempo del que tarda Spring en arrancar. Un dominio acoplado a Spring se prueba con `@SpringBootTest`, lo que hace que cada caso de negocio cueste segundos y empuje a probar menos.

**Consecuencia.** El coste de reemplazar GLPI o de añadir persistencia se paga en los adaptadores (`client/`, `config/`, `service/`), nunca en las reglas. Es la materialización de la decisión 1, que en la Fase 1 era una promesa y aquí es un hecho verificable: compilar `domain/` no requiere el resto de la aplicación.

**Descartado.** Anotar el dominio con `@Component` y `@ConfigurationProperties` para ahorrar la clase de configuración. Se descartó porque arrastra el contenedor al núcleo a cambio de ~20 líneas de `PlanningConfig`, y porque impide la prueba con `new`.

---

## 16. El motor no es un `@Service`

**Decisión.** `PlanningEngine` es una clase normal. Se registra como bean en `config/PlanningConfig.java`, que es la única pieza que conoce a Spring.

**Motivo.** `@Service` en el dominio es la forma habitual en que un dominio «puro» deja de serlo. La composición explícita deja a la vista qué necesita el motor (un registro de idempotencia y un reloj) sin tener que leer sus anotaciones ni adivinar el grafo de inyección.

**Consecuencia.** `PlanningService` (@Service, en `service/`) es el adaptador: traduce DTO ↔ dominio y no decide nada. El controlador solo delega en él.

---

## 17. Las reglas son un objeto de dominio, no configuración de Spring

**Decisión.** `PlanningRules` es un `record` de dominio con valores por defecto propios (`defaults()`). `PlanningProperties` (`@ConfigurationProperties(prefix = "planning")`) es el transporte y expone `toRules()`.

**Motivo.** El umbral de dedicación y la jornada son reglas de negocio: el motor debe poder razonar sobre ellas (y probarlas) sin que Spring las haya inyectado. Al mismo tiempo, tienen que ser configurables sin recompilar.

**Consecuencia.** Dos objetos pequeños en lugar de uno, pero el dominio conserva sus invariantes: `PlanningRules` valida en su constructor compacto que el umbral y la jornada sean positivos y que el horizonte sea de al menos un día. La validación no depende de que alguien anote un `@Validated`.

**Descartado.** Pasar los valores sueltos al motor, o leerlos con `@Value`. El objeto permite además que la simulación los sobrescriba puntualmente sin tocar la configuración de la aplicación.

---

## 18. Orden de resolución: primero incidentes, después requerimientos

**Decisión.** El motor ubica todos los incidentes abiertos (consumo voraz desde el día en que se reportaron) y solo después recorre los requerimientos, ordenados por fecha pactada y desempate por id.

**Motivo.** Expresa la prioridad del negocio en el orden del algoritmo en lugar de en una puntuación: un incidente tiene impacto corporativo y SLA de un día, y no compite de igual a igual con un requerimiento. El desempate estable por id garantiza que dos ejecuciones con los mismos datos produzcan el mismo plan.

**Consecuencia.** Los incidentes nunca se desplazan; el trabajo desplazable es el requerimiento. Cuando un incidente no cabe en su jornada, se reporta como un bloque que arranca ese día y vierte el excedente a los días siguientes.

---

## 19. Idempotencia: reclamo atómico detrás de una interfaz

**Decisión.** La protección contra reprocesamiento es la pareja (*incidente*, *requerimiento*). `RescheduleLedger.claim(incidentId, requirementId)` comprueba y registra en **una sola** operación (`Set.add` sobre un `ConcurrentHashMap.newKeySet()`); devuelve `true` solo si nadie la había reclamado. Si devuelve `false`, el desplazamiento se aplica igual al plan pero **no se emite un segundo evento de auditoría**.

**Motivo.** Dos distinciones importantes:

- **La pareja, no el requerimiento.** Registrar solo el requerimiento impediría que un incidente *distinto* lo desplazara de nuevo más adelante, que es un hecho nuevo y merece su propio evento. Registrar la pareja deja la auditoría completa.
- **Comprobar y registrar juntos.** Un `contains()` seguido de un `add()` deja una ventana en la que dos peticiones simultáneas pueden colarse las dos. `Set.add` es atómico y cierra la ventana. El motor es un bean único y puede atender peticiones concurrentes, así que la ventana era real.

**Consecuencia.** El plan se recalcula siempre desde cero — es una función pura de la entrada — y lo único que la idempotencia filtra es la **emisión de eventos**, que es el efecto observable. Repetir la misma petición devuelve el mismo plan y cero eventos nuevos.

**Reemplazabilidad.** `RescheduleLedger` es una interfaz y `InMemoryRescheduleLedger` su implementación por defecto. Cuando exista persistencia, se sustituye el bean en `PlanningConfig` y `PlanningEngine` no cambia una línea. Se descartó explícitamente usar base de datos en esta fase, según lo pedido.

**Limitación conocida.** El registro vive en memoria: un reinicio de la aplicación lo vacía y los desplazamientos pendientes de la sesión anterior se volverían a auditar. Es aceptable en una fase sin persistencia y es exactamente lo que resuelve la implementación sobre repositorio.

---

## 20. Auditoría obligatoria y attribution de la causa

**Decisión.** Cada desplazamiento emite un `RescheduleEvent` con marca de tiempo, incidente causante, requerimiento afectado, fecha original, fecha recalculada y la regla aplicada (`AppliedRule`). El incidente causante es el que ocupa la fecha pactada; si ninguno la ocupa, el primero de los que superaron el umbral; si no hay ninguno, el campo va a `null` y la regla pasa a `CAPACIDAD_DIARIA_EXCEDIDA`.

**Motivo.** La trazabilidad no es un extra: es lo que permite responder «¿por qué este requerimiento se movió?» sin reconstruir el estado de la aplicación en ese momento. Distinguir `UMBRAL_INCIDENTE_EXCEDIDO` de `CAPACIDAD_DIARIA_EXCEDIDA` separa el caso que motiva el sistema (un incidente grave) del caso trivial (la jornada estaba llena), que tienen responsables distintos.

**Consecuencia.** El DTO de respuesta deriva `displacedRequirements` de los eventos y no de las asignaciones, de modo que un requerimiento desplazado en una ejecución anterior se ve distinto de uno desplazado ahora. Es justo lo que la idempotencia promete, hecha visible.

**Marca de tiempo.** El motor recibe un `java.time.Clock`. En producción es el reloj del sistema; en pruebas es `Clock.fixed(...)`, lo que hace que la marca de tiempo sea verificable en lugar de «aproximada».

---

## 21. Puntos de extensión previstos, no implementados

**Decisión.** El calendario laboral y la capacidad parcial se dejan como dos métodos de `PlanningRules` que hoy devuelven la jornada estándar:

```java
BigDecimal workingHoursFor(LocalDate date)
BigDecimal workingHoursFor(Developer developer, LocalDate date)
```

**Motivo.** El sistema pedía dejar el diseño preparado para festivos, calendario laboral y capacidad parcial sin implementarlos. Se descartó crear un interface `WorkingCalendar` con una sola implementación y un `FestivoRepository` vacío: sería estructura esperando contenido, y la firma correcta no se conoce hasta que exista el primer caso real (¿los festivos son por país, por ciudad, por equipo?).

**Consecuencia.** Cuando llegue el calendario, el motor no cambia: `DayBook` ya pide la capacidad a `PlanningRules` en lugar de asumir la jornada. Hoy toda la capacidad del sistema es diaria y uniforme; el día que deje de serlo, la modificación está localizada en un método.

---

## 22. Restricción de modelo: un requerimiento cabe completo en una jornada

**Decisión.** Un requerimiento que no cabe entero en ningún día del horizonte se reporta como `PlanningConflict` en lugar de repartirse entre varios días. Los incidentes sí se reparten (consumo voraz con desborde al día siguiente).

**Motivo.** Un requerimiento es una unidad de compromiso con el usuario: su fecha pactada es la fecha en que se entrega, así que partirla obligaría a definir qué significa «medio entregado» y complicaría el modelo sin que nadie lo haya pedido. Un incidente, en cambio, es trabajo continuo: empezar hoy y terminar mañana es la realidad.

**Consecuencia.** El conflicto no es un error de ejecución sino un resultado de negocio: alguien tiene que repartir la tarea, ampliar el horizonte o sumar capacidad. Se devuelve con su motivo para que la UI pueda explicarlo.

---

## 23. Endpoint de simulación, declarado temporal

**Decisión.** `POST /api/planning/simulate` recibe un escenario completo (desarrollador, incidentes, requerimientos, reglas opcionales) y devuelve la agenda, los desplazamientos y los conflictos. Está documentado en su javadoc como temporal.

**Motivo.** Permite ejercitar las reglas de negocio antes de que existan persistencia y datos reales de GLPI. Sin él, la única forma de ver el motor funcionando sería leer las pruebas.

**Consecuencia.** El controlador solo delega en `PlanningService`; el motor no sabe que existe HTTP. Cuando la planificación se integre de verdad, esta superficie probablemente desaparezca sin que el núcleo note la diferencia. Las reglas se pueden sobrescribir por petición (`rules`), lo que permite comparar escenarios con umbrales distintos sin reconfigurar la aplicación.

**Descartado.** Que la simulación acepte y devuelva los objetos de dominio directamente. Habría ahorrado los dos DTO, pero expone el modelo interno a cambios incompatibles con el contrato HTTP y anula la validación de entrada en la frontera.

---

# Fase 3 — Priorización por severidad

Esta fase incorpora el acuerdo de nivel operativo (OLA) real del negocio. Hasta aquí el motor tenía una única palanca —un umbral de horas— para todos los incidentes, y ese umbral no gobernaba la planificación: gobernaba la auditoría. Las decisiones siguientes separan las dos cosas y hacen que la severidad del incidente determine de verdad cómo compite por la jornada.

Nada de esto integra GLPI ni añade persistencia: es modelo y comportamiento, tal como se pidió.

---

## 24. `IncidentSeverity` entra al modelo, y no tener severidad es un estado válido

**Decisión.** `Incident` incorpora `severity` (`ALTO`, `MEDIO`, `BAJO`), y el campo **admite `null`**. Un incidente sin severidad es dato legado: el motor lo planifica con el umbral histórico y lo audita con `UMBRAL_INCIDENTE_EXCEDIDO`.

**Motivo.** Al generalizar un modelo con datos ya en vuelo hay dos caminos: obligar a reclasificar todo antes de planificar, o aceptar que convivan. El primero cambia el plan de los datos existentes en cuanto la severidad por defecto no coincida con el umbral, y no tiene vuelta atrás. El segundo es reversible. Con `null` admitido, las diez pruebas del motor que ya existían siguen pasando **sin cambiar una sola aserción**, que es la definición operativa de compatibilidad y no una promesa.

**Consecuencia.** `Incident` conserva su constructor de cinco argumentos y `Incident.open(...)` mantiene su sobrecarga sin severidad. Cuando GLPI empiece a enviar prioridad, el camino legado deja de ejercitarse y puede retirarse de una vez.

**Descartado.** Severidad obligatoria con valor por defecto `MEDIO`: habría cambiado la regla auditada de todo el histórico, de `UMBRAL_INCIDENTE_EXCEDIDO` a `CAPACIDAD_COMPROMETIDA`, sin que nadie lo hubiera pedido y reescribiendo el significado de eventos ya emitidos.

---

## 25. `IncidentPolicy`: la OLA por severidad, donde los objetivos no son volumen de trabajo

**Decisión.** Cada severidad declara un `IncidentPolicy` con objetivo de adquisición, objetivo de resolución y comportamiento de planificación. Los valores por defecto viven en el dominio (`IncidentPolicy.defaults`) y la configuración externa los sobrescribe desde `planning.incident-policies.*`.

**Motivo.** El motor planifica con `Incident.estimatedHours`, que es la dedicación estimada del caso concreto. El objetivo de resolución —4, 8 y 12 horas— es la **meta** contra la que se mide el cumplimiento. Son dos números distintos que suelen coincidir y a veces no: tratar la meta como volumen de trabajo haría que un incidente estimado en 20 h se planificara como 4 h, y el plan sería incorrecto justo en el caso grave.

**Consecuencia.** La separación permite responder «¿se cumplió la OLA?» sin que la OLA contamine la agenda. Hoy los objetivos se devuelven en la respuesta de simulación, que es lo que los hace verificables; cuando existan marcas reales de adquisición y resolución, vendrán de GLPI.

**Descartado.** Un mapa de horas por severidad. Habría bastado para los tiempos, pero dejaba el comportamiento de planificación fuera de la política, y el comportamiento es precisamente lo que el negocio acaba de definir.

**Descartado.** Modelar aparte la OLA de los requerimientos (4 días para adueñarse y 4 para resolver). La fecha que el requerimiento ya tiene —`plannedDate`, la pactada con el usuario— **es** su objetivo de resolución, y el motor la respeta por construcción. Añadir dos campos para repetir un dato que ya está en el modelo habría creado dos fuentes de verdad para la misma promesa.

---

## 26. `DisplacementPolicy`: cómo se tradujo cada regla de negocio

Tres reglas en lenguaje natural, tres comportamientos verificables:

| Severidad | Regla del negocio | `DisplacementPolicy` | Qué hace el motor |
|---|---|---|---|
| ALTO | prioridad máxima, replanificación inmediata | `INMEDIATA` | reclama la jornada completa del día en que se reporta |
| MEDIO | replanifica cuando compromete capacidad laboral | `POR_CAPACIDAD` | consume sus horas y desborda a los días siguientes |
| BAJO | convive; solo desplaza si hay saturación | `POR_SATURACION` | se ubica **después** de los requerimientos, en el hueco sobrante |

**Motivo de cada traducción.**

- **ALTO cierra el día.** «Replanificación inmediata» sin más sería idéntico a lo que ya hacía cualquier incidente, y no distinguiría nada. La lectura que sí cambia el plan es que la prioridad máxima no negocia capacidad: entrado un ALTO, el equipo suelta lo que tuviera pactado para ese día aunque le sobren horas. Es la única forma de que el desplazamiento inmediato sea observable con capacidad de sobra.
- **MEDIO compite.** «Compromete la capacidad laboral» en términos del motor es exactamente que el trabajo pactado deje de caber. No hizo falta inventar una fórmula: es el consumo voraz que el motor ya aplicaba a todos los incidentes.
- **BAJO cede.** «Convive con los requerimientos» se implementa ubicándolo en una tercera pasada, cuando los requerimientos ya ocuparon su franja: el incidente toma el sobrante y desborda a los días siguientes, pero no puede quitarle el hueco a nadie. La excepción es la saturación: un incidente que no cabe ni en una jornada completa no tiene con quién convivir, y entonces reclama capacidad como cualquier otro. Es la lectura más directa de «solo desplaza si existe saturación» que produce un desplazamiento observable y acotado.

**Consecuencia.** El orden de resolución queda en tres pasadas: incidentes que reclaman —por severidad y, a igual severidad, por antigüedad—, requerimientos por fecha pactada, e incidentes que conviven. Es la estructura de la decisión 18 con una pasada más al final.

**Limitación conocida.** La saturación se evalúa contra la jornada estándar, no contra el hueco real de ese día. Un BAJO que sí cabría, pero que convive con un día ya cargado de otros incidentes, se ubica en el sobrante igualmente. El efecto neto es que cede más de lo estrictamente necesario, nunca menos, lo que es el lado seguro del error.

**Descartado.** Puntuar cada incidente y ordenar por puntuación. Habría dado un modelo continuo más elegante, pero el negocio no definió pesos relativos, y una puntuación inventada es una decisión de negocio tomada por quien escribe el motor.

**Descartado.** Un `interface DisplacementStrategy` con tres implementaciones. Tres comportamientos de tres líneas cada uno que no comparten estado no necesitan polimorfismo de objetos: el enum con métodos abstractos deja el mismo polimorfismo sin repartir el comportamiento en tres archivos.

---

## 27. `incidentThresholdHours` se conserva, con fecha de retiro

**Decisión.** El umbral se mantiene y solo gobierna a los incidentes **sin** severidad. Queda marcado como legado en `PlanningRules`, en `PlanningProperties` y en `application.properties`.

**Motivo.** Había que evaluar si seguía teniendo sentido, y no lo tiene como criterio de planificación: nunca lo fue. Revisando el motor de la Fase 2, el umbral no alteraba ni una fecha del plan; lo único que decidía era **si el desplazamiento se atribuía al incidente o se registraba como capacidad diaria excedida**. Era una regla de auditoría con nombre de regla de planificación. Con severidad, esa atribución la da la política y el umbral se queda sin cometido.

**Consecuencia.** Se retira sin ceremonia cuando GLPI envíe prioridad y no queden incidentes sin severidad: borrar el campo, su constante, su propiedad y las dos ramas que lo consultan (`isCause` y `appliedRule`). Se descarta retirarlo ahora porque los datos existentes dejarían de producir el mismo plan y perderían la regla con la que fueron auditados.

**Descartado.** Traducir el umbral a severidad al vuelo —un incidente de más de 4 h es ALTO— para poder borrar el campo hoy. Decidiría que un incidente de 5 h es de prioridad máxima, que no es lo que el negocio acaba de acordar.

---

## 28. La auditoría copia la severidad; el motivo se deriva en la frontera

**Decisión.** `RescheduleEvent` incorpora `severity` y **no** incorpora un texto de motivo. El motivo legible lo compone `PlanningService` a partir de la regla aplicada.

**Motivo, en dos partes.**

- **Copiar la severidad es correcto, no redundante.** Un evento de auditoría tiene que poder explicarse solo, sin consultar el estado actual. La severidad de un incidente es un dato reclasificable: si dentro de un mes un ALTO pasa a MEDIO en GLPI, los eventos ya emitidos deben seguir contando la severidad que había cuando ocurrieron.
- **El motivo no se guarda porque ya está dicho.** El texto es una redacción de `AppliedRule`, que ya viaja en el evento. Dos copias del mismo hecho acaban divergiendo, y redactar no es tarea del dominio.

**Consecuencia.** La trazabilidad completa queda en `appliedRule` —qué hizo el motor— más `severity` —con qué prioridad—, y el texto se añade en la frontera HTTP. La regla se nombra por el **comportamiento** y no por la severidad (`CAPACIDAD_COMPROMETIDA`, no `SEVERIDAD_MEDIA_...`) precisamente porque la correspondencia entre ambas es configurable: si la OLA le da a BAJO el comportamiento de MEDIO, la auditoría debe decir «comprometió la capacidad» y «BAJO», no una combinación que deje de existir.

**Compatibilidad.** `UMBRAL_INCIDENTE_EXCEDIDO` se conserva marcado `@Deprecated`: la auditoría ya emitida no se reinterpreta y quien la consuma sigue funcionando. `RescheduleEvent` gana un componente, así que su constructor canónico cambia; su único llamante es el motor, dentro del mismo cambio, y el contrato HTTP crece solo con campos nuevos.

---

## 29. La simulación acepta severidad y devuelve la OLA vigente

**Decisión.** `incidents[].severity` es opcional en la petición. La respuesta añade `severity` y `reason` a cada evento y una tabla `incidentPolicies` con la OLA con la que se calculó el plan.

**Motivo.** El resultado tiene que poder interpretarse sin abrir la configuración de la aplicación: un desplazamiento con severidad `BAJO` y regla `SATURACION` solo se entiende sabiendo que la OLA vigente le da ese comportamiento. Devolver la tabla es más barato que documentar cada combinación posible.

**Consecuencia.** Cambiar la OLA y volver a simular es la forma de comprobar el ajuste sin recompilar. Verificado en vivo: con `planning.incident-policies.BAJO.displacement-policy=POR_CAPACIDAD` y `target-resolution-hours=16`, el mismo escenario pasa de no desplazar a desplazar, y la tabla devuelta refleja el acuerdo nuevo.

**Descartado.** Permitir sobrescribir la OLA dentro de `rules`. Un simulador de la OLA que acepte una OLA distinta a la vigente simula un acuerdo que no existe. Los umbrales de `rules` siguen siendo sobrescribibles porque no son el acuerdo con el negocio.

---

## 30. Preparación para GLPI

La prioridad es el primer dato de negocio que llega desde fuera. Lo que queda preparado y lo que falta:

| Pieza | Estado |
|---|---|
| `IncidentSeverity` como clasificación de dominio | hecho: independiente del nombre que GLPI le dé a su campo de prioridad |
| Correspondencia prioridad GLPI → severidad | **falta**: es una pieza de la capa anticorrupción (mejora #1) |
| OLA configurable por severidad | hecho: `planning.incident-policies.*` |
| Adquisición y resolución reales | **falta**: hoy los objetivos se declaran; medir su cumplimiento necesita las marcas de tiempo de GLPI |
| Retiro del umbral legado | pendiente de que no queden incidentes sin severidad |

**Motivo de no integrarlo todavía.** Es lo pedido en esta fase: modelar y probar el comportamiento. La correspondencia entre la prioridad de GLPI y la severidad del dominio es una decisión de mapeo que conviene tomar con los datos reales delante.

---

## Mejoras previstas para la Fase 3

De esta tabla, la fase de priorización por severidad cubre el modelo de la OLA (decisiones 24–30). El resto sigue pendiente. Las mejoras #1 y #3 son las que faltan para que la severidad llegue desde GLPI en lugar de por HTTP.

| # | Mejora | Motivo |
|---|---|---|
| 1 | **Capa anticorrupción explícita** — interfaces de dominio con implementación `Glpi*` | Hoy el aislamiento de GLPI es por convención (todo GLPI en `client/`). Entrando ya Incidentes y Requerimientos, conviene hacerlo explícito con interfaces y un mapeo GLPI → dominio declarado |
| 2 | **Persistencia del plan y del registro de idempotencia** | `InMemoryRescheduleLedger` se vacía al reiniciar: los desplazamientos pendientes se volverían a auditar. Es la carencia conocida más importante del núcleo actual |
| 3 | **Alimentar el motor con datos reales de GLPI** | `PlanningService` hoy recibe el escenario por HTTP. Falta el adaptador que traduzca los ítems de GLPI a `Incident` y `Requirement` |
| 4 | ~~**Calendario laboral** (festivos, jornadas especiales)~~ — **hecha en la Fase 4** | Los puntos de extensión ya existían en `PlanningRules` (decisión 21), que es exactamente donde la Fase 4 los llenó |
| 5 | **Capacidad parcial por desarrollador** | Media jornada, vacaciones, dedicación compartida entre equipos. La sobrecarga `workingHoursFor(Developer, LocalDate)` ya existe y ya recibe ambos; falta que alguien la use para algo distinto del calendario común |
| 6 | **Reutilizar la sesión de GLPI** | Hoy cada verificación abre y cierra sesión. Con varios endpoints conviene cachear el `session_token` hasta que expire |
| 7 | **Resiliencia** — reintentos y circuit breaker (Resilience4j) | El endpoint de salud tolera fallos por diseño; las consultas de negocio no |
| 8 | **Reparto de requerimientos en varios días** | La restricción actual (decisión 22) es deliberada; levantarla exige definir qué es un requerimiento parcialmente entregado |
| 9 | **Librería de timeline** | Con la forma real de `PlanningItem` ya conocida, elegirla entonces y no antes |
| 10 | **Endpoint de renegociación** | El motor marca `PENDIENTE_DE_RENEGOCIACION`; falta la operación con la que el responsable confirma la nueva fecha |
| 11 | **Modo oscuro en la UI** | Los tokens ya existen en `index.css`; falta el conmutador y persistir la preferencia |
| 12 | **Pruebas del frontend** | No hay ninguna todavía. Vitest + Testing Library sobre los hooks y las páginas |
| 13 | **Pruebas de integración del endpoint** | Hay pruebas unitarias del motor y del servicio, y una de contexto. Falta `@WebMvcTest` sobre el contrato HTTP, incluida la validación de entrada |
| 14 | **Observabilidad** — métricas de Micrometer sobre las llamadas a GLPI | Latencia y tasa de error por operación |
| 15 | **Autenticación de la propia API** | Hoy `/api/**` está abierto. Spring Security antes de exponerla fuera de la red interna |
| 16 | **Pipeline CI** | Compilación, pruebas y lint en cada push |

---

# Fase 4 — Tiempo hábil

Hasta aquí el motor repartía 8 horas al día **todos** los días: sábados, domingos y festivos incluidos. El negocio nunca dijo eso. La OLA habla de horas de oficina, y las OLA se miden contra ellas. Esta fase introduce el calendario laboral explícito y el cálculo en tiempo hábil y, sobre todo, lo enchufa al motor **sin reescribirlo**.

Sigue sin haber GLPI, persistencia ni JPA: es modelo y aritmética de fechas, como se pidió.

---

## 31. `WorkingCalendar` es el calendario, y la jornada se deriva de él

**Decisión.** `WorkingCalendar` —bloque horario, días de fin de semana, festivos— entra al dominio como valor. `PlanningRules` lo incorpora y **deriva** su `workingHoursPerDay` de `calendar.businessHours().duration()` en el constructor compacto.

**Motivo.** La jornada del desarrollador y el horario de la oficina eran dos números que podían divergir: 8 horas declaradas por un lado y un bloque de 09:00 a 16:00 por otro describen un calendario que se contradice a sí mismo. Derivar uno del otro hace imposible esa contradicción: hay una sola fuente de verdad y quien construye las reglas no puede desalinearlas ni queriendo.

**Consecuencia.** `PlanningRules` gana un componente, pero conserva sus constructores de tres y de cuatro argumentos. Un llamante que no declare calendario obtiene el estándar con **su** jornada, no con la de por defecto. La sobrescritura de jornada de la simulación sigue funcionando por la misma vía.

**Descartado.** Mantener `workingHoursPerDay` como campo independiente y validar la coherencia en el constructor. Es la misma garantía a cambio de una validación que algún camino futuro puede olvidarse de invocar.

---

## 32. La aritmética de tiempo hábil se hace en minutos, no en horas

**Decisión.** El recorrido del calendario se hace en minutos enteros (`long`). La conversión a horas (`BigDecimal`) ocurre una sola vez, en la frontera de salida.

**Motivo.** Una OLA de 4 horas pedida un viernes a las 16:30 no son «cuatro horas más tarde»: son 30 minutos, un fin de semana que no cuenta y 3 h 30 el lunes. Eso obliga a **caminar** el calendario bloque a bloque, no a sumar una duración a un instante. Y hacerlo en minutos evita el redondeo que aparece al acumular sumas y restas de `BigDecimal` con escala fija: en un cálculo que encadena tramos, el error se acumula y acaba moviendo una fecha.

**Consecuencia.** `BusinessTimeCalculator.segments(from, businessHours)` es la operación base y devuelve los tramos en que se consume el objetivo. `dueAt(from, businessHours)` es su derivación de una línea —el final del último tramo— y existe porque es lo que consume la frontera. Los ejemplos 1, 2 y 3 del requerimiento son el mismo cálculo con entradas distintas.

**Descartado.** Un método `nextBusinessInstant(Instant)` aparte. Habría duplicado el recorrido del calendario para responder algo que `segments` ya responde: el siguiente bloque laborable es, literalmente, el primer tramo.

**Descartado.** Precalcular un `Map<LocalDate, BigDecimal>` de capacidad. Obligaría a decidir cuántos días se materializan antes de saber cuántos hacen falta.

---

## 33. La integración con el motor es un método que ya existía

**Decisión.** El motor no se modifica, salvo un defecto que el calendario dejó al descubierto (riesgo 22). La capacidad diaria se sigue pidiendo a `PlanningRules.workingHoursFor(developer, date)` —el punto de extensión de la decisión 21— y ahora ese método consulta el calendario.

**Motivo.** Era la promesa literal de la Fase 2: «cuando llegue el calendario, el motor no cambia». Cumplirla no es estética. Meter el calendario dentro del motor habría puesto el concepto de fin de semana en el algoritmo de reparto, que es justo lo que la decisión 21 evitó. Con el calendario detrás de `workingHoursFor`, un sábado devuelve cero horas y el motor **lo salta sin saber que los sábados existen**.

**Consecuencia.** Sábados, domingos y festivos son no laborables en todo el sistema —capacidad y auditoría— con un cambio de una línea. Y las 18 pruebas del motor anteriores a esta fase siguen pasando **sin cambiar una sola aserción**, que es la definición operativa de compatibilidad.

**Limitación: por qué la integración es parcial y no total.** El motor reparte por días completos; el cálculo de OLA es al minuto. Que el motor consumiera el tiempo restante del día del reporte —para que un incidente de las 16:30 de un viernes ocupara los 30 minutos que quedaban y no el día entero— es más fiel al reloj y se evaluó. Se descartó porque rompe `multiplesRequerimientosSeReplanificanEnCadena`: un requerimiento desplazado quedaría al día siguiente en vez de en el primer día con hueco. Es decir, cambiaría el plan de casos que hoy son correctos según el negocio. Se documenta como el límite real de la fase en lugar de disimularlo (riesgo 21).

---

## 34. El bloque por defecto es 09:00–17:00 porque son exactamente ocho horas

**Decisión.** `WorkingCalendar.standard()` abre a las 09:00, cierra a las 17:00 y no modela descanso de mediodía.

**Motivo.** No es un horario de oficina elegido por verosimilitud. Es el que satisface dos condiciones a la vez: hace que el ejemplo del requerimiento —viernes 16:30, OLA 4 h— dé 30 minutos el viernes **y** que el bloque dure exactamente las 8 horas que el sistema ya declaraba. Cualquier otro par de horas incumple una de las dos.

**Consecuencia.** La compatibilidad con la fase anterior es verificable, no prometida: la jornada derivada del calendario por defecto son 8 h, así que el plan de las pruebas existentes no cambia.

**Limitación conocida.** Un descanso de mediodía no se puede representar porque un día laborable es **un** bloque. Modelarlo exige que un día tenga varios (`Map<DayOfWeek, List<BusinessHours>>`) y hoy ninguna regla del negocio lo pide.

---

## 35. `end-time` es opcional para no romper `PLANNING_WORKING_HOURS_PER_DAY`

**Decisión.** `planning.calendar.end-time` no se declara por defecto. Si falta, la jornada cierra a la apertura más `PLANNING_WORKING_HOURS_PER_DAY`; si se declara, manda el bloque explícito.

**Motivo.** `PLANNING_WORKING_HOURS_PER_DAY` es configuración existente y ya desplegada. Obligar a declarar además un horario de cierre para conservar el comportamiento anterior convertiría una mejora en una migración de entorno, y el primer síntoma sería un entorno que cambia de plan sin que nadie haya tocado nada.

**Consecuencia.** La variable antigua sigue significando lo mismo. Declarar las dos a la vez tampoco es ambiguo: gana el bloque, y la jornada resultante es su duración.

**Descartado.** Declarar `end-time=17:00` en `application.properties` y dar la variable antigua por obsoleta. Un entorno que hoy declare `PLANNING_WORKING_HOURS_PER_DAY=6` pasaría de una jornada de 6 horas a una de 8 sin aviso, y la primera consecuencia sería un plan distinto sin causa visible.

---

## 36. Tres objetos nuevos; `WorkingDay` y `Holiday`, descartados

**Decisión.** El requerimiento proponía cinco nombres. Se implementaron tres y se descartaron dos.

**Los tres que existen, y qué aporta cada uno.**

| Objeto | Qué aporta que no quepa en otro sitio |
|---|---|
| `WorkingCalendar` | Agrupa las tres reglas que definen «cuándo se trabaja» —bloque, fin de semana, festivos—, protege sus invariantes (un calendario sin ningún día laborable se rechaza al construirlo) y expone **una** pregunta: `businessHoursOn(date)`, que devuelve `null` si la fecha no es laborable |
| `BusinessHours` | El bloque diario y su aritmética de frontera (`remainingMinutes`, `durationMinutes`). Es el único lugar donde vive la conversión minutos↔horas |
| `BusinessTimeCalculator` | El recorrido del calendario. No es un valor: es un cálculo, y tiene un colaborador real (`PlanningService`) |

**Por qué se descartaron los otros dos.**

- **`WorkingDay`** sería un par *(fecha, bloque)*. El recorrido ya desestructura esas dos cosas en la primera línea del bucle, y el objeto no tendría comportamiento propio ni un solo lugar donde almacenarse.
- **`Holiday`** sería un festivo con nombre y descripción. Para todo el código que existe, un festivo **es una fecha**: `holidays.contains(date)` es la única operación que se le pide. El nombre es un dato de la fuente que los publique —GLPI o un calendario corporativo—, no del cálculo, y añadirlo ahora sería un campo que nadie lee.

**Criterio general.** Un objeto de dominio entra cuando tiene invariantes que proteger, comportamiento que ofrecer o un colaborador que lo consuma. Un nombre nuevo que solo agrupa campos ya existentes no es un modelo: es un `record` más que mantener.

**Nota.** `businessHoursOn` devuelve `null` cuando la fecha no es laborable, en lugar de un `Optional` o de un bloque vacío. Es coherente con el resto del paquete (`causingIncidentFor`, `firstDayFitting`) y el javadoc lo declara. La alternativa —un `Optional`— habría obligado a desenvolver en el bucle del calculador, que es su único consumidor.

---

## Preparación para la Fase 5

Lo que esta fase deja listo y lo que falta:

| Pieza | Estado |
|---|---|
| Calendario laboral declarativo | hecho: `planning.calendar.*`, ajustable por entorno |
| Cálculo de tiempo hábil reutilizable | hecho: `BusinessTimeCalculator` es Java puro y sin estado compartido; cualquier capa puede construir el suyo |
| Vencimiento de la OLA de **resolución** | hecho: `incidentDeadlines` vence en tiempo hábil |
| Vencimiento de la OLA de **adquisición** (15 min) | **falta**: se declara y se reporta como número, pero no se convierte en fecha. Es reloj puro, no necesita calendario (riesgo 26) |
| Incidencia de la OLA sobre el plan | **falta**: hoy la OLA se **reporta**; medir si se cumplió necesita las marcas de adquisición y resolución de GLPI |
| Festivos desde GLPI | **falta**: hoy se declaran por configuración. GLPI ya tiene calendarios con horario laboral y festivos, así que es la fuente natural; la forma del mapeo (¿por país, por sede, por equipo?) se decide con los datos delante |
| Auditoría | intacta: el calendario no toca `RescheduleEvent` ni la idempotencia |
| Timeline del frontend | preparado: `calendar` e `incidentDeadlines` ya viajan en la respuesta |

**Relación con GLPI.** El calendario es un valor de dominio que se construye en la frontera, igual que `PlanningRules`. Cuando GLPI sea la fuente, el adaptador traduce su calendario al nuestro y ni el motor ni el calculador cambian. Es la misma separación de la decisión 1, aplicada a un dato nuevo.

**Cómo crecería el modelo, sin escribir código todavía.** Las cuatro necesidades que el requerimiento pedía dejar preparadas caen todas en el mismo sitio:

| Necesidad | Cambio | Dónde |
|---|---|---|
| Vacaciones, incapacidades | capacidad distinta **por desarrollador** | `PlanningRules.workingHoursFor(developer, date)` — esa sobrecarga ya existe y ya recibe los dos argumentos |
| Desarrollador de medio tiempo | bloque distinto por desarrollador | idéntico al anterior: es el mismo método |
| Diferencias por equipo | calendario por equipo | el calendario deja de ser único y se resuelve a partir del `developer` |
| Descanso de mediodía, jornada partida | varios bloques por día | `Map<DayOfWeek, List<BusinessHours>>` en `WorkingCalendar`; el bucle de `segments` los recorre igual |
| Zona horaria distinta de UTC | zona explícita en el calculador | hoy el constructor fija `ZoneOffset.UTC`; ya acepta un `ZoneId` (riesgo 23) |

Ninguna de las cinco exige tocar el motor ni el algoritmo de reparto, que es la prueba de que la integración de esta fase quedó en el sitio correcto.

> **Corrección de la Fase 5.** Las dos primeras filas apuntaban a `PlanningRules.workingHoursFor(developer, date)`, que era el punto de extensión de la decisión 21. La Fase 5 retiró ese método junto con el resto de la planificación por día (decisión 39): la capacidad ya no se consulta como un número de horas por fecha, sino como franjas de agenda, y quien la responde es `CapacityBook`. El punto de extensión para la capacidad por desarrollador es hoy el calendario que recibe el libro, no un método de `PlanningRules`.

---

# Fase 5 — Modelo temporal unificado

Hasta aquí el sistema tenía **dos relojes**. El cálculo de la OLA caminaba el calendario al minuto; el motor repartía por jornadas completas, y su libro de capacidad (`DayBook`) solo sabía decir «este día está tomado». El síntoma es el caso que abre esta fase: un incidente ALTO reportado un viernes a las 16:30 con 4 h de dedicación. La OLA decía, con razón, que vencía el lunes a las 12:30 —30 minutos el viernes y 3 h 30 el lunes—. La agenda decía que el viernes estaba **bloqueado entero**. Las dos respuestas salían del mismo sistema y no describían el mismo mundo.

Esta fase unifica los dos relojes en uno. Sigue sin haber GLPI, persistencia, JPA ni frontend: es modelo temporal, como se pidió.

---

## 37. La capacidad es una agenda de franjas, no un contador de horas

**Decisión.** `CapacityBook` sustituye a `DayBook`. Su estado es `Map<LocalDate, List<TimeSlot>>`: para cada fecha, las franjas ya ocupadas. `TimeSlot(start, end)` es el vocabulario compartido —apertura inclusive, cierre exclusivo— entre la capacidad y el cálculo de tiempo hábil.

**Motivo.** Un contador de horas por día no puede representar «09:00-11:00 ocupado, 11:00-14:00 libre, 14:00-17:00 ocupado»: sabe que quedan 3 horas, no dónde están. Y dónde están es exactamente lo que decide si un incidente de 2 horas cabe hoy o se va a mañana. Guardar franjas **ocupadas** en lugar de horas libres tiene además una ventaja práctica: el hueco se **deriva** de la ocupación, así que no hay dos estructuras que puedan contradecirse.

**Consecuencia.** `CapacityBook.freeSlots(date)` responde la pregunta de capacidad y `claim(...)` coloca trabajo consumiendo esas franjas. Las franjas se guardan ordenadas y fusionadas (`merge`), de modo que la ocupación de un día es una lista canónica: sin solapes y sin huecos entre tramos contiguos.

**Descartado.** Un `boolean[]` de minutos por día. Sería O(1) por consulta, pero 480 posiciones por fecha para representar lo que tres intervalos describen, y la aritmética de tramos habría que reconstruirla al leerlo.

**Descartado.** `WorkingCapacity` como objeto con horas libres y horas ocupadas. Es la estructura que puede contradecirse a sí misma: dos campos que hay que mantener de acuerdo. `freeSlots` es una función de la ocupación, no un campo paralelo.

**Nota sobre el horizonte.** La colocación se calcula primero completa; si no cabe entera dentro del horizonte, no se compromete **nada**. Es lo que mantiene el conflicto de la decisión 22 sin efectos colaterales: un requerimiento de 100 h no deja rastro de 72 h en la agenda.

---

## 38. Un solo recorrido del calendario para la OLA y para la capacidad

**Decisión.** `BusinessTimeCalculator` gana una sobrecarga `segments(from, hours, busy, until)` —package-private— que recibe una función de ocupación y un límite superior de fecha. La API pública de dos argumentos no cambia: delega con ocupación vacía y sin límite. `CapacityBook.claim` es su segundo llamante, con las franjas ocupadas del desarrollador y el horizonte.

**Motivo.** Es la unificación propiamente dicha, y responde a la pregunta obvia: ¿por qué no duplicar el recorrido? Porque el caso del viernes 16:30 es *el mismo cálculo* en los dos lados. La OLA pregunta «¿cuándo se agotan 4 horas de tiempo hábil desde este instante?» y la agenda pregunta «¿en qué franjas caben 4 horas de trabajo desde este instante?». Son la misma pregunta: cuánto queda de la jornada, qué días no cuentan, dónde está el siguiente hueco. Tenerlo escrito dos veces garantizaba que divergieran —y de hecho ya habían divergido, que es el defecto que esta fase corrige.

**Consecuencia.** La ocupación entra como parámetro y no como estado, así que el calculador sigue siendo sin estado compartido y el cálculo de la OLA sigue ignorando la agenda. Un tramo que la agenda no puede usar es, para la OLA, un tramo que no existe.

**Coste aceptado.** La sobrecarga de cuatro argumentos es package-private y no forma parte de la API del dominio: un llamante externo sigue viendo una sola operación. Se prefirió esto a un `interface Occupancy` con dos implementaciones, una de las cuales siempre devolvería la lista vacía.

---

## 39. Desaparece la planificación por día

**Decisión.** El motor deja de razonar en jornadas. `DayBook` —y con él `workingHoursFor(developer, date)`, `firstDayFitting` y el consumo voraz por días— se retira. `PlanningEngine` coloca cada elemento con `capacity.claim(...)`, que devuelve los **tramos** en que quedó ubicado.

**Motivo.** La planificación por día era el segundo reloj. Decidía de antemano «esto va el lunes» y luego comprobaba si el lunes cabía, en lugar de preguntar cuándo cabe. Ese orden es el que producía la reserva artificial de jornadas completas: para el motor un día estaba tomado o libre, y un incidente de 30 minutos lo tomaba entero.

**Consecuencia.** Un requerimiento de 20 horas ya no es un conflicto ni una jornada: son tres tramos, lunes 09:00–17:00, martes 09:00–17:00 y miércoles 09:00–13:00. Y un incidente ALTO de 4 horas reportado un viernes a las 16:30 ocupa 30 minutos el viernes y 3 h 30 el lunes, que es exactamente lo que la OLA ya decía.

**Qué sobrevive intacto.** Auditoría (`RescheduleEvent` con fecha original, fecha recalculada, regla y severidad), idempotencia (`RescheduleLedger.claim` sobre la pareja incidente-requerimiento), severidades y OLA, y las tres pasadas de la decisión 26 —incidentes que reclaman, requerimientos, incidentes que conviven—. La fase cambia **cuándo** se coloca el trabajo, no **quién manda** ni **qué se audita**.

**Descartado.** Conservar `workingHoursFor(developer, date)` como punto de extensión para la capacidad por desarrollador (decisión 21, mejora #5). La agenda de franjas lo reemplaza con una respuesta mejor, pero la capacidad **por desarrollador** sigue sin existir: `CapacityBook` es de un desarrollador, y quien lo construye sigue siendo el motor con el `developer` de la petición.

---

## 40. `WorkAllocation` no cambia; `WorkBlock` se suma

**Decisión.** `WorkAllocation` conserva sus cinco componentes (`workItemId`, `workItemType`, `developerId`, `date`, `hours`) y `PlanningResult` gana una segunda lista, `blocks` (`WorkBlock`: `workItemId`, `workItemType`, `developerId`, `start`, `end`, `hours`, con `date()` derivado de `start`).

**Motivo.** Son dos preguntas distintas sobre la misma agenda. La asignación responde «qué se comprometió y desde qué día arranca»: una pieza por elemento, que es lo que se negocia con el usuario y lo que ya consumía la frontera. El bloque responde «cuándo se trabaja de verdad»: un tramo por jornada tocada, que es lo que pinta un calendario. Un requerimiento de 20 horas son **una** asignación y **tres** bloques, y ninguna de las dos listas se deriva de la otra: la asignación pierde los tramos, y los bloques pierden la fecha pactada original.

**Consecuencia.** `hours` en un bloque es la duración de **ese** tramo, no el total del elemento. La suma de los bloques de un elemento es su dedicación; la suma de las horas de una fecha es la ocupación de esa fecha.

**Coste aceptado, explícito.** Dos listas que hay que mantener coherentes. Ambas se llenan en el mismo punto del motor y describen el mismo hecho. La alternativa —meter los tramos dentro de `WorkAllocation`— habría dejado una lista de objetos con una lista anidada, y habría obligado a reescribir a todos los consumidores de la asignación para un dato que solo necesita el timeline.

---

## 41. La reserva de prioridad reclama la jornada, no la consume

**Decisión.** `ALTO` (`INMEDIATA`) sigue cerrando el resto de la jornada del día en que arranca, pero ahora mediante `CapacityBook.reserveRestOfDay(date, from)`, que marca ocupado desde el final de su propio último tramo de ese día hasta el cierre. El incidente sigue consumiendo exactamente sus horas.

**Motivo.** «Replanificación inmediata» tiene que seguir siendo observable —es la lectura de la decisión 26 y no se toca—, pero reclamar el día y consumirlo son dos cosas distintas que el modelo anterior confundía. Un ALTO de 4 horas reportado un lunes a las 09:00 reserva de 13:00 a 17:00 y desplaza lo pactado para ese lunes; un ALTO de 4 horas reportado un viernes a las 16:30 reserva **solo** los 30 minutos que quedaban y no toca la mañana del viernes, que ya pasó.

**Consecuencia.** La reserva es de un día y no se propaga: el ALTO no bloquea el martes. Un requerimiento desplazado por prioridad se ubica en el primer hueco real, que es el día siguiente si ese día tiene capacidad.

---

## 42. Se levanta la restricción de la decisión 22: un requerimiento se reparte

**Decisión.** Un requerimiento que no cabe en el hueco que queda de su fecha pactada ya no se mueve entero al día siguiente: ocupa lo que queda y continúa en los días siguientes. Un requerimiento solo es conflicto cuando no cabe en **todo** el horizonte.

**Motivo.** La decisión 22 decía que partir un requerimiento obliga a definir qué significa «medio entregado», y eso sigue siendo cierto: la fecha de entrega es la del **último** tramo, y es la que se audita como fecha recalculada. Lo que cambió es la evaluación del otro lado del balance. La restricción existía porque el motor no sabía representar un requerimiento parcial; con la agenda de franjas sí sabe, y mantenerla obligaba a desperdiciar el hueco que esta misma fase vino a aprovechar. El caso «incidente + requerimiento: capacidad remanente usada correctamente» es imposible sin levantarla.

**Consecuencia.** El desplazamiento pasa a significar «no cerró en su fecha pactada» en lugar de «no cupo en su fecha pactada». Eso es lo que se audita: `rescheduledDate` es la fecha de cierre. Un requerimiento que empieza el lunes y termina el miércoles se audita con fecha recalculada el miércoles, y `allocations[].date` sigue siendo el lunes, que es cuando arranca.

**Compatibilidad.** Seis de las pruebas anteriores cambian de expectativa; ninguna se elimina. Las que fijaban «el requerimiento se va al día siguiente» ahora fijan los tramos concretos. Es el coste real de la decisión y está en la tabla de riesgos (riesgo 27).

---

## 43. Preparación para la Fase 6 (persistencia)

| Pieza | Estado |
|---|---|
| Agenda como dato explícito | hecho: `WorkBlock` es un valor con inicio, fin y horas. Es una fila de tabla, no un cálculo |
| Capacidad reconstruible | hecho: `CapacityBook` se reconstruye desde la lista de bloques y no guarda nada más |
| `WorkAllocation` como resumen | hecho: una fila por elemento y compromiso, con `date` y `hours` |
| Clave de la agenda | preparada: `(developerId, start)` identifica un tramo; `(workItemId, start)` identifica un bloque dentro de un elemento |
| Idempotencia | **falta**: `InMemoryRescheduleLedger` sigue en memoria (riesgo 11) |
| Identidad del elemento | **falta**: `workItemId` es el id de GLPI, que todavía no llega |

**Por qué el modelo temporal es lo que desbloquea la persistencia.** El obstáculo real de la Fase 2 para persistir no era la falta de una tabla: era que la agenda **no era un dato**. Un día ocupado era estado interno del motor durante una ejecución, y al terminar no quedaba nada que guardar salvo la fecha de cada asignación. Con `WorkBlock` la agenda es una lista de valores con clave propia, y guardarla es escribirla.

**Lo que hay que decidir con la persistencia delante.** Si la tabla guarda bloques, asignaciones o las dos; si la agenda se recalcula desde cero en cada planificación —como hoy— o se acumula; y si la idempotencia vive en la misma transacción que el plan. Ninguna de las tres se puede responder sin saber si el plan es una simulación o un compromiso. Hoy es una simulación, y por eso no se decide.

---

## 44. Preparación para el Timeline de React

El frontend ya tiene el contrato definido (`types/resource.ts`: `Resource`, `PlanningItem`, `TimelineWindow`) y el punto de integración aislado (`components/timeline/ResourceTimeline.tsx`). Lo que falta es el mapeo, y esta fase lo deja determinado.

**Qué estructura consumiría la UI.** `PlanningItem` es prácticamente la forma de un `WorkBlock`:

| `PlanningItem` | Origen en la respuesta | Nota |
|---|---|---|
| `id` | `blocks[].workItemId` + `blocks[].start` | un elemento tiene varios tramos, así que la clave del bloque es la pareja |
| `resourceId` | `blocks[].developerId` | ya viaja en cada bloque |
| `source` | `blocks[].workItemType` | `INCIDENTE` → `INCIDENT`, `REQUERIMIENTO` → `REQUEST` |
| `startsAt` / `endsAt` | `blocks[].start` / `blocks[].end` | **coinciden literalmente**: `LocalDateTime` ISO-8601 sin zona, que es lo que el contrato pide |
| `title` | — | **falta**: el bloque no lleva título. Lo tiene el ítem de origen y hoy no viaja en la respuesta |
| `priority` | severidad del incidente causante, o `rescheduleEvents` para un requerimiento | **falta**: solo los incidentes tienen severidad |
| `allocation` | `blocks[].hours` ÷ jornada del día | **falta**: derivable en la frontera desde `calendar` |

**Cómo se obtendría desde `PlanningResult`.** El mapeo es directo, sin cálculo intermedio: `result.blocks()` → `PlanningItem[]`, una entrada por bloque. Los campos que faltan no son cálculos, son datos de presentación que se resuelven en la frontera: el título y la prioridad se cruzan con el ítem de origen, y `allocation` se deriva de la jornada del calendario que ya viaja en la respuesta. **No se implementa**: el frontend es de una fase posterior y añadir el mapeo hoy sería una capa sin consumidor.

**Lo que el modelo ya garantiza.** Que los tramos sean continuos, no se solapen y caigan dentro de la jornada es un invariante del motor, no del render: la librería de timeline no tiene que defenderse de datos imposibles. Y como los bloques se derivan de la misma estructura que la capacidad, la agenda que se pinta y la capacidad que se consume son el mismo hecho, no dos copias.

---

## Mejoras previstas para la Fase 6

Actualización de la tabla de mejoras a la luz de esta fase:

| # | Mejora | Estado tras la Fase 5 |
|---|---|---|
| 5 | Capacidad parcial por desarrollador | **parcial**: el consumo parcial al minuto ya existe (`CapacityBook`); falta la capacidad **variable por persona** (vacaciones, medio tiempo). `PlanningRules.workingHoursFor(developer, date)` se retiró con el resto de la planificación por día, así que el punto de extensión es ahora el calendario que recibe `CapacityBook` |
| 8 | Reparto de requerimientos en varios días | **hecha en la Fase 5** (decisión 42) |
| 9 | Librería de timeline | **desbloqueada**: `blocks` ya es la forma que consume `PlanningItem` (decisión 44). Falta el mapeo en la frontera y los tres campos de presentación |

El resto de la tabla de la Fase 3 sigue pendiente sin cambios. La #2 (persistencia del plan y del registro de idempotencia) es la que entra en la Fase 6, y la decisión 43 dice qué deja preparado esta fase.

---

# Fase 6 — Persistencia del plan

La planificación estaba madura; lo que faltaba era que su resultado sobreviviera a la respuesta HTTP. El riesgo 11 era el síntoma visible —el registro de idempotencia vivía en memoria—, pero la causa de fondo era la que ya había señalado la decisión 43: hasta la Fase 5 la agenda no era un dato, y sin dato no hay nada que guardar.

Esta fase no cambia ninguna regla de planificación. No hay comportamiento nuevo: hay un sitio donde el resultado queda escrito. Las 46 pruebas de las fases anteriores siguen pasando sin cambiar una sola expectativa, y eso es lo que prueba que la fase no tocó el negocio.

**La restricción que gobierna la fase, y cómo se verifica.** El dominio sigue sin saber que existe una base de datos. No es una promesa en un documento: `grep -r "jakarta.persistence|org.springframework|org.hibernate" src/main/java/.../domain/` no devuelve nada, y `PlanningEngine` no cambió una línea entre la implementación en memoria y la de base de datos. Es la misma propiedad que la decisión 43 dejó preparada, y ya se había ejercitado una vez: el motor recibió un `RescheduleLedger` distinto sin enterarse.

---

## 45. El modelo persistente: Spring Data JPA, y qué se guarda de todo lo que el motor produce

| Objeto | Qué es | Se persiste | Por qué |
|---|---|---|---|
| `PlanSnapshot` | Raíz del agregado | Sí — `plan_snapshot` | Es el plan: identificador, desarrollador e instante en que se decidió |
| `WorkAllocation` | Instantánea | Sí — `work_allocation` | Qué se comprometió y desde qué día |
| `WorkBlock` | Instantánea | Sí — `work_block` | Cuándo se trabaja de verdad. Es la razón por la que la persistencia es posible (decisión 43) |
| `RescheduleEvent` | Evento | Sí — `reschedule_event` | Auditoría: el requisito pide explícitamente que sobreviva a los reinicios |
| `PlanningConflict` | Instantánea | Sí — `planning_conflict` | Lo que no cupo. Un plan sin sus conflictos parece un plan completo |
| `RescheduleClaim` | Clave de idempotencia | Sí — `reschedule_claim` | No es dominio: es el hecho de que esa pareja ya se auditó (decisión 48) |
| `Incident` | Entrada | **No** como valor vivo; sí, fechadas, en `planning_input_incident` | Es de GLPI. Guardarlo como valor vivo crearía una segunda copia de un dato ajeno, que se desincroniza sola; lo que se guarda es la copia **fechada** de una ejecución (Fase 8, decisión 66) |
| `Requirement` | Entrada | **No** como valor vivo; sí, fechadas, en `planning_input_requirement` | Igual que el incidente |
| `Developer` | Entrada | **No** como valor vivo; sí, su `id`, en `planning_input` | El plan guarda `developerId`; el nombre no hace falta para releerlo ni para recalcular, y por eso no se guarda |
| `PlanningRules` | Configuración | **No** como valor vivo; sí, fechadas, en `planning_context` | Ya vive en `application.properties`. Una copia viva sería un segundo origen de verdad para el mismo valor; lo que se guarda es la copia **fechada** de una ejecución, que no se modifica nunca (Fase 7, decisión 55) |
| `WorkingCalendar` | Configuración | **No** como valor vivo; sí, fechadas, en `planning_context` | Igual que las reglas |

Las dos últimas filas cambiaron en la Fase 7 y las tres anteriores en la Fase 8. En los cinco casos la objeción que las dejaba en «No» —un segundo origen de verdad— sigue siendo válida para el valor vivo, y por eso lo que se añadió no es el valor sino una **fotografía** suya atada a un plan, que no se modifica nunca y que nadie consulta para saber qué dice GLPI hoy.

**Por qué se guardan las cuatro listas y no solo los bloques.** Un plan es la evidencia de una decisión, y releerlo tiene que mostrar todo lo que se decidió, incluido lo que no se pudo ubicar. Los bloques dicen cuándo se trabaja; las asignaciones, qué se comprometió; los eventos, qué se movió y por qué; los conflictos, qué quedó fuera. Guardar solo la agenda daría un plan que parece completo justo cuando no lo está.

**Por qué no se guardan las entradas.** El plan enlaza por id. El día que GLPI sea la fuente, guardar una copia del incidente congelaría una versión que GLPI puede cambiar, y el plan pasaría a describir una entrada que ya no existe. Es el riesgo 32, que esta decisión abre a propósito.

**Qué cambió en la Fase 8, y qué no.** La objeción sigue en pie para el plan: el plan enlaza por id y no copia la entrada. Lo que la Fase 8 añade es otra cosa, una tabla aparte que responde otra pregunta. El plan dice qué se decidió con unos datos que viven en GLPI; la instantánea dice qué datos exactos entraron al motor aquel día. No compiten: la primera describe el presente de GLPI, la segunda un hecho pasado. La distinción está desarrollada en la decisión 69.

**Por qué Spring Data JPA.** El proyecto ya es Spring Boot, así que JPA e Hibernate son la pieza que la plataforma trae puesta: no hay que escribir el mapeo ni mantener SQL a mano. Las alternativas no compran nada aquí. `JdbcTemplate` evitaría la dependencia a cambio de escribir a mano el mapeo de cinco tablas; jOOQ añadiría un generador de código. Ninguna de las dos resuelve un problema que este proyecto tenga.

---

## 46. Cuatro entidades planas: el agregado se arma con consultas, no con relaciones

No hay `@ManyToOne` ni `@OneToMany`. Cada fila hija lleva su `plan_id` y el agregado se rearma con cuatro consultas (`findByPlanIdOrderByIdAsc`), una por lista.

**Por qué.** Las relaciones traen carga perezosa, el problema N+1 y entidades separadas de la sesión. Un plan se lee siempre entero, así que no hay nada que cargar bajo demanda; lo único que aportarían sería el mecanismo que hay que desactivar. `spring.jpa.open-in-view=false` está puesto por lo mismo: dejarlo activo escondería exactamente el problema que esta decisión evita.

**El coste, aceptado.** El armado se escribe a mano y cuesta cuatro consultas por lectura. Con el tamaño de un plan —decenas de filas por lista— no compensa nada más listo, y el lugar donde compensaría es el adaptador.

**Dos convenciones que acompañan.** `@Enumerated(STRING)` en todos los enums: guardar el ordinal rompería el día que se inserte un valor en medio de un enum, y la base de datos conservaría un número cuyo significado cambió en silencio. Y `persistence/` es plano, con doce clases, siguiendo la convención de `domain/model/`.

---

## 47. La identidad: el plan la recibe del adaptador; el resto son claves sustitutas

El identificador del plan lo genera `JpaPlanSnapshotRepository` antes de insertar. `GenerationType.UUID` haría lo mismo, pero ataría la identidad del agregado a una anotación de JPA, y el adaptador ya tiene que devolver el `PlanSnapshot` con su id: generarlo ahí es donde hace falta y donde el dominio no se entera.

Las filas hijas usan clave sustituta `Long` con `IDENTITY`. No tienen identidad propia en el dominio —son valores dentro del agregado— y la clave sustituta es la forma más barata de tener un orden de fila estable: `ORDER BY id` reproduce el orden en que el motor produjo los bloques. Eso es lo que hace que `findBlocks` devuelva los tramos en el orden de la agenda y que la prueba de ida y vuelta sea significativa.

---

## 48. El registro de idempotencia deja de vivir en memoria (cierra el riesgo 11)

Es el núcleo de la fase. `RescheduleLedger` ya era la costura, así que lo que cambió fue la implementación —de `InMemoryRescheduleLedger` a `JpaRescheduleLedger`— y nada más. `PlanningEngine` no se tocó.

**El mecanismo, y por qué es así.**

- **Una restricción de unicidad sobre `(incident_id, requirement_id)`, no un «consultar y luego insertar».** Dos peticiones simultáneas pueden leer las dos «no reclamado»; solo un insert sobrevive. Decide la base de datos, no la aplicación.
- **`saveAndFlush` y `DataIntegrityViolationException` capturada.** La violación tiene que aflorar dentro de la llamada, no al cerrar la transacción.
- **`incident_id` es `NOT NULL`, con el centinela `"-"`.** En PostgreSQL un `NULL` no colisiona nunca con otro `NULL` en un índice único, así que una columna anulable habría dejado sin reclamar todos los desplazamientos sin incidente causante: dos ejecuciones del mismo escenario auditarían dos veces el mismo movimiento. El centinela es el mismo `SIN_INCIDENTE` que ya usaba `InMemoryRescheduleLedger`; el comportamiento no cambió, cambió el soporte.
- **Sin `REQUIRES_NEW`.** El reclamo corre fuera de toda transacción nuestra porque `PlanningEngine.plan()` no está dentro de la transacción de guardado (decisión 50). Por eso la violación no puede envenenar una transacción externa. No es casualidad del orden actual de llamadas: es la decisión 50 la que lo hace cierto.

`InMemoryRescheduleLedger` se movió a las fuentes de prueba. Sigue existiendo porque las pruebas del motor no deben necesitar una base de datos para comprobar una regla de planificación, y porque reproduce en memoria el comportamiento que la implementación real conserva en disco.

**Lo que la fase no promete.** El registro no expira: nada se borra nunca. Ver el riesgo 35.

---

## 49. Las pruebas corren contra H2, no contra PostgreSQL

Desviación declarada. `mvn test` tiene que pasar sin Docker levantado, y exigir PostgreSQL convertiría el comando en algo que depende del entorno de quien lo ejecuta. En esta máquina Testcontainers no era siquiera una opción comprobable: `docker --version` responde, pero el demonio no está disponible.

**Qué prueba H2, y qué no.** Con `MODE=PostgreSQL` prueba las entidades, los mapeos, el armado del agregado y la restricción de unicidad. No prueba las particularidades de PostgreSQL: sus tipos, sus índices, su concurrencia ni el DDL exacto que genera. El caso concreto que obliga a tener cuidado es `NUMERIC(10,4)`, que devuelve `8.0000` y no es igual a `8` para `BigDecimal`; por eso toda comparación de horas en la suite es `isEqualByComparingTo` y nunca `equals`. Queda como riesgo 34.

**`application-test.properties` y no `src/test/resources/application.properties`.** El segundo sombrearía el archivo principal entero, dejando fuera `planning.*` y `spring.config.import`, y la suite estaría probando una configuración que nadie ejecuta en ningún entorno.

**Qué se usa en cada caso.** `@DataJpaTest` en las pruebas de repositorio, que reemplaza la fuente de datos por una embebida sin configurar nada; `@SpringBootTest` + `@ActiveProfiles("test")` en la de endpoints, que necesita el contexto completo. La prueba del registro de idempotencia desactiva además la transacción de prueba (`NOT_SUPPORTED`) porque con ella activa el reclamo duplicado reventaría dentro de la misma transacción que lo creó —y eso no es lo que pasa en producción, donde cada reclamo corre en la suya.

---

## 50. Guardar no forma parte de calcular

`PlanningEngine.plan()` corre fuera de la transacción de guardado: `PlanningService` calcula primero y escribe después. De ahí salen tres consecuencias que conviene tener escritas.

1. **Un reclamo perdido durante el cálculo no arrastra el guardado del plan.** Es lo que hace seguro el `catch` de la decisión 48.
2. **Una escritura fallida no deshace la auditoría que el motor ya confirmó.** Un plan que no se guarda deja sus reclamos hechos, así que el siguiente intento no volverá a auditar. La asimetría es deliberada: el registro es la parte durable y el plan es la reconstrucción, y se prefiere un plan ausente a una auditoría duplicada.
3. **`simulate` y `plan` comparten el cálculo** (`PlanningService.run`) y solo se diferencian en si el resultado sobrevive a la respuesta.

---

## 51. `POST /plan` y `GET /{planId}` no devuelven lo mismo

`POST /plan` devuelve `{planId, createdAt, plan}`, con `plan` igual que la respuesta de la simulación. `GET /{planId}` devuelve la instantánea plana. Y `GET /{planId}/blocks` devuelve solo la agenda.

**Por qué.** El contexto de configuración —OLA, calendario, vencimientos— sale gratis en el `POST` porque se acaba de usar, y no se persiste. Quien relee un plan recibe lo que se guardó más lo que se deriva de ello (`displacedRequirements` sale de los eventos). No se inventa nada para que las dos respuestas se parezcan.

**Por qué existe el endpoint de bloques suelto.** Un timeline quiere la agenda, no la auditoría. Devolver el plan entero para que el cliente se quede con un campo obliga a traerse los eventos y los conflictos de propina.

**El coste, nombrado.** Las dos respuestas que devuelven un plan no tienen la misma forma, así que el cliente tiene que saber cuál tiene en la mano. Está documentado en el controlador y la prueba de endpoints lo fija.

---

## 52. `ddl-auto=update` mientras el plan sea un borrador

Hibernate crea y actualiza el esquema al arrancar. Es deliberado en esta fase: el plan todavía no es un compromiso y no hay datos que preservar, así que una migración por cambio sería ceremonia.

**Cuándo cambia.** El día que haya datos que conservar, `ddl-auto` pasa a `validate` y el esquema se mueve a Flyway. Queda como riesgo 33.

---

## 53. Preparación para la integración con GLPI

| Pieza | Estado |
|---|---|
| El plan enlaza por id | hecho: `workItemId` es el id de GLPI, y el plan no guarda una copia del elemento (decisión 45) |
| La entrada no se duplica | hecho: el día que GLPI alimente el motor, el plan seguirá describiendo el incidente por su id |
| `client/` sigue siendo la única capa que sabe de GLPI | hecho: `persistence/` no menciona a GLPI en ninguna clase |
| Que la entrada venga de GLPI | **falta**: hoy llega en el cuerpo HTTP. Es un cambio en `PlanningService.toDomain`, no en el motor |
| Qué pasa con un plan cuando GLPI cambia | **falta**: ver el riesgo 32 |

**Por qué esto estaba preparado de antes.** La Fase 5 ya dejó el motor sin saber de dónde vienen sus entradas: recibe un `PlanningRequest` armado. Esta fase no cambió ese límite, solo lo aprovechó para decidir qué se guarda. El día que GLPI sea la fuente, lo que cambia es quién llena el `PlanningRequest`.

---

## 54. Preparación para el Timeline de React

| Pieza | Estado |
|---|---|
| Endpoint que consume el timeline | hecho: `GET /api/planning/{planId}/blocks` |
| El bloque ya trae inicio, fin y horas | hecho en la Fase 5 (decisión 44) |
| Mapeo en la frontera (`Block` → `PlanningItem`) | **falta**: es trabajo del frontend, en `types/resource.ts` |
| Campos de presentación | **falta**: color por severidad, etiqueta y agrupación por recurso |
| Qué pinta el timeline | **falta decidir**: un plan guardado o la simulación en vivo |

**Por qué la decisión puede tomarse después.** Ahora existen los dos caminos —lo que se simula y lo que se guarda— y los dos devuelven la misma lista de bloques, porque el mapeo es el mismo método (`PlanningService.toBlock`) y hay una prueba que lo comprueba. Elegir uno no obliga a rehacer el otro.

---

## Mejoras previstas para la Fase 7

| # | Mejora | Estado tras la Fase 6 |
|---|---|---|
| 2 | Persistencia del plan y del registro de idempotencia | **hecha en la Fase 6** (decisiones 45 y 48) |
| 9 | Librería de timeline | **desbloqueada**: el endpoint de bloques ya existe (decisión 54). Falta el mapeo en la frontera y los tres campos de presentación |
| 5 | Capacidad parcial por desarrollador | sin cambios: sigue siendo parcial (decisión 43 de la Fase 5) |
| nueva | Que `Incident` y `Requirement` vengan de GLPI | es el paso siguiente natural: el punto de cambio es `PlanningService.toDomain` |
| nueva | `ddl-auto` a `validate` + Flyway | es la mejora que acompaña al primer dato que haya que conservar (riesgo 33) |
| nueva | Expiración del registro de idempotencia | es la mejora que acompaña al riesgo 35 |

El resto de la tabla de mejoras de las fases anteriores sigue pendiente sin cambios.

---

## Riesgos identificados

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 1 | **La URL de GLPI debe incluir `/apirest.php`** | Alto — error de configuración frecuente y poco evidente | Documentado en `.env.example` y en el README. El detalle del endpoint de salud ayuda a diagnosticarlo |
| 2 | **Versión de la API de GLPI** | Medio — `apirest.php` cambia entre versiones de GLPI | Verificado contra el contrato estándar de GLPI 10. Conviene confirmar la versión del GLPI destino antes de la Fase 3 |
| 3 | **`SPRING_PROFILES_ACTIVE=prod` activa logs JSON** | Bajo — ilegibles en consola local | El perfil es opcional y está documentado |
| 4 | **API sin autenticación** | Alto si se expone fuera de la red interna | No exponerla. `/api/planning/simulate` recibe datos completos de planificación, así que la Fase 3 (#15) es requisito para publicarla |
| 5 | **Datos mockeados en el dashboard** | Medio — pueden confundirse con datos reales | Aislados en un único servicio y con el módulo de timeline declarado explícitamente como vacío. La tarjeta "Estado GLPI" sí es real |
| 6 | **Sin pruebas de frontend** | Medio — regresiones silenciosas en la UI | Añadir Vitest en la Fase 3 (#12) |
| 7 | **Sesión de GLPI abierta por verificación** | Bajo — consumo innecesario de recursos en GLPI | El cierre va en un `finally`, así que no quedan sesiones colgadas. Optimizable con caché (#6) |
| 8 | **Versiones muy recientes del stack** (Spring Boot 3.5, React 19, Vite 8, Tailwind 4, TypeScript 6) | Medio — menos rodaje y menos respuestas en foros | Todas las versiones se fijaron tras consultar las fuentes oficiales y se verificó que compilan y arrancan |
| 9 | **TypeScript 6 depreca `baseUrl`** | Bajo — rompería al migrar a TS 7 | Ya se usa solo `paths`, sin `baseUrl` |
| 10 | **El puerto 8090 está reservado por Windows** | Bajo — solo afecta al entorno de desarrollo local | Detectado y evitado. Se usa 8080 (backend) y 5173 (frontend) |
| 11 | ~~**El registro de idempotencia se pierde al reiniciar**~~ — **resuelto en la Fase 6** | Medio mientras estuvo abierto — un reinicio podía re-auditar desplazamientos de la sesión anterior | Se resolvió donde la decisión 43 dijo que se resolvería: el registro pasó a la tabla `reschedule_claim`, con una restricción de unicidad sobre la pareja (incidente, requerimiento), y `PlanningEngine` no cambió una línea (decisiones 45 y 48). La prueba `laIdempotenciaSobreviveAlReinicioDeLaAplicacion` lo fija construyendo una instancia nueva sobre la misma base de datos, que es lo que hay después de un reinicio: memoria nueva, datos viejos |
| 12 | ~~**La capacidad es uniforme: 8 h al día, todos los días**~~ — **resuelto en la Fase 4** | Medio mientras estuvo abierto — el motor planificaba sobre sábados y domingos y no conocía festivos | Se resolvió donde se dijo que se resolvería: ampliando `PlanningRules.workingHoursFor`, sin tocar el motor (decisión 33) |
| 13 | **Atribución del incidente causante aproximada** | Bajo — en escenarios con varios incidentes graves el evento puede señalar el primero en lugar del exacto | El criterio está documentado en `causingIncidentFor` y es determinista. Con datos reales de GLPI conviene revisarlo: la relación causal exacta requiere saber qué requerimiento postergó cada incidente |
| 14 | **Un requerimiento mayor que la jornada nunca se ubica** | Medio — se reporta como conflicto en lugar de planificarse | Es la restricción de la decisión 22, con salida en la Fase 3 (#8). Mientras tanto el conflicto es visible, no silencioso |
| 15 | **`planning.*` solo se puede cambiar reiniciando** | Bajo — el umbral de 4 h es un valor de negocio que probablemente se ajuste | Se puede sobrescribir por petición en la simulación (`rules`). Cuando exista persistencia, los umbrales deberían vivir en configuración editable desde la UI |
| 16 | **Los incidentes sin severidad pueden quedarse indefinidamente** | Medio — mientras existan, el motor mantiene dos caminos de planificación y de auditoría | Es la migración controlada de la decisión 24. La rama legada está aislada en dos métodos (`isCause`, `appliedRule`) y tiene prueba propia, así que no se degrada en silencio. Se retira cuando GLPI envíe prioridad |
| 17 | **La OLA también se cambia solo reiniciando** | Bajo — es el acuerdo con el negocio y se ajusta de vez en cuando, no a diario | Mismo caso que el riesgo 15. Cambiarla en vivo es la forma de comprobar el ajuste, pero no es una operación rutinaria |
| 18 | **Atribución del incidente causante con varias severidades** | Medio — el evento señala al incidente que ocupa la fecha pactada, así que un requerimiento empujado por un `BAJO` puede auditarse contra el `ALTO` que ocupa ese día, y ese `BAJO` no deja evento propio | Verificado en vivo durante la validación. El criterio es determinista y está documentado en `causingIncidentFor`. La relación causal exacta exige saber qué requerimiento postergó cada incidente, que es la mejora pendiente del riesgo 13 |
| 19 | **La saturación de `BAJO` se mide contra la jornada estándar, no contra el hueco del día** | Bajo — un `BAJO` que sí cabría cede igualmente | El efecto neto es que cede más de lo necesario, nunca menos. Documentado en la decisión 26 |
| 20 | **`Incident.severity` admite `null`** | Bajo — un campo anulable es una invitación a olvidarse de él y a leerlo sin comprobar | La rama legada está acotada a dos métodos y cubierta por una prueba que fija su comportamiento. Desaparece con el campo |
| 21 | ~~**El motor consume por días completos; la OLA se calcula al minuto**~~ — **resuelto en la Fase 5** | Medio mientras estuvo abierto — un incidente reportado un viernes a las 16:30 ocupaba su bloque del viernes entero, aunque de esa jornada solo quedaran 30 minutos | Se resolvió unificando los dos relojes (decisiones 37–39): capacidad y OLA comparten ahora el mismo recorrido del calendario. El caso que abría la fase está fijado por la prueba `limite1IncidenteAltoAlFinalDelViernesReservaCapacidadParcial` |
| 22 | ~~**`DayBook.consumeGreedy` devolvía el día del reporte aunque no fuera laborable**~~ — **cerrado en la Fase 5 al desaparecer `DayBook`** | Alto mientras estuvo abierto — la asignación mostraba una fecha en la que nadie trabaja | El defecto se corrigió en la Fase 4 devolviendo el primer día que **aporta** horas, con prueba de regresión `unIncidenteReportadoEnFinDeSemanaSeUbicaElLunes`. En la Fase 5 el camino desapareció con la clase: ahora el primer tramo de un `claim` no puede caer en un día sin jornada porque no existe hueco que reclamar. Lección que se conserva: un cambio de calendario se verifica con fechas de calendario, no solo con la suite |
| 23 | **El calculador de tiempo hábil fija la zona horaria en UTC** | Bajo — si la zona operativa no fuera UTC, un incidente de las 16:30 podría caer del otro lado del cierre de jornada | Hoy ambos extremos son UTC: el calculador lo fija y el motor usa `clock.getZone()`, también UTC. El constructor del calculador ya acepta un `ZoneId`, así que el ajuste es una línea más su declaración en configuración |
| 24 | **No hay descanso de mediodía ni jornada partida** | Bajo — un día laborable es un solo bloque, así que 09:00–17:00 son 8 horas continuas de capacidad | Deliberado (decisión 34): ninguna regla del negocio lo pide. Se resuelve con varios bloques por día, cambio localizado en `WorkingCalendar` |
| 25 | **Los festivos se declaran a mano y por defecto no hay ninguno** | Medio — sin `PLANNING_CALENDAR_HOLIDAYS`, el sistema sigue planificando el 25 de diciembre como un día normal. Es mejor que antes (los fines de semana ya no se planifican), pero no es un calendario colombiano completo | Es una configuración vacía, no un defecto de cálculo: declarar los festivos del año es una operación de entorno. La fuente natural es GLPI, que ya tiene calendarios con festivos |
| 26 | **La OLA de adquisición (15 min) no se convierte en vencimiento** | Bajo — se declara y se reporta como número, pero no como fecha | Es reloj puro: la adquisición no se mide en tiempo hábil, así que no necesita el calendario. Convertirla en fecha es trabajo de la frontera cuando existan las marcas reales |
| 27 | **Seis pruebas anteriores cambian de expectativa** | Medio — casos que eran correctos según el negocio se planifican ahora de otra forma: un requerimiento que antes se movía entero al día siguiente se reparte entre el hueco que queda y los días siguientes | Es el coste declarado de la decisión 42, no un efecto colateral silencioso. Ninguna prueba se eliminó: las seis fijan ahora los tramos concretos, lo que las hace más estrictas que antes. El plan nuevo es el que el caso 3 del requerimiento pedía explícitamente («capacidad remanente usada correctamente»), imposible con la restricción anterior |
| 28 | **`allocations` y `blocks` son dos listas del mismo hecho** | Bajo — un cambio futuro que toque solo una de las dos las deja divergentes | Ambas se llenan en el mismo punto del motor y ninguna se deriva de la otra por diseño (decisión 40). Hay una prueba que compara la auditoría contra los bloques (`limite6LaAuditoriaCuentaLaMismaHistoriaQueLaAgenda`); no hay todavía una que compare asignaciones contra bloques, y sería la primera que añadir si aparecen síntomas |
| 29 | **La reserva de prioridad de `ALTO` se agota con la jornada** | Bajo — un ALTO que arranca a las 16:30 solo reserva 30 minutos, así que un requerimiento puede entrar el lunes por la mañana aunque el incidente siga abierto | Es deliberado (decisión 41): reclamar el día no es bloquear la semana. La prioridad se expresa sobre la jornada en que el incidente irrumpe, que es lo que la regla del negocio describe |
| 30 | **La agenda es continua: no hay descanso de mediodía** | Bajo — 09:00–17:00 son 480 minutos continuos de capacidad, y ahora el timeline los pinta al minuto | Sigue el riesgo 24: es deliberado y no lo pide ninguna regla. Con la agenda de franjas el cambio es más barato que antes —varios `TimeSlot` por día en lugar de un `BusinessHours`— pero sigue sin haber motivo para hacerlo |
| 31 | **`CapacityBook.occupy` reordena y fusiona el día completo en cada consumo** | Bajo — coste O(n log n) por colocación sobre las franjas de una jornada | Marcado con `ponytail:` en el código. Con las franjas que caben en un día laborable no compensa nada más listo, y el sitio donde compensaría es ese método |
| 32 | **Un plan guardado no se puede reproducir: guarda el resultado, no las entradas** | Medio — si GLPI cambia un incidente, el plan describe una entrada que ya no se puede reconstruir. La auditoría queda, pero no se puede recalcular ni explicar con los datos actuales | Es la consecuencia deliberada de la decisión 45: se guarda el plan, no una copia de datos ajenos. El plan es evidencia de lo que se decidió, no una función reproducible. Si hiciera falta reproducirlo, la vía es guardar la instantánea de la entrada en el momento de planificar, que es una tabla más y otra decisión |
| 33 | **`ddl-auto=update` en todos los entornos** | Medio — Hibernate actualiza el esquema al arrancar; con datos reales, un cambio de mapeo puede alterar o perder columnas sin que nadie lo revise | Deliberado mientras el plan sea un borrador: hoy no hay datos que conservar y el esquema cambia con el modelo (decisión 52). Antes de que el plan sea un compromiso, `ddl-auto` pasa a `validate` y el esquema se mueve a Flyway |
| 34 | **Las pruebas corren contra H2, no contra PostgreSQL** | Medio — H2 en modo PostgreSQL no reproduce los tipos, los índices, la concurrencia ni el DDL del motor real. Un defecto que solo aparezca en PostgreSQL no lo vería la suite | Desviación declarada y con motivo (decisión 49): la suite tiene que pasar sin Docker. Lo que sí cubre es el mapeo, el armado del agregado y la restricción de unicidad, que es donde se cometieron los errores en esta fase. El camino de salida es Testcontainers, y exige un demonio de Docker disponible tanto en desarrollo como en integración continua |
| 35 | **El registro de idempotencia no expira: crece sin límite** | Bajo a corto plazo, creciente — una fila por pareja (incidente, requerimiento) auditada, y nada se borra nunca. Con datos reales la tabla crece de forma indefinida | Aceptado en esta fase: el registro es pequeño (dos ids y una marca de tiempo) y su valor es ser permanente, porque la pregunta que responde —«¿ya audité esto?»— no caduca sin arriesgar una auditoría duplicada. Si el volumen llegara a importar, la vía es una política de retención por antigüedad, que habría que decidir junto con el negocio y no por criterio técnico |

---

# Fase 7 — Contexto de decisión

La Fase 6 hizo que el plan sobreviviera a la respuesta HTTP. Lo que quedó fuera fue el *con qué*. Un plan guardado dice que un requerimiento se movió el 5 de octubre bajo la regla `UMBRAL_INCIDENTE_EXCEDIDO`, y eso, tal cual, es una afirmación que no se puede comprobar: ¿contra qué umbral? ¿con qué jornada? ¿con qué calendario? El día que alguien cambie `planning.incident-threshold-hours`, el evento de octubre seguirá diciendo lo mismo y ya no habrá forma de saber si la regla se aplicó bien entonces.

La fase abre con esa pregunta: la plataforma tiene que poder explicar no solo **qué** ocurrió, sino **por qué** ocurrió. Lo que se añade no es más auditoría —el evento ya existía— sino el contexto que la hace interpretable.

**Lo que la fase no toca.** No hay reglas nuevas, ni un cálculo distinto, ni una línea cambiada en el motor. `PlanningEngine.java` no menciona el contexto en ningún punto (`grep -c "PlanningContext" domain/PlanningEngine.java` devuelve 0), y `domain/` sigue sin conocer Spring ni JPA. Es la misma propiedad que la decisión 43 dejó preparada y que la Fase 6 ya había ejercitado: el contexto se arma en el servicio, donde las reglas y los incidentes ya están en la mano, y el motor nunca se entera de que existe.

**Las nueve pruebas que la fase añade** (seis en el repositorio, tres en los endpoints) llevan la suite de 70 a 79, y ninguna expectativa anterior cambió.

---

## 55. `PlanningContextSnapshot`: la fotografía, no la configuración

El objeto es un registro de dominio con cinco campos: versión del motor, instante del cálculo, zona horaria, las severidades que participaron y las `PlanningRules` completas —umbral, horizonte, OLA por severidad y calendario—. `PlanningContextSnapshot.of(...)` lo construye a partir de las reglas que el motor recibió, que son las **efectivas**, no las del archivo: si una petición sobrescribe el umbral, lo que se guarda es el umbral que se usó.

**Por qué esto no contradice la decisión 45.** Aquella decisión dejó `PlanningRules` y `WorkingCalendar` fuera de la persistencia con un argumento que sigue en pie: una copia viva de la configuración es un segundo origen de verdad para el mismo valor. Lo que la Fase 7 añade no es eso. Es una copia **fechada**, atada a un plan concreto, que no se modifica nunca y que nadie consulta para saber cuál es la configuración vigente. El valor vivo sigue siendo `application.properties`; esto es lo que valía aquel día.

La diferencia se ve en el uso: si mañana el negocio cambia el umbral, la configuración vigente cambia y los planes viejos siguen contando lo que contaban. Eso es exactamente lo que un auditor necesita y exactamente lo que un segundo origen de verdad no haría.

---

## 56. Qué se persiste, dato por dato

Dos tablas. `planning_context` tiene una fila por plan y usa el mismo `plan_id` como clave primaria —no lleva clave sustituta: el contexto no tiene identidad propia, es un apéndice del plan—. `planning_context_policy` tiene una fila por severidad.

| Dato | Dónde | Por qué se guarda |
|---|---|---|
| `engineVersion` | `planning_context` | Sin ella, comparar dos planes de meses distintos es comparar dos motores distintos creyendo que es uno. Es la única forma de saber si un cambio de comportamiento vino de los datos o del código (decisión 59) |
| `calculatedAt` | `planning_context` | Es la fecha del cálculo, pedida explícitamente. Hoy coincide con `plan_snapshot.created_at`, y se conserva porque el contexto se lee sin tocar la fila del plan: un contexto que necesitara el plan para fecharse no sería una fotografía |
| `zoneId` | `planning_context` | `calculatedAt` es un instante y las horas del calendario son locales. Sin la zona, un plan calculado en `America/Bogota` y otro en `UTC` se leerían igual, y no lo son |
| `severities` | `planning_context` | Las severidades que participaron en la ejecución. Es lo que permite saber si el plan se calculó con la rama legada de la decisión 24 o con la nueva |
| `incidentThresholdHours` | `planning_context` | El valor contra el que se midió cada incidente. Es lo que hace comprobable la regla `UMBRAL_INCIDENTE_EXCEDIDO` |
| `planningHorizonDays` | `planning_context` | Hasta dónde miró el motor. Explica por qué algo se reportó como conflicto en lugar de colocarse |
| `calendarStart` / `calendarEnd` | `planning_context` | La jornada con la que se midió el tiempo hábil |
| `weekend` / `holidays` | `planning_context` | Los días que no cuentan. Sin ellos no se puede rehacer la aritmética de fechas que produjo el plan |
| OLA por severidad | `planning_context_policy` | El acuerdo con el negocio que estaba vigente: minutos de adquisición, horas de resolución y política de desplazamiento, por severidad |

**Lo que no se guarda, y por qué.**

| Dato | Por qué no |
|---|---|
| `workingHoursPerDay` | Se **deriva** del bloque del calendario: `PlanningRules` lo sobrescribe con `workingCalendar.businessHours().duration()` en su constructor compacto. Guardarlo sería guardar dos veces el mismo número con el riesgo de que un día discrepen. La prueba `conElContextoGuardadoSeReconstruyenLasReglasQueUsoElMotor` comprueba que la derivación devuelve lo mismo que declaró el motor |
| Los incidentes y los requerimientos | Son de GLPI. Es la decisión 45, sin cambios (riesgo 36) |
| Los bloques, asignaciones, eventos y conflictos | Ya están en las tablas de la Fase 6. El contexto no los repite |
| El nombre del desarrollador | El plan guarda `developerId`. El nombre no hace falta para releerlo |

---

## 57. El contexto entra por el puerto que ya existe

`PlanSnapshotRepository.save(...)` recibió un cuarto parámetro en lugar de nacer un `PlanningContextRepository` aparte. La razón es transaccional: el plan y su contexto se escriben dentro de la **misma** transacción, y con dos puertos habría dos, de modo que una escritura fallida en la segunda dejaría un plan guardado sin el contexto que lo explica.

Es el mismo argumento que ya usaba el guardado de los bloques —«un plan guardado sin sus bloques no es un plan incompleto, es un plan que miente»— aplicado al contexto, y es literalmente el mismo mecanismo: `JpaPlanSnapshotRepository.save` ya era el punto donde se escriben las cuatro tablas hijas, y ahora escribe cinco.

**Lo que se descartó.** Poner `@Transactional` sobre `PlanningService.plan()`. Sería la forma obvia de envolver todo, y rompe la decisión 50: un fallo al guardar el plan desharía también los reclamos de idempotencia, que es precisamente lo que aquella decisión eligió no deshacer. El contexto se escribe donde ya se escribía el plan, y nada más cambia.

**La lectura.** `findContext(planId)` devuelve `Optional<PlanningContextSnapshot>` y arma las reglas con dos consultas —la fila del contexto y las tres filas de la OLA—. El contexto no es un objeto persistente que se hidrata: se **reconstruye**, y por eso la prueba que importa no compara filas sino que vuelve a armar el objeto de dominio que el motor recibió.

---

## 58. La jornada se deriva; las severidades se copian enteras

Dos decisiones pequeñas que van en direcciones opuestas, y conviene tener escrito por qué.

**La jornada se deriva.** `workingHoursPerDay` no tiene columna. Sale del bloque del calendario al leer. Guardarlo sería un segundo sitio donde vive el mismo número.

**La OLA se copia entera.** `planning_context_policy` guarda **las tres** severidades siempre, aunque la ejecución solo haya usado una, y aunque el escenario no tenga ningún incidente con severidad. La tentación es guardar solo lo que se usó —es menos—, y es un error: lo que esta tabla responde es «cuál era el acuerdo vigente», y un acuerdo del que solo se conserva la parte que se usó no se puede comparar con el de mañana. Un plan de octubre sin incidentes tiene que poder decir cuáles eran las tres OLAs en octubre.

**La representación de los conjuntos.** `weekend`, `holidays` y `severities` son cadenas separadas por comas, y la cadena vacía es el único valor que representa la ausencia. Un centinela como `"NINGUNA"` haría que la lectura devolviera una severidad que el dominio nunca produjo; hay una prueba para eso (`unContextoSinSeveridadesNiFestivosVuelveVacio`). Va marcado con un `ponytail:` en el código: el techo es que no se pueden filtrar por SQL, y el día que haga falta —«dame los planes que se calcularon con el 25 de diciembre como festivo»— toca separarlas en su propia tabla.

---

## 59. `ENGINE_VERSION` es una constante escrita a mano

`PlanningContextSnapshot.ENGINE_VERSION = "1.0"`, sin derivar de la versión de Maven ni del `build-info` de Spring.

**Por qué a mano.** Un número que cambia en cada compilación no sirve para lo que se guarda aquí. La pregunta que la versión responde es «¿el motor cambió su forma de decidir?», y una versión de artefacto cambia también cuando se corrige una errata en el README. Se sube cuando cambia el algoritmo, y eso lo decide una persona.

**El coste, nombrado.** Es un número que hay que acordarse de subir. Se mitiga con la prueba `elContextoDeLaEjecucionSeGuardaConElPlanYVuelveEntero`, que fija el valor: cambiarlo sin querer rompe una prueba, que es la forma barata de que alguien lo mire.

---

## 60. `GET /api/planning/{planId}/context`

Es el endpoint que el requisito pedía. Devuelve `{planId, engineVersion, calculatedAt, zoneId, severities, rules}`, con `rules` conteniendo umbral, jornada, horizonte, la OLA de las tres severidades y el calendario.

**Por qué es una lectura aparte y no un campo más de `GET /{planId}`.** Porque son dos preguntas distintas. Quien relee un plan quiere su agenda; quien audita quiere sus reglas. Devolverlo todo junto obligaría a traerse la configuración entera para pintar un timeline, que es el mismo razonamiento que ya justificó el endpoint de bloques sueltos (decisión 51).

**Por qué reutiliza los tipos de `PlanningSimulationResponse`.** `IncidentPolicyView` y `WorkingCalendarView` ya existían y describen exactamente esta forma. Declarar unos segundos sería declarar dos veces lo mismo, y dos declaraciones de la misma forma acaban divergiendo.

**El 404.** Si no hay plan o no hay contexto, responde `PLAN_NOT_FOUND`, igual que las otras dos lecturas. Un plan sin contexto no es un caso que esta fase pueda producir —se escriben en la misma transacción—, así que el 404 solo cubre el plan inexistente.

---

## 61. Estrategia de trazabilidad

**Qué se conserva de una ejecución.** Tres capas, cada una respondiendo una pregunta distinta:

| Capa | Qué guarda | Qué pregunta responde |
|---|---|---|
| `reschedule_claim` | La pareja (incidente, requerimiento) que ya se auditó | ¿Ya conté esto? Es el registro de idempotencia (Fase 6) |
| `reschedule_event` | El hecho: qué se movió, de qué fecha a qué fecha, bajo qué regla y con qué severidad | ¿Qué ocurrió? |
| `planning_context` + `planning_context_policy` | La configuración vigente de esa ejecución | ¿Por qué ocurrió así? |

**El principio.** Lo que se guarda no es un resumen para leer: es suficiente para volver a armar el objeto de dominio que el motor recibió. La prueba `conElContextoGuardadoSeReconstruyenLasReglasQueUsoElMotor` no compara campos sueltos por comodidad —reconstruye las `PlanningRules` completas y las compara contra las originales, severidad por severidad. Si un dato se perdiera por el camino, esa prueba falla.

**El límite, declarado.** La trazabilidad es del **cálculo**, no de la **entrada**. Se puede saber con qué reglas se decidió y qué se decidió; no se puede volver a ejecutar el motor, porque los incidentes y los requerimientos no se guardan. Es el riesgo 36, evolución del 32.

---

## 62. Estrategia de auditoría

**Se mantiene lo que ya había.** `RescheduleEvent`, `WorkBlock` y `WorkAllocation` no cambiaron ni una columna. La fase no reescribe la auditoría: la completa. Un evento sigue siendo inmutable y sigue llevando copiada la severidad del incidente (decisión 28), que es lo que permite leerlo sin reconstruir el estado de aquel día.

**Lo que se añade es la capacidad de explicar la causa completa.** Antes, un evento con `appliedRule = UMBRAL_INCIDENTE_EXCEDIDO` era una afirmación sin comprobación posible. Ahora el mismo plan trae el umbral contra el que se midió, así que la afirmación se puede verificar en lugar de creer. La prueba `elContextoGuardadoExplicaLaReglaQueSeAplico` fija exactamente ese encadenamiento: el evento dice la regla, el contexto dice el umbral, y los dos tienen que concordar.

**Por qué la integridad es estructural y no una comprobación.** El contexto no se puede escribir sin el plan ni el plan sin el contexto: van en la misma transacción y en el mismo método (decisión 57). No hay una validación que alguien pueda saltarse, porque no hay un camino que los separe.

**Lo que la fase no hace.** El contexto no se firma ni se versiona por fila, y nada impide un `UPDATE` directo en la base de datos. La integridad depende de que no exista un camino de escritura, no de una restricción. Es el riesgo 37, y se acepta porque la aplicación solo lee esa tabla.

---

## 63. Explicabilidad de las decisiones

Las seis preguntas del auditor, y dónde se responde cada una:

| Pregunta | Dónde se responde |
|---|---|
| ¿Por qué se desplazó un requerimiento? | `reschedule_event.applied_rule`, más el contexto: bajo qué umbral, con qué horizonte y con qué OLA se aplicó esa regla |
| ¿Qué incidente lo provocó? | `reschedule_event.incident_id`, con el centinela `"-"` cuando no hubo incidente causante (decisión 48) |
| ¿Qué severidad tenía? | `reschedule_event.severity`, copiada en el momento del cálculo (decisión 28). El contexto añade qué severidades participaron en la ejecución |
| ¿Qué reglas estaban activas? | `planning_context`: umbral y horizonte; `planning_context_policy`: la OLA de las tres severidades |
| ¿Qué calendario se utilizó? | `planning_context`: jornada, fin de semana y festivos, más la zona horaria |
| ¿Qué configuración estaba vigente? | Todo lo anterior, más `engine_version` y `calculated_at` |

**Lo que sigue sin poder responderse.** Por qué el incidente tenía esa severidad, quién lo reportó o qué decía su descripción: son datos de GLPI, y el plan solo guarda su id. La explicabilidad llega hasta donde llega el cálculo.

**La propiedad que hace útil el conjunto.** Un evento viejo se lee con el contexto de **su** plan, no con la configuración de hoy. Eso es lo que convierte la respuesta en histórica y no en una interpretación del presente.

---

## 64. Preparación para la integración con GLPI

| Pieza | Estado |
|---|---|
| El contexto fechado | hecho: un plan guardado se explica con la configuración de su día, aunque la de hoy sea otra. Es lo que hará falta cuando GLPI cambie los datos que alimentan el motor |
| El plan enlaza por id, sin copiar la entrada | hecho desde la Fase 6, sin cambios (decisión 45) |
| `client/` sigue siendo la única capa que sabe de GLPI | hecho: `domain/` no menciona GLPI ni conoce Spring ni JPA (verificado por grep) |
| Que la entrada venga de GLPI | **falta**: hoy llega en el cuerpo HTTP. Es un cambio en `PlanningService.toDomain`, no en el motor |
| Qué pasa con un plan cuando GLPI cambia | **falta**: el riesgo 32 sigue abierto, y esta fase no lo cierra (riesgo 36) |
| Versión del motor frente a versión de GLPI | **falta decidir**: hoy `engineVersion` solo cubre el motor. Si GLPI cambia su forma de reportar prioridad, eso no queda registrado en ninguna parte |

**Por qué la fase acerca la integración sin hacerla.** El día que GLPI sea la fuente, la pregunta «¿por qué este plan se ve así?» tendrá dos causas posibles —el motor o los datos— y hasta hoy no había forma de distinguirlas. Con `engineVersion` y el contexto fechado, la mitad de la respuesta ya está escrita.

---

## 65. Preparación para gobierno operativo

Lo que un área de gobierno necesita para operar esto sin depender del equipo que lo escribió:

| Pieza | Estado |
|---|---|
| Poder explicar una decisión pasada | hecho: `GET /{planId}/context` |
| Poder distinguir un cambio de motor de un cambio de datos | hecho: `engineVersion` (decisión 59) |
| Poder ver qué acuerdos estaban vigentes | hecho: la OLA de las tres severidades, siempre completa (decisión 58) |
| Poder cambiar el umbral o la OLA sin reiniciar | **falta**: siguen en `application.properties` (riesgos 15 y 17). Es la mejora que un área de gobierno pide primero |
| Poder firmar o sellar un plan | **falta**: el contexto no es inmutable a nivel de base de datos (riesgo 37) |
| Retención: cuánto se conserva | **falta decidir**: nada se borra hoy (riesgo 35) |
| Quién puede consultar esto | **falta**: la API no tiene autenticación (riesgo 4). El contexto no añade datos sensibles nuevos, pero expone la configuración completa del motor a quien pueda leer un plan |

**Lo que la fase sí entrega al gobierno.** La capacidad de auditar sin acceso a la máquina ni al archivo de configuración: todo lo que hace falta para juzgar una decisión pasada sale de la API. Antes, reconstruir por qué un plan de octubre se veía así exigía saber qué decía `application.properties` en octubre, que es información que nadie guardaba.

---

## Mejoras previstas para la Fase 8

| # | Mejora | Estado tras la Fase 7 |
|---|---|---|
| nueva | Que `Incident` y `Requirement` vengan de GLPI | sigue siendo el paso siguiente natural: el punto de cambio es `PlanningService.toDomain` |
| nueva | Umbral y OLA editables sin reiniciar | es lo que un área de gobierno pide primero (riesgos 15 y 17), y ahora hay dónde guardar el histórico de los cambios |
| nueva | Guardar la instantánea de la entrada | es lo que cerraría el riesgo 36 y haría el plan reproducible, no solo explicable |
| nueva | `ddl-auto` a `validate` + Flyway | es la mejora que acompaña al primer dato que haya que conservar (riesgo 33) |
| nueva | Expiración del registro de idempotencia | es la mejora que acompaña al riesgo 35 |
| 9 | Librería de timeline | sin cambios: el endpoint de bloques existe desde la Fase 6 (decisión 54) |
| 5 | Capacidad parcial por desarrollador | sin cambios (decisión 43) |

El resto de la tabla de mejoras de las fases anteriores sigue pendiente sin cambios.

---

## Riesgos identificados

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 36 | **El plan sigue sin poder recalcularse: se guarda el resultado y el contexto, no las entradas** — evolución del riesgo 32 | Medio — se puede explicar por qué se decidió, pero no volver a decidir. Si GLPI cambia un incidente, el plan describe una entrada que ya no se puede reconstruir | Es la frontera declarada de la fase (decisión 61). El contexto cierra la mitad de la pregunta —con qué reglas— y deja abierta la otra —con qué datos—. La vía de cierre es guardar la instantánea de la entrada en el momento de planificar, que es una tabla más y otra decisión: aparece como mejora de la Fase 8 |
| 37 | **El contexto se puede modificar en la base de datos: la integridad depende de que no haya camino de escritura, no de una restricción** | Medio — un `UPDATE` directo, o una herramienta de administración, puede reescribir la configuración de un plan sin dejar rastro. La aplicación nunca lo hace, pero nada lo impide | Aceptado en esta fase: la aplicación solo lee `planning_context` (no hay ni un método de escritura fuera de `save`). Si el plan llegara a ser un compromiso formal, la vía es sellarlo —firma o hash de la fila— y decidir con el negocio qué se hace con un contexto alterado |
| 38 | **Dos tablas más por plan: `planning_context` crece una fila por plan y `planning_context_policy` tres** | Bajo — es el crecimiento más barato de todos los que introduce la persistencia: cuatro filas por plan frente a las decenas de bloques y asignaciones que ya se guardan | No requiere acción. Se deja escrito para que el día que se decida una política de retención se cuente con ellas: son las primeras que se pueden borrar sin perder el plan, porque el contexto explica pero no constituye |

---

# Fase 8 — Reproducibilidad: la instantánea de la entrada

La Fase 7 dejó el plan **explicable**. Un plan guardado dice qué se decidió y con qué reglas, y con eso un auditor puede responder «¿por qué se ve así?». Lo que no podía responder es la pregunta anterior: **¿qué datos exactos recibió el motor?**

Esa entrada vivía solo en el cuerpo de la petición HTTP que la trajo, y con ella se iba. El plan guardaba el resultado y el contexto; los incidentes y los requerimientos se quedaban fuera, enlazados por id a un sistema —GLPI— que puede cambiarlos o borrarlos. Un plan de octubre se podía leer, pero no se podía **volver a calcular**.

La fase cierra esa mitad: guarda la fotografía de la entrada en el momento de planificar. Con las tres piezas —entrada, contexto y versión del motor— la afirmación completa queda escrita y comprobable:

> con estas entradas, este contexto y esta versión del motor se obtuvo este resultado.

**Lo que la fase no toca.** Ni una línea del motor, ni una regla de negocio, ni el frontend, ni GLPI. `PlanningEngine.java` sigue sin mencionar la entrada persistida (`grep -c "PlanningInput" domain/PlanningEngine.java` devuelve 0): la instantánea se arma en el servicio, con los mismos objetos de dominio que ya iban al motor, y el motor nunca se entera de que existe. Las cuatro tablas de las fases anteriores —`work_block`, `work_allocation`, `reschedule_event`, `planning_context`— no cambiaron ni una columna: la información nueva **complementa**, no sustituye.

**Las catorce pruebas que la fase añade** (diez en el repositorio, cuatro en los endpoints) llevan la suite de 79 a 93, y ninguna expectativa anterior cambió.

---

## 66. `PlanningInputSnapshot`: la entrada, no un resumen de ella

El objeto es un registro de dominio con tres campos: el `developerId` y las listas de `Incident` y de `Requirement` **tal como entraron al motor**. No lleva las reglas: esas son el contexto, y mezclarlas en el mismo objeto borraría la distinción que la fase entera sostiene (decisión 69).

**Por qué no se guarda la petición entera.** `PlanningRequest` es el objeto que el motor recibe, y copiarlo tal cual habría sido lo obvio. Se descartó por dos motivos. El primero es que `PlanningRequest` lleva dentro las `PlanningRules`, que ya se guardan fechadas en `planning_context`: guardarlas otra vez sería el segundo origen de verdad que la decisión 55 evitó. El segundo es que la petición trae los datos de presentación —los títulos— que no intervienen en el cálculo.

**`toRequest(PlanningRules)` rearma la petición.** Es lo que hace comprobable la fase: con la instantánea y las reglas reconstruidas se vuelve a construir el objeto de dominio que el motor recibió, y se puede volver a ejecutar. El nombre del desarrollador se rellena con el propio `id`, porque no se guarda y el motor solo lee el `id`; la decisión está escrita en el código y comprobada en la prueba `conLaEntradaYElContextoGuardadosSeVuelveAObtenerElMismoPlan`, que verifica que el plan sale igual con el nombre real («Ana») y con el relleno («dev-1»).

---

## 67. Qué se persiste, dato por dato

Tres tablas. `planning_input` tiene una fila por plan y usa el mismo `plan_id` como clave primaria, igual que `planning_context`: la entrada no tiene identidad propia, es un apéndice del plan. Las otras dos llevan clave sustituta y una fila por elemento.

| Dato | Dónde | Por qué se guarda |
|---|---|---|
| `developerId` | `planning_input` | A quién se le planificó. Entra al resultado: es el `developerId` de cada bloque y cada asignación |
| `workItemId` | las dos tablas hijas | La identidad del incidente o del requerimiento. Sin ella no se puede saber a qué se refiere el plan |
| `estimatedHours` | las dos tablas hijas | La dedicación estimada. Es lo que compite por la jornada y lo que el motor reparte |
| `reportedAt` | `planning_input_incident` | El momento del reporte. Determina el día en que el incidente empieza a consumir, y es el segundo criterio de orden del motor |
| `severity` | `planning_input_incident` | La severidad declarada. Decide qué política se aplica y con qué prioridad entra |
| `status` (incidente) | `planning_input_incident` | Distingue un incidente vivo de uno resuelto, que el motor descarta |
| `plannedDate` | `planning_input_requirement` | La fecha pactada. Es el punto de partida de todo requerimiento y el primer criterio de orden |
| `status` (requerimiento) | `planning_input_requirement` | Distingue el trabajo vivo del finalizado o ya renegociado, que el motor descarta |

**Lo que no se guarda, y por qué.**

| Dato | Por qué no |
|---|---|
| `Incident.title` | `PlanningEngine` no lo lee en ningún punto. Un texto que no interviene en el cálculo no se copia: añadiría a la evidencia un campo que no explica nada de lo que salió, y daría a la foto una apariencia de completitud que no aporta a la reproducción |
| `Requirement.title` | Igual que el del incidente |
| El nombre del desarrollador | El motor solo lee el `id`. Se rellena al reconstruir la petición, y está comprobado que el plan no cambia |
| Las `PlanningRules` | Ya están fechadas en `planning_context`. Es la decisión 55, sin cambios |
| Los bloques, asignaciones, eventos y conflictos | Son el **resultado**, y viven en las tablas de la Fase 6. La entrada no los repite |

**Por qué se guardan también los elementos descartados.** Un incidente resuelto y un requerimiento finalizado no influyen en el cálculo, y se guardan igual. La foto es de lo que **entró**, no de lo que se usó: saber que estaban ahí es lo que permite distinguir «no influyó» de «no llegó». La prueba `laEntradaGuardaTambienLoQueElMotorDescarto` lo fija, y el mismo criterio que la decisión 58 usó para copiar las tres severidades enteras.

**`severity` admite nulo.** Los incidentes anteriores a la priorización por severidad no la declaran, y el motor los planifica con el umbral de dedicación. Un nulo aquí significa lo que dice, igual que en `reschedule_event`.

---

## 68. La entrada entra por el puerto que ya existe

`PlanSnapshotRepository.save(...)` recibió un quinto parámetro en lugar de nacer un `PlanningInputRepository` aparte. El motivo es el mismo que en la Fase 7 para el contexto, y es transaccional: el plan, su contexto y su entrada se escriben dentro de la **misma** transacción, y con puertos separados habría varias, de modo que una escritura fallida en la segunda dejaría un plan guardado sin la entrada que lo hace reproducible.

Es literalmente el mismo mecanismo: `JpaPlanSnapshotRepository.save` ya era el punto donde se escriben las tablas hijas, y ahora escribe ocho.

**Lo que se descartó.** Poner `@Transactional` sobre `PlanningService.plan()`, que sería la forma obvia de envolver todo. Rompe la decisión 50: un fallo al guardar el plan desharía también los reclamos de idempotencia. La entrada se escribe donde ya se escribía el plan, y nada más cambia.

**La lectura.** `findInput(planId)` devuelve `Optional<PlanningInputSnapshot>` con tres consultas y arma el objeto de dominio, no una fila. Y devuelve `Optional` en lugar de una lista vacía por una razón que sí importa aquí: **vacío significa que no consta, no que fuera vacía**. Un escenario sin incidentes ni requerimientos guarda su fila de entrada y se lee como una foto sin trabajo; un plan calculado antes de que esta tabla existiera no tiene fila. Sin esa distinción, un plan de la Fase 6 respondería con una entrada en blanco, que es una afirmación falsa sobre lo que el motor recibió.

---

## 69. Contexto y entrada: dos mitades que no se sustituyen

Es la distinción que la fase existe para trazar, y conviene que quede explícita porque las dos tablas se parecen: las dos cuelgan del `plan_id`, las dos tienen una fila por plan y las dos se leen por su propio endpoint.

| | `planning_context` (Fase 7) | `planning_input` (Fase 8) |
|---|---|---|
| Qué guarda | Con qué se decidió | Con qué datos se decidió |
| Qué contiene | Versión del motor, instante, zona, severidades participantes, reglas y calendario | Desarrollador, incidentes y requerimientos con los atributos que el motor lee |
| Qué pregunta responde | ¿Por qué salió así? | ¿Qué entró? |
| De quién es el dato | De la configuración del motor | De GLPI |
| Cuándo cambia en el origen | Cuando el negocio cambia el umbral o la OLA | Cuando alguien reporta, resuelve o renegocia un incidente o un requerimiento |
| Endpoint | `GET /{planId}/context` | `GET /{planId}/input` |

**Ninguna sustituye a la otra.** El contexto sin la entrada explica una decisión que no se puede volver a tomar; la entrada sin el contexto da unos datos que no se pueden volver a interpretar. Y ninguna de las dos sustituye al resultado: el plan sigue siendo la evidencia de lo que se decidió, y las tres se leen por separado porque son tres preguntas distintas (decisión 60).

**La prueba que sostiene la separación** no compara formas sino comportamientos: dos planes con las **mismas reglas** y distinta entrada comparten contexto y no comparten entrada. Si la entrada se hubiera guardado dentro del contexto —o al revés— una de las dos mitades fallaría.

---

## 70. Estrategia de reproducibilidad

**El principio.** Lo que se guarda no es un resumen para leer: es suficiente para volver a armar los objetos de dominio que el motor recibió y volver a ejecutarlo. Es el mismo principio que la decisión 61 aplicó al contexto, extendido a la entrada.

**La afirmación que la fase deja escrita:**

> con estas entradas, este contexto y esta versión del motor se obtuvo este resultado.

Cada pieza cubre una parte y ninguna sobra: la **entrada** fija los datos, el **contexto** fija las reglas, la zona y el instante, y la **versión del motor** avisa de si el algoritmo cambió entre dos planes comparados (decisión 59).

**Cómo se comprueba.** La prueba `conLaEntradaYElContextoGuardadosSeVuelveAObtenerElMismoPlan` recorre el camino entero: calcula un plan, lo guarda con su entrada y su contexto, suelta el resultado, y vuelve a calcular usando **solo lo que sobrevive en la base de datos**. Compara asignaciones, bloques y eventos contra los originales. Si un dato se perdiera por el camino, esa prueba falla.

**El límite, declarado.** La reproducción es exacta para la agenda y condicional para la auditoría. Está desarrollado en la decisión 71 y es el riesgo 39.

---

## 71. Qué se reproduce exacto y qué no

La parte incómoda de la fase, escrita en lugar de omitida.

| Pieza del resultado | ¿Se reproduce? | Por qué |
|---|---|---|
| `allocations`, `blocks`, `conflicts` | **Sí, exacto** | Son función pura de la entrada, las reglas y la zona. Los dos recorridos del motor ordenan con criterios que son orden total —severidad, `reportedAt` e `id`; y `plannedDate` e `id`—, así que el orden de las listas de entrada **no interviene**: la misma foto en otro orden da el mismo plan |
| `rescheduleEvents` | **Condicional** | El motor emite el evento solo si `ledger.claim(incidente, requerimiento)` devuelve `true`. Reproducir sobre la **misma** base de datos devuelve los mismos bloques y **cero eventos**, porque el hecho ya está registrado. Es lo correcto —es la idempotencia de la Fase 6— y hay que saberlo al auditar: la ausencia de eventos en una reproducción no significa que no hubo desplazamiento |
| `RescheduleEvent.timestamp` | **No** | Sale de `Instant.now(clock)` en el momento del cálculo. Es el único punto donde el instante del reloj entra al resultado, y no se puede reconstruir desde la entrada: es un hecho, no un cálculo |
| Los vencimientos (`incidentDeadlines`) | **No se guardan** | Se derivan de los incidentes en el servicio. Con la entrada guardada **sí** se pueden volver a derivar, que es más de lo que había antes |

**Lo que esto significa en la práctica.** Un auditor puede reconstruir la agenda exacta de cualquier plan pasado y comprobar que el motor la produce otra vez. Para la auditoría de desplazamientos necesita además el registro de idempotencia, que es lo que dice si el evento se emitió; y para la marca de tiempo, el `occurred_at` que quedó escrito, que es el hecho y no una derivación.

**Una precisión sobre el reloj.** El `timestamp` del evento y el `calculatedAt` del contexto salen del mismo `Instant.now(clock)` de la misma ejecución, así que coinciden. El contexto guarda el instante; el evento guarda el instante. Ninguno de los dos se recalcula al leer.

---

## 72. Estrategia de auditoría: complementar, no sustituir

**Se mantiene intacto lo que ya había.** `WorkBlock`, `WorkAllocation`, `RescheduleEvent` y `PlanningContextSnapshot` no cambiaron ni una columna, ni una firma, ni una prueba. La fase no reescribe la auditoría: le añade la pieza que le faltaba por delante.

| Capa | Qué guarda | Qué pregunta responde | Fase |
|---|---|---|---|
| `reschedule_claim` | La pareja (incidente, requerimiento) que ya se auditó | ¿Ya conté esto? | 6 |
| `reschedule_event` | El hecho: qué se movió, de qué fecha a qué fecha, bajo qué regla y con qué severidad | ¿Qué ocurrió? | 6 |
| `planning_context` + `planning_context_policy` | La configuración vigente de esa ejecución | ¿Por qué ocurrió así? | 7 |
| `planning_input` + sus dos tablas hijas | Los datos exactos que recibió el motor | ¿Con qué entró? | 8 |

**La cadena completa.** Con las cuatro capas, la auditoría de un plan responde las cuatro preguntas sin salir de la API y sin depender de que GLPI conserve nada: qué entró, con qué reglas, qué se decidió y si ya se había contado.

**Lo que sigue sin poder hacerse.** Un `UPDATE` directo sobre cualquiera de estas tablas las altera sin dejar rastro: la integridad depende de que no haya camino de escritura, no de una restricción. Es el riesgo 37, que la Fase 8 extiende a las tres tablas nuevas (riesgo 41).

---

## 73. `GET /api/planning/{planId}/input`

Es el endpoint que el requisito pedía. Devuelve `{planId, developerId, incidents, requirements}`, con cada incidente llevando `id`, `estimatedHours`, `reportedAt`, `status` y `severity`, y cada requerimiento `id`, `estimatedHours`, `plannedDate` y `status`.

**Por qué es una lectura aparte.** Porque es otra pregunta. Quien relee un plan quiere su agenda; quien audita quiere su entrada. Devolverlo todo junto obligaría a traerse los datos de GLPI para pintar un timeline, que es el mismo razonamiento que ya justificó el endpoint de bloques sueltos (decisión 51) y el de contexto (decisión 60).

**La asimetría con la petición, visible a propósito.** `POST /plan` acepta `title` y esta respuesta no lo devuelve, porque no se guarda. La diferencia está en la superficie de la API y no solo en un comentario, para que nadie la tome por un campo que se perdió por el camino. Lo mismo con el nombre del desarrollador: viaja el `id` y nada más.

**El 404.** Si no hay plan o no hay entrada registrada, responde `PLAN_NOT_FOUND`, igual que las otras tres lecturas. Devolver una entrada en blanco se leería como «el motor recibió una agenda vacía», que es una afirmación distinta de «no consta» y además falsa para los planes anteriores a esta fase (decisión 68).

---

## 74. Preparación para la integración con GLPI

| Pieza | Estado |
|---|---|
| `client/` sigue siendo la única capa que sabe de GLPI | hecho: `domain/` no menciona GLPI ni conoce Spring ni JPA |
| El plan enlaza por id, sin copiar la entrada como valor vivo | hecho: sin cambios (decisión 45) |
| La entrada fechada de cada ejecución | hecho: es lo que esta fase añade. El día que GLPI cambie un incidente, el plan de ayer sigue contando lo que entró ayer |
| Que la entrada venga de GLPI | **falta**: hoy llega en el cuerpo HTTP. Es un cambio en `PlanningService.toDomain`, no en el motor |
| Qué pasa con un plan cuando GLPI cambia | **mitigado**: el riesgo 32 sigue abierto para el plan —sigue enlazando por id—, pero la instantánea permite saber qué decía GLPI cuando se calculó |
| Versión del motor frente a versión de GLPI | **falta decidir**: `engineVersion` solo cubre el motor. Si GLPI cambia su forma de reportar prioridad, eso no queda registrado en ninguna parte |

**Por qué la fase acerca la integración sin hacerla.** Con la instantánea, un plan pasado se puede volver a calcular sin pedirle nada a GLPI. Eso convierte la integración en un cambio de origen —de dónde vienen los datos— y no en un cambio de modelo: el día que GLPI sea la fuente, la foto se seguirá tomando igual, solo que desde otro sitio. Y como los títulos no se guardan, el día que GLPI aporte descripciones ricas no habrá que decidir si migrarlas: no están.

**Lo que la fase no resuelve de GLPI.** La calidad de la severidad. Si GLPI reporta una severidad distinta a la real, la instantánea guardará fielmente el error: hace reproducible el cálculo, no correcta la entrada. Es la frontera que el riesgo 40 nombra.

---

## 75. Implicaciones de almacenamiento

| Tabla | Filas por plan | Cuándo crece |
|---|---|---|
| `planning_input` | 1 | Siempre. Es la fila que marca que hay entrada (decisión 68) |
| `planning_input_incident` | Tantos como incidentes entraron | Con el número de incidentes **recibidos**, incluidos los resueltos |
| `planning_input_requirement` | Tantos como requerimientos entraron | Con el número de requerimientos **recibidos**, incluidos los finalizados |

**Comparación con la Fase 7.** Aquella añadió cuatro filas fijas por plan (una de contexto y tres de OLA). Esta añade una más las entradas, así que **es la fase que más crece** de las dos: en un escenario con veinte incidentes y treinta requerimientos son cincuenta y una filas nuevas por plan.

**El tamaño de cada fila es pequeño.** Son ocho columnas cortas —identificadores de 64 caracteres, cuatro números, dos fechas— y ningún texto libre: los títulos no se guardan, que es justo lo que mantiene las filas estrechas. Un plan con una agenda de decenas de bloques pesa más en `work_block` que su entrada entera.

**Lo que no hay, y hay que decidirlo.** No hay política de retención: nada se borra (riesgo 35, sin cambios). La entrada es, junto con el contexto, lo **primero que se puede borrar sin perder el plan**: explica y permite recalcular, pero no constituye el resultado. El día que se decida una retención, ese es el orden razonable — primero la entrada, después el contexto, nunca los bloques ni los eventos.

**Por qué no hay índice por elemento.** Las dos tablas hijas llevan índice por `plan_id` y ninguno por `work_item_id`. La consulta que existe es «la entrada de este plan», y un índice por elemento serviría para «en qué planes aparece este incidente», que hoy no se pregunta. Se añade el día que se pregunte.

---

## Mejoras previstas para la Fase 9

| # | Mejora | Estado tras la Fase 8 |
|---|---|---|
| nueva | Que `Incident` y `Requirement` vengan de GLPI | sigue siendo el paso siguiente natural: el punto de cambio es `PlanningService.toDomain`, y la instantánea ya no depende de dónde vengan |
| nueva | Umbral y OLA editables sin reiniciar | sigue pendiente (riesgos 15 y 17) |
| nueva | Sellar la entrada y el contexto | el riesgo 37 sigue abierto y ahora cubre tres tablas más (riesgo 41) |
| nueva | `ddl-auto` a `validate` + Flyway | es la mejora que acompaña al primer dato que haya que conservar (riesgo 33), y con ocho tablas ya no es un borrador |
| nueva | Expiración del registro de idempotencia | es la mejora que acompaña al riesgo 35 |
| nueva | Retención de la entrada y el contexto | nuevo con esta fase: son las primeras tablas prescindibles (decisión 75) |
| 9 | Librería de timeline | sin cambios (decisión 54) |
| 5 | Capacidad parcial por desarrollador | sin cambios (decisión 43) |

El resto de la tabla de mejoras de las fases anteriores sigue pendiente sin cambios.

---

## Riesgos identificados

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 39 | **La reproducción es exacta para la agenda y condicional para la auditoría** — los eventos dependen del registro de idempotencia y su marca de tiempo del reloj | Medio — un auditor que reproduzca un plan sobre la misma base de datos verá los mismos bloques y **cero eventos**, y podría concluir que no hubo desplazamiento. La marca de tiempo del evento no es derivable de la entrada | Se documenta en la decisión 71 en lugar de disimularse. La vía de cierre es que el motor reciba el registro de idempotencia en modo consulta durante una reproducción, o que el `occurred_at` guardado sea la fuente de la reproducción en lugar de `Instant.now(clock)`. Ninguna de las dos es un cambio de esta fase: la primera toca el motor (criterio 4) y la segunda cambia el algoritmo (criterio 5) |
| 40 | **La instantánea hace reproducible el cálculo, no correcta la entrada** | Medio — si GLPI reporta mal una severidad o una dedicación, la foto lo guarda con toda fidelidad y el plan sale mal de forma reproducible. Un auditor puede confundir «el motor lo calculó bien» con «el plan es correcto» | Es una frontera del alcance, no un defecto: la fase responde «¿qué recibió el motor?» y no «¿era cierto lo que recibió?». La vía es la validación en la frontera con GLPI, que es el riesgo 6 y sigue abierto |
| 41 | **Las tres tablas nuevas se pueden modificar en la base de datos: la integridad depende de que no haya camino de escritura** | Medio — un `UPDATE` directo reescribe la entrada de un plan sin dejar rastro, y entonces el plan se reproduce contra unos datos que no fueron los que entraron. Es el riesgo 37 extendido | Aceptado en esta fase, con el mismo argumento: la aplicación solo escribe la entrada en `save` y solo la lee en `findInput`. Si el plan llegara a ser un compromiso formal, la vía es la misma —sellar— y cubriría las tres tablas a la vez |
| 42 | **Lo que no se guarda deja de ser reproducible si el motor empieza a leerlo** | Bajo — hoy el título y el nombre del desarrollador no se guardan porque el motor no los lee. El día que una regla los use, la foto queda incompleta y el fallo sería silencioso: la prueba de reconstrucción seguiría pasando porque reconstruye con lo que hay | Se mitiga con la prueba de reconstrucción, que compara el plan entero: el día que el motor lea un dato que no se guarda, el plan recalculado dejará de coincidir y la prueba fallará. Es la misma forma barata de que alguien lo mire que la decisión 59 usa para `ENGINE_VERSION` |

---

# Fase 9 — La capa anticorrupción: GLPI traducido antes de entrar

Hasta aquí el sistema **sabía hablar con GLPI, pero no sabía leerlo**. La integración entera eran tres operaciones —abrir sesión, validarla, cerrarla— y ningún dato de negocio: `GlpiClient` no consumía un solo endpoint de datos, y el único DTO de GLPI que existía era la respuesta del handshake. El motor se alimentaba exclusivamente de un cuerpo JSON escrito a mano por quien llamaba a `POST /api/planning/plan`.

Esta fase construye la pieza que faltaba: una **capa anticorrupción** que traduce GLPI al lenguaje del dominio antes de que nada entre al motor. El recorrido queda así:

```
GLPI  →  ACL  →  PlanningRequest  →  PlanningEngine
```

y la afirmación que sostiene la fase es negativa, que es la forma más difícil de comprobar y por eso se deja escrita: **el dominio no conoce GLPI**. No sus DTOs, no sus prioridades, no sus códigos, no su JSON. `PlanningEngine` no se tocó (criterio 3): `grep -c "glpi\|Glpi" domain/PlanningEngine.java` sigue devolviendo 0, y también en `domain/model/`, `domain/enums/` y `domain/rules/`, con la única excepción de `InputSource`, que se justifica en la decisión 86.

**Lo que la fase no toca.** Ni el motor, ni una regla de negocio, ni el frontend, ni los endpoints existentes. Tampoco introduce sincronización: no hay trabajos programados, ni colas, ni reintentos, ni escritura hacia GLPI. Se extrae cuando alguien llama al endpoint nuevo, y solo entonces.

**Las cincuenta y ocho pruebas que la fase añade** llevan la suite de 93 a 151, y ninguna expectativa anterior cambió.

---

## Inspección previa: cómo estaba el sistema antes de esta fase

El brief pedía documentar cuatro cosas antes de escribir una línea. Se hicieron sobre el código, no sobre lo que se creía recordar.

### 76. Cómo entraba la información al motor

Un único camino, y con un único punto de paso:

```
POST /api/planning/{simulate|plan}
  → PlanningController            (delega, no decide)
  → PlanningService.run(PlanningSimulationRequest)
      → toRules(...)              (config + sobrescrituras de la petición)
      → toDomain(...) ×2          (DTO → Incident / Requirement)
      → new PlanningRequest(...)
  → planningEngine.plan(request)
```

`PlanningEngine.plan(PlanningRequest)` era y sigue siendo **la única puerta**. Todo lo que el motor sabe del mundo entró por ahí. Eso es lo que hizo la fase viable: había un solo sitio donde interceptar, y no estaba dentro del dominio.

### 77. Qué conocía el sistema de GLPI

Menos de lo que la existencia de un `GlpiClient` sugería. Concretamente:

| Pieza | Qué hacía |
|---|---|
| `client/GlpiClient` | `initSession`, `getFullSession`, `killSession`. **Ningún endpoint de datos** |
| `config/GlpiProperties` | `base-url`, `app-token`, `user-token`, `timeout` |
| `config/WebClientConfig` | el `WebClient` con sus tiempos límite y el `App-Token` por defecto |
| `service/GlpiConnectivityService` | el diagnóstico; único punto de bloqueo |
| `controller/GlpiController` | `GET /api/glpi/health` |
| `dto/GlpiSessionResponse` | el único DTO de GLPI que existía |

Es decir: **el sistema conocía el protocolo de autenticación y nada del negocio**. No había una sola suposición escrita sobre qué es un ticket, cómo se prioriza o cómo se numera un estado. Toda suposición de esa clase la introduce esta fase, y por eso están todas declaradas en las decisiones 81 a 83 y en los riesgos 43 a 49.

### 78. Qué objetos espera el dominio

La frontera que la ACL tiene que producir, y nada más:

| Objeto | Campos | Invariantes que ya exigía |
|---|---|---|
| `Developer` | `id`, `name` | ambos con texto |
| `Incident` | `id`, `title`, `estimatedHours`, `reportedAt`, `status`, `severity` | id con texto, horas positivas, `reportedAt` y `status` no nulos; **`severity` admite nulo** |
| `Requirement` | `id`, `title`, `estimatedHours`, `plannedDate`, `status` | id con texto, horas positivas, `plannedDate` y `status` no nulos |
| `PlanningRequest` | `developer`, `incidents`, `requirements`, `rules` | listas copiadas, nulo → vacío |

Dos detalles de esa tabla gobiernan media fase. El primero: **`severity` ya admitía nulo** desde antes, porque el motor sabe trabajar sin ella por el umbral de horas. Eso convirtió «no sé la prioridad» en un caso previsto en lugar de un caso a inventar (decisión 81). El segundo: los títulos son **opcionales en el dominio**, así que un ticket de GLPI sin `name` no es un problema.

### 79. Por qué había que construir la ACL desde cero

Porque no existía ninguna suposición sobre el contrato de datos de GLPI, y una capa anticorrupción es exactamente el sitio donde esas suposiciones viven. No se trataba de refactorizar una integración: se trataba de **inventariar y aislar** las suposiciones que hacían falta para leer un ticket, y de que ninguna de ellas llegara al dominio.

---

## La estructura

### 80. Dónde vive la capa anticorrupción

Paquete nuevo, `integration/glpi/`, con una responsabilidad por clase:

| Clase | Responsabilidad | Conoce |
|---|---|---|
| `GlpiUser`, `GlpiTicket` | DTOs externos: el JSON de GLPI, campo por campo | GLPI |
| `GlpiPlanningSource` | **el puerto**: qué necesita la aplicación de GLPI, en dos preguntas | nada |
| `GlpiRestPlanningSource` | **el adaptador**: rutas, sesión, HTTP, clasificación de fallos | GLPI + `GlpiClient` |
| `GlpiTicketMapper` | **la traducción**: códigos y fechas → enums y unidades del dominio | los dos |
| `GlpiPriorityMapper` | la correspondencia prioridad → severidad, aislada | los dos |
| `GlpiTicketValidator` | **la política**: si un ticket se traduce o se descarta, y por qué | los dos |
| `GlpiPlanningRequestFactory` | **el ensamblaje**: produce la `PlanningRequest` y los descartes | los dos |
| `GlpiDiscardedItem` | el registro de lo que quedó fuera | nada |

**Por qué el puerto devuelve DTOs y no objetos del dominio.** Es la decisión menos obvia de la tabla. Un adaptador que ya tradujera sería más cómodo de usar, pero la traducción dejaría de tener un sitio único: el mapeo de prioridades y la política de descarte acabarían dentro del cliente HTTP, que es justo donde el documento de decisiones (mejora #1) dice que no deben estar. Devolviendo el ticket crudo, el transporte y el significado quedan separados por una frontera que se puede probar por los dos lados.

**Por qué el cliente HTTP sigue siendo `client/GlpiClient`.** No se creó un cliente nuevo: se le añadieron dos operaciones genéricas, `get(path, token, tipo)` y `getList(path, token, tipo)`. El tipo entra por parámetro, de modo que `client/` **no depende de `integration/glpi/`** y la dependencia va en un solo sentido. Las rutas —`/User/`, `/Ticket`— viven en el adaptador, porque saber que existe `/Ticket` es conocer el contrato de GLPI y eso es de quien adapta, no del transporte.

**Por qué el dominio no se enteró.** Nada de `integration/glpi/` es alcanzable desde `domain/`: el paquete importa al dominio, nunca al revés. La prueba de que la frontera aguanta es que `PlanningEngine` no cambió ni una línea y las veintinueve pruebas del motor siguen pasando sin tocarlas.

---

## El mapeo

### 81. Mapeo de prioridad → severidad

GLPI prioriza en una escala de 1 a 5 con tres campos relacionados —`priority`, `impact`, `urgency`—, y calcula la prioridad a partir de los otros dos con una **matriz configurable por instancia**. El dominio tiene tres valores: `ALTO`, `MEDIO`, `BAJO`.

| GLPI | Dominio | Por qué |
|---|---|---|
| `5`, `4` | `ALTO` | El dominio tiene una categoría por encima de la media y tiene que significar algo. Si `4` cayera en `MEDIO`, `ALTO` solo la produciría el extremo de GLPI y el dominio perdería «importante pero no crítico» |
| `3` | `MEDIO` | El centro de la escala, uno a uno |
| `2`, `1` | `BAJO` | Simétrico con el extremo alto |

Tres reglas gobiernan el resto del mapeo:

1. **Si falta la prioridad, se deduce del mayor entre impacto y urgencia.** GLPI calcula la prioridad con esos dos campos; tomar el mayor es una **aproximación declarada**, no una réplica de la matriz, porque la matriz real es configurable y no se puede reproducir sin leerla.
2. **Si no hay nada que traducir, la severidad es nula y el ticket se conserva.** Un ticket sin prioridad, impacto ni urgencia es válido en GLPI. Descartarlo perdería trabajo real; inventarle un valor produciría un plan que parece completo y no lo está. El dominio ya sabía leer una severidad nula, así que el ticket degrada al camino del umbral de horas y la respuesta dice `severity: null`, que es la verdad.
3. **Un valor fuera de la escala no se interpreta ni se recorta.** Un `9` significa que la suposición sobre el contrato de GLPI es falsa. Adivinar qué quiso decir sería peor que declarar que no se sabe: se trata como ausente, con aviso, y se intenta el impacto y la urgencia.

**La prioridad manda sobre el impacto y la urgencia.** Si GLPI trae prioridad utilizable, los otros dos no se miran: son los que la produjeron, y preferir el original evita que una discrepancia entre los tres campos cambie el plan.

### 82. Mapeo de tipo y estado: un ticket, dos objetos del dominio

En GLPI los incidentes y las peticiones son **la misma entidad**. En el dominio son dos tipos distintos que el motor trata de forma distinta. La separación la hace `type`:

| `type` | Dominio |
|---|---|
| `1` | `Incident` |
| `2` | `Requirement` |
| otro | descartado |

Los estados se traducen **por su significado, no por su número**, y el mismo código de GLPI cae en enums distintos según el lado:

| `status` | GLPI | → `Incident` | → `Requirement` |
|---|---|---|---|
| `1` | Nuevo | `ABIERTO` | `PLANIFICADO` |
| `2`, `3`, `4` | Asignado / Planificado / Pendiente | `EN_ATENCION` | `EN_EJECUCION` |
| `5`, `6` | Solucionado / Cerrado | `RESUELTO` | `FINALIZADO` |
| otro | — | descartado | descartado |

Dos decisiones dentro de la tabla:

- **Los estados vivos se aplanan.** `2`, `3` y `4` son matices de gestión en GLPI —el ticket está vivo y en manos de alguien— y el motor no los distingue para calcular. Aplanarlos aquí evita que el dominio aprenda cuatro estados que solo se diferencian en cómo se gestionan, no en cuánto ocupan.
- **Una petición nueva es `PLANIFICADO`, no `EN_EJECUCION`.** El motor solo planifica lo que está `PLANIFICADO` o `EN_EJECUCION`. Traducir `1` a un estado no planificable sacaría del cálculo a toda petición recién creada por un tecnicismo de traducción, que es exactamente lo que una capa anticorrupción no debe hacer.

**`PENDIENTE_DE_RENEGOCIACION` no aparece en ninguna tabla, y es correcto.** No es un estado que GLPI pueda tener: es un estado que el motor deduce cuando no alcanza a planificar algo. Un requerimiento no entra al motor renegociado; sale.

### 83. Unidades y fechas

| Dominio | GLPI | Conversión |
|---|---|---|
| `estimatedHours` | `actiontime` | segundos → horas, escala `4` (la de la columna que las guarda) |
| `reportedAt` | `date` | `yyyy-MM-dd HH:mm:ss` interpretado en la zona del reloj de la aplicación |
| `plannedDate` | `time_to_resolve` | el mismo formato, reducido a su día |

**Las horas se redondean a cuatro decimales, que es la escala de `numeric(10,4)`.** Redondear más tarde, al persistir, haría que la entrada registrada no fuera exactamente la que el motor leyó.

**La ausencia de zona horaria es real y se resuelve declarándola.** GLPI envía las fechas sin zona. Se interpretan en la zona del reloj de la aplicación —el mismo que fecha los planes—, que es la única elección que no desplaza las fechas. Queda como suposición en el riesgo 47 porque no se puede verificar sin una instancia real.

---

## La validación

### 84. Descartar el ticket, no la planificación

Dos niveles, y la frontera entre ellos es la pregunta «¿se puede construir el objeto del dominio?».

**Descarta** —el ticket se pierde, con su motivo, y los demás se planifican igual:

| Defecto | Motivo que se registra |
|---|---|
| sin `id` | `sin identificador de ticket` |
| `type` desconocido | `tipo de ticket desconocido: N` |
| `actiontime` ausente o no positivo | `sin horas estimadas: actiontime ausente o no positivo` |
| `status` desconocido | `estado de incidencia/petición desconocido: N` |
| `date` ilegible | `fecha de creación ausente o ilegible: '...'` |
| `time_to_resolve` ilegible (solo peticiones) | `fecha comprometida ausente o ilegible: '...'` |

**Degrada** —el ticket entra, con un valor declarado:

| Defecto | Qué pasa |
|---|---|
| sin `priority`, `impact` ni `urgency` | entra con `severity: null` y decide el umbral de horas |

**Por qué descartar y no fallar.** Un ticket mal formado en GLPI es un dato de entrada defectuoso, no un fallo del sistema. Tumbar la petición entera por él haría que un solo ticket malo bloqueara el trabajo de todo un desarrollador.

**Por qué descartar y no inventar.** Planificar con un valor inventado para el campo que falta produciría un plan que parece completo y no lo está, y el descarte sería invisible. La alternativa —inventar— es la única que no se puede detectar desde fuera.

**Por qué el descarte se devuelve y no solo se registra.** `POST /api/planning/from-glpi` responde con la lista de tickets descartados y sus motivos. Un plan con menos trabajo del que hay, sin decirlo, es indistinguible de un plan correcto. Es el mismo principio que la decisión 67 aplica a la entrada guardada: lo que se recibió es un dato, y lo que se descartó también.

**Los motivos están escritos para una persona que opera GLPI**, no para un programa: nombran el campo que hay que corregir y el valor que llegó. El texto viaja tal cual hasta la respuesta.

**Una lista vacía no es un error.** Si GLPI no devuelve tickets, el motor recibe una agenda vacía y produce un plan vacío, que es la respuesta correcta a «este desarrollador no tiene trabajo pendiente». Tratarlo como fallo obligaría a inventar una excepción para el caso más normal de todos.

---

## Los errores

### 85. Cuatro clases, cuatro códigos

| Situación | Excepción | HTTP | Código |
|---|---|---|---|
| GLPI caído, DNS, TLS, **timeout** | `GlpiUnreachableException` | `503` | `GLPI_UNAVAILABLE` |
| GLPI responde un error | `GlpiConnectionException` | `503` | `GLPI_UNAVAILABLE` |
| Credenciales rechazadas (`401`, `403`) | `GlpiAuthenticationException` | `502` | `GLPI_AUTHENTICATION_FAILED` |
| El cuerpo no se puede leer | `GlpiInvalidDataException` | `502` | `GLPI_INVALID_DATA` |
| El elemento pedido no existe | `GlpiItemNotFoundException` | — | se convierte en `Optional` vacío |
| El desarrollador no está en GLPI | `GlpiDeveloperNotFoundException` | `404` | `DEVELOPER_NOT_FOUND` |

Las cuatro primeras heredan de `GlpiConnectionException`, de modo que un manejador genérico sigue tratándolas como lo que son y **no hubo que tocar los manejadores existentes**. Se separan para poder responder y registrar distinto, porque son cuatro averías que se arreglan en sitios distintos: la red, el servicio, los tokens, el contrato. Meterlas en un solo `503` obligaría a leer el mensaje para saber a quién llamar.

**El timeout no tiene clase propia, y es deliberado.** Spring envuelve el vencimiento del tiempo de espera en la misma excepción que un fallo de conexión, y su mensaje conserva la causa original —`Response timeout after 5000ms`—, que es lo que distingue una cosa de la otra. Añadir una clase obligaría a depender de Netty para inspeccionar el tipo de la causa; el mensaje ya lo dice.

**El caso incómodo es el elemento inexistente.** GLPI responde a eso con `HTTP 400` y un cuerpo `["ERROR_ITEM_NOT_FOUND", ...]`, **no con un 404**, así que el código de estado no alcanza para reconocerlo y hay que mirar el cuerpo. Se mira sobre el cuerpo completo y no sobre el truncado, para que el reconocimiento no dependa del límite de longitud de los mensajes. Sin esta clase, pedir un usuario que no existe se vería desde fuera como un fallo de conexión y quien llama recibiría un `503` que le dice que revise la red cuando el problema es el identificador que escribió.

**El cierre de sesión nunca enmascara el resultado.** Va en un `finally` y su fallo se registra y se traga: un error al cerrar no puede invalidar una lectura que ya se hizo bien.

---

## La trazabilidad

### 86. La procedencia de la entrada

La Fase 8 guardó **qué** datos entraron al motor. Esta añade **de dónde vinieron**, con tres campos en `planning_input`:

| Columna | Qué guarda |
|---|---|
| `source` | `HTTP` o `GLPI` |
| `extracted_at` | cuándo se extrajo de GLPI |
| `adapter_version` | con qué versión del adaptador se tradujo |

**`InputSource` vive en `domain/enums/`, y hay que justificarlo** porque es la única mención a GLPI que se acerca al dominio. No es un contrato de GLPI: es una **etiqueta de procedencia**, de la misma clase que `status` o `severity` —dice algo del origen del dato, no de su forma—. El dominio puede nombrar de dónde viene una entrada sin saber cómo está hecha por dentro, igual que puede decir que un incidente está `RESUELTO` sin conocer la tabla que lo guarda. Y el brief lo pedía explícitamente: «registrar: source = GLPI». Lo que el dominio sigue sin conocer es el contrato: los DTOs, las prioridades, los códigos y el JSON.

**`adapterVersion` es el campo que hace útil la trazabilidad.** Un plan calculado con datos de GLPI se puede volver a leer, pero **no se puede volver a traducir**: los tickets ya cambiaron. Saber con qué versión del adaptador se tradujeron permite reconstruir la interpretación, no solo el dato. Es la misma idea que `engineVersion` en el contexto, aplicada a la frontera.

**Solo GLPI se fecha y se versiona, y la invariante lo obliga.** `InputProvenance` exige fecha y versión cuando `source` es `GLPI`. Una procedencia a medias —una fila que dice `GLPI` y nada más— no permite auditar nada y además afirma una trazabilidad que no existe. La vía HTTP no tiene extracción que fechar ni traducción que versionar: los datos llegaron ya en la forma del dominio, escritos por quien llamó al endpoint. Exigirle una fecha obligaría a inventarla, y una fecha inventada en un registro de auditoría es peor que su ausencia.

**Las filas anteriores a esta fase se interpretan, no se migran.** `source` nulo se lee como `HTTP`, porque no había otra vía posible: el conjunto de orígenes era de un solo elemento. Escribirlo hacia atrás sería afirmar algo que no consta en ningún sitio; deducirlo es exacto. No hay migración que rellenar.

**Los planes de las fases anteriores siguen respondiendo lo mismo.** `PlanningInputSnapshot` conserva un constructor de tres argumentos que asume `HTTP`, de modo que ninguna llamada anterior cambió, y `GET /{planId}/input` devuelve los tres campos nuevos sin romper a quien ya lo consumía.

---

## El caso de uso

### 87. `POST /api/planning/from-glpi`

Los siete pasos del brief, en este orden:

| # | Paso | Quién |
|---|---|---|
| 1 | Obtener datos desde GLPI | `GlpiRestPlanningSource` |
| 2 | Construir `PlanningRequest` | `GlpiPlanningRequestFactory` |
| 3 | Ejecutar `PlanningEngine` | `PlanningService.plan(request, provenance)` |
| 4 | Persistir plan | `JpaPlanSnapshotRepository` |
| 5 | Persistir contexto | ídem |
| 6 | Persistir snapshot de entrada | ídem |
| 7 | Devolver `planId` | `PlanningController` |

**El cuerpo pide un solo dato: `developerId`.** Todo lo demás no lo elige quien llama: lo trae GLPI. Un cuerpo con campos para las reglas abriría la puerta a que el plan no corresponda a la configuración vigente, y la trazabilidad —que dice con qué reglas se decidió— quedaría registrando algo que nadie eligió. Las reglas son las configuradas.

**Falla antes de traer tickets si el desarrollador no existe.** Pedir los tickets de alguien que no está sería trabajo tirado, y además devolvería una lista vacía que se leería como «no tiene trabajo» cuando lo que pasa es que el identificador está mal. El `404` dice la verdad.

**El identificador que se guarda es el que pidió quien llamó, no el número interno de GLPI.** Así la respuesta y la petición se pueden correlacionar sin conocer la numeración de GLPI. El precio está anotado en el riesgo 46.

**El plan que sale es un plan de los de siempre.** Mismo motor, mismas tablas, mismos endpoints de consulta después: `GET /{planId}`, `/{planId}/blocks`, `/{planId}/context` y `/{planId}/input` funcionan igual. Lo único distinto es de dónde vinieron los datos, y eso se lee en la procedencia. Los seis endpoints anteriores siguen existiendo sin cambios.

**La prueba que más dice de esta fase** compara los dos caminos: el escenario de `PlanningEndpointsTest` escrito a mano y el mismo escenario traído de GLPI producen **el mismo plan** —tres bloques, dos asignaciones, un desplazamiento bajo `UMBRAL_INCIDENTE_EXCEDIDO`—. Que dos entradas distintas por caminos distintos converjan en el mismo resultado es la afirmación que sostiene la capa anticorrupción.

### 88. Qué no se modificó

| Artefacto | Estado |
|---|---|
| `domain/PlanningEngine.java` | **intacto** — ni una línea |
| `domain/model/`, `domain/enums/`, `domain/rules/` | intactos salvo `InputSource` (decisión 86) e `InputProvenance`, ambos aditivos |
| `PlanningService.run(...)` | la llamada al motor sigue siendo una sola; lo único que cambió es que ahora conoce la procedencia, y solo para registrarla |
| Endpoints existentes | los seis siguen igual |
| Frontend | sin cambios |
| `PlanningEngine` y la idempotencia | el registro de reclamos no se toca: el motor sigue reclamando como antes |

**La procedencia no interviene en el cálculo, y es deliberado.** El motor no debe comportarse distinto según de dónde vinieron los datos, porque entonces el origen sería una variable del resultado y la trazabilidad dejaría de ser una etiqueta para volverse una regla de negocio.

---

### 89. Implicaciones de almacenamiento

| Tabla | Cambio | Filas |
|---|---|---|
| `planning_input` | **tres columnas nuevas**, todas nulas: `source varchar(16)`, `extracted_at`, `adapter_version varchar(32)` | las mismas: una por plan |
| `planning_input_incident` | sin cambios | las mismas |
| `planning_input_requirement` | sin cambios | las mismas |

**El crecimiento es de tres columnas cortas en una fila que ya existía**, y son nulas en todos los planes anteriores. No hay tabla nueva ni fila nueva: la fase más barata en almacenamiento de las tres últimas, y la única cuyo coste es literalmente cero para los planes ya guardados.

**`ddl-auto` sigue en `update`.** Con esta fase son ya ocho tablas y tres columnas añadidas por evolución del esquema, y el riesgo 33 sigue abierto sin cambios. Es la mejora que acompaña al primer dato que haya que conservar de verdad.

---

### 90. Preparación para la sincronización futura

La fase **no implementa** sincronización, y el brief lo prohibía. Lo que sí hace es dejar el terreno preparado, y conviene ser preciso sobre qué está listo y qué no.

**Lo que ya está en su sitio:**

1. **El puerto.** `GlpiPlanningSource` es el sitio donde una sincronización futura consultaría. Añadir «qué cambió desde tal fecha» es un método más en la interfaz y una consulta más en el adaptador; ni el dominio ni el motor se enteran.
2. **El adaptador versionado.** `adapterVersion` en la entrada permite saber con qué interpretación se construyó cada plan. El día que una traducción cambie, se sube la versión y los planes viejos siguen siendo legibles.
3. **La traducción aislada y probada.** Cincuenta y ocho pruebas cubren el mapeo sin una instancia real. Una sincronización reutiliza ese código entero: lo único nuevo sería el disparador.
4. **El descarte visible.** Una sincronización que descarte elementos en silencio es la peor forma de perder datos. El mecanismo para no hacerlo ya existe y ya se devuelve al llamador.
5. **La procedencia.** Una entrada escrita por una sincronización se distingue de una escrita a mano y de una extraída a petición.

**Lo que falta, y por qué no está aquí:**

1. **Un modo incremental.** Hoy `ticketsOf` trae los tickets de un desarrollador y filtra por asignado. Una sincronización quiere «qué cambió desde el último corte», y eso es una consulta distinta que no se puede escribir sin validarla contra una instancia real (riesgo 43).
2. **Una decisión sobre qué hacer con lo que desaparece.** Un ticket que ya no está asignado, ¿se retira del plan? Es una regla de negocio, no una traducción, y no le toca a esta fase.
3. **Idempotencia del disparador.** El registro de reclamos ya impide duplicar desplazamientos, pero una sincronización periódica necesita además decidir si dos ejecuciones con los mismos datos deben producir dos planes. Hoy producirían dos planes distintos con el mismo contenido.
4. **La reutilización de la sesión.** El adaptador abre y cierra una sesión por consulta, y el flujo abre dos (riesgo 45). Es la mejora #6 que el documento lleva anotada desde la primera fase.

**El orden razonable** para la fase siguiente es: primero validar las suposiciones contra una instancia real de GLPI (riesgo 43), después la consulta incremental, después el disparador. Al revés se construiría sincronización sobre un contrato que nadie ha comprobado.

---

## Mejoras previstas para la Fase 10

| # | Mejora | Estado tras la Fase 9 |
|---|---|---|
| 1 | **Capa anticorrupción explícita** | **cerrada en esta fase** — el paquete `integration/glpi/` y su puerto |
| 3 | **Alimentar el motor con datos reales de GLPI** | **cerrada en esta fase** — `POST /api/planning/from-glpi` |
| 6 | Reutilizar la sesión de GLPI | **sigue pendiente**, y ahora importa más: el flujo abre dos sesiones (riesgo 45) |
| nueva | **Validar el contrato contra una instancia real** | es la primera de la fase siguiente: sin ella, todo lo de arriba es una suposición coherente (riesgo 43) |
| nueva | Consulta incremental por fecha de cambio | es el paso previo a cualquier sincronización (decisión 90) |
| nueva | Escribir el descarte en la entrada guardada | hoy se devuelve pero no se persiste (riesgo 48) |
| 9 | Librería de timeline | sin cambios (decisión 54) |
| 5 | Capacidad parcial por desarrollador | sin cambios (decisión 43) |

El resto de la tabla de mejoras de las fases anteriores sigue pendiente sin cambios.

---

## Riesgos identificados

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 43 | ~~**Las suposiciones sobre el contrato de GLPI no están verificadas contra una instancia real**~~ — **medido tras la Fase 11** (decisiones 104 a 108) | **Cerrado como riesgo ciego, abierto como hallazgo.** Ya no hay suposiciones sin comprobar: la forma del contrato se verificó entera y salió bien. Lo que apareció al medir es peor que lo que el riesgo describía: no es que un nombre de campo difiera, es que **un campo que el contrato declara no existe en la respuesta** y otro llega a cero en el 99,4 % de la muestra | La vía prevista —una prueba de integración contra un GLPI de verdad— es la que se ejecutó, y funcionó: produjo los siete hallazgos de la decisión 106. El riesgo cambia de naturaleza: de «no sabemos qué suponemos» a «sabemos exactamente qué falla, con qué frecuencia y por qué». Ninguno de los campos obligatorios falta y ningún tipo difiere, así que el contrato declarado describe bien la **forma**; lo que falla está en el **contenido**. **Tras la Fase 12** (decisiones 109 a 116) el diagnóstico se cierra por el lado del significado: no es solo que el contenido difiera, es que **el dominio pide cuatro cosas que GLPI no guarda donde el adaptador las busca** —el responsable está en `Ticket_User`, el esfuerzo no está en ninguna parte, la fecha de inicio es `date_creation` y no `date`, y el compromiso son dos fechas que se contradicen—. El riesgo queda cerrado: ya no hay nada que suponer sobre qué significa cada campo |
| 44 | ~~**El filtro por asignado se hace en memoria y tiene techo**~~ — **el techo era el problema menor** (riesgo 43, decisión 106) | **Alto, no Medio.** El riesgo describía una lista incompleta con más de mil tickets. Lo observado es peor: `users_id_assign` **no existe en ninguna de las 1000 respuestas**, así que el filtro en memoria no devuelve una lista incompleta, devuelve **una lista vacía**. El techo sigue ahí —`Content-Range: 0-999/67599`, y los mil que trae son los más antiguos— pero es el segundo problema | La vía que el riesgo proponía —`searchText[users_id_assign]`— apuntaba en la dirección correcta y ahora se sabe por qué: el servidor filtra sin necesitar el campo, que es lo que lo hace inmune a H1. Queda por verificar el nombre exacto del criterio contra la instancia antes de escribirlo. El registro del adaptador —cuántos llegaron, cuántos quedaron asignados— no basta: hoy imprimiría «1000 llegaron, 0 asignados» y el flujo seguiría devolviendo una agenda vacía sin error, que es la peor forma de fallar (decisión 93). **Tras la Fase 12** (decisión 110) el criterio quedó verificado y la vía existe: `/search/Ticket?range=0-4&criteria[0][field]=5&criteria[0][searchtype]=equals&criteria[0][value]={usersId}` responde `HTTP 206, Content-Range: 0-4/208` —208 tickets en una sola llamada—, con `field=5` publicado por `/listSearchOptions/Ticket` como «Technician» sobre `glpi_users.name`. **El riesgo sigue abierto por una segunda causa que no tiene nada que ver con el filtro**: el adaptador itera sobre `/User/`, que devuelve 30 usuarios de 2427 (limitación 3, decisión 114) |
| 45 | **El adaptador abre y cierra una sesión por consulta, y el flujo abre dos** | Bajo — el handshake se paga dos veces por planificación. GLPI lo soporta; es coste, no corrección | Aceptado. Es la mejora #6, pendiente desde la primera fase. La vía es que el caso de uso abra una sesión y la pase, lo que exige cambiar la firma del puerto |
| 46 | **El identificador del desarrollador es el que pidió quien llamó, no el canónico de GLPI** | Medio — pedir `jdoe` y pedir `7` producen **dos planes con identificadores distintos para la misma persona**. La idempotencia es por pareja (incidente, requerimiento) y no se ve afectada, pero los planes no se agrupan por desarrollador | Se elige así para que la respuesta se correlacione con la petición sin conocer la numeración de GLPI, y se documenta en la decisión 87. La vía es guardar además el id canónico como columna propia, que es aditivo |
| 47 | **La zona horaria de las fechas de GLPI es una suposición** — **la mitad comprobable quedó comprobada** (decisión 106) | **Bajo, y acotado a la zona.** El formato ya no es una suposición: las 1032 fechas de la muestra tienen exactamente 19 caracteres y la forma `yyyy-MM-dd HH:mm:ss`, sin una sola excepción. Lo que sigue sin verificarse es la **zona**, y la instancia no la declara en la respuesta | Se elige la zona del reloj de la aplicación porque es la única que no desplaza las fechas, y queda anotado en la decisión 83. La vía sigue siendo leer la zona de la configuración de GLPI o exigirla en `GlpiProperties`. Que el formato esté confirmado reduce el riesgo sin cerrarlo: un desplazamiento de zona no cambia la forma de la fecha, solo su valor. **Tras la Fase 12** (decisión 114, limitación 6) la segunda medición —100 tickets de la ventana viva— no cambia nada: el formato sigue exacto y la instancia sigue sin declarar su zona. Sigue **Bajo y abierto en esa mitad**, y sin vía nueva para cerrarlo |
| 48 | **Los descartes se devuelven pero no se persisten** | Bajo — la respuesta dice qué quedó fuera, pero la entrada guardada no lo registra. Alguien que relea el plan dentro de un mes no puede saber que hubo tickets descartados, solo ver que no están | Se acepta en esta fase: el descarte es información de la ejecución, no de la entrada. La vía es una tabla hija o una columna, y sería la primera pieza de la fase siguiente. Mientras tanto, el descarte queda en el registro de la aplicación |
| 49 | **El reconocimiento del elemento inexistente depende del cuerpo del error** | Bajo — se busca la marca `ERROR_ITEM_NOT_FOUND` en la respuesta. Si GLPI cambiara ese texto, un usuario inexistente volvería a verse como un `503` en lugar de un `404` | El reconocimiento se hace sobre el cuerpo completo, no sobre el truncado, y el `503` resultante sigue siendo un error honesto —no se pierde el fallo, se clasifica peor—. La vía es que GLPI devuelva el `404` que corresponde |

---

# Fase 10 — El contrato de GLPI, declarado y comparable

La Fase 9 construyó la capa anticorrupción y la dejó funcionando. La Fase 10 no añade recorrido: añade **la posibilidad de comprobar que el recorrido es el correcto**. Es una fase de verificación, y su producto no es una funcionalidad nueva sino una respuesta honesta a una pregunta que llevaba abierta desde la Fase 7: *¿y si GLPI no responde como creemos?*

---

## Inspección previa: qué se estaba asumiendo

Antes de escribir nada se recorrió `integration/glpi/` entero, `GlpiClient`, `GlpiPlanningService`, `PlanningInputSnapshot`, `InputProvenance` y este documento. El resultado de esa inspección es lo que justifica todo lo demás, así que va primero.

### 91. El inventario de suposiciones

Todo lo que la capa anticorrupción daba por cierto de GLPI, con su origen:

| # | Suposición | Dónde estaba escrita | Origen |
|---|---|---|---|
| 1 | `type` vale `1` para incidencia y `2` para petición | `GlpiTicket.TYPE_INCIDENT`, `TYPE_REQUEST` | Documentación de GLPI |
| 2 | `status` usa los códigos 1–6, y `1` es nuevo, `2`–`4` vivos, `5`–`6` cerrados | `switch` en `GlpiTicketMapper` | Documentación de GLPI |
| 3 | El mismo código de `status` significa cosas distintas según el `type` | `switch` en `GlpiTicketMapper` | Decisión propia (documentada) |
| 4 | `priority`, `impact` y `urgency` van de 1 a 5 | Constantes en `GlpiPriorityMapper` | Documentación de GLPI |
| 5 | La prioridad se puede deducir de `impact`/`urgency` cuando falta | `GlpiPriorityMapper` | Decisión propia (aproximación declarada) |
| 6 | `actiontime` está en **segundos** | `GlpiTicketMapper.estimatedHours` | Documentación de GLPI |
| 7 | `date` y `time_to_resolve` usan el formato `yyyy-MM-dd HH:mm:ss` | `GLPI_DATE_TIME` | Documentación de GLPI |
| 8 | Las fechas llegan **sin zona horaria** | `GlpiTicketMapper.parseDateTime` | Observación del formato |
| 9 | La zona correcta es la del reloj de la aplicación | `GlpiTicketMapper` (constructor) | Decisión propia |
| 10 | `users_id_assign` identifica al asignado y se puede filtrar por él | `GlpiRestPlanningSource.assignedTo` | Documentación de GLPI |
| 11 | `date` es la fecha de creación del ticket | Javadoc de `GlpiTicketMapper.reportedAt` | **Inferencia** — GLPI tiene además `date_creation` |
| 12 | Un ítem inexistente responde HTTP 400 con `ERROR_ITEM_NOT_FOUND` | `GlpiClient.rejection` | Observación de la API |
| 13 | `/Ticket?range=0-999` devuelve todos los tickets visibles para la sesión | `PATH_TICKETS` | Documentación de GLPI |
| 14 | `/User/{login}` devuelve un único usuario | `PATH_USER` | Documentación de GLPI |

**Ninguna de las catorce estaba verificada contra una instancia.** Tres son decisiones propias (3, 5, 9) y por tanto no se verifican: se aceptan o se cambian. Las otras once son afirmaciones sobre un sistema ajeno, y esas sí.

### 92. Qué está verificado y qué no

Conviene separar dos cosas que se confunden con facilidad.

**Verificado internamente** — que el código hace lo que dice que hace, que la traducción es coherente consigo misma y que ningún camino se sale sin motivo. Eso lo sostienen 160 pruebas, y incluye: las tablas de estados, la escala de prioridad, el paso de segundos a horas, la interpretación de la zona, el orden de los motivos de descarte y la clasificación de todos los fallos.

**Verificado contra GLPI** — que GLPI responde lo que el código espera. **Nada. Cero.** No hay una sola suposición de las once contrastada con una respuesta real, y el mecanismo que faltaba es precisamente el objeto de esta fase.

**Un hallazgo concreto de la inspección.** La instancia configurada en `.env` —`sac-i.connser.com.co`— resuelve a `fenix.connser.com.co` → `10.87.4.16`, una dirección de la intranet corporativa, y **el certificado que presenta no cubre el nombre con el que se le llama**:

```
curl: (60) schannel: SNI or certificate check failed: SEC_E_WRONG_PRINCIPAL
```

Eso ocurre **antes** de cualquier pregunta sobre el contrato: la conexión no llega a establecerse. No se ha saltado la verificación del certificado —hacerlo convertiría una integración en un riesgo de seguridad—, así que la validación real empieza por resolver ese nombre, no por comparar campos. Está anotado como riesgo 50.

**Resuelto, y el diagnóstico estaba a medias.** Eran dos defectos acumulados, no uno. El primero es el nombre: el certificado es un comodín para `*.coltefinanciera.com.co`, de modo que **ninguno** de los dos nombres `connser.com.co` está cubierto —la salida que apuntaba a `fenix.connser.com.co` como «nombre canónico» era falsa— y `GLPI_URL` pasa a `sac-i.coltefinanciera.com.co`. El segundo solo aparece una vez corregido el primero: el servidor **envía únicamente su certificado hoja**, sin el intermedio `GeoTrust TLS RSA CA G1` que lo firma. Windows lo descarga por su cuenta vía AIA —y por eso el mismo host respondía desde el navegador y desde `curl`—, pero la JVM no lo hace, así que la cadena no se puede construir y la conexión muere con `SunCertPathBuilderException` aunque el nombre ya sea el correcto. Se resuelve declarando ese intermedio y la raíz que lo firma en un almacén propio del cliente de GLPI (decisión 103). La verificación no se relajó en ningún punto, y la prueba es que el nombre viejo sigue fallando con un error **de nombre** y no de confianza.

### 93. Qué campos son críticos para el motor

No todos los campos pesan lo mismo, y la distinción es la que decide qué se puede degradar y qué no.

**Críticos: sin ellos el objeto del dominio no se puede construir.** `id` (identidad del incidente), `actiontime` (lo que compite por la jornada), `date` (el día en que empieza a consumir) y `status` (si sigue compitiendo). Para las peticiones, `time_to_resolve` en lugar de `date`: es la fecha contra la que se mide el desplazamiento.

**Influyentes: cambian el resultado sin impedirlo.** `priority`, `impact` y `urgency`, que producen la severidad; con severidad nula el incidente entra por el umbral de horas, que es un camino distinto hacia un resultado distinto pero válido.

**De selección: no llegan al dominio.** `users_id_assign`, que decide qué tickets se traen. Un fallo aquí no descarta nada: devuelve una lista vacía, que es la peor forma de fallar porque se parece a «no hay trabajo».

**Ausentes.** `date_creation` no está en `GlpiTicket` y el adaptador no lo lee. Es la suposición 11 hecha código: se usa `date` como fecha de creación. Que GLPI mande `date_creation` —y con qué valor— es una de las preguntas que el verificador responde en su primera ejecución contra la instancia real.

### 94. El estado de los riesgos 43 a 49

| # | Estado tras esta fase |
|---|---|
| 43 | **Abierto, y es el que la fase ataca.** Sigue sin verificarse contra una instancia real, pero deja de ser un riesgo ciego: hay un mecanismo que lo mide y un procedimiento para cerrarlo. Ver decisión 96 y riesgo 54 |
| 44 | **Abierto, sin cambios.** El filtro en memoria con techo de mil tickets sigue igual, marcado con `ponytail:` en el código |
| 45 | **Abierto, sin cambios.** Las dos sesiones por planificación siguen ahí; la fase no toca el transporte |
| 46 | **Abierto, sin cambios.** El identificador del desarrollador sigue siendo el que pidió quien llamó |
| 47 | **Abierto, pero ahora es medible.** La zona horaria sigue siendo una suposición, y el verificador no puede resolverla —una fecha sin zona es ambigua incluso leída—. Lo que sí puede es descartar que el *formato* sea otro, que era la mitad comprobable del riesgo |
| 48 | **Abierto, sin cambios.** Los descartes se devuelven y no se persisten |
| 49 | **Abierto, sin cambios.** El reconocimiento del ítem inexistente sigue dependiendo del texto del cuerpo |

Ninguno se cierra en esta fase, y decirlo es parte del entregable: la fase construye el instrumento, no toma la medida.

**Actualización tras la Fase 11** — la medida se tomó, y esta tabla es el estado al terminar la Fase 10. Lo que cambió al ejecutar el plan de la decisión 102: **43** pasó de riesgo ciego a hallazgo medido (decisiones 104 a 108) —el contrato acierta en la forma y falla en el contenido—; **44** subió de Medio a Alto, porque `users_id_assign` no existe y el filtro devuelve una lista vacía en lugar de una incompleta; **47** bajó a Bajo, con el formato de fecha confirmado y la zona todavía abierta; **51** quedó respondido —`date_creation` existe y difiere de `date` en el 23,5 %—; **54** se cerró, porque el instrumento se usó. Los riesgos 45, 46, 48 y 49 siguen abiertos sin cambios: la validación no los tocaba.

**Actualización tras la Fase 12** — la segunda medición se tomó, esta vez sobre tickets vivos, y lo que cambió: **43** se cierra del todo, porque ya no queda nada que suponer sobre qué significa cada campo (decisiones 109 a 116); **44** sigue Alto y ahora con dos causas independientes —el campo que no existe y el padrón truncado al 1,2 %—, con la vía del servidor ya verificada; **47** no se mueve: el formato sigue confirmado y la zona sigue sin declararse; **51** gana el matiz que le faltaba: en la ventana viva la discrepancia es de 33 de 100 y **siempre en la misma dirección**. Aparece además un hallazgo que no estaba en ningún riesgo: el padrón de usuarios se lee incompleto (limitación 3, decisión 114), que es el cambio 7 de la decisión 115. Los riesgos 45, 46, 48 y 49 siguen sin tocarse.

---

## El contrato explícito

### 95. La matriz del contrato, campo por campo

Para cada campo que el adaptador lee, qué se espera y qué pasa cuando no está o llega mal. Es la tabla que responde «¿qué pasa si…?» sin tener que leer el código.

| Campo | Endpoint | Tipo esperado | ¿Obligatorio? | Si falta | Si llega inválido | Consumidor |
|---|---|---|---|---|---|---|
| `id` | `GET /Ticket` | integer | **Sí** | Descarte: «sin identificador de ticket» | Un tipo no numérico impide decodificar el arreglo entero → `502 GLPI_INVALID_DATA` | `GlpiTicketValidator`, `GlpiTicketMapper` |
| `type` | `GET /Ticket` | integer | **Sí** | Descarte: «tipo de ticket desconocido: null» | Código fuera de `{1, 2}` → descarte, con el código en el motivo | `GlpiTicketMapper.isIncident` / `isRequirement` |
| `status` | `GET /Ticket` | integer | **Sí** | Descarte: «estado de incidencia desconocido: null» | Código fuera de la tabla del contrato → descarte | `GlpiContract.incidentStatus` / `requirementStatus` |
| `priority` | `GET /Ticket` | integer | **No** | Degradación: severidad nula, decide el umbral de horas | Fuera de `1..5` → se trata como ausente, con aviso, y cae a `impact`/`urgency` | `GlpiPriorityMapper` |
| `impact` | `GET /Ticket` | integer | No | Se ignora si hay `priority` | Fuera de `1..5` → ignorado | `GlpiPriorityMapper` |
| `urgency` | `GET /Ticket` | integer | No | Ídem | Ídem | `GlpiPriorityMapper` |
| `actiontime` | `GET /Ticket` | integer, **segundos** | **Sí** | Descarte: «sin horas estimadas» | `0` o negativo → descarte; no numérico → `502` | `GlpiTicketMapper.estimatedHours` |
| `date` | `GET /Ticket` | string `yyyy-MM-dd HH:mm:ss` | **Sí** para incidencias | Descarte: «fecha de creación ausente o ilegible» | Otro formato → descarte, mostrando el texto original | `GlpiTicketMapper.reportedAt` |
| `date_creation` | `GET /Ticket` | string | **No se usa** | No aplica | No aplica | **Ninguno** — no está en `GlpiTicket` |
| `users_id_assign` | `GET /Ticket` | integer | **Sí**, para filtrar | El ticket **no se devuelve**; no se descarta ni se registra | No numérico → cero tickets y aviso | `GlpiRestPlanningSource.assignedTo` |
| `name` | `GET /Ticket` | string | No | `Incident.title` nulo, que el dominio tolera | No aplica | `GlpiTicketMapper` → `Incident.title` |
| `time_to_resolve` | `GET /Ticket` | string `yyyy-MM-dd HH:mm:ss` | **Sí** para peticiones | Descarte: «fecha comprometida ausente o ilegible» | Otro formato → descarte | `GlpiTicketMapper.plannedDate` |
| `id` | `GET /User/{login}` | integer | **Sí** | `404 DEVELOPER_NOT_FOUND` | No numérico → cero tickets y aviso | `GlpiPlanningService`, `GlpiRestPlanningSource` |

**La fila que más importa es la de `users_id_assign`.** Es el único campo cuyo fallo no produce ni descarte ni error, sino una agenda vacía. Todas las demás filas de esta tabla fallan de forma visible; esa no. Es el riesgo 44, y por eso el adaptador registra cuántos tickets llegaron y cuántos quedaron.

**`date_creation` está en la tabla aunque no se use.** El brief lo pedía y la razón es buena: una tabla de lo que se lee que omita lo que no se lee deja fuera justo la pregunta abierta. Que no aparezca en el código y sí en la tabla es la diferencia entre «no lo usamos» y «no sabemos si está».

### 96. `GlpiContract`: el contrato como dato

Las suposiciones 1, 2, 4 y 7 estaban dentro de los mapeadores, como constantes y `switch`. Estaban escritas, pero no **declaradas**: no había un sitio donde leer de un golpe qué se da por cierto del sistema ajeno.

`GlpiContract` es ese sitio. Es un registro con la versión del contrato, los códigos de `type`, las dos tablas de `status`, la escala de prioridad, el formato de fecha y el mapa de campos con su tipo y su obligatoriedad. No añade comportamiento: **recoge el que ya existía y lo convierte en un valor.**

| Antes | Después |
|---|---|
| `switch (status) { case 1 -> ... }` en `GlpiTicketMapper` | `contract.incidentStatus(status)` sobre la tabla del contrato |
| `MIN_SCALE`/`MAX_SCALE` en `GlpiPriorityMapper` | `contract.inScale(valor)` |
| `GLPI_DATE_TIME` en `GlpiTicketMapper` | `DateTimeFormatter.ofPattern(contract.datePattern())` |
| `ticket.type() == GlpiTicket.TYPE_INCIDENT` | `contract.isIncident(ticket.type())` |

**El efecto secundario es que el código encogió.** Las dos tablas de estados pasaron de dos `switch` de siete líneas a dos líneas que consultan un mapa. No es una casualidad: una tabla de traducción es un dato, y escribirla como dato la hace más corta y más fácil de cambiar que escribida como control de flujo.

**Se registra como bean en `PlanningConfig`, no se lee de la constante.** Es la decisión que hace que esto sea un mecanismo de compatibilidad y no una reorganización: una instancia de GLPI con otros códigos de estado u otra escala se adapta devolviendo otro `GlpiContract` desde ese método, y ni el dominio ni el motor se enteran de que hubo un cambio. Si los mapeadores leyeran `GlpiContract.REST_V1` directamente, el seam no existiría.

**Los nombres de los campos no están en el contrato, y es deliberado.** Cambiarlos exige otro DTO —viajan en los `@JsonProperty` de `GlpiTicket`—, no otro valor. Meterlos aquí daría la apariencia de que el contrato cubre la forma del JSON cuando no la cubre; el mapa de campos declara **qué se espera de cada campo**, que es lo que el verificador necesita para comparar.

---

## La verificación

### 97. `GlpiContractVerifier`: comparar en lugar de suponer

Es la pieza que faltaba. Recibe el JSON que GLPI devolvió —copiado de una respuesta, de un registro, de un `curl` hecho a mano— y dice en qué se diferencia del contrato declarado.

**No consulta GLPI.** Recibe texto. Es deliberado y es lo que la hace útil hoy: se puede ejecutar contra una captura guardada o contra un caso inventado en una prueba, sin que la instancia esté disponible ni las credenciales funcionen. Quien trae el JSON es otra cosa; esto solo lo lee.

**Acepta un ticket suelto o el arreglo de `/Ticket`**, porque las dos formas son respuestas legítimas y obligar a envolver una sería trabajo para quien llama sin ganancia para nadie.

**Tres veredictos, porque son tres decisiones distintas:**

| Veredicto | Significa | Qué hacer |
|---|---|---|
| `INCOMPATIBLE` | Falta un campo obligatorio o uno llega con otro tipo | Cambiar el adaptador antes de seguir |
| `DEGRADED` | Se lee, pero algo entró por un camino de respaldo | Revisar por qué: una prioridad fuera de escala o una fecha ilegible |
| `COMPATIBLE` | Todo lo declarado está y se lee como se declaró | Seguir |

**Un campo desconocido no baja el veredicto.** Que GLPI traiga más de lo que se modela es información, no un problema: significa que hay datos disponibles que hoy se ignoran. Por eso `date_creation` aparecerá en el informe como campo no modelado y no como incompatibilidad — que es exactamente la respuesta que se busca.

**Un cuerpo que no es JSON no es un contrato incompatible.** Sale como `GlpiInvalidDataException`, igual que en el adaptador. La distinción importa porque `INCOMPATIBLE` manda a revisar el contrato y este fallo manda a revisar la respuesta.

**El informe nombra las dos versiones**: la del adaptador (`glpi-rest-1`) y la del contrato (`glpi-contract-1`). Una diferencia se puede atribuir entonces a una versión concreta y no a «el contrato» en abstracto.

### 98. Dónde se detecta cada cosa

La validación temprana no es una capa nueva: es un reparto explícito de responsabilidades que ya existía a medias y ahora está declarado.

| Defecto | Se detecta en | Cómo se manifiesta |
|---|---|---|
| Campo obligatorio ausente | `GlpiTicketValidator` (ticket a ticket) y `GlpiContractVerifier` (forma del JSON) | Descarte con motivo legible / `INCOMPATIBLE` |
| Tipo incompatible | `GlpiClient` (decodificación) y `GlpiContractVerifier` | `502 GLPI_INVALID_DATA` / `INCOMPATIBLE` |
| Formato inesperado | `GlpiTicketMapper.parseDateTime` | Descarte con el texto original |
| Prioridad fuera de rango | `GlpiPriorityMapper` y `GlpiContractVerifier` | Severidad nula con aviso / `DEGRADED` |
| Severidad imposible | No existe: la severidad se **deriva** de la prioridad, y una prioridad fuera de escala no produce severidad | — |
| Fecha inválida | `GlpiTicketMapper.parseDateTime` y `GlpiContractVerifier` | Descarte / `DEGRADED` |

**«Severidad imposible» no tiene fila propia porque no puede ocurrir.** La severidad del dominio es un enum de tres valores que se calcula desde la prioridad; no hay entrada de GLPI que produzca un valor fuera de él. La pregunta del brief se responde declarando que la imposibilidad está en la prioridad, no en la severidad, y ahí sí se comprueba.

**Las dos detecciones son complementarias y no redundantes.** El validador mira el ticket y aplica política —descarta o tolera, con un motivo escrito para que lo lea quien opera GLPI—. El verificador mira la forma de la respuesta y aplica comparación. El primero dice «este ticket no sirve»; el segundo dice «este campo ya no llega». Un cambio de contrato se ve en el segundo **antes** de que el primero empiece a descartar tickets.

### 99. Observabilidad: qué se registra y dónde

El brief pedía registrar cinco cosas sin afectar al motor. Ninguna toca `PlanningEngine`.

| Qué | Dónde | Forma |
|---|---|---|
| Versión del adaptador | `InputProvenance.adapterVersion` | Persistida con la entrada y devuelta por `GET /{planId}/input` |
| Versión del contrato | Registro de `GlpiPlanningRequestFactory`, en cada traducción | `«Traduccion GLPI para dev-1 con el contrato glpi-contract-1: …»` |
| Campos desconocidos | Informe de `GlpiContractVerifier` | Lista deduplicada de nombres |
| Tickets descartados | Respuesta del endpoint + registro | `GlpiDiscardedItem` con identificador y motivo |
| Degradaciones aplicadas | Registro de `GlpiPriorityMapper` | Aviso nombrando el valor, la escala del contrato y su versión |

**La versión del contrato se nombra en cada traducción a propósito.** Una lectura con menos tickets de los esperados tiene que poder atribuirse a una versión concreta de lo que se da por cierto de GLPI, y no quedar como un misterio de «el adaptador».

**El aviso de prioridad fuera de escala se añadió en esta fase.** El código ya decía en su documentación que un valor fuera de escala se trata como ausente «con aviso», y el aviso solo existía para el caso en que no había nada que traducir. Ahora también avisa cuando había un valor y no servía, que es el caso que delata que el contrato está desactualizado.

---

## Compatibilidad y cambios de GLPI

### 100. Estrategia ante un cambio de GLPI

Cuando GLPI cambie, hay tres situaciones distintas y conviene no confundirlas.

**Cambia un valor, no una forma** — otros códigos de `status`, otra escala de prioridad, otro formato de fecha. Es el caso que `GlpiContract` resuelve: se declara un contrato nuevo, se devuelve desde `PlanningConfig` y los mapeadores lo usan sin cambios. El dominio y el motor no se tocan, y los planes viejos siguen siendo legibles porque su procedencia guarda la versión del adaptador.

**Cambia un nombre de campo** — `actiontime` pasa a `action_time`, por ejemplo. Es el caso que el contrato **no** cubre, porque los nombres viven en los `@JsonProperty` del DTO. La vía es un DTO nuevo o un `@JsonAlias`, y el verificador lo detecta como campo obligatorio ausente mucho antes de que nadie lo note en producción.

**Aparece un campo nuevo** — GLPI añade información que hoy se ignora. El DTO tiene `@JsonIgnoreProperties(ignoreUnknown = true)`, así que **no rompe nada**, y el verificador lo reporta como campo no modelado. Es la situación más frecuente y la menos grave.

**El orden de actuación ante cualquier cambio es siempre el mismo:** ejecutar el verificador contra una respuesta capturada, leer el veredicto, y solo entonces decidir. Es la diferencia entre reaccionar a un informe y reaccionar a un plan que salió raro.

**Lo que no se hace: adivinar.** Un valor fuera de escala no se recorta ni se interpreta. Se trata como ausente, con aviso, porque un `9` significa que la suposición sobre el contrato es falsa y suponer qué quiso decir sería peor que declarar que no se sabe.

### 101. Respuesta parcial: qué se usa, qué se ignora, qué se degrada

| Situación de GLPI | Qué se usa | Qué se ignora | Qué se degrada | Trazabilidad |
|---|---|---|---|---|
| Respuesta completa | Todos los campos del contrato | Nada | Nada | Procedencia con adaptador y contrato |
| Falta `priority` | Todo lo demás | — | Severidad nula → decide el umbral de horas | `severity: null` en la entrada guardada |
| `priority` fuera de escala | `impact`/`urgency` si sirven | El valor de `priority` | Severidad deducida o nula | Aviso con el valor y la escala del contrato |
| Falta `actiontime` | — | El ticket entero | — | `GlpiDiscardedItem` con el motivo |
| `date` ilegible | — | El ticket entero | — | `GlpiDiscardedItem` con el texto original |
| `status` desconocido | — | El ticket entero | — | `GlpiDiscardedItem` con el código |
| Llegan campos nuevos | Los declarados | Los no modelados | — | Informe del verificador |
| No llega ningún ticket | Agenda vacía | — | — | Plan vacío, que no es un error |

**La regla que ordena la tabla:** lo que impide construir el objeto del dominio se descarta y se dice; lo que solo cambia el resultado se degrada y se registra. Nunca se inventa un valor para un campo ausente — un plan que parece completo y no lo está es peor que un plan con un descarte visible.

---

## Mejoras previstas para la Fase 11

| # | Mejora | Estado tras la Fase 10 |
|---|---|---|
| nueva | **Validar contra la instancia real** | **hecho en la Fase 11**: decisiones 104 a 108. Produjo siete hallazgos y una decisión recomendada |
| nueva | **Persistir los descartes** | sigue pendiente (riesgo 48); ahora hay además un informe que se podría guardar |
| 6 | Reutilizar la sesión de GLPI | sigue pendiente (riesgo 45) |
| 44 | Filtro por asignado en el servidor | **ahora es el primer cambio de la Fase 12, y subió de prioridad**: el verificador no lo resolvía, y la medida demostró que sin él el flujo devuelve una agenda vacía (riesgo 44, decisión 107, cambio 1) |
| nueva | **Corregir el clasificador de errores del cliente** | nuevo tras la Fase 11: un cuerpo que no cabe se reporta como «HTTP 206» (decisión 107, cambio 5) |
| nueva | **Ampliar la escala de `priority` en el contrato** | nuevo tras la Fase 11: la instancia usa 6 y el contrato declara 1..5 (decisión 107, cambio 6) |
| nueva | Consulta incremental por fecha de cambio | sigue siendo el paso previo a cualquier sincronización (decisión 90) |
| 9 | Librería de timeline | sin cambios (decisión 54) |
| 5 | Capacidad parcial por desarrollador | sin cambios (decisión 43) |

El resto de la tabla de mejoras de las fases anteriores sigue pendiente sin cambios.

**Actualización tras la Fase 12** — la medida del modelo real (decisiones 109 a 116) reclasifica cuatro filas y añade una:

| # | Mejora | Estado tras la Fase 12 |
|---|---|---|
| 44 | Filtro por asignado en el servidor | **sigue siendo el primer cambio, y ya está verificado**: `field=5` es «Technician», y `equals` devuelve 208 tickets en una llamada (decisión 110, pregunta 3). Lo que falta no es saber cómo: es escribirlo, y va después de la respuesta de negocio de los cambios 2, 3 y 4 |
| nueva | **Leer el padrón de usuarios completo** | **nuevo tras la Fase 12**: `/User/` devuelve 30 usuarios de 2427 y el adaptador no mira `Content-Range` (limitación 3, decisión 114). Es el cambio 7 de la decisión 115 |
| nueva | **Leer las dos fechas comprometidas** | **nuevo tras la Fase 12**: `time_to_resolve` cubre 68 de 100 y `internal_time_to_resolve` 89; juntas, 100. Usar solo la primera deja sin fecha a un tercio de los tickets que sí la tienen (decisión 110, pregunta 6) |
| nueva | **Añadir `date_creation` al DTO** | **nuevo tras la Fase 12**: es la fecha de creación real; `date` es «Opening date» y va por detrás en un tercio de los casos vivos (decisión 110, pregunta 6). Añadir el campo es una línea; elegir cuál consume capacidad es de negocio |
| nueva | **Decidir la fuente del esfuerzo estimado** | **nuevo tras la Fase 12, y no es una mejora de código**: GLPI no guarda una estimación en ninguna de sus 139 opciones de búsqueda (decisión 110, pregunta 4). Es una decisión de proceso, y bloquea el cambio 2 |
| nueva | Corregir el clasificador de errores del cliente | sigue igual: un cuerpo que no cabe se reporta como «HTTP 206» (decisión 107, cambio 5) |
| nueva | Ampliar la escala de `priority` en el contrato | sigue igual: la instancia usa 6 y el contrato declara 1..5 (decisión 107, cambio 6) |

**Actualización tras la Fase 13** — la respuesta de negocio llegó y se escribió como modelo (decisiones 117 a 126). Cierra una fila y reordena otra:

| # | Mejora | Estado tras la Fase 13 |
|---|---|---|
| nueva | **Decidir la fuente del esfuerzo estimado** | **cerrada.** El negocio decidió: **lo define el desarrollador asignado**, y la cifra entra por escritura, con autor y fecha (decisión 119). Ya no es una pregunta abierta: es `PlanningMetadata.estimatedHours` |
| nueva | **Decidir cuál de las dos fechas comprometidas manda** | **cerrada, y la respuesta descarta las dos.** No manda ninguna: **la define el gestor de demanda** (decisión 120). El SLA y el OLA son techos de política de servicio, no promesas, y por eso `PlanningMetadata.committedDate` no sale de ninguno de los dos |
| 44 | Filtro por asignado en el servidor | sin cambios, y **ya no bloquea la respuesta de negocio**: era el bloqueo de los cambios 2, 3 y 4, y esas respuestas ya están. Sigue pendiente escribirlo |
| nueva | **Leer las dos fechas comprometidas** | **pierde prioridad, no se cae.** Con el compromiso declarado por el gestor, leer `internal_time_to_resolve` deja de ser la vía para obtener la fecha; sigue siendo útil como **dato de contraste** entre lo prometido y el techo del OLA, que es otra cosa |
| nueva | **Añadir `date_creation` al DTO** | sigue pendiente y ahora con más motivo: la fecha de inicio sigue saliendo de `date`, que va por detrás en un tercio de los casos vivos, y la Fase 13 no la tocó porque el brief prohíbe modificar la integración |
| nueva | **Integrar la metadata en la ACL** | **nuevo tras la Fase 13, y es el siguiente trabajo**: `GlpiPlanningRequestFactory` dejará de leer las horas de `GlpiTicketMapper` y la fecha de `time_to_resolve`, y las leerá de `PlanningMetadata` por `workItemId` (decisión 124). La costura está documentada y no implementada. **La pregunta que la bloqueaba ya está contestada**: un ticket con metadata incompleta se descarta, con `SIN_ESTIMACION_DECLARADA` o `SIN_COMPROMISO_DECLARADO` según lo que falte, sin inferir valores ni generar planes parciales (decisión 124.1). Falta escribirlo |
| nueva | **Acceso al historial por muchos elementos** | **nuevo tras la Fase 13**: hoy solo se lee por `workItemId`, y la Timeline necesitará leer por desarrollador y por rango de fechas (decisión 125, riesgo 58) |
| nueva | Corregir el clasificador de errores del cliente | sigue igual: un cuerpo que no cabe se reporta como «HTTP 206» (decisión 107, cambio 5) |
| nueva | Ampliar la escala de `priority` en el contrato | sigue igual: la instancia usa 6 y el contrato declara 1..5 (decisión 107, cambio 6) |
| nueva | **Leer el padrón de usuarios completo** | sigue igual: `/User/` devuelve 30 usuarios de 2427 (limitación 3, decisión 114) |

---

## Preparación para la validación contra la instancia real

### 102. Plan de validación contra la instancia real

Es el entregable que convierte todo lo anterior en algo ejecutable. El procedimiento, en orden, con lo que hay que hacer y lo que se espera de cada paso.

**Paso 0 — Resolver el nombre del host y la cadena de confianza. (Hecho.)**

Eran dos defectos, y el segundo no se ve hasta que el primero está corregido. El certificado del servidor es un comodín para `*.coltefinanciera.com.co` y **no cubre ninguno de los dos nombres `connser.com.co`**, así que `GLPI_URL` pasa a `sac-i.coltefinanciera.com.co`. Con el nombre ya correcto la conexión sigue fallando, ahora con `SunCertPathBuilderException`: el servidor envía solo su hoja y omite el intermedio `GeoTrust TLS RSA CA G1`, que Windows obtiene por AIA y la JVM no. Se declaran el intermedio y su raíz en `backend/src/main/resources/glpi/glpi-truststore.pem` y se aplican **solo** al cliente de GLPI (decisión 103). **No se salta la verificación del certificado** en ningún punto: el almacén resultante es más estrecho que el de por defecto, y el nombre viejo sigue fallando con un error de nombre.

**Paso 1 — Comprobar que las credenciales abren sesión.**

```
POST {GLPI_URL}/initSession      (App-Token + Authorization: user_token)
```

Se espera `200` con `session_token`. Un `401`/`403` es el riesgo de credenciales y se ve aquí, no en la traducción. La aplicación ya clasifica ese caso como `502 GLPI_AUTHENTICATION_FAILED`.

**Paso 2 — Capturar un ticket real, sin interpretarlo.**

```
GET {GLPI_URL}/Ticket?range=0-1      (Session-Token)
```

La respuesta se guarda **tal cual**, sin editarla. Es la entrada del paso 3 y la prueba documental de lo que la instancia devuelve hoy.

**Paso 3 — Verificar la captura contra el contrato.**

```java
GlpiContractVerifier.verify(captura)
```

El informe responde, campo por campo, a las once suposiciones que la inspección no pudo comprobar:

| Pregunta | Dónde se lee la respuesta |
|---|---|
| ¿Los nombres de campo son los que el DTO espera? | `missingRequired` — un nombre distinto aparece aquí |
| ¿`type` usa 1 y 2? | `outOfRangeValues` no lo cubre; se comprueba leyendo el valor y contrastándolo con la tabla |
| ¿`status` usa los códigos 1–6? | Ídem: un código nuevo no lo detecta el verificador, lo detecta el descarte en la traducción |
| ¿`priority` está en 1..5? | `outOfRangeValues` |
| ¿`actiontime` está en segundos? | Se contrasta `actiontime` con `time_to_resolve - date` del mismo ticket; si el orden de magnitud no cuadra, la unidad es otra |
| ¿El formato de fecha es `yyyy-MM-dd HH:mm:ss`? | `unreadableDates` |
| ¿La instancia manda `date_creation`? | `unknownFields` — si aparece, la suposición 11 deja de ser una inferencia |
| ¿`users_id_assign` es un entero? | `typeMismatches` |
| ¿`/Ticket` devuelve un arreglo? | El informe declara cuántos tickets verificó |
| ¿Un usuario inexistente responde `ERROR_ITEM_NOT_FOUND`? | `GET /User/no-existe` y lectura del cuerpo |

**Paso 4 — Repetir el paso 2 sobre una muestra, no sobre un ticket.**

Un ticket puede tener `priority` y otro no. Se captura un rango que cubra al menos un incidente y una petición de un mismo desarrollador, y se verifica el arreglo entero: el verificador acumula los hallazgos de todos y deduplica, así que un campo que falta en uno solo aparece una vez.

**Paso 5 — Contrastar el resultado con el plan.**

Con las credenciales y el contrato validados, `POST /api/planning/from-glpi` debe producir un plan sin descartes. Un descarte cuyo motivo diga «ausente» es la señal de que queda un campo por corregir; uno que diga «desconocido» es la señal de que hay un código nuevo en la tabla de estados.

**Qué NO hacer en esta validación.** No crear tickets, no modificar nada en GLPI, no ejecutar el flujo contra producción sin haber pasado por los pasos 1 a 4. Todo lo anterior es de solo lectura, y el paso 5 solo lee y guarda en la base de datos propia.

### 103. La cadena de confianza del cliente de GLPI

**El problema no era la confianza, era la cadena.** El servidor de GLPI presenta su certificado hoja y nada más: no envía el intermedio `GeoTrust TLS RSA CA G1` que lo firma. La raíz —`DigiCert Global Root G2`— sí está en el almacén por defecto de la JVM, pero sin el eslabón intermedio no hay camino que recorrer desde la hoja hasta la raíz, y la conexión muere con `SunCertPathBuilderException` antes de que exista una petición HTTP.

**Por qué el mismo host funcionaba desde el navegador y desde `curl`.** Windows, y por tanto `curl` con schannel, completan la cadena por su cuenta: leen la extensión AIA del propio certificado hoja, se descargan el intermedio de la URL que ahí se declara y validan con él. La JVM no hace eso. Es una diferencia de implementación, no de configuración, y es la razón de que el síntoma pareciera contradictorio —el host responde en un sitio y falla en otro—. Afecta a todo cliente que no busque por AIA: Java, Python, Go y `curl` sobre Linux.

**La salida descartada.** Desactivar la verificación —`curl -k`, un `HostnameVerifier` que devuelve `true`, un `X509TrustManager` que acepta todo— habría hecho desaparecer el síntoma cambiando un problema de configuración por un agujero de seguridad, y habría dejado la integración sin ninguna defensa frente a un intermediario. No se hizo en ningún momento, ni siquiera para diagnosticar: la comprobación se hizo siempre con verificación activa, y el precio fue un rato más de diagnóstico.

**La decisión: un almacén de confianza propio, y solo para GLPI.** El intermedio y su raíz viven en `backend/src/main/resources/glpi/glpi-truststore.pem`, y `application.properties` los declara como un *bundle* de Spring Boot (`spring.ssl.bundle.pem.glpi`). `WebClientConfig` lo toma y lo aplica al `HttpClient` de Reactor Netty con `.secure(...)`, de modo que **el `glpiWebClient` es el único afectado**: cualquier otro destino que la aplicación llegue a consumir sigue confiando exactamente en lo que confiaba.

**El almacén resultante es más estrecho que el de por defecto, no más amplio.** El bundle sustituye al almacén por defecto en ese cliente; no lo extiende. Solo acepta lo que firmen `GeoTrust TLS RSA CA G1` o `DigiCert Global Root G2`, que es un subconjunto de lo que la JVM ya aceptaba. Esa es la propiedad que hace que esto no sea una relajación, y es también su coste: si GLPI cambia de emisor, el archivo hay que reemplazarlo. El síntoma será un fallo de handshake al planificar y el emisor esperado aparecerá en el propio error.

**La prueba.** Dos comprobaciones sobre la aplicación real, no sobre un banco de pruebas. La primera, contra el nombre correcto: `GET /api/glpi/health` responde `connected: true` y `authenticated: true`, es decir, la conexión se establece **y** las credenciales abren sesión. La segunda, contra el nombre viejo, que es la que importa para la seguridad: `connected: false` con `No subject alternative DNS name matching sac-i.connser.com.co found`. El fallo es **de nombre**, no de confianza —si el almacén propio hubiera relajado algo, el nombre viejo habría pasado—, y con eso queda demostrado que la verificación de certificado y la de nombre siguen activas de punta a punta. Una prueba en aislamiento anterior ya había fijado lo mismo sobre el material de confianza; estas lo confirman sobre el recorrido real de la aplicación.

**Lo que no se arregla aquí.** El defecto es del servidor: una cadena incompleta rompe a todos sus clientes que no busquen por AIA, no solo a este. La corrección de fondo es que GLPI sirva su intermedio, y eso es un ticket de infraestructura. Mientras tanto, este almacén es el puente, y está declarado en el repositorio en lugar de en la máquina de quien lo descubrió, para que el siguiente entorno no tenga que repetir el diagnóstico.

---

---

## Riesgos identificados

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 50 | ~~**El certificado de la instancia objetivo no cubre el nombre configurado**~~ — **resuelto tras la Fase 10**. Eran **dos** defectos: el nombre de `GLPI_URL`, que el certificado no cubría, y un segundo que solo se veía al corregir el primero — el servidor omite su certificado intermedio | **Alto mientras estuvo abierto** — bloqueaba la validación real entera, y bloqueaba también el flujo de la aplicación contra esa instancia. No era un problema de contrato: la conexión no llegaba a establecerse | Se detectó en la inspección de la Fase 10, que es exactamente para lo que sirve. El diagnóstico de entonces estaba a medias: el certificado es un comodín para `*.coltefinanciera.com.co`, así que **ninguno** de los dos nombres `connser.com.co` servía —`fenix.connser.com.co` no era ningún «nombre canónico»—, y quedaba por descubrir la cadena incompleta. Se resolvió con el nombre correcto más un almacén de confianza propio del cliente de GLPI (decisión 103). **No se mitigó saltando la verificación del certificado**, que era la salida fácil y la única descartada de antemano: el nombre viejo sigue fallando con un error de nombre, no de confianza |
| 51 | **`date_creation` no está modelado y se usa `date` como fecha de creación** — **respondido, y la respuesta es que no son lo mismo** (decisión 106) | Medio — confirmado. `date_creation` llega en las 1000 respuestas y **coincide con `date` en 765 y difiere en 235** (23,5 %). La suposición 11 es cierta en tres cuartos de la muestra y falsa en el resto, así que leer `date` desplaza el inicio de casi uno de cada cuatro incidentes | La pregunta que el riesgo planteaba —«si `date_creation` aparece, se compara con `date` y se sabe»— quedó contestada por la vía prevista, en la primera ejecución del verificador contra la instancia. Lo que **no** quedó resuelto es cuál de las dos fechas debe consumir capacidad: eso es una decisión de negocio, no un dato que la instancia pueda aportar. El campo sigue sin estar en el DTO; añadirlo es una línea, pero antes hay que saber para qué. **Tras la Fase 12** (decisión 110, pregunta 6) el riesgo sube de matiz: en la ventana **viva** difieren **33 de 100**, y en **31 de esos 33** `date` es *posterior* a `date_creation`. La suposición no solo falla en un tercio de los casos: **falla siempre en la misma dirección**, regalando capacidad ya consumida. Eso convierte la elección de la fecha en una decisión de negocio con el sesgo ya medido, no en una duda simétrica |
| 52 | **La obligatoriedad declarada en el contrato y la que aplica el validador son dos afirmaciones distintas** | Bajo — el contrato declara qué campos son obligatorios para la **forma** del JSON; el validador decide qué se descarta según el **tipo** del ticket, con reglas condicionales (`date` para incidencias, `time_to_resolve` para peticiones). Un cambio en uno sin el otro dejaría el informe diciendo `COMPATIBLE` sobre una respuesta que la traducción descarta entera | La división está documentada en la decisión 96 y en el propio `GlpiContract`. La vía es que el contrato declare la obligatoriedad condicional por tipo, lo que exige un mapa por tipo en lugar de un booleano por campo. No se hizo porque el validador ya cubre el caso y duplicarlo ahora sería adelantar una abstracción |
| 53 | **El vocabulario de tipos del verificador es de dos valores** — `integer` y `string` | Bajo — un campo declarado `integer` que llegue como número decimal o como objeto se detecta; uno declarado `string` que llegue como número también. Lo que no se modela son estructuras anidadas, que hoy ningún campo del contrato usa | Se acepta: el contrato solo declara campos planos, y ampliar el vocabulario sin un campo que lo necesite sería construir para un caso que no existe. La vía es ampliarlo cuando aparezca el primer campo anidado |
| 54 | ~~**El riesgo 43 sigue abierto: la fase construye el instrumento, no toma la medida**~~ — **cerrado tras la Fase 11** (decisiones 104 a 108) | **Cerrado.** El instrumento se construyó y **se usó**: el plan de la decisión 102 se ejecutó completo y produjo una medida real sobre 1000 tickets. Este riesgo describía correctamente el límite de la Fase 10 y dejó de aplicar en cuanto se corrió el paso 3 | El cierre fue exactamente el previsto, en el orden previsto: primero el riesgo 50 —nombre del host y cadena de confianza—, después la captura, después la verificación. Lo que la fase no podía saber es lo que la medida iba a encontrar: el instrumento cumplió, y el contrato que declaraba estaba bien en la forma y mal en el contenido. Eso es ahora el riesgo 43 y los hallazgos de la decisión 106, no un límite del instrumento |

---

# Fase 11 — El contrato, medido contra la instancia real

## El contrato asumido contra el contrato observado

### 104. Qué devolvió la instancia

Se ejecutó `GlpiContractValidationTest` contra `sac-i.coltefinanciera.com.co` el **2026-10-06**: un solo caso, `Tests run: 1, Failures: 0, Errors: 0, Skipped: 0`, 31 s. La captura cruda quedó en `%TEMP%\glpi-tickets.json` (7,8 MB) y el análisis agregado se hizo **fuera del repositorio**: no se imprime ningún nombre, contenido ni identificador de persona, solo recuentos y distribuciones.

| Dato de la captura | Valor |
|---|---|
| Ruta | `/Ticket?range=0-999` |
| HTTP | `206 Partial Content` |
| `Content-Range` | `0-999/67599` |
| Cuerpo | 8 190 807 caracteres |
| Tickets verificados | 1000 |
| Contrato asumido | `glpi-contract-1` |
| Adaptador | `glpi-rest-1` |
| Veredicto del verificador | `DEGRADED` |

**`DEGRADED` por una sola razón.** Los once campos declarados están presentes y con el tipo declarado; los obligatorios no faltan ninguno; no hay fechas ilegibles. El veredicto lo baja un único valor: `priority = 6`, fuera de la escala 1..5 que el contrato declara.

**Y el veredicto del verificador no es el veredicto de la integración.** El verificador compara **forma** —nombres, tipos, presencia, rango—, que es lo que se le pidió. La comparación de **contenido**, que es la que decide si el flujo funciona, da un resultado mucho peor, y está en la decisión 106.

### 105. Matriz del contrato asumido contra el observado

Sobre los 1000 tickets de la muestra, campo por campo. «Presente» es un valor distinto de `null`; el tipo observado se cuenta solo sobre los presentes.

| Campo | Tipo declarado | Tipo observado | Presente | Ausente o `null` | Veredicto |
|---|---|---|---|---|---|
| `id` | integer, obligatorio | integer | 1000 | 0 | **COMPATIBLE** |
| `name` | string | string | 1000 | 0 | **COMPATIBLE** |
| `type` | integer, obligatorio | integer | 1000 | 0 | **COMPATIBLE** |
| `status` | integer, obligatorio | integer | 1000 | 0 | **COMPATIBLE** |
| `priority` | integer | integer | 1000 | 0 | **DEGRADED** — un valor fuera de la escala declarada |
| `impact` | integer | integer | 1000 | 0 | **COMPATIBLE** |
| `urgency` | integer | integer | 1000 | 0 | **COMPATIBLE** |
| `actiontime` | integer, obligatorio | integer | 1000 | 0 | **INCOMPATIBLE** — el tipo coincide, el contenido no |
| `date` | string | string, 19 car. | 1000 | 0 | **DEGRADED** — la forma coincide, el significado está en duda |
| `time_to_resolve` | string | string, 19 car. | 32 | 968 | **INCOMPATIBLE** para la ruta de peticiones |
| `date_creation` | *no modelado* | string, 19 car. | 1000 | 0 | **DEGRADED** — aparece siempre, y no siempre coincide con `date` |
| `users_id_assign` | integer | — | **0** | **1000** | **INCOMPATIBLE** |

**Lo que la muestra sí prueba.** Los nombres de campo son los que el DTO espera. Los tipos son los declarados. El formato de fecha es `yyyy-MM-dd HH:mm:ss` —19 caracteres en las 1032 fechas de la muestra, sin una sola excepción—. `/Ticket` devuelve un arreglo. `type` usa 1 y 2 y ningún otro valor. Nada de esto hay que cambiarlo.

**Lo que la muestra no puede probar.** Es la **más antigua** de las 67 599: identificadores 3 a 1006, fechas entre el 2024-07-31 y el 2024-09-05, y **los 1000 tickets están en estado 6**. Las tablas de estados de la decisión 81 quedan sin ejercitar: para incidencias solo se observó `RESUELTO` y para peticiones solo `FINALIZADO`. Un estado abierto —que es el único que compite por capacidad— no aparece ni una vez. La muestra valida presencia, tipo y formato; **no valida las tablas de estados ni la escala de prioridad**.

### 106. Los siete hallazgos

Ordenados por lo que rompen, no por lo que llaman la atención.

**H1 — `users_id_assign` no existe en `/Ticket`. `INCOMPATIBLE`, y rompe el flujo entero.**

Es el hallazgo grave. El campo no está ausente en algunos tickets: **no está en ninguno de los 1000**, y no aparece como `null`, sino que la clave no existe en el objeto. `GlpiRestPlanningSource.assignedTo` hace `id.equals(ticket.assignedUserId())`; con `assignedUserId()` nulo, ninguna igualdad se cumple y **los 1000 tickets se filtran**. El flujo devuelve una planificación vacía, sin descartes, sin error y sin aviso. Es exactamente la peor forma de fallar que la decisión 93 anticipó para los campos de selección: se parece a «no hay trabajo».

GLPI no expone el asignado como campo escalar del ticket. Lo expone en `links`, con dos entradas relacionadas: `Ticket_User` → `/Ticket/{id}/Ticket_User/` y `User` → `/User/{id}`. La primera es un subrecurso **por ticket**: resolverlo por esa vía son 1000 llamadas adicionales, inviable. Las claves que contienen «user» en el ticket son `users_id_lastupdater` y `users_id_recipient`, ninguna de las cuales es el asignado.

**H2 — `actiontime` es 0 en 994 de 1000. `INCOMPATIBLE`, y descarta el 99,4 %.**
El campo llega siempre, siempre como entero, y casi siempre vale cero: 994 ceros, 6 valores distintos de cero (1200, 1800, 3600, 7200, 9000), ninguno negativo. El validador descarta todo ticket con `actiontime` ausente o no positivo, así que **994 de 1000 no llegan al motor**. Hay además una duda semántica de fondo: el adaptador lee `actiontime` como «horas estimadas», y en GLPI `actiontime` es la duración **registrada** de las acciones sobre el ticket. Una instancia que no registre horas de acción deja el campo en cero aunque la estimación exista en otro sitio. Cuál es la fuente correcta de la estimación es una decisión de negocio, no de código.

**H3 — `time_to_resolve` falta en 968 de 1000. `INCOMPATIBLE` para las peticiones.**
Presente en 32, `null` en 968. El validador exige fecha comprometida a las peticiones, así que **408 de las 428 peticiones de la muestra se descartan** por esa regla. En incidencias la ausencia no descarta —la regla usa `date`—, pero son 560 de 572 las que no tienen el campo.

**H4 — `priority = 6` fuera de la escala declarada. `DEGRADED`.**
Un solo ticket, pero un valor que la escala 1..5 del contrato no cubre. El motor lo maneja: severidad deducida de `impact`/`urgency` y aviso con el valor. Lo que queda mal es el **contrato**, que declara una escala incompleta. `impact` y `urgency` sí se movieron dentro de 2..4 en toda la muestra.

**H5 — `date` y `date_creation` difieren en 235 de 1000. `DEGRADED`.**
El riesgo 51 queda respondido, y la respuesta es que **`date_creation` existe siempre** y **coincide con `date` en 765 casos y difiere en 235** (23,5 %). La suposición 11 —«`date` es la fecha de creación»— es cierta en tres cuartos de la muestra y falsa en el resto. No se puede saber cuál de las dos fechas es la que debe consumir capacidad sin una decisión de negocio; lo que sí se sabe es que elegir `date` desplaza el inicio de un 23,5 % de los incidentes.

**H6 — La lectura de 1000 tickets no cabe. Operativo, y mal clasificado.**
`getList("/Ticket?range=0-999")` —la llamada que hace el adaptador de verdad— falla con `GlpiConnectionException: GLPI respondio HTTP 206 en /Ticket?range=0-999: (cuerpo vacio)`. Las otras dos sondas separan las causas: leer el mismo cuerpo entero de una pieza falla igual, y `getList("/Ticket?range=0-1")` **funciona** y devuelve 2 tickets. Es decir, **el 206 no es el problema**: la respuesta de rango pequeño también es 206 y se lee sin dificultad. Lo que falla es el **tamaño**: 8,19 MB contra un límite de búfer de 256 KB. La excepción de fondo en el informe de la suite es `io.netty.util.IllegalReferenceCountException: refCnt: 0, decrement: 1`, que es lo que hace que el fallo emerja como una respuesta HTTP 206 con cuerpo vacío en lugar de como un error de búfer. **El clasificador de errores miente**: reporta un problema de tamaño como un problema de protocolo, y el mensaje que ve quien depura no contiene la causa real.

**H7 — El techo de mil tickets está confirmado, y devuelve los más viejos.**
`Content-Range: 0-999/67599`: la instancia tiene 67 599 tickets y la consulta trae el 1,5 %, que son los **más antiguos** —identificadores 3 a 1006, todos cerrados, todos de 2024—. El flujo no planificaría trabajo pendiente: planificaría trabajo de hace dos años que ya terminó. El comentario `ponytail:` del adaptador dejó escrito que se cambiaría a la búsqueda del servidor «en cuanto se valide contra un GLPI de verdad». **Esa condición ya se cumplió, y la respuesta es que sí hay que cambiarlo** — no por el techo, que ya se conocía, sino porque el filtro en memoria que debía sustituirlo está roto (H1).

### 107. Qué habría que cambiar en el adaptador, y por qué

**No se cambió nada de esto.** El brief lo fija —«no corregir todavía el adaptador, primero producir evidencia»— y además H1 y H2 no son decisiones técnicas: sin una respuesta de negocio, cualquier cambio sería adivinar. Queda escrito para que el cambio se discuta con el diagnóstico delante.

| # | Cambio | Por qué | Qué decide |
|---|---|---|---|
| 1 | **Traer los tickets por `/search/Ticket`** en lugar de `/Ticket?range=0-999` | Es el único cambio que resuelve H1, H6 y H7 a la vez: el criterio de búsqueda filtra por técnico asignado **en el servidor** (no necesita `users_id_assign`, que no existe), devuelve solo lo que se va a usar (el cuerpo deja de ser 8 MB) y no tiene techo de mil. El criterio exacto hay que verificarlo contra la instancia antes de escribirlo | Nada — es técnico, pero **no se puede escribir sin verificar el nombre del criterio** |
| 2 | **Cambiar la fuente de las horas estimadas** | H2: `actiontime` está en cero en el 99,4 % de la muestra y su significado en GLPI no es «estimación». Candidatos: `internal_time_to_resolve`, la diferencia `time_to_resolve - date`, un campo de SLA. Ninguno se puede elegir sin saber qué representa la estimación en el proceso de la compañía | **Negocio** |
| 3 | **Revisar la regla de la fecha comprometida** | H3: la regla descarta 408 de 428 peticiones. Si las peticiones sin `time_to_resolve` son trabajo válido, la regla está de más; si son trabajo sin comprometer, el descarte es correcto y lo que falla es que la instancia no las alimenta | **Negocio** |
| 4 | **Elegir entre `date` y `date_creation`** | H5: difieren en el 23,5 %. El adaptador lee `date`; `date_creation` está en la respuesta y no en el DTO | **Negocio** |
| 5 | **Corregir el clasificador de errores del cliente** | H6: un cuerpo que no cabe se reporta como «GLPI respondio HTTP 206», que manda a quien depura a mirar el código de estado en lugar del tamaño. El búfer y el 206 son cosas distintas y el mensaje debe distinguirlas | Nada — es técnico y acotado a `GlpiClient` |
| 6 | **Ampliar la escala de `priority` en el contrato** | H4: el contrato declara 1..5 y la instancia usa 6. Es una línea, y sin ella el verificador seguirá dando `DEGRADED` sobre una respuesta que el motor maneja bien | Nada — es declarativo |

**Lo que NO hay que cambiar.** El transporte y la cadena de confianza (decisión 103), el manejo de sesión, la separación DTO / mapeador / validador, la forma del contrato declarado y el verificador. Todo eso quedó ejercitado contra la instancia real y no produjo ni un hallazgo.

### 108. Decisión recomendada

**Requiere ajustes menores — en la estructura. El efecto, hoy, es total.**

La arquitectura no necesita rediseño: los seis cambios de la decisión 107 están localizados —una consulta, dos campos, un clasificador de errores, una declaración— y ninguno toca el motor, el dominio ni el frontend. Pero decir «menores» sin más sería engañoso, y por eso conviene decirlo entero:

- **El flujo, contra esta instancia, no produce una planificación aproximada: no produce ninguna.** El filtro por asignado deja la lista en cero antes de que nada más importe (H1). De los 1000 tickets, **2 sobrevivirían al validador** si el filtro por asignado no existiera.
- **Dos de los seis ajustes no son técnicos.** La fuente de las horas estimadas y el tratamiento de las peticiones sin fecha comprometida son decisiones sobre el proceso de la compañía. Sin ellas, tocar el código sería sustituir una suposición por otra.
- **La muestra no ejercitó el caso que importa.** Los 1000 tickets están cerrados. Todo lo observado describe trabajo terminado; el comportamiento sobre trabajo abierto —el único que el motor planifica— sigue sin observarse.

**El orden que se recomienda**, y no es el orden de la tabla: primero el cambio 1, que es el único que desbloquea una segunda medición —hoy no se puede capturar trabajo abierto porque la consulta devuelve lo más viejo—; después la segunda medición, que es la que ejercita las tablas de estados y la que responde H2, H3 y H5 con datos de tickets vivos; y solo entonces los cambios 2, 3 y 4, con la respuesta de negocio delante. Los cambios 5 y 6 pueden ir en cualquier momento: son independientes y no cambian ningún resultado.


---

# Fase 12 — El modelo funcional real de GLPI

La Fase 11 comparó el contrato declarado con lo que la instancia devuelve y produjo siete hallazgos. Casi todos tienen la misma forma: **el campo llega, y no significa lo que el dominio cree que significa**. `users_id_assign` no llega nunca; `actiontime` llega siempre y vale cero; `time_to_resolve` llega en dos tercios de los casos; `date` y `date_creation` llegan los dos y no son la misma fecha.

Medir la forma era la Fase 11. Esta fase mide el **significado**, sobre las mismas respuestas crudas más las que faltaban. La pregunta ya no es «¿está el campo?» sino «¿de dónde saca la capa anticorrupción el responsable, el esfuerzo, el inicio y el compromiso?».

---

## Cómo se midió, y por qué así

### 109. El instrumento y el método

Se escribió `GlpiModelDiscoveryTest` —dos casos, ninguno corre con la suite, los dos desactivados salvo `GLPI_MODELO=true`— y se ejecutó contra `sac-i.coltefinanciera.com.co` el **2026-10-06**: `Tests run: 2, Failures: 0, Errors: 0`, 42 s.

**La prueba no afirma nada.** Trae respuestas crudas, las deja en `%TEMP%\glpi-modelo\` y termina. Toda la lectura se hizo después, en scripts de Python **fuera del repositorio**, que solo agregan: no imprimen nombres, ni contenido, ni identificadores de persona. Es el mismo reparto que la Fase 11 —el instrumento trae, el análisis interpreta— y no es una formalidad: convertir la conclusión en una aserción dentro de la prueba sería escribir la respuesta que se quiere leer.

**Por qué una prueba de integración y no un `curl`.** Dos razones, y la primera es de seguridad: las credenciales entran al proceso por `spring.config.import` del archivo `.env`, así que sacar la sesión a un script obligaría a leer el archivo de credenciales, que es justo lo que no se quiere. La segunda es que el JVM es el único cliente que completa la cadena TLS de esta instancia: el servidor omite su certificado intermedio y ni Python ni OpenSSL lo piden por AIA (decisión 103).

**Qué se pidió.** Tres bloques:

1. **La ventana viva.** `/Ticket?range=67500-67599` — el extremo opuesto del rango que usó la Fase 11. Es el cambio que hace posible todo lo demás: los mil tickets de `range=0-999` son los más antiguos y están todos cerrados, así que no pueden responder si el asignado o el esfuerzo existen en un ticket que el motor tendría que planificar.
2. **Los subrecursos, ticket por ticket.** `/Ticket/{id}`, `/Ticket/{id}/Ticket_User/`, `/Ticket/{id}/TicketTask/` y `/Ticket/{id}/Group_Ticket/` sobre 33 tickets de la ventana viva **repartidos por estado** —no los primeros, que serían todos del mismo estado— y sobre 12 de la ventana antigua, para contrastar.
3. **Los metadatos del servidor.** `/listSearchOptions/Ticket`, que publica el número de campo de cada concepto sin tener que adivinarlo; `/search/Ticket`; y el padrón de usuarios en sus dos formas, `/User/` y `/User/?range=0-999`.

**La muestra, medida.** La ventana viva trae **100 tickets** (ids 67500..67599) con `status` `{2: 39, 5: 52, 6: 9}` y `type` `{1: 17, 2: 83}`: hay trabajo abierto, resuelto y cerrado, y hay incidencias y peticiones. La antigua trae **1000 tickets** (ids 3..1006), todos cerrados, todos de 2024. El contraste que el brief pedía —cerrados, abiertos, asignados y sin asignar— queda cubierto por las dos ventanas juntas.

### 110. Las siete preguntas del brief, respondidas

**1. ¿Cómo se obtiene el técnico asignado?**

Por `Ticket_User`, y solo por ahí. El campo `users_id_assign` que el DTO declara **no existe**: ausente en las 100 respuestas de la ventana viva y en las 1000 de la antigua. No es un campo que llegue vacío — no está en el JSON.

`Ticket_User` guarda los tres papeles del ticket en la misma tabla y los distingue con `type`: **1 solicitante, 2 asignado, 3 observador**. El tipo no es un adorno: sin él, la fila del solicitante se leería como si fuera el responsable, y como el solicitante está en el 100 % de los tickets, el error sería silencioso y universal.

Medido: en la ventana viva, **33 de 33 tickets abiertos uno por uno traen técnico** (`{1: 36, 2: 33, 3: 8}` filas por tipo, 16 técnicos distintos). En la antigua, **10 de 12** (`{1: 12, 2: 10, 3: 4}`, 7 técnicos distintos): el ticket más antiguo de la instancia, el id 3, solo tiene fila de solicitante. Es decir: **«sin asignar» existe de verdad, es raro, y no es una práctica reciente** — el grupo, en cambio, sí está asignado siempre (ver la pregunta 7).

**2. ¿En qué endpoint vive realmente?**

En `/Ticket/{id}/Ticket_User/`, un subrecurso por ticket. Claves de una fila: `alternative_email, id, links, tickets_id, type, use_notification, users_id`.

Eso significa que resolver el asignado por esta vía cuesta **una llamada por ticket**. Para los 67 612 tickets de la instancia serían 67 612 llamadas: no escala.

**3. ¿Cómo se representa la asignación?**

De tres formas a la vez, y la distinción importa:

- **A una persona**: `Ticket_User` con `type=2`, columna `users_id`.
- **A un grupo**: `Group_Ticket` con `type=2`, columna `groups_id` — presente en **todos** los tickets muestreados, incluido el id 3, que no tiene técnico.
- **Al técnico que trabajó**: `TicketTask.users_id_tech`, en las tareas.

La asignación a grupo es la que siempre está. La asignación a persona es la que el dominio necesita y la que a veces falta. **La vía que escala** no es el subrecurso sino la búsqueda del servidor:

`/search/Ticket?range=0-4&criteria[0][field]=5&criteria[0][searchtype]=equals&criteria[0][value]={usersId}`

verificado contra la instancia: **HTTP 206, `Content-Range: 0-4/208`** — el técnico de prueba tiene 208 tickets, y la respuesta los cuenta y los devuelve en una sola llamada, con `totalcount` y filas. El número de campo **5** no se adivinó: `/listSearchOptions/Ticket` publica que es «Technician» sobre `glpi_users.name`. Una fila trae `{"1": "<nombre del ticket>", "2": <id>, "5": "<usuario>", "12": <status>}`.

**El mismo endpoint sin criterio no responde.** `/search/Ticket?range=0-2` no contestó ni con el límite del cliente (5 s) ni con un margen deliberado de 30 s. No es un fallo de la sonda: es un hallazgo. La búsqueda de GLPI es viable **acotada** y no lo es sin criterio, así que el cambio que la Fase 11 recomendó no se puede escribir como «traer los tickets por búsqueda» sin más: hay que escribir la consulta **con su criterio**.

**4. ¿Cómo se obtienen estimaciones?**

**No se obtienen. GLPI no tiene un campo de esfuerzo estimado, y esto no es un campo que falte: es una categoría que no existe.**

La evidencia es doble. Primero, el mapa de opciones: de las **139 opciones de búsqueda numéricas** que publica `/listSearchOptions/Ticket`, **ninguna declara una estimación** — la 45 es «Total duration» sobre `glpi_tickets.actiontime`, la 96 «Duration» sobre `glpi_tickettasks.actiontime`, y las demás son duraciones transcurridas, fechas o contadores. Segundo, los valores: `actiontime` llega en el 100 % de la ventana viva y **vale cero en las 100**. En la antigua, 994 de 1000. Un campo que existe, que siempre llega y que casi siempre es cero no es una estimación mal capturada: es otra cosa que el dominio está leyendo como estimación.

**5. ¿Qué campos podrían sustituir a `actiontime`?**

Ninguno lo sustituye con el mismo significado, y esa es la respuesta. Lo que hay son **duraciones transcurridas calculadas por GLPI**, que miden lo que pasó y no lo que se planea:

| Campo | Opción | No cero en la ventana viva (n=100) |
|---|---|---|
| `takeintoaccount_delay_stat` | 150 «Take into account time» | 98 |
| `solve_delay_stat` | 154 «Resolution time» | 58 |
| `close_delay_stat` | 152 «Closing time» | 9 |
| `waiting_duration` | 153 «Waiting time» | 2 |
| `sla_waiting_duration` | — | 2 |
| `ola_waiting_duration` | — | 2 |

Y hay una tercera fuente, la única que se parece a un esfuerzo declarado por una persona: **`TicketTask`**, con su propio `actiontime` (opción 96, «Duration» sobre `glpi_tickettasks.actiontime`), `begin` (173), `end` (174), `state` (33) y `users_id_tech`. El problema es la cobertura: de los 7 tickets abiertos uno por uno en la primera pasada, **solo 2 tienen alguna tarea**. Un campo que solo existe en dos de cada siete tickets no puede ser la fuente del esfuerzo de todos.

**Conclusión: la premisa del adaptador es un error de categoría.** El dominio pide «horas estimadas»; GLPI no las guarda en ninguna parte. Elegir un sustituto no es una decisión técnica entre candidatos: es decidir qué significa «esfuerzo» en el proceso de la compañía. Si el esfuerzo es lo que el técnico registró en sus tareas, la fuente es `TicketTask.actiontime`. Si es lo que el SLA comprometió, la fuente es una fecha comprometida menos la fecha de apertura. Si es una cifra que alguien digita al planificar, **esa cifra no está en GLPI y no se puede leer de GLPI**. Ninguna de las tres la puede elegir el código.

**6. ¿Cuál es la diferencia real entre `date`, `date_creation`, `solvedate`, `closedate` y `time_to_resolve`?**

Los nombres los publica `/listSearchOptions/Ticket`; los valores, la ventana viva. **No son cinco nombres para la misma cosa: son cinco momentos distintos del ciclo de vida, y dos de ellos están mal elegidos en el adaptador.**

| Opción | Nombre en GLPI | Columna | Qué es | Presente (n=100) |
|---|---|---|---|---|
| 15 | Opening date | `glpi_tickets.date` | Apertura | 100 |
| — | — | `date_creation` | Creación del registro | 100 |
| 150 | Take into account time | `takeintoaccountdate` | Cuándo alguien lo tomó | 98 |
| 18 | Time to resolve | `time_to_resolve` | Compromiso del **SLA** | 68 |
| 180 | Internal time to resolve | `internal_time_to_resolve` | Compromiso del **OLA** | 89 |
| 17 | Resolution date | `solvedate` | Cuándo se resolvió | 61 |
| 16 | Closing date | `closedate` | Cuándo se cerró | 9 |
| 19 | Last update | `date_mod` | Última modificación | — |

Tres cosas que la medida deja claras y que ninguna documentación habría dado:

- **`date` no es la fecha de creación.** Difieren en **33 de 100** tickets de la ventana viva, y en **31 de esos 33** `date` es *posterior* a `date_creation`. No es ruido de segundos: el adaptador está desplazando el inicio de uno de cada tres tickets vivos, y siempre hacia adelante — es decir, **siempre regalando capacidad ya consumida**. En la ventana antigua la proporción es menor (235 de 1000) y el riesgo 51 ya lo había detectado allí; la ventana viva confirma que sigue ocurriendo y que la dirección del error es sistemática.
- **El compromiso no es uno, son dos, y se contradicen.** De los 57 tickets que traen las dos fechas, **solo 2 coinciden y 55 difieren**. Además, 11 traen solo la del SLA, 32 solo la del OLA, y **ninguno se queda sin ninguna**. Es decir: siempre hay una fecha comprometida disponible, pero **elegir cuál de las dos es una decisión de negocio** — y usar solo `time_to_resolve`, como hace el adaptador hoy, deja sin fecha a 32 de los 100 tickets que sí la tienen.
- **El estado y las fechas de cierre son coherentes**, lo que descarta que los vacíos sean datos corruptos: `status=2` (n=39) → 0 con `solvedate`, 0 con `closedate`; `status=5` (n=52) → 52 y 0; `status=6` (n=9) → 9 y 9. Los vacíos son la ausencia real del hecho, no un campo perdido.

**7. ¿Qué campos distinguen incidentes de requerimientos?**

Uno solo: **`type`** (opción 14, `glpi_tickets.type`), **1 = incidencia, 2 = petición**, presente en el 100 % de las dos ventanas. Ningún otro campo del ticket los distingue. La ventana viva trae `{1: 17, 2: 83}`; la antigua, `{1: 572, 2: 428}`.

Conviene añadir lo que **no** los distingue, porque es fácil de confundir: `Group_Ticket` y `Ticket_User` también tienen un campo `type`, y es un vocabulario **distinto** —1/2/3 para el papel del actor, no 1/2 para el tipo de ticket—. Dos campos llamados `type` con dos escalas distintas en la misma respuesta.

### 111. La matriz funcional

Lo que el negocio necesita, contra lo que GLPI realmente tiene:

| Campo de negocio | Campo real GLPI | Endpoint | Calidad del dato | Observaciones |
|---|---|---|---|---|
| **Responsable** | `Ticket_User.users_id` con `type=2` | `/Ticket/{id}/Ticket_User/` | Fiable donde existe: 33/33 vivos, 10/12 antiguos | No vive en el ticket. Una llamada por ticket: 67 612 para la instancia. **Alternativa que escala**: `/search/Ticket` con `criteria[0][field]=5` (verificado, 208 tickets en una llamada) |
| Identificador del responsable | `users_id` → `/User/{id}` | `/User/{id}` | Resuelve: 98 campos, `name`/`realname`/`firstname`/`is_active`/`profiles_id` no vacíos | El técnico asignado existe como usuario activo |
| **Esfuerzo estimado** | **no existe** | — | — | Ni `actiontime` ni ninguna de las 139 opciones declara una estimación. Es una decisión de negocio, no un campo |
| Esfuerzo registrado | `glpi_tickets.actiontime` (opción 45 «Total duration») | `/Ticket` | Presente 100/100, **no cero 0/100** | Es duración registrada. El nombre de la opción lo dice: «Total duration», no «estimate» |
| Duración por tarea | `glpi_tickettasks.actiontime` (opción 96 «Duration») | `/Ticket/{id}/TicketTask/` | Presente y no nulo donde hay tarea | Solo 2 de 7 tickets muestreados tienen tareas |
| Tiempo transcurrido | `takeintoaccount_delay_stat` (98), `solve_delay_stat` (58), `close_delay_stat` (9) | `/Ticket` | Calculado por GLPI, consistente con el estado | Mide lo que pasó. No es planificable |
| **Fecha de inicio** | `date_creation` (creación) frente a `date` (opción 15 «Opening date») | `/Ticket` | 100/100 las dos | **Difieren en 33/100, y `date` es posterior en 31 de esos 33.** El adaptador lee `date`: desplaza el inicio y regala capacidad consumida |
| **Fecha comprometida** | `time_to_resolve` (18, SLA) e `internal_time_to_resolve` (180, OLA) | `/Ticket` | 68/100 y 89/100; **juntas 100/100** | **Se contradicen: 55 de 57 difieren.** Usar solo el SLA deja sin fecha a 32 de 100 |
| Fecha de resolución | `solvedate` (17) | `/Ticket` | 61/100, coherente con `status` | — |
| Fecha de cierre | `closedate` (16) | `/Ticket` | 9/100, coherente con `status` | — |
| Tipo de ticket | `type` (14) | `/Ticket` | 100/100 | 1=incidencia, 2=petición |
| Estado | `status` | `/Ticket` | 100/100 | Coherente con las fechas de cierre |
| Grupo responsable | `Group_Ticket.groups_id` con `type=2` | `/Ticket/{id}/Group_Ticket/` | Presente en todos los muestreados, incluido el más antiguo | El grupo siempre está asignado; la persona no |
| **Padrón de usuarios** | `/User/` — la ruta que el adaptador usa | `/User/` | **30 usuarios de 2427** (`Content-Range: 0-30/2427`) | Ver la limitación 3 |

### 112. Campos confirmados

Sirven, y sirven para lo que el dominio necesita:

- **`type`** — distingue incidencia de petición, 100 % de cobertura en las dos ventanas. Es el discriminador que la política de incidencias necesita.
- **`status`** — 100 % de cobertura y coherente con las fechas de cierre en las tres combinaciones observadas.
- **`date_creation`** — 100 % de cobertura. **Es la fecha de creación real**; hoy no está en el DTO y debería estar.
- **`Ticket_User` con `type=2`** — el responsable. Es la única fuente y es fiable donde existe.
- **`Group_Ticket` con `type=2`** — el grupo responsable, con cobertura total en la muestra.
- **`/search/Ticket` con `criteria[0][field]=5`** — la vía que escala para obtener el asignado sin recorrer subrecursos. Verificada contra la instancia.
- **`/User/{id}`** — resuelve el técnico con nombre y apellido, perfil y estado de actividad.
- **`solvedate` y `closedate`** — coherentes con el estado; útiles para el histórico, no para planificar.
- **`internal_time_to_resolve`** — la mitad de la fecha comprometida que el adaptador hoy no mira, y la que cubre los 32 tickets que el SLA deja fuera.

### 113. Campos descartados

- **`users_id_assign`** — no existe. Ausente en 1100 respuestas. Se descarta como fuente; el DTO lo declara y el DTO está equivocado.
- **`actiontime` como esfuerzo estimado** — descartado por significado, no por disponibilidad: llega siempre y vale cero siempre. La opción 45 lo llama «Total duration».
- **`date` como fecha de creación** — descartado: difiere de `date_creation` en un tercio de la ventana viva, y siempre hacia adelante.
- **`time_to_resolve` como única fecha comprometida** — descartado como fuente única: deja fuera 32 de 100 tickets que sí tienen compromiso.
- **Las duraciones transcurridas como esfuerzo** — descartadas como *sustituto* de una estimación: miden lo que pasó. Pueden alimentar otro concepto —real contra planificado—, pero no este.
- **`/search/Ticket` sin criterio** — descartado como vía de lectura: no responde.

### 114. Limitaciones encontradas

**1. La muestra de subrecursos es pequeña.** 33 tickets vivos y 12 antiguos para `Ticket_User`, 7 para `TicketTask`. El reparto por estado y la cobertura del 100 % de técnicos son consistentes, pero «33 de 33» no es «todos los tickets vivos de la instancia». Las proporciones de `TicketTask` —2 de 7— son las más frágiles de todo el informe y conviene no apoyar una decisión solo en ellas.

**2. No se observó el ciclo de vida completo de ningún ticket.** Las dos ventanas son fotografías. Que `solvedate` esté vacío en los tickets abiertos es lo esperado; que se llene al resolverlos es una deducción, no una observación.

**3. El padrón de usuarios se lee incompleto, y esto es nuevo.** `/User/` —la ruta exacta que `GlpiRestPlanningSource` usa— devuelve **30 usuarios**; la cabecera `Content-Range` declara `0-30/2427`. El padrón tiene 2427 usuarios y el adaptador ve el **1,2 %**. La consecuencia no es hipotética: de los **23 técnicos distintos** observados en las dos ventanas, **solo 3 están en esos 30**, y solo 14 en la primera página de mil. Es decir: **el punto de entrada del adaptador —recorrer usuarios y pedir sus tickets— cubre el 1,2 % del padrón**, y arreglar H1 no arregla esto: aunque el filtro por asignado funcione, la lista de personas sobre la que itera está truncada en silencio. GLPI responde `206` y no avisa; el adaptador tampoco mira la cabecera.

**4. La búsqueda sin criterio no responde, y no se sabe por qué.** No contestó en 30 s. Podría ser el coste de ordenar 67 612 tickets, podría ser una particularidad de esta instancia. Lo que sí se sabe es que acotada responde al instante.

**5. El nombre del ticket llega en la búsqueda, y el nombre puede contener datos personales.** La fila de `/search/Ticket` trae el campo 1, que es el título. Leer la búsqueda es, por tanto, leer títulos: conviene pedir solo los `forcedisplay` que se van a usar, que es lo que se hizo aquí (2, 12 y 5).

**6. La zona horaria sigue sin verificarse.** El formato está confirmado desde la Fase 11 —19 caracteres, `yyyy-MM-dd HH:mm:ss`, sin excepciones— pero la instancia no declara su zona. El riesgo 47 sigue abierto en esa mitad.

**7. Nada de esto se probó sobre un ticket en curso con tareas abiertas.** El motor planifica trabajo pendiente; la ventana viva tiene 39 tickets en `status=2`, que es lo más cerca que se estuvo, pero no se siguió ninguno mientras cambiaba.

### 115. Qué habría que cambiar en el adaptador — revisión de la decisión 107

La decisión 107 escribió seis cambios cuando solo se sabía que los campos fallaban. Ahora se sabe **por qué** fallan, y la tabla cambia en cuatro de las seis filas. **Sigue sin cambiarse una línea de código**: el brief lo fija —«no modificar todavía los mapeadores, primero producir evidencia»— y además los cambios 2, 3 y 4 siguen sin respuesta de negocio.

| # | Cambio | Qué se sabía (Fase 11) | Qué se sabe ahora (Fase 12) | Qué decide |
|---|---|---|---|---|
| 1 | **Traer los tickets por `/search/Ticket`** | «El criterio exacto hay que verificarlo» | **Verificado.** `field=5` es «Technician» sobre `glpi_users.name`, y `equals` devuelve `totalcount` y filas: 208 tickets en una llamada. Resuelve H1, H6 y H7 a la vez | Nada. Pero **la consulta tiene que llevar criterio**: sin él no responde |
| 2 | **Cambiar la fuente de las horas estimadas** | «Candidatos: `internal_time_to_resolve`, `time_to_resolve - date`, un campo de SLA» | **Los candidatos de la Fase 11 no eran estimaciones: son fechas límite.** No hay estimación en GLPI. Las tres familias reales son `TicketTask.actiontime` (cobertura 2 de 7), una fecha comprometida menos la apertura, o una cifra externa a GLPI | **Negocio** |
| 3 | **Revisar la regla de la fecha comprometida** | «Descarta 408 de 428 peticiones» | La regla no solo descarta de más: **lee la mitad del dato**. `time_to_resolve` 68/100, `internal_time_to_resolve` 89/100, juntas 100/100, y se contradicen en 55 de 57. La regla debe leer **las dos** y decidir cuál manda | **Negocio** en cuál manda; **técnico** en leer las dos |
| 4 | **Elegir entre `date` y `date_creation`** | «Difieren en el 23,5 %» | Difieren en **33/100 vivos**, y **`date` es posterior en 31 de esos 33**: el error no es simétrico, siempre regala capacidad consumida. `date_creation` es la creación; `date` es «Opening date», que no es lo mismo | **Negocio**, pero con el sesgo ya medido: hoy el error va siempre en la dirección que hace planificar trabajo ya hecho |
| 5 | **Corregir el clasificador de errores del cliente** | Un cuerpo que no cabe se reporta como «HTTP 206» | Sin cambios. Es un defecto de mensaje, acotado a `GlpiClient` | Nada |
| 6 | **Ampliar la escala de `priority` en el contrato** | El contrato declara 1..5 y la instancia usa 6 | Sin cambios. Una línea | Nada |
| **7** | **Leer el padrón de usuarios completo** *(nuevo)* | No se sabía | `/User/` devuelve 30 de 2427. El adaptador itera sobre el 1,2 % del padrón y no mira `Content-Range` | Nada — es técnico: paginar, o mejor, no iterar el padrón y entrar por la búsqueda del cambio 1 |

**El orden sigue siendo el de la decisión 108, con una corrección.** Primero el cambio 1 —es el único que desbloquea una segunda medición—; después la segunda medición; y solo entonces los cambios 2, 3 y 4, con la respuesta de negocio delante. Los cambios 5, 6 y 7 son independientes y pueden ir en cualquier momento. Lo que cambia respecto de la decisión 108 es que **el cambio 7 ya no es opcional**: el cambio 1 hace que el adaptador entre por la búsqueda en lugar de por el padrón, y con eso el cambio 7 deja de bloquear nada — pero mientras el cambio 1 no esté hecho, el padrón truncado es una segunda causa, independiente de H1, de que la agenda salga vacía.

### 116. Decisión final

**Requiere intervención funcional del negocio.**

La investigación no es insuficiente: las siete preguntas del brief están respondidas con respuestas reales de la instancia, la matriz funcional está completa, y los cuatro campos que el dominio necesita tienen respuesta sobre dónde viven. Tampoco es que la ACL esté lista para corregirse sin más, porque **dos de los cuatro campos no tienen una fuente que el código pueda elegir solo**.

Lo que separa a esta fase de una corrección es esto, y conviene decirlo sin adornos:

- **El responsable tiene fuente y la fuente escala.** `Ticket_User` con `type=2`, y `/search/Ticket` con `field=5` para traerlo sin recorrer subrecursos. Es el único de los cuatro campos que está resuelto de punta a punta. Es técnico, está verificado, y se puede escribir.
- **El esfuerzo estimado no existe en GLPI.** No es un campo mal elegido: es un concepto que la instancia no guarda. Cualquier cambio que se haga hoy sustituye una suposición por otra suposición. Hace falta que el negocio diga qué es «esfuerzo» en su proceso, y de dónde sale la cifra.
- **La fecha de inicio tiene dos candidatas y una está mal.** `date_creation` es la creación; `date` es «Opening date» y va por detrás en un tercio de los casos vivos. La elección es de negocio, pero el sesgo ya está medido: hoy el error siempre hace planificar trabajo ya hecho.
- **La fecha comprometida existe siempre, pero son dos y se contradicen.** `time_to_resolve` e `internal_time_to_resolve` cubren juntas el 100 % y discrepan en 55 de 57. Cuál manda es del negocio; leer las dos es técnico y se puede hacer ya.

**Y una advertencia sobre el orden, porque es la parte que se puede malinterpretar.** Corregir el cambio 1 no arregla la planificación: la deja **medible**. Hoy el flujo devuelve una agenda vacía por dos causas independientes —el filtro por asignado lee un campo que no existe (H1) y el padrón de usuarios está truncado al 1,2 % (limitación 3)— y ninguna de las dos se ve como un error. El cambio 1 elimina las dos, y con eso el motor recibe por primera vez trabajo real. Que ese trabajo se planifique bien o mal es lo que la segunda medición tiene que decir, y para eso hacen falta los cambios 2, 3 y 4 — que son, precisamente, los que no puede decidir el código.

**Lo que no cambia.** El transporte y la cadena de confianza, el manejo de sesión, la separación DTO / mapeador / validador, el motor de planificación, las reglas de negocio y el frontend: la fase no tocó ninguno. `PlanningEngine` sigue con las mismas líneas que antes de que empezara la investigación de GLPI.

---

# Fase 13 — `PlanningMetadata`: la planificación propia

La Fase 12 midió el modelo funcional real de GLPI y cerró con un veredicto que no era un fracaso de la investigación sino su resultado: **requiere intervención funcional del negocio**. De los cuatro datos que el motor necesita, dos no tienen una fuente que el código pueda elegir solo. El esfuerzo estimado **no existe en GLPI** —no es un campo mal elegido, es una categoría que la instancia no guarda— y la fecha comprometida **son dos y se contradicen** en 55 de 57 casos.

El negocio contestó las dos preguntas:

> **El esfuerzo estimado lo define el desarrollador asignado.**
> **La fecha de compromiso la define el gestor de demanda.**

Ninguno de los dos valores vive en GLPI. Esta fase construye el sitio donde viven, con historial y trazabilidad, y una API mínima para validar el modelo. La afirmación que la sostiene es una separación de responsabilidades, no una funcionalidad: **GLPI es la fuente del trabajo; la planificación pertenece a este sistema.** El motor sigue leyendo horas y fechas; lo que cambia es de dónde van a salir cuando alguien las conecte.

**Lo que la fase no toca.** Ni `PlanningEngine`, ni una regla de planificación, ni el frontend, ni `integration/glpi/`, ni `client/`, ni `config/`, ni un endpoint de planificación existente. La metadata es una capa nueva que **hoy nadie consume**, y es deliberado: el brief pide el modelo, no la integración. La costura por la que entrará queda documentada en la decisión 124 y **no implementada**.

**Las treinta y dos pruebas que la fase añade** llevan la suite de 163 a 195, y ninguna expectativa anterior cambió. `GestionDemandaApplicationTests` levanta el contexto entero, así que es la red que atrapa cualquier bean nuevo mal cableado.

---

## Dónde vive la planificación, y por qué aquí

### 117. GLPI es la fuente del trabajo; la planificación es de este sistema

Hasta esta fase, el sistema tenía una sola fuente de verdad para todo: GLPI. El ticket traía el trabajo, el asignado, la prioridad y —supuestamente— el esfuerzo y la fecha comprometida. La Fase 12 demostró que las dos últimas suposiciones eran falsas, y la Fase 11 ya había demostrado que `users_id_assign` tampoco existe.

La conclusión no es que GLPI esté incompleto. Es que **se le estaba pidiendo algo que no le corresponde**. GLPI registra lo que pasa en la operación: quién reporta, quién atiende, cuándo se abrió, cuándo se resolvió. Planificar es decidir **cuánto va a costar** y **para cuándo se promete**, y esas dos cosas no son hechos registrados: son compromisos que alguien asume. Un sistema de mesa de ayuda no los guarda porque no los produce.

De ahí la separación, que es la decisión de arquitectura de esta fase:

| Qué | De quién es | Dónde vive |
|---|---|---|
| El trabajo: qué hay que hacer, de quién es, con qué prioridad, desde cuándo | GLPI | GLPI. Este sistema lo lee |
| El coste: cuántas horas se estiman | El desarrollador asignado | **Aquí**, en `PlanningMetadata` |
| La promesa: para cuándo se compromete | El gestor de demanda | **Aquí**, en `PlanningMetadata` |
| El plan: cómo se reparte ese trabajo en la agenda | Este sistema | Aquí, en `PlanSnapshot` |

La fila que importa es la tercera. Un plan construido sobre una fecha que nadie prometió no es un plan: es un cálculo. La fase anterior dejó el sistema sin poder prometer nada porque la promesa estaba en un campo que no la contenía; esta le da el sitio donde hacerla.

**Lo que esta decisión implica y conviene decir sin adornos:** desde esta fase hay **dos verdades sobre las horas** —la que GLPI registra en `actiontime` y la que el negocio declara aquí— y mientras la ACL no integre la segunda, la primera sigue siendo la que el motor lee. No se concilian, y no se intenta: conciliarlas antes de que la ACL las conecte sería resolver un problema que todavía no existe. Es el riesgo 56.

### 118. La forma del modelo, y por qué `work_item_id` es la clave

`PlanningMetadata` es un record de dominio, Java puro, sin una anotación de Spring ni de JPA:

```
workItemId      String        el identificador del ticket de GLPI, como texto
estimatedHours  BigDecimal    lo que el desarrollador estima. Puede no haber
committedDate   LocalDate     lo que el gestor promete. Puede no haber
estimatedBy     String        quién fijó —o retiró— la estimación
committedBy     String        quién fijó —o retiró— el compromiso
estimatedAt     Instant       cuándo se fijó o se retiró
committedAt     Instant       cuándo se fijó o se retiró
source          InputSource   HTTP o GLPI: de dónde entró el dato
```

Los ocho campos que el brief pedía, con los mismos nombres. Tres cosas del diseño merecen explicación, porque no son obvias:

**`workItemId` es el identificador de GLPI como texto, y no lleva clave foránea.** No hay tabla de tickets que referenciar: los tickets viven en GLPI, no aquí, y este sistema nunca los copia como valor vivo —esa es la decisión 66 y sigue vigente—. La consecuencia es que se puede declarar planificación para un elemento de trabajo que no existe, y el modelo **lo permite a propósito**: comprobarlo exigiría una llamada a GLPI por escritura, que es exactamente el acoplamiento que la fase evita. Es el riesgo 55.

**El par autor/fecha va junto o no va.** `estimatedBy` sin `estimatedAt` es un dato a medias y el constructor compacto lo rechaza, igual que `committedBy` sin `committedAt`. La invariante está en el dominio, no en el DTO: `DomainPreconditions` ya existía para esto.

**`estimatedBy` presente con `estimatedHours` nulo es legal, y significa algo.** Es «se retiró, y consta quién». Es el estado que hace trazable el borrado de la decisión 122, y por eso no es una violación de la invariante anterior sino su complemento: el autor acompaña al *acto*, no al valor.

**La clave primaria es natural: `work_item_id`.** Es la diferencia deliberada con las tablas del plan —hijas de un agregado con UUID e `id` IDENTITY—. Aquí hay **un** metadata por elemento de trabajo, y la clave natural es lo que lo impide. `RescheduleClaimEntity` usa clave sustituta más restricción única, pero su javadoc explica que fue para no necesitar un `@IdClass`; con una clave natural de una sola columna eso no aplica.

**La trampa que la clave natural esconde, y que costó un rodeo.** Spring Data decide entre insertar y actualizar mirando si el identificador es nulo. Aquí **nunca lo es**. Sin intervenir, `saveAndFlush` de una fila nueva haría un `merge`, y un merge sobre una clave que ya existe **no falla: actualiza en silencio**. La segunda declaración del mismo elemento pisaría la primera en vez de responder que ya estaba, y el 409 que la API promete no llegaría nunca. `PlanningMetadataEntity` implementa `Persistable<String>` con una marca `nueva` para que el `create` inserte de verdad y la violación de clave ocurra. Las dos alternativas se descartaron con motivo: inyectar `EntityManager` obligaría a anotar el adaptador como `@Repository` para que la excepción se tradujera, y una clave sustituta con restricción única contradice el punto anterior.

### 119. La fuente de la estimación: el desarrollador asignado

**Lo define el desarrollador asignado al ticket.** No el gestor, no un campo de GLPI, no una media histórica. Quien va a hacer el trabajo es quien dice cuánto le cuesta.

Esto responde la pregunta que la Fase 12 dejó abierta —«¿qué es esfuerzo en el proceso de la compañía?»— y descarta las tres familias de candidatos que la medición había encontrado. No es `TicketTask.actiontime`: las tareas son lo que el técnico registró *después*, y su cobertura era de 2 de cada 7 tickets. No es `actiontime` del ticket: vale cero en el 100 % de la ventana viva y su opción de búsqueda se llama «Total duration», no «estimate». No es una fecha comprometida menos la apertura: eso mide el plazo que se concedió, no el trabajo que hay dentro.

Es una cifra que una persona digita al planificar, y por eso **no se puede leer de GLPI**: no está ahí.

La consecuencia para la API es que la estimación **entra por escritura**, con autor y fecha, y no se deduce en ningún punto del recorrido. El valor se normaliza a escala 4 —lo que la columna ya hace— y se compara con `compareTo(...) == 0`, nunca con `equals`. La razón está escrita en el javadoc y es la misma trampa que `JpaPlanSnapshotRepositoryTest` ya tenía documentada: `toPlainString()` da `8` para lo que llega en la petición y `8.0000` para lo que vuelve de la columna, así que reenviar el mismo valor produciría un **cambio fantasma** —una fila de historial y un sello nuevos por nada—. Hay una prueba que lo fija.

### 120. La fuente del compromiso: el gestor de demanda

**La define el gestor de demanda.** No el SLA, no el OLA, no el más restrictivo de los dos.

Es la respuesta a la segunda mitad del hallazgo de la Fase 12: `time_to_resolve` cubre 68 de 100 tickets e `internal_time_to_resolve` 89, juntas cubren el 100 %, y **se contradicen en 55 de 57**. Cuál manda no era una pregunta que la instancia pudiera contestar, porque las dos son fechas que GLPI calcula a partir de políticas de servicio —y una política de servicio es un techo, no una promesa—.

Que la promesa la haga una persona cambia dos cosas del modelo, y las dos están escritas:

**El compromiso puede no existir.** Es un estado legítimo y frecuente: hay trabajo estimado que todavía no se ha prometido. `committedDate` nulo no significa «sin fecha límite» ni «para ayer»: significa que nadie ha prometido nada, y el sistema lo representa en vez de rellenarlo.

**El compromiso puede haber pasado ya.** Se acepta, y se marca. Es la decisión 123.

### 121. La trazabilidad: qué se guarda en cada cambio

La trazabilidad no es un log. Es una tabla —`planning_metadata_history`— con una fila por **campo cambiado**, de solo inserción, con este contenido:

```
work_item_id    a qué elemento pertenece
field           ESTIMATED_HOURS o COMMITTED_DATE
previous_value  el valor anterior, como texto. Nulo significa «no existía»
new_value       el valor nuevo, como texto. Nulo significa «se retiró»
changed_by      quién lo hizo
changed_at      cuándo
```

Responde las dos preguntas del brief —quién cambió la estimación, cuándo, de qué a qué; y lo mismo para el compromiso— con la misma fila.

**Los valores viajan como texto, y `field` dice cómo leerlos.** Es una decisión deliberada: los dos campos tienen tipos distintos, y una columna numérica no puede guardar una fecha ni una columna de fecha puede guardar horas. El texto es el denominador común, y el `field` es lo que impide que se interprete mal. Se persiste el enum con `@Enumerated(EnumType.STRING)` como `AppliedRule`: un `ORDINAL` aquí sería una trampa silenciosa el día que se añada un tercer campo.

**Una fila por campo, no una por petición.** Un PUT que cambia horas y fecha a la vez escribe dos filas con el mismo `changedAt`. Es lo correcto: la historia de la estimación y la del compromiso son dos historias que se pueden leer por separado, y mezclarlas en una fila obligaría a deshacer la mezcla para responder «quién cambió la estimación».

**Se lee ordenado por `id`, no por `changed_at`.** El reloj es el mismo para toda la operación, así que dos filas consecutivas comparten instante y el orden solo puede venir del identificador generado. Es lo que hace `RescheduleEventJpaRepository` y por la misma razón. Hay una prueba que lo fija con dos filas de instante idéntico.

**La declaración inicial también entra al historial**, con `previousValue` nulo. Cuesta una fila y evita que el primer valor quede sin autor en cuanto alguien lo cambie: sin ella, el historial empezaría en el segundo valor y afirmaría que el primero nunca existió. Un POST que declara los dos valores escribe dos filas.

**El diff vive en el dominio.** `PlanningMetadata.changesFrom(anterior, changedBy, changedAt)` devuelve las entradas de lo que cambió, y por eso la regla de trazabilidad se puede probar sin levantar Spring.

**Un solo `changedBy` por petición**, obligatorio, que firma todas las filas de esa operación. `estimatedBy` y `committedBy` **no son campos de entrada**: son el autor del último cambio de ese campo, derivados. El diseño alternativo —pedir `estimatedBy` en el cuerpo— no era exigible, porque con un record y Jackson **no se puede distinguir «ausente» de `null`**: un borrado podía acabar sin autor, que es justo lo que la decisión de negocio prohíbe. Con `changedBy` la regla además se vuelve obvia: si no hubo cambio, no hay cambio que atribuir.

### 122. El borrado se permite y queda registrado

**Tanto la estimación como la fecha compromiso pueden dejar de existir legítimamente, y el sistema representa ese estado.** Se borran enviando `null` en el PUT.

El borrado **no toca el historial**. Se registra como una modificación trazable más, `anterior -> null`, con autor y fecha:

```json
{"field": "ESTIMATED_HOURS", "previousValue": "8.0000", "newValue": null,
 "changedBy": "dev-ana", "changedAt": "2026-10-06T15:00:00Z"}
```

Es la misma forma que cualquier otro cambio, y esa uniformidad es el punto: **el historial no tiene una operación especial para borrar**, porque un borrado no es un olvido, es una decisión. Quien lea la historia ve el valor que hubo, quién lo quitó y cuándo.

Y el autor **sobrevive al valor**: después de retirar la estimación, `estimatedBy` sigue diciendo quién la retiró y `estimatedAt` cuándo. Es lo que hace que el estado actual sea explicable sin leer el historial.

**Dos asimetrías que quedan escritas, porque son deliberadas:**

- El **POST exige al menos un valor**; el **PUT puede dejar los dos en nulo**. No es una incoherencia: crear un recurso que no declara nada sería crear un historial vacío, y eso el dominio lo rechaza. Vaciar un recurso que ya existe es una modificación legítima.
- El **GET de un metadata sin ningún valor responde 200 con nulos, no 404**. La fila existe, su historia existe, y el recurso está donde se dejó. Un 404 diría que nunca hubo nada, que es falso.

La segunda asimetría es la que hace que el caso límite «historial vacío» sea **inalcanzable por construcción**, y merece un párrafo. Con la declaración inicial escrita, un metadata existente nunca tiene historial vacío; la única forma de llegar a una lista vacía sería crear un elemento sin declarar nada, y el dominio lo rechaza. Así que «historial vacío» solo puede significar una cosa: **elemento sin metadata, que es el 404**. La alternativa —que el POST no escribiera fila— haría el caso alcanzable al precio de perder el autor de la declaración original en el primer cambio, y se descartó por eso. Hay una prueba que comprueba el rechazo en vez de darlo por supuesto: es la garantía que sostiene todo lo demás, porque un historial que puede estar vacío no puede afirmar que conserva la historia completa.

### 123. El compromiso vencido se acepta y se marca

Un compromiso anterior a hoy **no se rechaza**. Se acepta y se expone un derivado en la respuesta:

```
commitmentOverdue = committedDate != null && committedDate.isBefore(LocalDate.now(clock))
```

Un compromiso de **hoy no está vencido**; uno de ayer sí. Las dos fronteras tienen prueba.

**Por qué no se rechaza.** Rechazarlo obligaría a decidir qué hacer con lo que ya está vencido, y no hay una respuesta buena: la fecha ya se prometió, y esconderla no la deshace. Además convertiría el vencimiento en un problema de escritura cuando es un problema de lectura: el gestor necesita poder registrar la promesa que hay, incluso tarde, y el planificador necesita saber que esa promesa está incumplida. Lo segundo es el dato útil, y por eso viaja en la respuesta y no en una validación.

**`commitmentOverdue` es un valor derivado, no un campo guardado.** No se persiste porque no es un hecho: es una relación entre una fecha y el día en que se pregunta. Guardarlo lo volvería obsoleto al día siguiente.

**Se calcula con el mismo `Clock` que fecha todo lo demás**, el bean que `PlanningConfig` registra y que el motor y los servicios ya comparten. Eso hereda su suposición de zona horaria, que es el riesgo 47 y ahora también el 59. La alternativa —fijar `America/Bogota` solo aquí— se descartó: introducir una zona en un sitio mientras el motor, el mapeador y `PlanningContextSnapshot` fechan en UTC crearía **dos verdades temporales**, que es peor que una suposición documentada y compartida. Por eso las pruebas de endpoint usan compromisos del año 2000 y del 2099: el indicador se calcula con el reloj real, y una fecha cercana haría que la prueba cambiara de resultado con el paso del tiempo.

### 124. La costura por la que entrará la ACL

**No se implementa en esta fase.** Se documenta, porque es el entregable que el brief pide y porque deja escrito dónde está el trabajo que falta.

El punto de entrada es `GlpiPlanningRequestFactory`, que hoy construye el `PlanningRequest` a partir de los tickets ya traducidos. Los dos valores que lee hoy:

| Hoy lee | De dónde sale | Qué pasará |
|---|---|---|
| `Incident.estimatedHours` / `Requirement.estimatedHours` | `GlpiTicketMapper`, desde `actiontime` | Pasará a salir de `PlanningMetadata.estimatedHours` por `workItemId` |
| La fecha comprometida | `GlpiTicketMapper`, desde `time_to_resolve` | Pasará a salir de `PlanningMetadata.committedDate` por `workItemId` |

**El acoplamiento es directo y no hace falta traducción nueva:** `Incident.id` y `Requirement.id` ya son el identificador de GLPI como texto, así que la clave de búsqueda en `PlanningMetadata` es el identificador que el dominio ya lleva. No hay que introducir un concepto intermedio ni una tabla de correspondencia.

**Lo que cambiaría alrededor, y conviene decirlo:**

- **`GlpiTicketValidator` dejaría de descartar por esas dos causas** —hoy descarta los tickets con `actiontime` cero, que son el 99,4 %— y pasaría a descartar por la falta de los valores declarados, con los códigos de la regla de planificabilidad. El descarte no desaparece: cambia de motivo, y el motivo nuevo es más honesto («no hay estimación declarada» en vez de «el campo vale cero»).
- **La lectura sería una consulta por plan, no por ticket.** Un `findByWorkItemId` por cada ticket de la entrada es N+1 consultas evitables; la vía es un `findByWorkItemIdIn(Collection<String>)`. No se añadió ahora porque nadie lo llama todavía y sería construir para un caso que no existe.

#### 124.1 La regla de planificabilidad: hacen falta los dos valores

**El negocio la fijó, y no es la que esta fase había recomendado.** La recomendación era descartar solo los tickets **sin ninguna** metadata. La decisión es más estricta: **un ticket con metadata incompleta se descarta**, porque la planificación requiere **simultáneamente** `estimatedHours` y `committedDate`, y con uno solo el sistema no dispone de información suficiente para construir un compromiso planificable.

Los descartes siguen siendo **visibles y auditables**, con un motivo explícito por cada valor que falta:

| Código | Cuándo |
|---|---|
| `SIN_ESTIMACION_DECLARADA` | No hay `estimatedHours` declarado para el elemento de trabajo |
| `SIN_COMPROMISO_DECLARADO` | No hay `committedDate` declarado para el elemento de trabajo |

**Las tres prohibiciones que la acompañan, explícitas:** no se infiere ningún valor, no se genera un plan parcial, y no se rellena el hueco con lo que GLPI tenga a mano —ni `actiontime`, ni `time_to_resolve`, ni `internal_time_to_resolve`—. Es la parte que importa: sin ella, «descartar» sería un nombre para «seguir leyendo GLPI», que es exactamente lo que esta fase vino a terminar.

**Y una distinción que hay que sostener, porque es la que hace que el modelo y la regla no se contradigan.** La ausencia de metadata —total o parcial— es un **estado válido del negocio**, y por eso `PlanningMetadata` admite estimación sin compromiso y compromiso sin estimación (decisión 118) y el `PUT` puede dejar los dos en nulo (decisión 122). Pero **no es un estado planificable**. Que algo se pueda declarar a medias y no se pueda planificar a medias no es una incoherencia: son dos preguntas distintas —qué se puede representar y qué se puede planificar— y cada una tiene su respuesta. La consecuencia práctica es que **la regla no cambia el modelo de esta fase**: cambia quién entra al motor cuando la ACL se escriba.

La razón de fondo es la que la decisión 70 ya dio para los tickets intraducibles, y conviene repetirla porque es la que decide: **un plan que parece completo y no lo está es peor que un plan al que le faltan elementos visibles.** Si se inventara una cifra para el ticket sin estimación, el motor repartiría en la agenda un trabajo cuyo coste nadie declaró, y el resultado sería indistinguible de un plan bien alimentado. Descartarlo con su motivo deja el hueco a la vista y, además, convierte el hueco en una lista de trabajo pendiente: cada descarte es una declaración que falta y que alguien puede ir a hacer.

**Un caso que la integración tendrá que resolver al escribirse:** un ticket **sin ninguna fila** de metadata falta por partida doble y los dos códigos le aplican. `GlpiDiscardedItem` guarda hoy **un solo motivo**, así que la forma de representarlo —los dos códigos en la misma entrada, o una entrada por código— es una decisión de forma que se toma al escribir el cambio, no antes. Lo que no es negociable es que el descarte diga **todo** lo que falta: reportar solo la estimación ausente haría creer que el compromiso sí estaba declarado, que es justo el silencio que la lista de descartes existe para evitar.

**La última pregunta de esta costura —si lo declarado sustituye a lo registrado o lo complementa— se cierra en la 124.2.**

#### 124.2 La estimación y el compromiso declarados sustituyen a los de GLPI

**Es la última decisión funcional que quedaba abierta antes de integrar `PlanningMetadata` en la ACL**, y hay que cerrarla antes de escribir el cambio, porque decide qué lee el motor cuando las dos fuentes tengan valor a la vez. Se evaluaron dos modelos y solo dos, como pidió el brief: **MODELO A**, la metadata **complementa** a GLPI; **MODELO B**, la metadata **sustituye** a GLPI. La decisión es **B**, y el argumento que la decide no es de preferencia: **A, en cualquiera de sus tres formas, contradice la regla de planificabilidad de la 124.1.**

**Qué aporta GLPI hoy, exactamente.**

| Dato del motor | De dónde sale | Qué es en realidad | Qué se midió |
|---|---|---|---|
| `estimatedHours` de `Incident` y de `Requirement` | `GlpiTicket.actiontime` → `GlpiTicketMapper.estimatedHours` (segundos entre 3600, escala 4) | **Tiempo de acción registrado**, no una estimación: es lo que ya se trabajó sobre el ticket | **H2**: vale 0 en 994 de 1000. El validador descarta todo ticket con `actiontime` ausente o no positivo, así que el 99,4 % no llega al motor |
| `Requirement.plannedDate` | `GlpiTicket.timeToResolve` → `GlpiTicketMapper.plannedDate` (`time_to_resolve`, el SLA, reducido a su día) | El **techo de una política de servicio**: para cuándo *debería* estar resuelto, no para cuándo alguien se comprometió a resolverlo | **H3**: falta en 968 de 1000, y por esa regla se descartan 408 de las 428 peticiones de la muestra. En la ventana viva el SLA cubre 68 de 100 y el OLA (`internal_time_to_resolve`) 89; juntas el 100 %, y **se contradicen en 55 de 57** |
| Fecha compromiso de un `Incident` | **nada** | El incidente no tiene ese campo en el modelo de dominio: `GlpiTicketMapper.toIncident` construye con estado, horas y `reportedAt`. La fecha de GLPI de un incidente **no entra hoy al motor por ningún camino** | — |

De ahí salen dos consecuencias que no son opinión: **la estimación que el motor lee hoy no es una estimación**, y **la fecha que lee hoy es un techo de servicio, no una promesa**. Y una tercera, que es de forma y decide parte de lo que viene: **`Requirement` tiene un solo campo de fecha (`plannedDate`) e `Incident` ninguno**, así que el modelo de dominio que el motor consume **no tiene sitio donde guardar dos fechas a la vez**.

**Qué aporta `PlanningMetadata`.**

| Dato | Quién lo declara | Qué es | Qué trae además del valor |
|---|---|---|---|
| `estimatedHours` | El **desarrollador asignado** (decisión 119) | Una **estimación**: cuánto cree que cuesta, dicho antes de hacerlo | `estimatedBy`, `estimatedAt` y una fila de historial por cada cambio |
| `committedDate` | El **gestor de demanda** (decisión 120) | Una **promesa**: para cuándo se compromete la entrega | `committedBy`, `committedAt` y su historial |

La diferencia con GLPI no es de precisión: es de **naturaleza**. Lo de GLPI es el registro de lo que pasó o de lo que una política permite; lo declarado es un compromiso de personas, con nombre y con fecha. Un plan se construye con lo segundo, que es lo que la decisión 124 ya había fijado.

**Qué ocurriría si ambos convivieran.** «Complementar» no es un modelo: son tres, y conviene separarlos porque cada uno falla por su cuenta.

- **A1 — GLPI manda cuando tiene valor; la declarada solo rellena su ausencia.** Es el complemento literal. Para la estimación es el peor caso posible: `actiontime` **no está vacío cuando vale 0**, así que el relleno dispararía justo en los 6 tickets de la muestra con tiempo registrado —y ahí el plan se construiría con **el trabajo ya hecho** en vez de con lo prometido—. Para la fecha, el SLA ganaría en 32 de cada 100 tickets y la promesa del gestor se ignoraría en esos mismos 32.
- **A2 — la declarada manda cuando existe; GLPI rellena su ausencia.** Es B con red de seguridad, y la red es exactamente lo que la 124.1 prohíbe: **el hueco no se rellena, se descarta.** Si falta la estimación declarada, el ticket sale del plan con `SIN_ESTIMACION_DECLARADA`; no entra con `actiontime`.
- **A3 — se derivan de las dos** (el máximo, el mínimo, o lo declarado más lo ya dedicado). Es **inferencia**, prohibida de forma explícita por la 124.1, y produce un número que nadie declaró y que por tanto no tiene autor: no habría a quién preguntarle por qué el plan dice 14 horas.

**Las tres chocan con la 124.1**, y con eso el modelo A queda cerrado sin necesidad de sopesar ventajas: la regla de planificabilidad no deja sitio donde el complemento pueda vivir. Hay además un obstáculo técnico independiente, y es el que la tabla de arriba dejó a la vista: **A exige dos valores donde el dominio tiene uno o ninguno** —`Requirement.plannedDate` es único, `Incident` no tiene fecha—, así que implementarlo obligaría a cambiar el modelo que consume el motor, que es justo lo que el brief prohíbe.

**Comparación de los dos modelos.**

| Criterio | MODELO A — complementa | MODELO B — sustituye |
|---|---|---|
| Coherencia con la regla de planificabilidad (124.1) | **No.** Las tres formas rellenan el hueco con GLPI o lo derivan, y las dos cosas están prohibidas | **Sí.** Es la única forma en que «no se rellena el hueco» es cierto: no hay segunda fuente a la que recurrir |
| Coherencia con H1-H7 | **No.** H2 y H3 midieron que las dos fuentes de GLPI son un registro de tiempo y un techo de servicio; A las mantiene como entrada del plan | **Sí.** Deja de leer exactamente los dos campos que la medición declaró `INCOMPATIBLE` |
| Riesgo 56 — dos verdades sobre las horas | **Lo perpetúa.** Es su definición: dos columnas con el mismo nombre lógico y sin conciliación | **Lo cierra.** Una sola fuente por campo, y la de GLPI deja de leerse para planificar |
| Riesgo 60 — la ACL no tendrá qué planificar hasta que se declare metadata | **Lo enmascara.** La agenda no sale vacía, pero se llena con lo que nadie declaró: el riesgo desaparece de la vista sin desaparecer del dato | **Lo deja a la vista**, que es lo que la 124.1 eligió: la agenda vacía viene acompañada de la lista de descartes, que es la lista de declaraciones pendientes |
| Trazabilidad | **Ambigua.** El plan guarda un número y no dice de cuál de las dos fuentes salió | **Una sola fuente por campo**, con autor y fecha en el historial |
| Cambio en el modelo del dominio | **Exige campos nuevos** en `Incident` y `Requirement`, y por tanto tocar el modelo del motor | **Ninguno.** `committedDate` entra donde ya entra `plannedDate` |
| Qué pasa con el ticket sin declarar | Se planifica con lo que haya | Se descarta con motivo explícito y auditable |

**La decisión: MODELO B, lo declarado sustituye a lo registrado.** Cuando la ACL se escriba, la estimación y la fecha compromiso del plan saldrán **solo** de `PlanningMetadata`, y `actiontime` y `time_to_resolve` dejarán de ser entradas del motor. Es coherente con la 124 —la declarada es la promesa, y el plan se construye con la promesa—, con la 124.1 —que solo es verificable si no existe una segunda fuente a la que recurrir—, con la 126 y con la medición de las fases 11 y 12, y es la mitigación que el riesgo 56 ya tenía escrita para sí mismo.

**«Sustituir» no significa «borrar».** GLPI sigue siendo la fuente del trabajo, y lo sigue siendo entera: identificador, título, estado, severidad, fecha de reporte y asignado. Lo que deja de leerse son **dos campos y solo dos**, y solo para planificar. No se escribe nada hacia GLPI, no se borra nada de GLPI, y las traducciones no se tiran: `GlpiTicketMapper.estimatedHours` y `plannedDate` dejan de alimentar la petición del dominio, y si además se retiran del mapeador es una decisión de la fase de la ACL, no de esta.

**Tres cosas que la decisión arrastra, y que hay que dejar escritas.**

- **Una fecha de negocio deja de llegar al plan.** `time_to_resolve` es un dato real —el techo del SLA— y con B no entra a la agenda. Es el precio de tener una sola fecha comprometida, y es el precio correcto: la alternativa era elegir entre dos fechas que se contradicen en 55 de 57 casos (riesgo 61). Si el negocio quiere el SLA a la vista, es **otro dato y otra decisión**, y no debe colarse por la puerta de atrás de la planificación.
- **Un valor exigido que el motor no consume.** `Incident` no tiene campo de fecha compromiso, así que con B el `committedDate` de un incidente es una **puerta** —planificable o descartado— y no una entrada del cálculo. Es coherente: la regla de la 124.1 es del negocio, no del motor. Pero tiene una consecuencia que conviene no descubrir en producción: **un incidente puede quedar descartado por faltarle un valor que no habría cambiado su plan.** Se acepta, y el descarte es la prueba de que la regla se aplicó.
- **La procedencia del plan hay que subirla.** `GlpiPlanningService` sella el plan con `InputProvenance.glpi(..., GlpiRestPlanningSource.VERSION)`, y esa versión vale hoy `glpi-rest-1`. Con B, dos de las entradas del plan ya no vienen de GLPI, así que un plan sellado como `glpi-rest-1` describiría mal su propia procedencia. La vía es la que el javadoc de la constante ya prevé —subir la versión cuando cambia una traducción—: la ACL debe sellar la versión siguiente, para que un plan viejo se pueda releer sabiendo de dónde salieron sus horas.

### 125. Preparación para la Timeline

El brief pide que la fase quede preparada para la Timeline. Lo está, y no por haber añadido nada para ella: **por la forma del historial**.

Una línea de tiempo de la planificación necesita exactamente cuatro cosas por evento: **qué** elemento, **qué campo**, **de qué valor a qué valor** y **quién y cuándo**. `planning_metadata_history` guarda las cuatro, una fila por evento, y las guarda como **hechos ocurridos** —de solo inserción, sin reescritura— que es la única forma en que una línea de tiempo no miente. No hace falta un modelo nuevo: hace falta leer esta tabla.

Y hay un segundo ingrediente que ya existe: **`commitmentOverdue` es el primer indicador derivado** del modelo. Un compromiso prometido y no cumplido es un evento que una timeline querrá pintar, y hoy se puede calcular sin guardar nada.

Lo que **no** está y habría que añadir cuando llegue el momento: la Timeline necesitará leer el historial **de muchos elementos a la vez** —por desarrollador, por rango de fechas— y hoy el único acceso es por `workItemId`. Es el riesgo 58.

### 126. Decisión final

**El modelo queda construido y validado. La integración queda pendiente, y es la decisión correcta.**

Los ocho criterios de aceptación del brief se cumplen: existe el modelo, existe el historial, las estimaciones y las fechas compromiso son trazables con autor y fecha, `PlanningEngine` no cambió una línea, `integration/glpi/` tampoco, las 195 pruebas pasan, y la costura para la Timeline y para la sincronización futura está documentada en las decisiones 124 y 125.

Lo que esta fase **no** hace, y conviene que quede escrito para que nadie lo dé por hecho:

- **No conecta la metadata al motor.** El sistema puede hoy declarar que un ticket cuesta 8 horas y se promete para el 20 de octubre, y el planificador seguirá leyendo `actiontime` —que vale cero— y `time_to_resolve`. Es el riesgo 56, y es deliberado: el brief prohíbe tocar la integración en esta fase. **Lo que sí queda fijado es la puerta de entrada:** cuando la ACL se escriba, solo será planificable el ticket que tenga **los dos valores declarados**, y el que no los tenga saldrá del plan con su motivo explícito (decisión 124.1).
- **No sincroniza con GLPI.** No hay trabajos programados, ni colas, ni escritura hacia GLPI. La metadata entra por HTTP y por ningún otro sitio. El `source` existe y hoy solo puede valer `HTTP`; `GLPI` queda declarado para cuando la ACL la rellene.
- **No comprueba que el elemento de trabajo exista.** Es el riesgo 55.

**Lo que sí cambia, y es lo que hacía falta.** El sistema tiene por primera vez un sitio donde el negocio **promete**. La Fase 12 dejó al descubierto que no lo tenía y que no podía deducirlo de GLPI; esta fase no arregla la planificación, pero le da el dato que le faltaba para poder arreglarla. El orden que la decisión 116 fijó sigue siendo el correcto —primero la respuesta de negocio, después el cambio en el adaptador— y esta fase **es** esa respuesta de negocio, escrita en un modelo en vez de en un documento.

## Riesgos identificados

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 55 | **La metadata no está atada a ningún elemento de trabajo real** — no hay clave foránea, ni comprobación contra GLPI, ni siquiera una tabla de tickets que referenciar | Bajo mientras nadie la consuma; **medio en cuanto la ACL la lea**, porque un plan puede quedar construido sobre la estimación de un ticket que no existe o que ya se cerró | Es una consecuencia directa de la decisión 66 —este sistema no copia tickets como valor vivo— y del mandato del brief de no tocar la integración. La vía, cuando la ACL la consuma, es que la ausencia de metadata **descarte** el ticket con motivo explícito (decisión 124): así un elemento inexistente no aporta una estimación, aporta un descarte visible. No se hizo ahora porque comprobarlo exigiría una llamada a GLPI por escritura |
| 56 | **Dos verdades sobre las horas** — `Incident.estimatedHours` viene de `actiontime` en GLPI y `PlanningMetadata.estimatedHours` lo declara el negocio. No se concilian y el motor lee la primera | **Medio y creciente.** Hoy el motor sigue leyendo cero; en cuanto la ACL integre, leerá la declarada. Entre una cosa y la otra, un valor declarado y un plan calculado pueden discrepar sin que nada lo señale | Se acepta por mandato del brief —«NO modificar integración GLPI todavía»— y está documentada en la decisión 117 y en la 124. La vía es la propia integración: cuando `GlpiPlanningRequestFactory` lea la metadata, la segunda verdad desaparece porque la primera deja de leerse. La **decisión 124.2** —que la declarada **sustituya** a la registrada— es lo que cierra el riesgo, y ya no es una recomendación |
| 57 | **`estimatedBy` y `committedBy` son texto libre, no identidades verificadas** — el modelo guarda «dev-ana» y no comprueba que exista, ni contra el padrón de GLPI ni contra ningún directorio propio | Bajo para la trazabilidad —la historia dice quién **dijo** que lo hizo— y medio para cualquier uso futuro que quiera atribuir carga por persona: dos cadenas distintas pueden ser la misma persona, y una cadena puede no ser nadie | Se acepta: el brief pide trazabilidad, no autenticación, y verificar la identidad exigiría resolverla contra el padrón de GLPI —que la Fase 12 midió truncado al 1,2 % (limitación 3, decisión 114)—. La vía, cuando haya autenticación en la API, es que `changedBy` salga del principal autenticado en vez del cuerpo; hoy no hay principal que sacar. Está escrito en el javadoc del DTO |
| 58 | **El historial crece sin retención, sin paginación y sin acceso más que por elemento** — `planning_metadata_history` es de solo inserción y el único índice es `work_item_id` | Bajo hoy —el volumen es el de los cambios declarados, no el de los tickets— y **medio para la Timeline**, que necesitará leer por desarrollador y por rango de fechas, no por elemento | Se acepta porque el brief pide conservar la historia completa y prohíbe construir la Timeline. La vía, cuando llegue: un índice por `changed_at` y por `changed_by`, y paginación en el endpoint de historial. El acceso por muchos elementos a la vez es exactamente lo que la decisión 125 identifica como lo que falta |
| 59 | **`commitmentOverdue` hereda la suposición de zona horaria del resto del modelo temporal** — se calcula con el `Clock` del sistema, que es UTC, mientras el negocio opera en hora de Colombia (UTC-5) | Bajo pero real, y **asimétrico**: un compromiso que vence hoy puede aparecer como no vencido durante las cinco horas finales del día colombiano, o —al revés— aparecer vencido antes de que el día haya terminado aquí | Es el riesgo 47 con una cara nueva, y se enlaza con él en vez de abrir una decisión aparte. No se fijó `America/Bogota` a propósito: introducir una zona en un solo punto mientras el motor, el mapeador y `PlanningContextSnapshot` fechan en UTC crearía dos verdades temporales, que es peor que una suposición compartida y documentada. La vía es la del riesgo 47 —decidir la zona de negocio **de una vez** y aplicarla en todo el modelo temporal—, y esta fase no la adelanta |
| 60 | **Con la regla de planificabilidad, la ACL no tendrá nada que planificar hasta que el negocio declare metadata** — se exige estimación y compromiso **a la vez**, y ninguna de las dos vive en GLPI ni se puede inferir | **Alto en el momento de escribir la ACL**, y no es un defecto del código: es el estado real del dato. El adaptador pasaría de devolver una agenda vacía porque lee un campo que no existe (H1) a devolverla por una lista de descartes —lo cual es una mejora, porque ahora se ve por qué— pero seguiría siendo una agenda vacía | Es la consecuencia buscada y no un efecto colateral: la decisión 124.1 prefiere un plan incompleto y visible a uno completo y falso. La mitigación es de proceso, no de código —hay que declarar la metadata de los tickets en vuelo **antes** de conectar la ACL, y la propia lista de descartes es la lista de trabajo pendiente—. Conviene medirlo antes de dar la integración por buena: contar los descartes por código y comprobar que bajan |
| 61 | **El techo del SLA deja de llegar a la planificación** — con la decisión 124.2, `time_to_resolve` deja de ser entrada del motor, y es un dato real que el negocio usa para medir el servicio | Bajo para el plan —la fecha compromiso declarada lo reemplaza con una promesa, que es lo que el plan necesita— y **medio para la operación**, si alguien esperaba ver el SLA en la agenda | Es el precio de tener una sola fecha comprometida, y se paga a conciencia: la alternativa era elegir entre dos fechas que se contradicen en 55 de 57 (Fase 12). La vía, si el negocio quiere el SLA a la vista, es **otro dato y otra decisión** —leerlo y mostrarlo donde no compita con el compromiso, nunca como sustituto suyo—. No se hizo ahora porque nadie lo ha pedido, y porque hacerlo entrar por la puerta de atrás de la planificación es exactamente lo que la 124.1 prohíbe |

---

# Fase 14 — La ACL lee la planificación declarada

## Qué se hizo, en una frase

`GlpiPlanningRequestFactory` construye la `PlanningRequest` con `PlanningMetadata.estimatedHours` y `PlanningMetadata.committedDate`, buscadas por `workItemId` **en una sola consulta**. `actiontime`, `time_to_resolve` e `internal_time_to_resolve` dejan de participar en la planificación. Un ticket al que le falte cualquiera de los dos valores declarados se descarta con su motivo; si le faltan los dos, se informan los dos.

**Lo que no se tocó, y se acredita con fechas de modificación:** `PlanningEngine`, `domain/rules/**`, el frontend y la persistencia existente de planes. Es la mitad del brief, y es la mitad que se cumple por omisión: la fase entera vive en `integration/glpi/` más el puerto de lectura que hacía falta.

**Archivos.**

| Archivo | Qué cambió |
|---|---|
| `integration/glpi/GlpiDiscardReason.java` | **Nuevo.** El vocabulario de descartes |
| `integration/glpi/GlpiPlanningRequestFactory.java` | Lee el puerto, decide la planificabilidad, arma los descartes |
| `integration/glpi/GlpiTicketValidator.java` | `rejection` + `missingDeclaration`; se retiran los dos chequeos de GLPI |
| `integration/glpi/GlpiTicketMapper.java` | `toIncident`/`toRequirement` reciben lo declarado; las dos traducciones de GLPI se conservan |
| `integration/glpi/GlpiDiscardedItem.java` | Gana `code`, y el `of(...)` que resuelve el identificador |
| `integration/glpi/GlpiRestPlanningSource.java` | `VERSION` → `glpi-rest-2` |
| `integration/glpi/GlpiContract.java` | Javadoc: la obligatoriedad de `time_to_resolve` ya no existe |
| `domain/repository/PlanningMetadataRepository.java` | `findByWorkItemIdIn` |
| `persistence/PlanningMetadataJpaRepository.java`, `persistence/JpaPlanningMetadataRepository.java` | La consulta derivada y su adaptador |
| `service/GlpiPlanningService.java` | Los descartes llevan código; los dos `log` dicen «descartes», no «tickets» |
| `dto/PlanningFromGlpiResponse.java` | `DiscardedView` gana `code` |

## El corte

### 127. La ACL deja de leer las horas y la fecha de GLPI

Es la fase que la decisión 124 dejó documentada y la 124.2 dejó decidida. Lo que sigue no es una decisión nueva sobre el modelo: es **la aplicación de las dos**, y lo único que se decide aquí es de forma —cómo se descarta—, que es lo que el brief delegó.

#### 127.1 La 124.1 aplicada: se exigen los dos valores, sin excepción de tipo

`GlpiTicketValidator.missingDeclaration(ticket, metadata)` devuelve la lista de lo que falta, y puede traer **cero, una o dos** entradas. Un elemento sin fila de metadata se trata igual que una fila con los dos valores en nulo: faltan los dos.

**La regla es uniforme, y no distingue incidencias de peticiones.** Es la consecuencia que la 124.2 ya había dejado escrita como precio —«un valor exigido que el motor no consume»— y aquí se confirma: `Incident` no tiene campo de fecha compromiso, así que el `committedDate` de un incidente es una **puerta** y no una entrada del cálculo. **Un incidente puede quedar descartado por faltarle un valor que no habría cambiado su plan.** Se acepta por la misma razón que entonces: la regla es del negocio, no del motor, y el descarte es la prueba de que se aplicó. Lo que se gana es que la lista de descartes es la lista de declaraciones pendientes, sin casos especiales que recordar.

#### 127.2 La 124.2 aplicada: sustituir, no borrar

`GlpiTicketMapper.toIncident(ticket, estimatedHours)` y `toRequirement(ticket, estimatedHours, committedDate)` reciben los valores declarados **como parámetro**. No hay ningún camino por el que la petición del dominio lea `actiontime` ni `time_to_resolve`: la regla se cumple por construcción, no por disciplina.

**Las dos traducciones de GLPI se conservan**, por decisión explícita: *diagnóstico sí, planificación no*. `GlpiTicketMapper.estimatedHours(ticket)` y `plannedDate(ticket)` siguen existiendo, siguen traduciendo y **nadie las llama desde el camino de la planificación**. Sirven para una sola cosa: contrastar lo que GLPI registra con lo que el negocio declaró, que es como se mide la calidad del dato durante la transición. Las dos llevan en su javadoc la advertencia de que ya no alimentan la petición, para que nadie las borre por parecer muertas ni las reconecte por parecer útiles.

**`internal_time_to_resolve` nunca participó.** Conviene decirlo porque el brief lo nombra: el mapeador no lo lee en ninguna versión, así que su exclusión no es un cambio de esta fase sino un hecho que ya se cumplía. Lo que la Fase 12 midió —que el OLA y el SLA se contradicen en 55 de 57 casos— es la razón por la que se dejó fuera, y esta fase no la revisa.

**Las tres sustituciones están probadas, no afirmadas:**

| Prueba | Qué demuestra |
|---|---|
| `actiontime` de 10 h con 4 declaradas → entra con **4** | Las horas del plan no salen de GLPI |
| `time_to_resolve` en diciembre con compromiso en octubre → entra **octubre** | La fecha del plan no sale de GLPI |
| `actiontime` nulo con la declaración completa → **planifica igual** | No es una segunda fuente que convive: es la única |

La tercera es la que cierra el argumento por el otro lado. Antes de esta fase un `actiontime` ausente descartaba el ticket y con él se perdía el trabajo entero; ahora el hueco de GLPI deja de tener consecuencias. Si el corte fuera cosmético —una lectura nueva que no desplazó a la vieja— esa prueba fallaría.

#### 127.3 Cómo se descarta: dos causas explícitas, y no una

El brief delegó la elección entre **OPCIÓN A** —un único descarte `METADATA_INCOMPLETA` con el detalle de los campos ausentes— y **OPCIÓN B** —varias causas explícitas—, y pidió justificarla. **Se eligió B.**

1. **A inventa un tercer código que el negocio no acordó.** Los dos acordados —`SIN_ESTIMACION_DECLARADA` y `SIN_COMPROMISO_DECLARADO`— no son sinónimos de «incompleta»: cada uno nombra **a una persona distinta** que tiene que actuar. La estimación la debe el desarrollador asignado (decisión 119) y el compromiso el gestor de demanda (decisión 120). Un código combinado borra justo el dato que hace útil el descarte: a quién hay que ir a pedirle qué.
2. **B es lo que hace medible el riesgo 60.** Su mitigación escrita es *contar los descartes por código* y comprobar que bajan. Con A esa cuenta no se puede hacer, y la única pregunta que la transición necesita contestar —«¿van los desarrolladores o los gestores por detrás?»— queda sin respuesta.
3. **B no pierde nada.** «Prohibido perder información» se cumple emitiendo las dos entradas, no resumiéndolas en una.

**El vocabulario completo** — `integration/glpi/GlpiDiscardReason`:

| Código | Cuándo | `reason` |
|---|---|---|
| `SIN_IDENTIFICADOR_TICKET` | `id == null` | «sin identificador de ticket» |
| `TIPO_DESCONOCIDO` | `type` fuera del contrato | «tipo de ticket desconocido: X (…)» |
| `ESTADO_DESCONOCIDO` | `status` fuera de la tabla | «estado de incidencia/petición desconocido: X» |
| `FECHA_CREACION_ILEGIBLE` | `date` no parsea | «fecha de creación ausente o ilegible: 'X'» |
| `SIN_ESTIMACION_DECLARADA` | sin fila, o `estimatedHours == null` | «no hay planificación declarada…» / «…no tiene estimación» |
| `SIN_COMPROMISO_DECLARADO` | sin fila, o `committedDate == null` | «no hay planificación declarada…» / «…no tiene fecha compromiso» |
| `TRADUCCION_FALLIDA` | el mapeador devuelve vacío | «no se pudo traducir la incidencia/petición al dominio» |

**Las dos causas que desaparecen** —«sin horas estimadas: `actiontime`…» y «fecha comprometida ausente o ilegible»— se van con su causa. No es una expectativa relajada: es una regla que dejó de existir. Sus pruebas se retiraron y en su lugar quedaron dos que afirman lo contrario —un `actiontime` ausente ya no descarta, un `time_to_resolve` ilegible tampoco—, porque la afirmación que hay que sostener ahora es la opuesta.

**El motivo son dos campos y no uno.** `GlpiDiscardedItem` pasó a `(ticketId, code, reason)`: el `code` es el que se cuenta y el que no cambia aunque alguien reescriba el texto; el `reason` es el que se lee y el que nombra el campo concreto que hay que corregir. Las tres cosas que el brief exige —visibilidad, auditoría y códigos contables— no caben en un campo, y juntarlas en una cadena dejaría el descarte sin poder contarse. Es el mismo reparto que `PlanningMetadataChange` ya hace con `field` y sus valores.

**El texto distingue los dos casos que el código junta.** «No hay planificación declarada» y «la planificación declarada no tiene estimación» son la misma acción —declarar la estimación— pero no el mismo diagnóstico: lo primero dice que nadie ha empezado, lo segundo que alguien empezó y retiró el valor. El código es el mismo porque la acción es la misma; el texto es distinto porque quien opera necesita saber cuál de las dos es.

**El precio, y cómo se paga.** Un ticket sin fila de metadata produce **dos** entradas con el mismo `ticketId`. `discarded.size()` deja de ser «tickets descartados» y pasa a ser «causas», así que los dos registros que decían «{} descartados» pasan a decir «{} descartes sobre {} tickets». Queda como riesgo 62.

#### 127.4 La versión del adaptador, y por qué no se añadió procedencia

`GlpiRestPlanningSource.VERSION` pasa de `glpi-rest-1` a **`glpi-rest-2`**. La constante se define a sí misma —*«se sube cuando cambia una traducción»*— y cambió: la entrada al motor se construye con dos valores que ya no salen de GLPI. Un plan de antes y uno de después tienen las horas en sitios distintos —`actiontime` el uno, `PlanningMetadata` el otro— y **los dos se leen igual si no se distinguen**. La versión es justo lo que permite distinguirlos, y es la respuesta a la pregunta del brief sobre la trazabilidad.

**No se añadió ningún campo a `InputProvenance` ni a `planning_input`**, por dos razones. La primera es que el brief prohíbe tocar la persistencia existente de planes. La segunda es que no hace falta, y esto importa más: **el origen de lo declarado ya está trazado, y mejor que lo estaría una etiqueta.** `planning_metadata_history` guarda quién declaró cada valor y cuándo, y se une a la foto por el mismo `workItemId` que ya viaja en `Incident.id` y `Requirement.id`. Los tres registros se cruzan por la misma clave:

| Registro | Qué responde |
|---|---|
| `planning_input` | **Qué** entró al motor |
| `InputProvenance` | **De dónde** vinieron los tickets, y con qué traducción |
| `planning_metadata_history` | **Quién** puso las horas y la fecha, y cuándo |

Añadir un campo habría duplicado en la foto lo que el historial ya dice con más detalle —un campo no puede llevar autor ni fecha por valor— y habría obligado a tocar la persistencia de planes, que es lo que el brief prohíbe.

#### 127.5 Lo que la fase deja deliberadamente fuera

Conservar `estimatedHours` y `plannedDate` en el mapeador deja disponible el contraste entre lo declarado y lo registrado —«este ticket dice 0 en GLPI y 8 declaradas»—, pero **esta fase no lo expone en ningún sitio**. El brief acota el alcance a `GLPI → ACL → PlanningRequest`, y una superficie de comparación no es eso. Si el negocio lo quiere ver, es una línea en el detalle del descarte o un endpoint de diagnóstico, y se añade cuando se pida.

## Riesgos identificados

Se listan los que esta fase toca. Los demás siguen como estaban en la Fase 13.

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 55 | **La metadata no está atada a ningún elemento de trabajo real** | **Pasa a ser real.** La Fase 13 lo dejó en «medio en cuanto la ACL la lea», y la ACL la lee desde ahora | **Mitigado en el sentido que importa, y abierto en el otro.** La metadata se busca **por el identificador del ticket**, así que una fila que no corresponde a ningún ticket es inerte: no hay ningún camino por el que planifique algo por error, que era el daño temible. Queda abierto el otro sentido —una fila huérfana no se detecta sola— y es aceptable: como mucho ocupa sitio. La vía, si molesta, es un informe de filas sin ticket vivo, y exige llamar a GLPI por escritura |
| 56 | **Dos verdades sobre las horas** | **Cerrado.** Era su definición: `actiontime` por un lado y `PlanningMetadata.estimatedHours` por otro, sin conciliación y con el motor leyendo la primera. La primera deja de leerse para planificar | La decisión 124.2 lo cerró por decisión y esta fase lo cierra por código. Queda una verdad por campo, con autor y fecha. Lo que sobrevive es la **discrepancia**, que ya no es un riesgo sino un dato de diagnóstico: `GlpiTicketMapper.estimatedHours` sigue traduciendo `actiontime` para poder medirla |
| 60 | **La ACL no tiene qué planificar hasta que el negocio declare metadata** | **Cerrado como riesgo de código, abierto como estado del dato.** El adaptador ya no devuelve una agenda vacía porque lea un campo que no existe: devuelve una agenda vacía **con la lista de lo que falta** | Es exactamente el resultado que la 124.1 buscaba: un plan incompleto y visible en vez de uno completo y falso. La mitigación es la que ya estaba escrita y ahora es ejecutable —**contar los descartes por código**—: `SIN_ESTIMACION_DECLARADA` alto significa que los desarrolladores van por detrás, `SIN_COMPROMISO_DECLARADO` alto que van los gestores. Dos números que dicen a quién hay que ir |
| 61 | **El techo del SLA deja de llegar a la planificación** | **Pasa de latente a real**, y con la forma exacta que la 124.2 anticipó | Se paga a conciencia y por la razón que ya estaba escrita: la alternativa era elegir entre dos fechas que se contradicen en 55 de 57 casos. `GlpiTicketMapper.plannedDate` sigue traduciendo `time_to_resolve` para poder contrastarlo. La vía, si el negocio quiere el SLA a la vista, sigue siendo otro dato y otra decisión |
| 62 | **Un descarte ya no es un ticket** — un elemento sin planificación declarada produce dos entradas con el mismo `ticketId` | Bajo, y es de lectura: quien cuente `discarded.length()` y lo llame «tickets descartados» se equivocará justo en el caso que más importa —el del elemento sin declarar nada—, que es el que hay que vigilar durante la transición | Se nombra en los tres sitios donde se cuenta: el `log` de la traducción dice «{} descartes sobre {} tickets» y lleva los dos números, el `log` del caso de uso dice «descartes», y el javadoc de `DiscardedView` explica que contar la lista da causas y contar identificadores distintos da tickets. El detalle de a cuántos tickets corresponden queda en el registro de la traducción, que sí lo calcula |

---

# Fase 15 — El contrato de lectura para la Timeline

## Qué se hizo, en una frase

`GET /api/planning/{planId}/timeline` devuelve la agenda de un plan guardado **ya proyectada para pintarla**: cada tramo con sus horas, su tipo, su severidad y su fecha compromiso; la capacidad del desarrollador día a día —cuánto cabe, cuánto está ocupado y cuánto queda—; y las referencias para volver al origen. Todo sale de lo que ya estaba escrito —los `WorkBlock` y `WorkAllocation` del plan, la foto de su entrada y el contexto congelado con el que se decidió— y **nada se recalcula**: el motor no se ejecuta en ningún punto de la lectura.

La agenda persistida ya existía entera. Lo que faltaba era una lectura pensada para consumirla: `/{planId}` da el plan completo y `/{planId}/blocks` da los tramos, pero responder «qué ocupa esta franja y cuánto queda libre ese día» exigía tres llamadas y una aritmética de calendario en el navegador. Esta fase entrega esa lectura, y solo eso.

**Lo que no se tocó, y se acredita con fechas de modificación:** `PlanningEngine`, `domain/rules/**`, la integración con GLPI (`integration/glpi/**`, `client/**`), el frontend y la persistencia existente de planes. Es la mitad del brief, y se cumple **sin matices**: la fase no añade ninguna tabla, ninguna entidad, ningún repositorio y **ningún método al puerto `PlanSnapshotRepository`**, porque las tres lecturas que necesita ya existían y el puerto ya tenía el método que un timeline pide —`findBlocks`, cuyo javadoc dice literalmente *«Es la consulta que hace un timeline»*—.

**Archivos.**

| Archivo | Qué cambió |
|---|---|
| `dto/TimelinePlanResponse.java` | **Nuevo.** El contrato entero: `TimelineItem`, `TimelineResource`, `TimelineCapacity` |
| `domain/enums/TimelineItemStatus.java` | **Nuevo.** `PLANIFICADO` / `DESPLAZADO`, y los candidatos rechazados |
| `service/PlanningService.java` | `timeline(UUID)` y los ayudantes privados de proyección |
| `controller/PlanningController.java` | El endpoint, y el javadoc de la clase, que contaba seis endpoints y ahora cuenta ocho |
| `controller/PlanningTimelineEndpointsTest.java` | **Nuevo.** Once casos; ningún archivo de prueba anterior se modificó |

Las 217 pruebas que había pasan **sin que cambie una sola expectativa**, y las once nuevas son todas de archivo nuevo. Es la forma más fuerte de cumplir «mantener todas las pruebas actuales»: no hay una expectativa anterior que se haya tenido que relajar.

## El contrato

### 128. El contrato de la Timeline: una proyección de lectura

La decisión central de la fase es **de qué se lee**, y la respuesta es: de lo persistido, y de nada más.

| Lectura del puerto | Qué aporta al timeline |
|---|---|
| `findById(planId)` | Los bloques, las asignaciones y los eventos de auditoría, en una sola llamada |
| `findInput(planId)` | Las horas estimadas, la fecha compromiso y la severidad — **la foto, no la metadata viva** |
| `findContext(planId)` | El calendario congelado, sin el cual la capacidad no se puede medir |

Las tres se traducen a `PlanNotFoundException` igual que ya hacían `context()` e `input()`. Que las tres lecturas devuelvan vacío tanto si el plan no existe como si le falta el contexto o la entrada es deliberado: hoy no puede ocurrir —`plan()` escribe las tres cosas en la misma transacción— y tratarlo como un plan inexistente es preferible a devolver una capacidad medida con un calendario que no es el suyo.

#### 128.1 Los tipos, y por qué cada uno tiene la forma que tiene

```java
public record TimelinePlanResponse(
        UUID planId, String developerId, LocalDate from, LocalDate to,
        List<TimelineResource> resources, List<TimelineItem> items,
        List<PlanningSimulationResponse.Allocation> allocations)
```

**`allocations` reutiliza el tipo que ya existe** en vez de declarar uno propio, siguiendo la regla que `PlanSnapshotResponse` dejó escrita: *«son la misma forma, y dos declaraciones de la misma forma acaban divergiendo»*. Es la respuesta literal a «conservar la `workAllocation` asociada» **sin duplicarla por tramo**: una lista, unida por `workItemId`. Un requerimiento de cuatro horas que ocupa dos días tiene **una** asignación y **dos** tramos, y confundir las dos cosas haría que el total se contara dos veces.

`TimelineItem` lleva los diez campos que el brief pidió, más uno:

| Campo | De dónde sale |
|---|---|
| `workItemId` | `WorkBlock.workItemId` |
| `workItemType` | `WorkBlock.workItemType` — `INCIDENTE` / `REQUERIMIENTO` |
| `startsAt` / `endsAt` | `WorkBlock.start` / `.end`, en hora local, igual que el bloque |
| `durationHours` | `WorkBlock.hours` — lo que consume **este tramo**, no el total del elemento |
| `developerId` | `WorkBlock.developerId` |
| `estimatedHours` | La foto de la entrada: `Incident.estimatedHours` o `Requirement.estimatedHours` |
| `committedDate` | `Requirement.plannedDate` de la foto. **Nulo en incidentes** (128.3) |
| `severity` | `Incident.severity` de la foto. Nulo en requerimientos |
| `planningStatus` | Derivado de los `RescheduleEvent` del plan (131) |
| `sourcePlanId` | El `planId` pedido |
| `allocation` | **No viaja en el item**: es la lista `allocations` de la respuesta |

**`severity` no estaba en la lista del brief y se añadió igual.** El brief la pide en su sección de agrupaciones —«severidad, si existe persistida»— y está persistida: en `planning_input_incident`. Sin ella, agrupar por severidad exigiría una llamada más, que es exactamente lo que el brief prohíbe. Es la misma razón por la que viaja `workItemType`: la agrupación se prepara **poniendo el atributo en la respuesta**, no multiplicando endpoints.

#### 128.2 La trazabilidad: `workBlockId` «o equivalente»

El brief pedía conservar «`workBlockId` o equivalente». **`WorkBlock` no tiene identificador propio, y no es un olvido:** su javadoc lo dice —*«va sin identificador propio porque no es una entidad… se reconoce por `workItemId` más `start`»*—. El equivalente es, por tanto, la pareja **`workItemId` + `startsAt`**, que es única dentro de un plan y es exactamente la clave con la que el propio dominio reconoce un bloque.

Con esa pareja, `sourcePlanId` y la lista de `allocations`, cada tramo llega hasta su origen sin duplicar nada:

| Pregunta | Se responde con |
|---|---|
| ¿A qué plan pertenece? | `sourcePlanId` |
| ¿Qué elemento de trabajo es? | `workItemId` + `workItemType` |
| ¿Cuál de sus tramos? | `startsAt` |
| ¿Qué se pactó para él? | La entrada de `allocations` con ese `workItemId` |
| ¿Qué entró al motor? | `GET /{planId}/input`, por el mismo `workItemId` |
| ¿Con qué reglas? | `GET /{planId}/context` |

**No se copian eventos ni snapshots completos.** Los `RescheduleEvent` se consumen para calcular el estado y no se reemiten: quien los quiera leer enteros tiene `/{planId}`, y duplicarlos aquí sería afirmar que el timeline es la fuente de la auditoría, que no lo es.

#### 128.3 Los dos nulos que son la respuesta correcta

`committedDate` sale **nulo en todo incidente**, y `severity` nulo en todo requerimiento. Ninguno de los dos es un hueco por rellenar:

- **El compromiso de un incidente no está en la foto porque no es una entrada del cálculo.** La decisión 124.2 ya lo dejó escrito: en un incidente el compromiso fue una **puerta de planificabilidad** —un valor exigido que el motor no consume— y `Incident` no tiene el campo. Rellenarlo desde `PlanningMetadata` viva rompería la reproducibilidad y haría que el mismo plan se leyera distinto mañana.
- **La severidad de un requerimiento no existe** en el modelo: es un atributo de incidente, y se declara como tal.

### 129. La planificación y la visualización se separan aquí

Esta es la frontera que la fase dibuja, y conviene decirla en una línea: **el motor decide, la agenda se guarda, y el timeline cuenta lo que se guardó.** Las tres afirmaciones que la sostienen:

1. **No se ejecuta el motor.** No hay ninguna llamada a `PlanningEngine` en el camino de la lectura. La consecuencia práctica es que **el timeline no puede discrepar del plan que pinta**: los dos salen de las mismas filas. No es una promesa de disciplina, es una propiedad de construcción.
2. **La aritmética de calendario se le pide al dominio, no se reimplementa.** La jornada de un día sale de `WorkingCalendar.businessHoursOn(date)` y `BusinessHours.duration()`, que ya existen y ya están probados. El servicio no calcula horarios: **suma lo que el calendario dice**, del mismo modo que ya le pide a `BusinessTimeCalculator` los vencimientos en lugar de restarlos.
3. **Ningún valor depende del reloj.** No hay un solo `Instant.now()` en la proyección. Es lo que permite afirmar la reproducibilidad y comprobarla: la prueba de la Fase 15 lee el mismo plan antes y después de cambiar la declaración y compara las dos respuestas **byte a byte**.

**La separación es también de procedencia.** Las horas y el compromiso salen de `PlanningInputSnapshot` y **nunca** de `PlanningMetadata` viva. La consecuencia es la que el brief exigió: la visualización representa el plan almacenado, no la situación actual del ticket. Un incidente que hoy tiene otra estimación declarada sigue pintándose con la que entró al motor, porque **eso es lo que el plan decidió**.

Esto no contradice la Fase 14, la completa. La 14 hizo que la ACL **leyera** lo declarado para construir el plan; la 15 hace que el timeline **lea el plan**, no la declaración. Son dos momentos distintos y por eso las dos lecturas conviven sin pisarse: `planning_metadata_history` sigue diciendo quién declaró qué y cuándo, y la foto sigue diciendo qué entró. El timeline no mezcla las dos.

### 130. La estrategia de capacidad

La capacidad **se deriva, no se guarda**, y se deriva de dos cosas que ya están persistidas: el calendario congelado del plan y los tramos que el motor escribió.

Para cada fecha `D` de la ventana, con el calendario de `context.rules().workingCalendar()`:

| Término | Fórmula | Utilidad que ya existía |
|---|---|---|
| `availableHours` | `businessHoursOn(D)` → `BusinessHours` o `null`; su `duration()` si lo hay, `0` si no | `WorkingCalendar.businessHoursOn`, `BusinessHours.duration` |
| `occupiedHours` | Suma de `WorkBlock.hours` de los bloques con `date().equals(D)` | `WorkBlock.date` |
| `remainingHours` | `available − occupied` | — |

**Un día no laborable sale con jornada cero, no con una fila ausente.** Fin de semana y festivos producen `available = 0`, y la fila se emite igual. El frontend necesita el día para no dejar un hueco en el eje, y calcularlo allí sería volver a implementar el calendario que el plan ya congeló. Por la misma razón la capacidad cubre **todos** los días de la ventana y no solo los que tienen trabajo.

**`remainingHours` no se recorta a cero.** El motor nunca sobrepasa la jornada, así que un negativo no debería ocurrir; si ocurriera, significaría que el plan contradice su propio contexto, y es mejor que se vea a que se esconda detrás de un cero. Recortarlo convertiría una contradicción en una apariencia de normalidad.

**Los tramos parciales funcionan solos**, porque `hours` es la duración del tramo y no la del elemento: un bloque de 09:00 a 11:00 sobre una jornada de ocho deja `remaining = 6` sin ninguna regla adicional.

**Las horas se publican sin los ceros de `NUMERIC(10,4)`.** Un bloque guardado como ocho horas vuelve de la base de datos como `8.0000`, y sumarlo arrastra la escala hasta la respuesta. Los tres valores pasan por `stripTrailingZeros()`, que es lo que `BusinessHours.toHours` ya hace por el mismo motivo. `8` y `8.0000` son el mismo número, pero no se leen igual.

**La ventana es la agenda, no el horizonte.** `from` y `to` son el mínimo y el máximo de las fechas de los bloques, y son nulos cuando no hay ninguno. El horizonte dice cuántos días hacia adelante miró el motor, pero **no desde cuándo** —arranca del reporte de los incidentes— y esa fecha de inicio no se guarda. Inventarla sería derivar lo que no consta; abarcar lo que hay es lo que el dato sostiene. Queda como riesgo 65.

### 131. El estado de planificación: dos valores, y los dos que se rechazaron

`domain/enums/TimelineItemStatus`: **`PLANIFICADO`** y **`DESPLAZADO`**.

- `DESPLAZADO` — el `workItemId` aparece como `requirementId` en algún `RescheduleEvent` del plan. Es alcanzable y útil: un requerimiento desplazado **sigue teniendo bloques** en su fecha nueva, así que aparece como tramo con las dos cosas.
- `PLANIFICADO` — todo lo demás. **Un incidente nunca se desplaza**, porque `RescheduleEvent` solo nombra requerimientos: son el trabajo con fecha pactada y por tanto el único desplazable.

**No es el estado del ticket, y la distinción importa.** `ABIERTO`, `EN_EJECUCION` y los demás dicen en qué punto del proceso va el trabajo y viajan en la foto. Esto dice otra cosa: qué relación tiene el elemento con **esta** agenda. Un requerimiento puede estar `EN_EJECUCION` en GLPI y además `DESPLAZADO` en el plan de ayer, y las dos afirmaciones son ciertas a la vez porque hablan de cosas distintas.

**El conjunto es de dos valores, y no por falta de imaginación.** Los candidatos descartados lo fueron por razones concretas:

| Candidato | Por qué se rechazó |
|---|---|
| «No cupo» / `SIN_ESPACIO` | Sería **inalcanzable**. El trabajo que no entra al horizonte sale en `PlanningConflict`, y un elemento en conflicto **no tiene bloques**. Sin bloques no hay tramo que pintar, y por tanto no hay item al que colgarle el estado |
| «Sin declaración» | Describiría la metadata de **hoy**, no la del plan. La entrada congelada solo contiene elementos ya declarados —es la regla de planificabilidad de la 124.1— así que dentro de un plan la pregunta no tiene caso |
| «Vencido» | Obligaría a comparar contra el reloj, y el timeline devolvería bytes distintos para el mismo plan según el día en que se pidiera. **La representación de un plan guardado tiene que ser reproducible**, y esto lo rompe |

El tercero es el que más importa: la decisión 125 apuntó «vencido» como el primer indicador derivado de la Timeline, y aquí se rechaza a conciencia. Un indicador de vencimiento es información **de hoy sobre un plan de ayer**, y su sitio no es una respuesta que promete ser idéntica consigo misma.

## La preparación

### 132. Preparación para React

La decisión 44 escribió el mapeo campo a campo de `Block` a `PlanningItem` y dejó **tres huecos nombrados**: `title`, `priority` y `allocation`. Esta fase **cierra dos** y declara el tercero.

| `PlanningItem` | Origen en el timeline | Estado |
|---|---|---|
| `id` | `workItemId` + `startsAt` | **Cerrado** — la pareja es la identidad del tramo (128.2) |
| `resourceId` | `developerId` | **Cerrado** |
| `title` | — | **Sigue abierto** (132.1) |
| `source` | `workItemType`: `INCIDENTE` → `'INCIDENT'`, `REQUERIMIENTO` → `'REQUEST'` | **Cerrado** |
| `priority` | `severity`, con traducción | **Cerrado** (132.2) |
| `startsAt` / `endsAt` | `startsAt` / `endsAt` | **Cerrado** — misma forma, ISO-8601 |
| `allocation` | `durationHours ÷ availableHours` del día | **Cerrado** (132.3) |

Y la ventana: `TimelineWindow { from, to }` se arma con `from` y `to` de la respuesta, sin cálculo. `TimelineResource` **no** cubre `Resource { id, name, kind, weeklyCapacityHours, active }`: aporta `developerId` y una serie de capacidad **por día**, que es más rica que la semanal en una dirección y más pobre en las otras tres —el nombre, el rol y el estado activo no están persistidos y no se inventan—. Quien pinte la fila los resuelve por su cuenta.

#### 132.1 `title` sigue abierto, y se dice por qué

**La foto no guarda títulos.** `PlanningInputResponse` lo documenta como decisión, no como olvido: el motor nunca lee el título, así que no se persiste. Una UI necesita rotular cada barra, así que necesita **una segunda fuente** —o el `title` que ya viaja en la petición, o una consulta a GLPI—. El timeline no lo inventa, porque inventarlo sería exactamente el tipo de dato derivado del estado actual que la fase prohíbe. Queda como riesgo 64.

#### 132.2 `priority`: una traducción, no una copia

`IncidentSeverity` tiene **tres** valores (`ALTO`, `MEDIO`, `BAJO`) y el `Priority` del frontend tiene **cuatro** (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`). No es una copia y no puede serlo:

| Dominio | Frontend |
|---|---|
| `ALTO` | `CRITICAL` |
| `MEDIO` | `HIGH` |
| `BAJO` | `MEDIUM` |
| — | `LOW` queda **sin origen** |

La traducción es del frontend, porque es el frontend quien tiene la escala de cuatro. Y `LOW` sin origen es un dato, no un defecto: o el negocio añade una severidad por debajo de `BAJO`, o `LOW` deja de usarse. Lo que **no** se hace es inventar un cuarto valor en el dominio para cuadrar la tabla.

**El requerimiento no tiene prioridad y el timeline no se la da.** El `Priority` del frontend es obligatorio, así que el frontend tendrá que decidir qué pone cuando `severity` venga nulo — y esa decisión es suya, no del contrato.

#### 132.3 `allocation`: una división que ya se puede hacer

`allocation` es, por definición del propio tipo, «fracción de la capacidad del recurso dedicada al bloque, 0..1». Con el contrato actual es **una división**: `durationHours ÷ availableHours` del día del tramo.

No se calcula en el backend, y la razón es que el denominador **ya viaja en la respuesta**, junto al numerador, en la misma entrada de capacidad. Calcularlo en el servidor añadiría un campo que se deriva de otros dos presentes en el mismo JSON, que es la clase de campo que acaba discrepando. Y si el día fuera no laborable el denominador sería cero, así que la división necesita un caso especial — que el frontend ya tiene que escribir para pintar la barra de todos modos.

### 133. Preparación para Resource Planning

**La forma admite un equipo; el endpoint sirve un plan.** Cada `PlanSnapshot` es de un solo desarrollador —`developerId` es singular— así que hoy `resources` trae un elemento. Se modela igualmente como colección para que una vista de equipo **agregue varias respuestas sin que el contrato cambie**, que es lo que «preparado para Resource Planning» significa aquí.

Lo que se hace y lo que no:

| Pieza | Estado en esta fase |
|---|---|
| `resources` como colección | **Hecho** — un elemento hoy, N mañana |
| Capacidad por día y por recurso | **Hecho** — es la unidad que un Resource Scheduler necesita |
| Ventana desde el horizonte | **No** — la ventana es la agenda (130, riesgo 65) |
| Agregación de varios planes | **No** — exige decidir qué plan manda cuando un desarrollador tiene varios snapshots inmutables, y esa pregunta no está cerrada |
| Plan activo / consolidación / autoridad entre snapshots | **No** — nombrados y deliberadamente fuera |
| Filtros | **No** — documentados con su punto de entrada |

**Los filtros: por qué ninguno, y dónde entrarían.** El brief pidió evaluar rango de fechas, desarrollador y tipo de trabajo, y justificar la decisión. **No se implementa ninguno**, por tres razones:

1. **La respuesta ya está acotada.** Un plan, un desarrollador, la ventana de su agenda. No hay nada que recortar que no quepa en memoria: el volumen es el de los tramos de un plan, no el de una agenda corporativa.
2. **El frontend filtra en memoria sin coste** sobre una lista que ya tiene entera. Un filtro en el servidor obligaría a una llamada por cada cambio de vista.
3. **Un filtro es una decisión de contrato, no un parámetro.** Añadir `?from=&to=` fija hoy una semántica —¿recorta la ventana? ¿recorta los tramos? ¿recalcula la capacidad con la jornada completa o solo con los días pedidos?— que nadie ha pedido resolver.

El punto de entrada, cuando se pida, es **un parámetro más en el método del controlador** y un `Predicate` sobre los tres flujos que ya están construidos. No hace falta ni un tipo nuevo ni una consulta nueva: la proyección se arma entera en memoria desde tres lecturas, así que filtrar es descartar elementos de listas que ya existen.

**Y una frontera que se respeta: el timeline lee bloques, no historial.** El riesgo 58 —«el historial crece sin retención, sin paginación y sin acceso más que por elemento»— nombra la Timeline como su destinatario futuro, y **esta fase no lo toca**: la lectura que la Fase 15 construye sale de `plan_snapshot` y sus hijas, no de `planning_metadata_history`. La vía que la decisión 125 apuntó —leer el historial por desarrollador y por rango de fechas, con un índice por `changed_at` y por `changed_by`— sigue abierta y sigue siendo la misma. Lo que la Fase 15 cierra es la mitad que no la necesitaba.

## Riesgos identificados

Se listan los que esta fase toca. Los demás siguen como estaban en la Fase 14.

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 63 | **La capacidad es una derivación, no un dato guardado** — asume que un tramo ocupa el día en que **empieza** y que el calendario congelado es el que la agenda obedeció | Bajo hoy y **alto si el calendario cambiara de forma**: con jornada de 09:00 a 17:00 y el motor partiendo el trabajo por día, las dos suposiciones se cumplen. Un tramo que cruzara medianoche atribuiría sus horas al día equivocado, y lo haría **en silencio**, porque el total del plan seguiría cuadrando | La suposición queda escrita en el `ponytail:` del método que reparte y en esta tabla, que es lo que convierte un error mudo en uno buscable. Las pruebas del motor ya fijan la partición por día, así que un cambio de calendario que la rompiera fallaría antes aquí. La vía, si el calendario admitiera jornadas que cruzan el día, es repartir las horas entre las dos fechas por intersección de intervalos |
| 64 | **El timeline no puede etiquetar lo que pinta** — `TimelineItem` no lleva `title`, y no es un olvido: la foto no lo guarda porque el motor nunca lo lee | **Medio para la Timeline**, que es su consumidor declarado. Una barra sin rótulo no dice nada, así que la UI necesita una segunda fuente para cada tramo | Se acepta porque la alternativa era peor: reconstruir el título desde el estado actual del ticket rompería la reproducibilidad que es el eje de la fase. La vía es que el título **entre en la foto** —lo que exige guardarlo, y es una decisión de la Fase 8 revisitada, no un campo que se añade por la puerta de atrás—. Mientras tanto, el `workItemId` que sí viaja permite resolverlo contra GLPI o contra la petición original |
| 65 | **La ventana es la agenda, no el horizonte** — la capacidad cubre del primer al último día **con tramos**, así que los días libres anteriores al primero y posteriores al último no aparecen | **Medio para Resource Planning**, que es justo quien mira los huecos: un Resource Scheduler quiere ver «qué tengo libre la semana que viene», y si el último tramo cae el martes, el miércoles no está en la respuesta | Se acepta porque el dato que faltaría para cerrarlo **no está guardado**: el horizonte fija cuántos días se miraron, no desde cuándo, y el motor arranca del reporte de los incidentes. Inventar el inicio sería derivar lo que no consta. La vía es persistir la fecha de inicio del horizonte en `PlanningContextSnapshot`, que es una decisión de la Fase 7 revisitada |
| 58 | **El historial crece sin retención, sin paginación y sin acceso más que por elemento** | **Sin cambios en esta fase**, y conviene decirlo porque la Timeline es el destinatario que el riesgo nombra | La Fase 15 lee bloques, no `planning_metadata_history`. La vía que la decisión 125 apuntó —índice por `changed_at` y por `changed_by`, y lectura por rango— sigue abierta y sigue siendo la misma (133) |

---

# Fase 16 — La vista Timeline en React

## Qué se hizo, en una frase

`/calendario/:planId` pinta la agenda persistida de un plan —una fila por recurso, una columna por día, un bloque por tramo posicionado por hora, la capacidad del día y los desplazamientos diferenciados— con **una sola llamada** a `GET /api/planning/{planId}/timeline`. La UI no recalcula planificación: lee `remainingHours` tal como llega, y la única aritmética que hace es de píxeles.

La Fase 15 dejó el contrato expuesto y nadie lo consumía. El hueco estaba ya señalado en el propio repositorio: `components/timeline/ResourceTimeline.tsx` era un placeholder cuyo JSDoc decía que la librería de render se decidía «en la Fase 2», y `pages/Calendar.tsx` —la pantalla `/calendario`, ya en el menú lateral— listaba como pendientes cuatro decisiones de las que tres ya estaban resueltas. Solo quedaba la librería, y esta fase la decide.

**Lo que no se tocó, y se acredita con fechas de modificación:** `PlanningEngine`, `domain/rules/**`, la integración con GLPI, la persistencia de planes y **el backend entero**. Los cinco archivos de `backend/src` con fecha de hoy son de la Fase 15 —entre las 09:28 y las 09:42— y llevan hora anterior a la primera línea de frontend de esta fase (11:19), así que las 228 pruebas de Maven siguen valiendo sin volver a correrlas.

**Archivos.**

| Archivo | Qué cambió |
|---|---|
| `frontend/src/types/timeline.ts` | **Nuevo.** Espeja `TimelinePlanResponse` |
| `frontend/src/services/timelineService.ts` | **Nuevo.** `fetchTimeline(planId, signal)` sobre el `apiGet` de siempre |
| `frontend/src/hooks/useTimeline.ts` | **Nuevo.** `timelineQueryKey(planId)` y `useTimeline(planId)` |
| `frontend/src/lib/timeline.ts` | **Nuevo.** Los ayudantes puros: parseo, eje horario, agrupación, filtrado y formato |
| `frontend/src/components/timeline/TimelineGrid.tsx` | **Nuevo.** La rejilla |
| `frontend/src/components/timeline/ResourceTimeline.tsx` | De placeholder a implementación: consulta y decide qué mostrar |
| `frontend/src/pages/Calendar.tsx` | Lee el parámetro de la ruta, con reserva a campo |
| `frontend/src/routes/navigation.ts` · `AppRoutes.tsx` | `ROUTES.calendarPlan` y `calendarPath(planId)` |
| `frontend/src/layouts/Header.tsx` | **Una línea.** El título se deriva del menú |
| `frontend/package.json` · `vite.config.ts` | Cuatro `devDependencies` y el script `npm test` |
| `frontend/src/test/**` · los tres `*.test.*` | **Nuevos.** La primera infraestructura de pruebas del frontend |

## Las decisiones

### 134. La vista consume el contrato, no lo reinterpreta

`types/timeline.ts` **espeja `TimelinePlanResponse`** en vez de mapear al `PlanningItem` que la Fase 1 del frontend definió. La decisión 132 escribió ese mapeo y **no se adopta**, por tres razones que se suman:

1. Obligaría a **inventar** `PlanningItem.title` —la foto de la entrada no guarda títulos, que es el riesgo 64— y `Resource.name`, `Resource.kind` y `Resource.weeklyCapacityHours`, que no están persistidos en ningún sitio.
2. **Perdería** `planningStatus`, `severity` y toda la capacidad, que es exactamente lo que el brief pide pintar.
3. La convención de la casa para un DTO del backend ya existe y es otra: `types/glpi.ts` dice literalmente *«Espeja el DTO GlpiHealthResponse del backend»*. El timeline hace lo mismo.

`types/resource.ts` **no se toca**. Sigue siendo el modelo de recursos previsto y `Resources.tsx` lo referencia en su texto; queda sin consumidores, y se declara aquí para que nadie lo lea como un olvido.

### 135. CSS Grid propio, y por qué la librería puede esperar

`Calendar.tsx` listaba «Elegir la librería de línea de tiempo (licenciamiento incluido)» como decisión pendiente, y el JSDoc del placeholder nombraba FullCalendar Resource Timeline —**de pago**—, DHTMLX Gantt y vis-timeline. **Se cierra con CSS Grid y cero dependencias**, porque lo que el brief pide —filas de recursos, columnas temporales, bloques posicionados por hora, capacidad por día, desplazamientos diferenciados, zoom básico y scroll horizontal— es una rejilla, posicionamiento absoluto y tres números. Ninguna de las tres librerías aporta nada que esta fase necesite a cambio de una licencia sin resolver y de una dependencia de ejecución.

**Condición de salida, escrita desde ahora:** sustituir `TimelineGrid` por una de ellas **no cambia el contrato ni el backend**. El componente recibe `resources` e `items` y no sabe de dónde salen.

### 136. La ruta con reserva a campo

`/calendario/:planId` carga directo cuando el parámetro está; sin él, la misma pantalla muestra un campo para escribir el identificador y navega a la ruta del plan al enviarlo. **No hay selector de planes** porque no existe todavía ninguna pantalla que genere planes: un selector exigiría un endpoint de listado que nadie ha pedido y que el brief prohíbe —la vista consume `GET /timeline` y nada más—. La reserva a campo desaparece el día que exista una pantalla de planes que enlace a esta.

`calendarPath(planId)` sustituye el parámetro **sobre la constante** `ROUTES.calendarPlan` en vez de repetir el literal, para que la plantilla y la ruta concreta no puedan divergir. Es la misma razón por la que `Header.tsx` cambia una línea: su título se derivaba con igualdad exacta, y con `/calendario/<uuid>` habría mostrado «Dashboard».

### 137. Solo lectura, filtros en memoria

El alcance de la fase es cerrado: **no hay arrastrar y soltar, ni edición, ni recálculo**. No es una restricción de tiempo, es la forma del contrato —la Fase 15 expuso una proyección de lectura y el endpoint no acepta escrituras—. Editar exigiría un endpoint de escritura, reglas de validación y una decisión de negocio sobre qué se puede mover, y nada de eso está pedido.

Los filtros —tipo, severidad y estado— son `<select>` nativos con `useState` local y un `useMemo`, y **filtran el array ya recibido**: no generan ninguna llamada. Es lo que la Fase 15 anticipó al no implementarlos en el servidor. No se añade un componente Select estilizado: no existe en `ui/` y Radix Select sería una dependencia nueva para lo que el elemento nativo hace.

**La única corrección fina que importa: la fecha se parsea a mano.** `new Date('2026-10-05')` la interpreta el motor como UTC, y en Colombia (UTC-5) eso devuelve el día anterior. `parseLocalDateTime` construye el `Date` campo a campo, en hora local, y tiene prueba propia.

## Riesgos identificados

Se listan los que esta fase toca. Los demás siguen como estaban en la Fase 15.

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 66 | **Los bloques se rotulan con el `workItemId`** — el plan no guarda títulos: es el riesgo 64 visto desde la UI | **Medio**: una barra rotulada «INC-1» dice de qué ticket se trata pero no qué es | Se acepta porque inventar el título desde el estado actual del ticket rompería la reproducibilidad, que es el eje de la Fase 15. La vía es que el título **entre en la foto de la entrada**, y eso es del backend |
| 67 | **El eje horario se deriva de los tramos, no del calendario** — la jornada congelada (09:00–17:00) **no viaja** en la respuesta | **Bajo**: con la jornada actual el eje sale 09:00–17:00 igualmente, porque sale de los tramos. Si un plan no tuviera ninguno, el eje cae al defecto de 08:00–18:00 | Se acepta porque el dato no está en la respuesta y añadirlo es cambiar el contrato de la Fase 15, que esta fase tiene prohibido tocar. La vía es exponer el calendario del contexto —que **ya está persistido**— dentro de `TimelinePlanResponse` |
| 68 | **La fila muestra el `developerId`, no el nombre** — el plan guarda el identificador del recurso, no su nombre | **Bajo**: hoy hay un recurso y su identificador basta para saber de quién es la agenda | Se acepta porque resolver el nombre exige una segunda llamada, y el brief permite exactamente una. La vía es que el nombre entre en `TimelineResource`, o que una pantalla que ya tenga el padrón cargado enlace a esta |

---

# Fase 17 — Observabilidad operativa de la planificación

## Qué se hizo, en una frase

`GET /api/planning/metrics` arma la primera lectura que **no pide un plan**: una fotografía operativa —qué puede planificarse, qué no, dónde están los cuellos de botella y cuánta capacidad queda— construida **solo con lo ya persistido**. No ejecuta el motor, no genera planes y no consulta GLPI. Tres bloques —`declared`, `plans` y `current`—, cada uno declarando su fuente y su ámbito dentro del propio JSON.

Las dieciséis fases anteriores dejaron una superficie de lectura que siempre exige un identificador: `/{planId}`, `/{planId}/blocks`, `/{planId}/timeline`, `/{planId}/context` y `/{planId}/input`. Nadie podía preguntar por el conjunto, y esa era la mitad que faltaba.

**El hallazgo que gobierna el diseño: los descartes de la capa anticorrupción no se persisten.** `GlpiDiscardedItem` nace en `GlpiTicketValidator`, se acumula en `GlpiPlanningRequestFactory`, viaja en `PlanningFromGlpiResponse.discarded` y muere ahí: dos líneas de log y ningún registro. Es exactamente lo que la **decisión 99** declaró, así que no es un olvido. La consecuencia es dura y hay que decirla entera: **el universo de tickets conocido por GLPI es incognoscible desde la base de datos** —un ticket que nadie declaró no existe en ninguna tabla—, y por eso «tickets sin estimación» no puede medirse como «descartes con código `SIN_ESTIMACION_DECLARADA`», sino como **el estado declarado hoy en `planning_metadata`**.

**Segundo hallazgo: `planning_metadata` es una fila por ticket declarado, no por ticket conocido.** Existe fila si y solo si alguien declaró algo. El `POST` no puede crear una fila vacía, pero el `PUT` **sí** puede retirar los dos valores, así que el estado «ambos NULL» es alcanzable por HTTP y hay que decidir qué se hace con él.

**Tercero: los planes no tienen idempotencia.** Cada `POST /plan` inserta un UUID nuevo, así que `COUNT(*)` cuenta **ejecuciones, no planes distintos**.

**Archivos.**

| Archivo | Qué cambió |
|---|---|
| `domain/model/PlanReference.java` | **Nuevo.** `record(UUID planId, String developerId, Instant createdAt)`. Existe porque el puerto no puede devolver `PlanSnapshot`: armarlo exige el `PlanningResult`, que son cuatro consultas más por plan |
| `domain/model/DeclaredPlanningMetrics.java` | **Nuevo.** Cuatro números independientes; `incomplete` y `plannable` los deriva el álgebra de conjuntos, para no añadir dos consultas que dicen lo que ya dicen las otras cuatro |
| `dto/PlanningOperationalMetricsResponse.java` | **Nuevo.** El contrato, con los tres bloques anidados y las constantes `SOURCE`/`SCOPE` |
| `service/PlanningMetricsService.java` | **Nuevo.** `metrics()`. Sin `@Transactional`, y es deliberado |
| `domain/repository/PlanSnapshotRepository.java` | `+ findLatestPerDeveloper()` y `+ count()`. Ninguno de los seis métodos existentes se toca |
| `domain/repository/PlanningMetadataRepository.java` | `+ declaredMetrics()` |
| `persistence/JpaPlanSnapshotRepository.java` | Implementa la vigencia con `findAll()` heredado y agrupación en memoria |
| `persistence/PlanningMetadataJpaRepository.java` | **Tres métodos derivados, cero JPQL.** El total sale del `count()` heredado |
| `persistence/JpaPlanningMetadataRepository.java` | Implementa `declaredMetrics()` combinando los cuatro |
| `service/PlanningService.java` | **Una palabra**: `published` pasa a `private static` → `static` |
| `controller/PlanningController.java` | El noveno endpoint, un tercer campo, y **dos javadocs que dejan de ser ciertos** |
| `controller/PlanningMetricsEndpointsTest.java` | **Nuevo.** 12 pruebas |
| `persistence/JpaPlanSnapshotRepositoryTest.java` · `JpaPlanningMetadataRepositoryTest.java` | 4 y 2 pruebas nuevas |

## Las decisiones

### 138. La foto se arma leyendo la proyección de la Timeline

La capacidad, la ocupación y los desplazamientos **no se re-derivan**: `PlanningMetricsService` llama a `PlanningService.timeline(planId)` por cada plan vigente y suma lo que esa proyección ya devuelve.

La alternativa —extraer el cálculo de capacidad a un ayudante compartido— **no es solo más código**: `timelineCapacity(blocks, calendar, from, to)` no se puede extraer sola, porque `from`/`to` se calculan dentro de `toTimelineResponse` y el agrupamiento por desarrollador vive en `timelineResources`. Extraerla obliga a mover **tres** métodos privados estáticos fuera de una clase de ~700 líneas que sostiene el contrato de la Timeline —justo lo que esta fase tiene prohibido tocar— y el servicio de métricas tendría que reproducir de todos modos el cálculo de la ventana.

A cambio, la garantía es la más fuerte posible: **las métricas salen del mismo camino que pinta la interfaz, así que no pueden discrepar de ella**. Y no queda como afirmación: la prueba 7 suma los arrays que devuelve `/{planId}/timeline` y los compara con los del endpoint. Suma los arrays y **no constantes escritas a mano**, a propósito: si el timeline cambiara de criterio, la prueba lo sigue y sigue afirmando que los dos números son el mismo. Escribir el dieciséis a mano habría convertido esa prueba en una copia del escenario.

El coste (~9 consultas por desarrollador) no compra nada: el volumen es de decenas de filas.

**`PlanNotFoundException` se deja propagar.** Si a un plan vigente le falta el contexto o la entrada, la fotografía entera responde `404 PLAN_NOT_FOUND`. Es coherente con la postura que `PlanningService.timeline` ya dejó escrita —*tratarlo como un plan inexistente es preferible a devolver una capacidad medida con un calendario que no es el suyo*—, y la alternativa, saltarse a ese desarrollador, produciría **un total incompleto en silencio**, que es un número ambiguo de la peor clase. Hoy es inalcanzable —`save` escribe los tres en una transacción— y una prueba lo ancla.

**El redondeo.** Los valores que se suman ya vienen de `published(...)`, pero sumar `BigDecimal` **reintroduce ceros de cola**: `8.5 + 8.5` da `17.0`. Por eso el total se limpia otra vez con el mismo ayudante que usa el timeline, y ese es el motivo de que `published` deje de ser `private`: un ayudante propio sería una segunda definición de «cómo se publican las horas».

### 139. La vigencia es el plan más reciente por `created_at`

Capacidad, ocupación, capacidad restante y desplazamientos se calculan **solo sobre el último plan de cada `developerId`**. Agregar todos los históricos duplicaría la capacidad y la carga de trabajo: dos planes del mismo desarrollador no son el doble de jornada.

**Desempate determinista:** `Comparator.comparing(PlanReference::createdAt).thenComparing(ref -> ref.planId().toString())`, tomando el máximo. Los UUID son aleatorios, así que el desempate **no es significativo, pero sí estable**: dos llamadas devuelven el mismo ganador, que es lo único que «determinista» exige. La salida va ordenada por `developerId` con un `TreeMap`, la misma convención que `timelineResources` documenta.

**Se carga la tabla de referencias y se agrupa en memoria**, y no con un `GROUP BY` JPQL, por cuatro razones que se suman: `plan_snapshot` tiene **tres columnas**, así que `findAll()` trae la tabla entera *de referencias*, que es lo más barato que se puede leer de ella; **no hay índice sobre `created_at`**, así que un `GROUP BY` sería un *seq scan* + *sort* con el mismo coste asintótico y una consulta más que mantener; `select developerId, max(createdAt) group by developerId` **no devuelve el `id`** del ganador, así que haría falta una segunda consulta para resolverlo; y el repositorio tiene **una sola `@Query`** en todo el proyecto, con la convención de nombres derivados salvo que no haya otra.

**El criterio viaja en el payload** —`scope`, `planId`, `calculatedAt`— para que se compruebe en los datos y no en la prosa. El `scope` dice literalmente «el plan vigente de cada desarrollador: el mas reciente por created_at».

### 140. Los descartes se miden sobre el estado declarado, no sobre el historial de la ACL

Es la limitación de la fase, y se escribe explícita en tres sitios —la decisión, el javadoc del endpoint y el `scope` del bloque— porque es la clase de cosa que alguien lee mal dentro de seis meses.

`declared.withoutEstimation` y `declared.withoutCommitment` **no dicen «la ACL descartó esto»**: dicen **cuántas filas declaradas producirían hoy ese descarte si se planificaran ahora**. La diferencia no es semántica, es de universo: el primero se mide sobre lo declarado, el segundo sobre lo que GLPI conoce, y **lo segundo no está en ninguna tabla**.

La vía para cerrarlo sería persistir los descartes, y esta fase no la toma: la decisión del usuario es medir el estado actual declarado por el negocio y no reconstruir el historial. Podrá evaluarse en una fase posterior si aparece una necesidad explícita de auditoría histórica.

**Los códigos no se inventan.** `withoutEstimation` y `withoutCommitment` son `DeclaredGap(GlpiDiscardReason code, long count)`, y los dos códigos **salen del enum que la Fase 14 cerró**, no de un literal escrito aquí. Un descarte y una métrica que nombran la misma carencia tienen que nombrarla igual, y la única forma de garantizarlo es que haya un solo sitio donde esté escrito. Los otros cuatro números del bloque **no llevan código y no se les inventa uno**: no son causas de descarte, son agrupaciones del estado.

### 141. La trazabilidad viaja en el payload, no solo en el javadoc

Cada bloque lleva un `source` y un `scope` como componentes del record, inicializados desde constantes `public static final String` declaradas en el propio DTO —igual que `GlpiRestPlanningSource.VERSION` declara la suya junto al contrato—, para que un renombrado sea un solo sitio y la prueba pueda afirmarlos.

El brief pide que cada métrica indique claramente su fuente y su ámbito temporal para «evitar números ambiguos», y un javadoc no viaja con el número. Quien consuma `plans.generated` lee en la misma respuesta que ese contador es el histórico completo y que cuenta ejecuciones; quien lea `declared.total` lee que es el estado de hoy sin ventana temporal. Los tres bloques son **tres regímenes de dato distintos** y esa es la única agrupación honesta: lo declarado cambia con cada `PUT`, los planes solo crecen, y lo vigente es un plan congelado por desarrollador.

**`declared.total` se expone porque es el denominador**: sin él no se distingue «1 de 4» de «1 de 400», que es literalmente la pregunta del riesgo 60.

**El caso «ambos NULL», y por qué se expone.** Sea `C` una fila con estimación retirada *y* compromiso retirado:

```
withoutEstimation = B + C        incomplete = A + B + C
withoutCommitment = A + C        =>  withoutEst + withoutComm == incomplete + retracted
```

`C` se expone como `declared.retracted` en vez de derivarlo o callarlo, porque sin él **tres números del mismo bloque se contradicen** para un estado legítimo y alcanzable por `PUT`, y el consumidor no tiene forma de saber que la aritmética cierra. Eso es precisamente un número ambiguo. La identidad va como aserción en dos pruebas —una de persistencia y una sobre el JSON—, y `retracted` es además información operativa distinta: alguien empezó a declarar y se arrepintió.

### 142. `metrics` convive con `{planId}` por especificidad de patrón, y por eso se prueba

`GET /api/planning/metrics` y `GET /api/planning/{planId}` son las dos `GET` y las dos de un solo segmento bajo el mismo prefijo. Lo que las separa es la **especificidad del patrón**: un segmento literal puntúa por encima de una variable de captura, así que `/metrics` gana siempre y **en cualquier orden de declaración**. El orden de los métodos no interviene.

No se da por sabido. **Una prueba lo fija, y su segunda mitad es la que importa**: que `/metrics` responda demuestra poco; lo que hay que demostrar es que la ruta nueva **no se comió el caso malo** —`GET /api/planning/no-es-un-uuid` sigue siendo un `400 INVALID_PARAMETER`, y un UUID bien formado que no existe sigue siendo un `404 PLAN_NOT_FOUND`—. El día que la regla dejara de cumplirse, lo que se rompe no es una ruta nueva: es la lectura del plan entero.

Dos frases de `PlanningController` dejaron de ser ciertas y se reescribieron, que es parte del trabajo y no un extra: «los ocho endpoints son tres preguntas y cinco formas de responderlas» pasa a **nueve y seis**, y el párrafo que explicaba la convivencia de rutas *por el método HTTP* —«unas son `GET` con variable de camino y las otras `POST` con nombre fijo»— es **falso** en cuanto existe un `GET` con nombre fijo bajo el mismo prefijo.

## Riesgos identificados

Se listan los que esta fase toca. Los demás siguen como estaban en la Fase 16.

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 69 | **La foto mezcla estado declarado vivo con plan congelado** — `declared` cambia con cada `PUT`; `current` no cambia hasta que alguien vuelva a planificar. Dos llamadas separadas por un minuto pueden discrepar sin que nadie haya planificado. Es el riesgo 56 con otra cara | **Medio**: los dos bloques están en la misma respuesta y nada impide restarlos | Cada bloque declara su `scope`, y `generatedAt` fecha la mezcla. La consecuencia se dice explícitamente —**`plannable` y `capacity` no son comparables**—, y por eso **no se expone ninguna tasa de ocupación**: dividir los dos números daría un indicador que no mide nada |
| 70 | **`plans.generated` cuenta ejecuciones, no planes distintos** — no hay idempotencia de planes: cada `POST /plan` inserta un UUID nuevo | **Bajo**: el número es útil —dice cuánto se ha planificado— pero se lee mal si se toma como inventario | El nombre del bloque, el `scope` y el javadoc lo dicen, y no se usa como denominador de nada. Una prueba lo fija con un número: dos `POST /plan` idénticos dan `generated == 2` |
| 71 | **Carga completa de `plan_snapshot` y cuatro `COUNT(*)` sin índice** — O(planes totales) por petición, y los planes son inmutables por diseño, así que nada los borra | **Bajo hoy, creciente**: el coste sube con cada plan guardado y nada lo purga | `ponytail:` en el adaptador, con el techo nombrado y la vía escrita: un índice `(developer_id, created_at)` y la consulta de máximo por grupo, o una vista. No se hace ahora porque el volumen no lo pide y el índice es un cambio de esquema |
| 72 | **Un plan vigente sin contexto o sin entrada tumba la foto entera** con `404` | **Bajo**: hoy es inalcanzable, porque `save` escribe los tres en una transacción | Se acepta que propague: **un total incompleto en silencio es peor que un error**, y nadie sabría que falta. La prueba 7 ancla que hoy no ocurre |
| 73 | **El desempate de vigencia es arbitrario** — dos planes con el mismo `created_at` eligen por identificador, que es un UUID aleatorio | **Bajo**: hace falta un empate exacto al microsegundo | Es **estable** aunque no sea significativo: dos llamadas devuelven el mismo ganador, que es lo único que «determinista» exige. Probado con empate exacto. La vía es una columna monótona, que es un cambio de esquema que esta fase no necesita |
| 74 | **`generatedAt` rompe la reproducibilidad que la Fase 15 estableció** — el timeline devuelve el mismo plan byte a byte; las métricas no, y son dos contratos hermanos | **Bajo, pero alguien lo va a «arreglar»** | Es deliberado y va en el javadoc: el timeline lee un plan congelado y **debe** ser reproducible; la fotografía operativa es de ahora, y su bloque `declared` cambia con cada `PUT`. Quitarle la fecha la dejaría sin decir de cuándo es, que es peor |

---

# Fase 18 — Del tablero al elemento

## Qué se hizo, en una frase

La Fase 17 dejó nueve contadores y una pregunta abierta: cuando una tarjeta dice «sin estimación: 4», **cuáles son esos cuatro**. Esta fase cierra el salto de «hay un problema» a «estos son los elementos» con dos endpoints nuevos y una página, **sin recalcular una sola métrica**: cada lista sale de la misma información que ya cuenta la tarjeta.

La restricción del brief era literal —«no recalcular métricas, no reconstruir estados, utilizar información ya persistida»— y en vigor: no tocar `PlanningEngine`, ni las reglas de negocio, ni la integración con GLPI, ni la Timeline, ni la proyección de métricas de la Fase 17. Se cumplió sin excepciones: **la fase no añade ni una entidad, ni una tabla, ni un índice**, y `PlanningService` no cambia —`reason(AppliedRule)` y `toEventView` siguen siendo `private static`—.

## El tablero, que hasta ahora no estaba documentado

La palabra «tablero» llevaba una fase en el código sin aparecer en este documento. Sus nueve tarjetas, con el campo por el que se leen, y cuáles de ellas llevan a sus elementos:

| # | Tarjeta | Campo | ¿Navega? |
|---|---|---|---|
| 1 | Tickets planificables | `declared.plannable` | No — un total sin lista de elementos |
| 2 | Sin estimación | `declared.withoutEstimation.count` | Sí → `/metricas/sin-estimacion` |
| 3 | Sin compromiso | `declared.withoutCommitment.count` | Sí → `/metricas/sin-compromiso` |
| 4 | Metadata incompleta | `declared.incomplete` | Sí → `/metricas/metadata-incompleta` |
| 5 | Requerimientos desplazados | `current.displacedRequirements` | Sí → `/metricas/desplazados` |
| 6-8 | Capacidad disponible, ocupada, restante | `current.capacity.*` | No — agregados sin lista |
| 9 | Planes generados | `plans.generated` | No — cuenta ejecuciones sin identidad propia |

Que cinco de las nueve **no** naveguen es una decisión, no un pendiente, y hay una prueba que lo fija: afirma que esas tarjetas no contienen ningún enlace, para que el día que alguien les ponga uno a una ruta inexistente se entere.

## Las decisiones

### 143. El detalle se sirve con el mismo predicado que cuenta la tarjeta

El detalle de una carencia declarada no es una lectura nueva sobre un dato nuevo: es **la misma condición, sin el `COUNT`**. `countByEstimatedHoursIsNull()` y `findByEstimatedHoursIsNullOrderByWorkItemIdAsc()` son la misma condición escrita dos veces por Spring Data, sobre la misma tabla. El `switch` de `JpaPlanningMetadataRepository.findByDeclaredGap` solo elige cuál de las tres.

Se descartó la alternativa evidente —traer las filas y filtrarlas en memoria— por una razón que no es de rendimiento: filtrar en el servicio sería **una segunda definición de «sin estimación»**, escrita en otro sitio y en otro lenguaje, y nada obligaría a que las dos coincidieran. Con el predicado compartido la coincidencia es **por construcción**, y lo único que puede romperla es que alguien edite un repositorio, que es exactamente lo que la prueba vigila.

**La garantía se ancla contra el endpoint, no contra una constante.** Cada prueba lee la cifra de `GET /metrics` en la misma prueba y la compara con `items.length` del detalle. Un número escrito a mano en la prueba solo demuestra que el fixture no cambió; comparar contra el contador publicado demuestra que las dos rutas dicen lo mismo, que es la propiedad que interesa. El orden `OrderByWorkItemIdAsc` de las tres derivadas existe para lo mismo: que dos llamadas devuelvan la misma lista en el mismo orden, y una prueba pueda afirmarla.

Para los desplazamientos la garantía es la misma por otra vía: `displacedRequirements` cuenta `workItemId` distintos con `planningStatus == DESPLAZADO`, marca que pone `timelineItems` a partir de `RescheduleEvent::requirementId`; el detalle agrupa **esos mismos eventos** por `requirementId`. La consecuencia que hay que entender: **un requerimiento desplazado dos veces es una fila con dos eventos, no dos filas** —es la diferencia entre elementos y tramos que la tarjeta ya anuncia en su `hint`—, y por eso el coste del endpoint es `N + d` lecturas por petición: un timeline por plan vigente, más el plan de cada desarrollador que sí tenga desplazamientos. Es el precio de que las dos cifras no puedan discrepar, y es un precio que se paga a gusto cuando la alternativa es un contador que miente.

### 144. Dos contratos para dos regímenes, y una página en vez de un panel

**Dos contratos y no uno.** Una fila declarada se explica con lo que **sí** está declarado —horas, fecha, quién y cuándo—; una desplazada, con **a dónde se movió y por qué**. Un record común tendría la mitad de sus componentes nulos según el caso, y un contrato que miente campo a campo no es más barato que dos honestos. Es la misma razón por la que la fotografía de la Fase 17 tiene tres bloques y no una lista plana de nueve números.

**Y ninguno de los dos se escribe desde cero.** La fila declarada **es** el `PlanningMetadataResponse` que ya publicaba `GET /api/planning-metadata/{workItemId}`, con `commitmentOverdue` ya calculado y con `source`/`scope` tomados de las constantes que la Fase 17 declaró. La causa del desplazamiento **es** el `RescheduleEventView` que el plan ya entrega en `rescheduleEvents`. Cero mapeo nuevo, y —lo que importa— cero visibilidad ensanchada: la tentación era hacer `public` el `reason(AppliedRule)` de `PlanningService` para reusarlo, y no hizo falta, porque el plan ya lo publica.

**El mecanismo de drill-down: una página dedicada.** Se evaluaron cuatro, y las tres descartadas lo fueron por coste real, no por gusto.

| Opción | Coste real | Veredicto |
|---|---|---|
| **A. Panel lateral / drawer** | No hay primitiva de diálogo: la única Radix instalada es `@radix-ui/react-slot`. Exigiría escribir a mano trampa de foco, cierre con `Esc`, `aria-modal` y bloqueo del scroll de fondo. Sin URL propia: no se comparte ni se enlaza | **Descartada** — accesibilidad que no se puede simplificar, a cambio de nada que C no dé |
| **B. Tabla expandible** | Mismo coste de accesibilidad (`aria-expanded`/`aria-controls`), empuja el layout, sin URL. Además encaja mal: tres de las cuatro preguntas son listas que quieren su propio espacio | **Descartada** |
| **C. Página dedicada** | Cero dependencias nuevas. Reusa el patrón que ya existe (`/calendario/:planId` + `calendarPath()`), da URL compartible y atrás/adelante del navegador gratis, y `MainLayout` la envuelve sin escribir nada | **Elegida** |
| **D. Combinación** | C más fila expandible en la tabla de cuellos de botella: dos mecanismos que mantener para lo mismo | **Descartada** |

La consecuencia de elegir C se puede contar: `frontend/src/components/ui/` sigue teniendo **los mismos cinco archivos** y no se añadió ninguna dependencia.

**La cuarta pregunta del brief no necesitó contenedor.** «¿Qué desarrolladores tienen capacidad agotada?» ya se responde resaltada en la tabla de cuellos de botella —`data-remaining="full|over"`—, y su detalle es la vista Timeline que ya existe desde la Fase 16. Lo único que faltaba era **llegar**: la celda `Plan` deja de ser texto y pasa a ser un enlace a `/calendario/:planId`. Una celda convertida en enlace es todo el coste de esa pregunta.

**Hacer clicable una tarjeta sin romper la accesibilidad.** `StatCard` no acepta `onClick` ni `asChild` ni hace spread de props. **No se le añadió un `onClick` al `div`**: eso obliga a `role="button"` y `tabIndex` a mano y deja el teclado y el lector de pantalla a medias —justo lo que no se puede simplificar—. Se usó el patrón de enlace estirado: **una sola `<Link>` real** dentro del título, cubriendo la tarjeta con `after:absolute after:inset-0`. Un solo elemento tabulable, `Enter` funciona, el lector anuncia un enlace con su texto, y sin `to` la tarjeta se comporta exactamente como antes.

### 145. La ruta lleva el nombre de la constante, y no se probó a adivinar

`{gap}` se recibe como el enum directamente y un valor desconocido sale como `MethodArgumentTypeMismatchException` → **400 `INVALID_PARAMETER`** por el `GlobalExceptionHandler` que ya existía: cero manejo de errores nuevo.

Lo que se descubrió al probarlo, y que conviene dejar escrito porque es contraintuitivo: **Spring no normaliza nada**. `SIN_ESTIMACION` responde `200`; `sin-estimacion` responde `400`; y `sin_estimacion` —la forma que parecía el compromiso razonable— **también `400`**. La conversión por `@PathVariable` es `Enum.valueOf` y no hay tabla de tolerancia. La primera versión de la ruta usaba guiones, que se leen mejor en una URL, y se cambió a los nombres de constante antes que añadir una tabla de traducción en el backend; dos javadocs que afirmaban lo contrario se corrigieron, porque una afirmación falsa en un javadoc es peor que ninguna.

La traducción vive entonces **en un solo sitio y del lado que la necesita**: `METRIC_GAPS` en `frontend/src/types/planningMetrics.ts` relaciona el token que se comparte (`sin-estimacion`) con el que viaja a la API (`SIN_ESTIMACION`), y junto a él un `isMetricGap` que permite que una dirección inventada se explique como tal **en vez de traducirse en una petición que el backend conteste con un 400**. La página no llama a la API cuando el segmento no es una métrica; una prueba lo comprueba contando las llamadas.

## Riesgos identificados

Se listan los que esta fase toca. Los demás siguen como estaban en la Fase 17.

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 75 | **El detalle de desplazados cuesta O(planes) por petición** — un timeline por plan vigente más el plan de cada desarrollador con desplazamientos. Es el riesgo 71 con un factor más | **Bajo hoy, creciente**: la tarjeta ya hacía el recorrido de los timelines; lo nuevo es la lectura del plan, y solo para quien tiene desplazamientos | `ponytail:` en el servicio con el techo nombrado. La vía es una consulta agregada de `reschedule_event` por plan vigente, que es un cambio de esquema y no de código; no se hace porque el volumen no lo pide |
| 76 | **El detalle declarado no puede nombrar al desarrollador** — `planning_metadata` guarda quién **declara** (`estimatedBy`, `committedBy`), no quién **planifica**, y el asignado vive en GLPI | **Medio**: la pregunta «¿a quién le reclamo?» se responde a medias —se sabe quién estimó, no quién ejecutará | Las columnas se rotulan por lo que son —«Estimado por», «Comprometido por»— y la limitación va escrita en el javadoc del DTO, en el README y en una nota al pie de la propia tabla. Una fila retirada no tiene ninguno de los dos valores y se ve con su guion, nunca con un cero, que afirmaría una estimación de cero horas |
| 77 | **El enlace estirado puede ocultar que hay una tabla detrás** — la tarjeta entera es pulsable, y nada en el tablero anuncia qué se va a encontrar al pulsarla | **Bajo**: es una decisión de descubribilidad, no un defecto | La tarjeta navegable pierde el `text-muted-foreground` del título y gana `hover:border-ring`, así que se lee como enlace; y la página a la que lleva repite el título de la tarjeta, de modo que el clic y el destino se reconocen mutuamente |
| 78 | **Dos escrituras del mismo hecho: el token de la URL y el de la API** — `sin-estimacion` se comparte, `SIN_ESTIMACION` viaja, y el backend no acepta la primera | **Bajo**: la tabla que los relaciona es una y está junto al contrato que describe | Es deliberado y está en un solo sitio: `METRIC_GAPS`. Añadir una carencia sin añadirla a la tabla no compila, porque el tipo `MetricGap` se deriva de ella y `metricPath` solo acepta ese tipo |
| 79 | **El fixture de pruebas del tablero declaraba un estado imposible** — `retracted: 3` con `withoutCommitment: 2`, que exige `y = 2 − 3 = −1` filas | **Bajo en producción, alto en la prueba**: sin corregirlo, la prueba central de esta fase habría afirmado que el detalle cuadra con la tarjeta **sobre datos que el backend no puede producir** | Corregido a `retracted: 0` y `plannable: 34` —los otros números no cambian y la identidad cierra: `4 + 2 − 0 = 6`—, con el álgebra escrita en el javadoc del propio fixture. El único valor esperado que se tocó fue el de «Tickets planificables», de `31` a `34`; ningún caso se debilitó ni se eliminó |
| 80 | **El detalle de desplazados no ve elementos sin tramo en el timeline** — un requerimiento desplazado más allá del horizonte tiene su evento auditado pero ningún bloque, así que no aparece en la lista aunque el evento exista | **Bajo hoy**: el desfase exigiría un desplazamiento que cruce el borde de la ventana | Se dice en vez de taparse. Convertirlo en una lista de eventos en lugar de una lista de elementos rompería la correspondencia con el contador, que es la propiedad que esta fase existe para garantizar; si algún día se quiere ver, es una tercera lista, no un cambio de esta |

---

# Fase 19 — Alertas Operativas

## Qué se hizo, en una frase

Las dieciocho fases anteriores dejan leer un estado; esta dice **cuál de esos estados exige que alguien actúe**. `GET /api/planning/alerts` publica las condiciones que hoy se cumplen, de más grave a menos, cada una con su severidad, de dónde sale, con qué condición, sobre qué universo, cuántos elementos la producen, a dónde ir a verlos y cuándo se evaluó —**sin recalcular planificación**: no ejecuta el motor, no consulta GLPI y no lee la base por un camino distinto al de `/metrics`—.

La restricción del brief era literal —«las alertas son una proyección, no una nueva fuente de verdad»— y en vigor: no tocar `PlanningEngine`, ni las reglas de negocio, ni la integración con GLPI, ni la Timeline, ni el frontend, y no introducir correos, Teams, notificaciones push, jobs ni schedulers. Se cumplió sin excepciones: **la fase no añade ni una entidad, ni una tabla, ni una columna, ni un índice**, `PlanningMetricsService` **no se toca** —que es la forma más barata de garantizar que no se recalcula ninguna métrica— y el frontend queda intacto, porque el contrato de `detailUrl` se resolvió del lado del backend.

## Qué diferencia una métrica de una alerta

Es la distinción que gobierna toda la fase, y conviene tenerla explícita porque el código de las dos vive a un archivo de distancia.

**Una métrica describe un estado. Una alerta dice cuál de esos estados exige actuar.** `declared.incomplete: 6` es un dato; «hay seis tickets sin estimación y alguien tiene que estimarlos» es un juicio sobre ese dato. El primero se lee y se interpreta; el segundo llega ya interpretado, con la pregunta contestada.

De ahí salen las tres diferencias que se ven en el contrato:

| | Métrica | Alerta |
|---|---|---|
| **Qué publica** | Todos los contadores, siempre | Solo las condiciones que se cumplen |
| **Vocabulario** | Números y su origen | Números, severidad y destino |
| **Para qué** | Saber cómo está el sistema | Saber qué mirar primero |

Y una consecuencia que hay que decir en voz alta, porque es la trampa de la fase: **una alerta que no se cumple no se lista**. `alerts: []` no es un error ni un vacío que haya que rellenar; es la forma que tiene una alerta de declarar que hoy no hay nada que mirar. Por eso `generatedAt` va también en la respuesta y no solo en cada alerta: sin fecha, «no hay nada que mirar» y «no se ha mirado» se escribirían igual.

**Las alertas son derivadas, y no por disciplina sino por construcción.** No hay una segunda lectura de la base que pudiera divergir de la primera: el servicio que las proyecta no tiene repositorios, no tiene reloj y no conoce el motor. Su única dependencia es `PlanningMetricsService`, y todo lo que hace es leer su respuesta y contar.

## Las decisiones

### 146. Las alertas se proyectan sobre la respuesta de la fotografía, no sobre la base

Un método `alerts()` en `PlanningMetricsService` habría sido el camino corto: el servicio ya tiene los repositorios, ya tiene el reloj y ya cuenta cuatro de los seis números. Se descartó por dos razones, y la segunda es la que decide.

La primera es de oficio: el servicio de métricas traduce lo guardado a números, y las alertas no son números —son un juicio sobre ellos, con vocabulario que el servicio de métricas no tiene: severidad, catálogo, destino—. La segunda es la que importa: **al escribir las alertas dentro de `PlanningMetricsService` habría que haber tocado `PlanningMetricsService`**, y con él la garantía de que ninguna métrica se recalcula. Dejarlo intacto es la forma más barata de que esa garantía sea verificable en vez de prometida.

La separación cuesta **un archivo de una línea de composición**, y a cambio da la costura por la que una fase futura engancharía una notificación sin tocar nada de esto: el contrato ya lleva `type` como identidad estable, `severity` como clave de enrutado, `detailUrl` como carga útil y `generatedAt` como sello.

**La proyección es estática y pura**, `project(PlanningOperationalMetricsResponse)`, sin Spring ni base ni reloj. No es un gesto de estilo: es lo único que permite probar un estado que el camino real **no puede producir**, que es de lo que trata la decisión 150.

**Cuatro de los seis números ya estaban contados.** Las dos carencias declaradas, lo incompleto y los desplazamientos son, literalmente, el número que la fotografía publica. Los dos de capacidad son lo único que la alerta calcula, y los calcula filtrando la lista de desarrolladores que la fotografía ya produjo —con los mismos dos predicados que la tabla de cuellos de botella usa para pintar `full` y `over`, no con umbrales nuevos—.

### 147. La severidad se hereda de condiciones que el backend ya distingue

**No se inventa una escala: se nombra una que el código ya aplica en otro sitio.** Un criterio por nivel, y ninguno es un umbral —que es lo que hace que la clasificación sea defendible en vez de arbitraria—.

| Nivel | Criterio | Alertas | De dónde sale el criterio |
|---|---|---|---|
| **CRITICAL** | El estado **se contradice a sí mismo** | `CAPACIDAD_NEGATIVA` | `TimelineCapacity` ya declara que un restante negativo «significa que el plan contradice su propio contexto», y `Capacity` se niega a recortarlo a cero precisamente para que se vea |
| **WARNING** | Es un estado **legal y con dueño** | `REQUERIMIENTOS_DESPLAZADOS`, `CAPACIDAD_AGOTADA`, `SIN_ESTIMACION`, `SIN_COMPROMISO` | La capacidad exactamente agotada significa que el siguiente requerimiento desplaza a otro. Las dos carencias declaradas son **literalmente los dos motivos por los que la capa anticorrupción descarta un ticket**, cada una nombrando a una persona distinta: el desarrollador estima, el gestor compromete |
| **INFO** | Es un **agregado sin dueño único** | `METADATA_INCOMPLETA` | Es la **unión** de las dos carencias anteriores: sus elementos ya están contados y reclamados arriba |

**Por qué `METADATA_INCOMPLETA` es INFO y no WARNING**, que es la pregunta que la tabla no contesta sola: porque **sus elementos ya están en las dos alertas de arriba**, y subirla a aviso inflaría la cuenta de lo que urge con trabajo ya contado dos veces. Su oficio es decir cuánto está incompleto, no reclamar. Es además el mismo motivo por el que la fotografía no le inventa un código de descarte: no es un descarte, es una unión.

La clasificación no se sostiene en la prosa: **una prueba fija la severidad de las seis** comparando cada alerta emitida con la que declara su tipo en el catálogo. Si alguien cambiara un nivel, la prueba lo sigue; si alguien lo escribiera a mano en el servicio, discreparían.

### 148. El catálogo es el enum, y `detailUrl` es una ruta de la API que se puede recorrer

**El catálogo entero vive en `OperationalAlertType`**, y ahí están escritas por constante la severidad, la condición en palabras y el destino de cada alerta. El servicio solo aporta el número. La consecuencia práctica es la que se quiere de un catálogo: **añadir una alerta sin decir cuánto urge no compila**, y el `switch` que cuenta no tiene rama por defecto, así que añadirla sin decir de dónde sale su número tampoco.

El orden de declaración es el orden de salida, y la salida se ordena igualmente por severidad y luego por ese orden, para no depender de dónde acabe declarando alguien la próxima alerta.

**`detailUrl` es una ruta de esta API, no de la interfaz.** Fue la única decisión de esta fase que se llevó al usuario, y con razón: las dos opciones son defendibles al leerlas y muy distintas al vivirlas.

| Opción | A favor | En contra | Veredicto |
|---|---|---|---|
| **Ruta de la interfaz** (`/metricas/sin-estimacion`) | Es lo que un humano pega en el navegador | Es la **tercera copia** de un hecho que ya tiene dos dueños en el frontend —el token de `METRIC_GAPS` y la plantilla de `routes/navigation.ts`—; y el backend **no puede construirla bien**: no conoce el prefijo con el que se sirve la aplicación ni si va detrás de un proxy. Se rompe en silencio y nada lo nota | **Descartada** |
| **Ruta de la API** (`/api/planning/metrics/declared/SIN_ESTIMACION`) | **Se puede recorrer.** El literal deja de ser una promesa: una prueba pide cada ruta publicada y exige que responda y que el número de elementos cuadre con el `count` | El consumidor que quiera una pantalla tiene que traducirla | **Elegida** |

Lo que decidió el empate no fue la elegancia sino la **verificabilidad**: con la ruta de la interfaz, el único que puede comprobar que el enlace funciona es el frontend, que esta fase no toca; con la de la API, el propio backend se comprueba a sí mismo. Traducirla a una pantalla, el día que haga falta, es del lado que ya sabe traducirla.

**Cuando la alerta no tiene listado propio el campo viaja igual, con nulo**, para que el esquema sea el mismo en las seis. No se construyen listados nuevos ni se duplica la Timeline: el detalle de las dos de capacidad es el calendario del plan, que ya existe, y la Fase 18 ya dejó la celda `Plan` de la tabla de cuellos de botella como enlace. El precedente de un campo nulo con significado ya estaba en el contrato —el `code` del detalle declarado viaja nulo para `METADATA_INCOMPLETA`— y no hay configuración de Jackson que lo omita.

**Dos decisiones que son del usuario y se respetan.** `detailUrl` **se mantiene presente en el contrato** con nulo cuando no hay detalle, en vez de omitirse: un campo que a veces está y a veces no obliga a cada consumidor a saber cuándo. Y los dos contadores de capacidad **viven solo en `/alerts`**: la fotografía de la Fase 17 es un contrato cerrado y esta capa es una proyección suya, así que añadirle un contador sería lo contrario de proyectar.

### 149. La capa de alertas no lee la base, y por eso no puede discrepar de la métrica

Es la afirmación central del brief —«las alertas son una proyección»— y conviene decir exactamente qué significa, porque «proyección» se puede cumplir de muchas formas y solo una es esta.

No significa que las alertas se calculen a partir de los mismos datos; significa que **no existe la forma de que una alerta y su métrica se separen**. Los cuatro contadores que ya existían no se recalculan: se leen de la respuesta. Un segundo camino hacia la base —aunque fuera con el mismo predicado— sería una segunda oportunidad de divergir, y una alerta que discrepa de la métrica que la justifica es peor que no tener alerta.

La consecuencia concreta está en las pruebas y es lo que las hace útiles: **el número esperado se lee de `/metrics` en la misma prueba, nunca se escribe a mano**. Comparar contra una constante solo demuestra que el fixture no cambió; comparar contra el contador publicado demuestra que las dos rutas dicen lo mismo, que es la propiedad que interesa.

Y el mismo criterio vale para los textos: `source` y `scope` **no se copian**, se toman prestados de las constantes que la fotografía declara junto a su contrato. Un dato escrito en dos sitios acaba escrito de dos formas.

**Un plan vigente roto tumba las alertas enteras.** Si `/metrics` responde `404 PLAN_NOT_FOUND`, ese `404` sale sin recortarlo. Una lista de alertas calculada sobre una fotografía incompleta diría que no hay problemas donde no se ha mirado, que es la peor forma de fallar de una alerta: **mejor un error que un «todo bien» falso**. Hoy es inalcanzable —`save` escribe los tres en una transacción—, así que la prueba lo fabrica borrando la fila de contexto, y es la primera prueba del repositorio que construye ese estado.

### 150. Una alerta no es alcanzable, y se dice

El brief pide una alerta de **capacidad negativa**. Al implementarla se comprobó que **el camino real no puede producirla**: `CapacityBook` solo ocupa dentro de las franjas del calendario y `reserveRestOfDay` recorta a la ventana, así que `available − taken >= 0` día a día. El motor nunca sobrepasa la jornada.

Se implementó igual, porque el brief la pide y porque es exactamente la clase de estado que el contrato ya declara que **es mejor que se vea** —existe como canario—; y la imposibilidad se **documenta en el enum** en vez de disimularse. Lo que cambió fue **dónde se prueba**, y el reparto es lo que hace honesta la fase.

| Estado | ¿Alcanzable de punta a punta? | Dónde se prueba | Qué se afirma |
|---|---|---|---|
| `CAPACIDAD_NEGATIVA` | **No** | En la proyección, con la fotografía escrita a mano | Que se dispara, y que es la única CRITICAL |
| | | En el endpoint, sobre datos reales | Que **no** se dispara — la mitad que protege contra el falso positivo |
| `CAPACIDAD_AGOTADA` | **Sí** | En el endpoint, con un escenario de un solo día | Que se dispara, con el contador leído de `/metrics` |

La prueba de endpoint contiene solo lo que el camino real puede producir; el estado inalcanzable se prueba donde la fotografía **se escribe en vez de producirse**. Poner la alerta negativa en la prueba de endpoint habría exigido manipular bloques hasta dejar un estado que el motor no genera, y una prueba así no describiría el sistema: describiría la manipulación.

**Y el hallazgo que sí cambió el diseño: la alerta mide el plan, no el día.** El escenario conocido deja el lunes exactamente lleno —cero restante en el calendario— y el plan entero con seis horas de holgura el martes. `CAPACIDAD_AGOTADA` **no se dispara**, y es correcto: el restante que se mira es el del plan vigente entero —la suma de sus jornadas—, que es el que la fotografía publica y el que el tablero ya colorea fila a fila.

Se evaluó contar por día, que es lo que la intuición pide, y se descartó por dos razones. La primera es que exigiría **una segunda llamada al timeline por plan**, un segundo cálculo que podría divergir del de `/metrics` —exactamente lo que las decisiones 146 y 149 existen para impedir—. La segunda es que **daría un falso positivo por cada sábado y domingo de la ventana**: una jornada no laborable tiene cero disponible y cero ocupado, así que su restante es cero y dispararía la alerta todos los lunes por culpa del fin de semana anterior.

El detalle día a día no se pierde: sigue donde estaba, en el calendario del plan. Y la decisión queda **fijada por una prueba** que lee las dos cifras a la vez —el restante del lunes del timeline, que es cero, y el del plan de `/metrics`, que es seis— y afirma que la alerta **no** sale. Si alguien la cambiara a contar por día, esa prueba cae.

## Riesgos identificados

Se listan los que esta fase toca. Los demás siguen como estaban en la Fase 18.

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 81 | **`detailUrl` es una ruta de la API, no de la interfaz** — quien quiera una pantalla tiene que traducirla, y esa traducción vive en el frontend | **Bajo**: es deliberado y está documentado, con la alternativa evaluada | La ruta está en un solo sitio por lado, y una prueba recorre los cuatro literales publicados y exige que respondan con tantos elementos como dice el `count`. La vía de cierre, si algún día molesta, es que el frontend lea el `detailUrl` en vez de calcularlo |
| 82 | **Dos de los seis contadores no existen en la fotografía** — los dos de capacidad son los únicos que la alerta calcula | **Bajo**: son dos filtros sobre una lista que la fotografía ya produjo | Se dice, y los predicados son **los mismos** que la tabla de cuellos de botella usa para pintar `full` y `over` —`== 0` y `< 0`—, no umbrales nuevos. No se añadieron a `/metrics` porque ese contrato es de la Fase 17 y esta capa es una proyección suya |
| 83 | **La alerta de capacidad negativa no puede dispararse hoy** — es un canario que no suena | **Bajo hoy, alto si el motor cambiara**: sería el aviso de que el plan dejó de respetar su propio calendario, y llegaría tarde | Se implementa igual y se prueba donde el estado es construible. El escenario de endpoint fija además que **no** se dispara sobre datos reales, así que el día que empezara a sonar, hay una prueba que se entera |
| 84 | **Las alertas clasifican, no particionan** — una fila sin ninguno de los dos valores cuenta en tres alertas a la vez | **Bajo, y alto si alguien no lo sabe**: sumar los `count` de la lista daría un total que no mide nada | Es correcto —cada alerta responde a una pregunta distinta sobre el mismo elemento— y por eso **no se publica ningún total**, ni en el contrato ni en la respuesta. Está escrito en el javadoc del `record` y en el del enum, en el sitio donde alguien lo construiría |
| 85 | **`/alerts` cuesta una fotografía entera por petición** — recorre los planes vigentes igual que `/metrics` | **Bajo**: es el mismo O(planes) de los riesgos 71 y 75, **sin factor nuevo**, porque `/alerts` llama a `metrics()` una sola vez | Se acepta y se nombra. Cualquier caché sería un segundo camino hacia el dato, que es justo lo que la decisión 149 prohíbe: la fotografía dejaría de ser «de ahora» y la alerta podría hablar de un estado que ya no existe |
| 86 | **Un plan vigente roto tumba las alertas enteras**, incluidas las tres declaradas, que no dependen de ningún plan | **Bajo**: hoy es inalcanzable, porque `save` escribe los tres en una transacción | Se acepta que propague, por el mismo motivo que la Fase 17 documentó en el riesgo 72: una lista de alertas sobre una fotografía incompleta diría que no hay problemas donde no se ha mirado. La alternativa —saltarse al desarrollador roto— daría un «todo bien» falso, que en una alerta es peor que un error |
| 87 | **Siete `generatedAt` que deben ser el mismo instante** — el de la respuesta y el de cada una de las seis alertas | **Bajo**: hoy los siete se copian del mismo campo de la fotografía | No hay una segunda lectura del reloj: las siete fechas salen del `generatedAt` que la fotografía ya traía, así que no pueden diferir. Una prueba lo afirma comparando las seis contra la de la respuesta. El día que una alerta salga de otra fuente, su fecha ya está donde tiene que estar |
