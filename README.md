# Gestión de Demanda

Sistema de planificación de recursos para el equipo de desarrollo. La Fase 1 estableció la base técnica (backend Spring Boot integrado con GLPI vía su API REST, frontend React con el layout corporativo, verificación en vivo del estado de la integración). La Fase 2 construyó el núcleo de dominio: el motor de reglas que decide qué trabajo cabe en la agenda de cada desarrollador y qué requerimientos hay que renegociar cuando un incidente grave se cruza. La Fase 3 incorporó el acuerdo de nivel operativo real del negocio, la Fase 4 el calendario laboral y el cálculo en tiempo hábil, la Fase 5 unificó el modelo temporal —capacidad y vencimiento de las OLA comparten hoy un mismo reloj, al minuto— y la Fase 6 hizo que el plan sobreviva al reinicio: el resultado del planificador y la auditoría de los desplazamientos se guardan en PostgreSQL.

---

## Descripción

| Aspecto | Estado |
|---|---|
| Integración GLPI | Sesión, verificación de conectividad y autenticación, y lectura de usuarios y tickets |
| Motor de planificación | Completo y probado (dominio puro: sin Spring, sin JPA, sin GLPI) |
| Endpoints de planificación | `POST /api/planning/simulate` (calcula sin guardar), `POST /api/planning/from-glpi` (trae de GLPI y planifica) y `POST /api/planning/plan`, `GET /api/planning/{planId}`, `GET /api/planning/{planId}/blocks`, `GET /api/planning/{planId}/timeline`, `GET /api/planning/{planId}/context`, `GET /api/planning/{planId}/input` |
| Planificación declarada (metadata) | `POST /api/planning-metadata`, `PUT /api/planning-metadata/{workItemId}`, `GET /api/planning-metadata/{workItemId}` y `GET /api/planning-metadata/{workItemId}/history`. El esfuerzo estimado y la fecha compromiso que GLPI no tiene, con la historia de sus cambios. **Es la fuente del plan desde la Fase 14**: la capa anticorrupción la lee, y un ticket al que le falte cualquiera de los dos valores se descarta con su motivo |
| Datos de negocio (incidentes, requerimientos, recursos) | Mockeados en el frontend. El backend ya los lee de GLPI para planificar |
| Dashboard | Completo, con estado GLPI real |
| Módulo de planificación (timeline) | El contrato de lectura está expuesto: `GET /api/planning/{planId}/timeline` devuelve los tramos y la capacidad del desarrollador día a día, todo leído de lo persistido. Y ya tiene quien lo pinte: la pantalla `/calendario/:planId` (Fase 16) |
| Base de datos | PostgreSQL. Guarda el plan (agenda, asignaciones, auditoría y conflictos), el contexto y la entrada con que se calculó, el registro de idempotencia, y la planificación declarada con su historial |

---

## Arquitectura

Monorepo con dos aplicaciones independientes y desplegables por separado.

```
GestionDemanda/
├── backend/            API REST (Spring Boot 3 / Java 21)
├── frontend/           SPA (React 19 / TypeScript / Vite / Tailwind v4)
├── docs/               Decisiones arquitectónicas
├── .env.example        Plantilla de configuración
└── docker-compose.yml  Despliegue local de ambos servicios
```

### Backend

Arquitectura en capas, con la dependencia apuntando siempre hacia el dominio:

```
domain/       ⬅ núcleo: Java puro, sin Spring, sin JPA, sin GLPI
  enums/        WorkItemType, RequirementStatus, IncidentStatus, AppliedRule,
                IncidentSeverity, DisplacementPolicy, PlanningMetadataField
  model/        Developer, Incident, Requirement, WorkAllocation, WorkBlock,
                TimeSlot, BusinessHours, RescheduleEvent, PlanningConflict,
                PlanningRequest, PlanningResult, PlanSnapshot,
                PlanningMetadata, PlanningMetadataChange
  rules/        PlanningRules             Reglas de negocio (umbral, jornada, horizonte)
                WorkingCalendar           Bloque, fin de semana y festivos
                BusinessTimeCalculator    Recorrido del calendario en tiempo hábil
                CapacityBook              Agenda de franjas ocupadas del desarrollador
  repository/   PlanSnapshotRepository    Puerto de salida: cómo se guarda un plan
                PlanningMetadataRepository Puerto de salida: la planificación declarada y su historia
  idempotency/  RescheduleLedger          Puerto de salida: qué desplazamiento ya se auditó
  PlanningEngine               El motor. No lleva @Service a propósito
persistence/  ⬅ única capa que conoce JPA. Traduce entre entidades y objetos de dominio
              JpaPlanSnapshotRepository  Implementa PlanSnapshotRepository
              JpaRescheduleLedger        Implementa RescheduleLedger
              JpaPlanningMetadataRepository  Implementa PlanningMetadataRepository
              *Entity + *JpaRepository   Una tabla por lista del plan. Sin relaciones
controller/   GlpiController          Expone /api/glpi/health
              PlanningController      Expone /api/planning/*
              PlanningMetadataController  Expone /api/planning-metadata
service/      GlpiConnectivityService Orquesta el handshake con GLPI
              GlpiPlanningService     El caso de uso: traer de GLPI, planificar y guardar
              PlanningService         Adaptador DTO ↔ dominio. No decide nada
              PlanningMetadataService La planificación declarada: quién la escribe y qué queda registrado
client/       GlpiClient              Traduce HTTP <-> objetos. Único punto que conoce GLPI
integration/  ⬅ capa anticorrupción: aquí GLPI se traduce al dominio y en ningún otro sitio
  glpi/       GlpiTicket, GlpiUser            DTOs externos, con los campos crudos de GLPI
              GlpiTicketSearchPage           La respuesta de /search/Ticket: un sobre, no un arreglo
              GlpiTicketMapper               Ticket → Incident / Requirement
              GlpiPriorityMapper             priority / impact / urgency → IncidentSeverity
              GlpiTicketValidator            Qué ticket no se puede traducir, y por qué
              GlpiPlanningRequestFactory     Tickets traducidos → PlanningRequest
              GlpiPlanningSource             Puerto: lo que el caso de uso necesita de GLPI
              GlpiRestPlanningSource         Implementación REST. Declara su versión
              GlpiDiscardedItem              Un ticket descartado y su motivo
              GlpiContract                   El contrato de GLPI que se asume, como dato
              GlpiContractVerifier           Compara el contrato asumido con una respuesta real
config/       GlpiProperties          Configuración tipada de GLPI
              WebClientConfig         WebClient con timeouts y cabeceras por defecto
              PlanningProperties      Configuración tipada de planning.*
              PlanningConfig          Registra el dominio como beans
dto/          Contratos de entrada/salida de la API
exception/    Excepciones propias y manejador global
```

**Punto clave:** el dominio tiene dos bordes y ninguno lo toca. Hacia fuera, `client/` es lo único que sabe de HTTP y de las credenciales de GLPI, e `integration/glpi/` es lo único que sabe qué **significan** sus datos; hacia dentro, `persistence/` es lo único que sabe de JPA. `domain/` no conoce a ninguno de los tres, así que el motor se puede probar sin levantar la aplicación ni una base de datos: `PlanningEngineTest` lo instancia con `new` y corre 29 casos de negocio en menos de medio segundo.

La costura ya estaba puesta y la Fase 6 la aprovechó: el motor recibía un `RescheduleLedger` y ahora recibe otro distinto —uno que escribe en PostgreSQL— sin haber cambiado una línea. El `InMemoryRescheduleLedger` que antes era la implementación de producción es hoy el doble de las pruebas.

La Fase 9 usó la misma costura por el otro lado. El motor recibe un `PlanningRequest`, y da igual quién lo haya construido: desde esta fase lo construye también `integration/glpi/`, a partir de tickets reales. `PlanningEngine` no cambió una línea, y `domain/` sigue sin una sola referencia a GLPI.

### Frontend

```
layouts/    MainLayout + Sidebar + Header (shell de la aplicación)
pages/      Una vista por ruta
components/ Presentacional. ui/ son primitivas tipo shadcn
services/   Cliente HTTP centralizado + un servicio por recurso
hooks/      TanStack Query sobre los servicios
lib/        Lógica pura y sin estado, compartida entre vistas
types/      Contratos de TypeScript
routes/     Definición de rutas y navegación
test/       Infraestructura de pruebas (Vitest + Testing Library)
```

---

## Requisitos

| Herramienta | Versión | Verificar con |
|---|---|---|
| Java (JDK) | 21 o superior | `java -version` |
| Maven | 3.9 o superior | `mvn -version` |
| Node.js | 20 o superior | `node -v` |
| npm | 10 o superior | `npm -v` |

Docker se necesita para la base de datos local (y para el despliegue con `docker-compose.yml`). Desde la Fase 6 el backend no arranca sin PostgreSQL.

---

## Configuración Backend

Toda la configuración externa entra por variables de entorno. **No hay credenciales en el repositorio.**

### 1. Crear el archivo de entorno

Desde la raíz del repositorio:

```bash
cp .env.example .env
```

El backend carga ese archivo automáticamente al arrancar (`spring.config.import` en `application.properties`), tanto si está en la raíz como si está dentro de `backend/`. No hace falta exportar variables a mano ni instalar nada extra.

### 2. Completar las variables

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DB_URL` | No | Cadena de conexión completa. Por defecto `jdbc:postgresql://localhost:5432/gestiondemanda` |
| `DB_NAME` | No | Nombre de la base de datos. Por defecto `gestiondemanda` |
| `DB_USER` | No | Usuario. Por defecto `gestiondemanda` |
| `DB_PASSWORD` | No | Contraseña. Por defecto `gestiondemanda` |
| `GLPI_URL` | Sí | URL del API REST. **Debe incluir el sufijo `/apirest.php`** |
| `GLPI_APP_TOKEN` | Sí | App-Token de la aplicación cliente |
| `GLPI_USER_TOKEN` | Sí | User-Token del usuario de integración |
| `GLPI_TIMEOUT` | No | Timeout por petición. Por defecto `5s` |
| `SERVER_PORT` | No | Puerto HTTP del backend. Por defecto `8080` |
| `SPRING_PROFILES_ACTIVE` | No | `prod` activa logs estructurados JSON (formato ECS) |
| `TEAM_GROUP_ID` | No | Identificador del grupo de GLPI que **es** el equipo. Por defecto `1` —Desarrollo N2—. Se lee **con sus subgrupos incluidos** |
| `TEAM_GROUP_NAME` | No | Nombre de ese grupo. Por defecto `Desarrollo N2`. Solo se usa para poder nombrarlo cuando no se puede leer |
| `PLANNING_INCIDENT_THRESHOLD_HOURS` | No | Dedicación a partir de la cual un incidente obliga a recalcular. **Solo afecta a incidentes sin severidad.** Por defecto `4` |
| `PLANNING_WORKING_HOURS_PER_DAY` | No | Duración de la jornada. Es la del bloque de calendario cuando no se declara `PLANNING_CALENDAR_END_TIME`. Por defecto `8` |
| `PLANNING_HORIZON_DAYS` | No | Días hacia adelante en que se busca hueco. Por defecto `10` |
| `PLANNING_CALENDAR_START_TIME` | No | Apertura de la jornada. Por defecto `09:00` |
| `PLANNING_CALENDAR_END_TIME` | No | Cierre de la jornada. Si se omite, cierra a la apertura más `PLANNING_WORKING_HOURS_PER_DAY`. Declararlo tiene prioridad sobre ella |
| `PLANNING_CALENDAR_WEEKEND` | No | Días de la semana nunca laborables. Por defecto `SATURDAY,SUNDAY` |
| `PLANNING_CALENDAR_HOLIDAYS` | No | Festivos en formato ISO separados por coma, p. ej. `2026-01-01,2026-04-02`. Sin declarar no hay ninguno |
| `OLA_ALTO_ADQUISICION_MINUTOS` | No | Minutos objetivo para adueñarse de un incidente ALTO. Por defecto `15` |
| `OLA_ALTO_RESOLUCION_HORAS` | No | Horas objetivo para resolverlo. Por defecto `4` |
| `OLA_MEDIO_ADQUISICION_MINUTOS` | No | Igual, para severidad MEDIO. Por defecto `15` |
| `OLA_MEDIO_RESOLUCION_HORAS` | No | Por defecto `8` |
| `OLA_BAJO_ADQUISICION_MINUTOS` | No | Igual, para severidad BAJO. Por defecto `15` |
| `OLA_BAJO_RESOLUCION_HORAS` | No | Por defecto `12` |

**Dónde se obtienen los tokens en GLPI:**

- `GLPI_APP_TOKEN` → Configuración › API › Aplicaciones cliente. Se muestra **una sola vez** al crearla.
- `GLPI_USER_TOKEN` → Administración › Usuarios › *(usuario)* › pestaña API. Se recomienda un usuario dedicado con permisos de solo lectura.

**Sobre `GLPI_URL`:**

```
Correcto:   https://glpi.midominio.com/apirest.php
Incorrecto: https://glpi.midominio.com
```

**El equipo: GLPI manda, las excepciones complementan.**

El padrón de personas (`GET /api/team`) sale del grupo de GLPI configurado en `TEAM_GROUP_ID`, **con sus subgrupos**. Ese grupo es la **fuente principal**: quien GLPI publica ahí está en el equipo, y no hay que declararlo en ningún sitio.

Una **excepción** es una persona que se añade a mano porque GLPI no la publica —o la publica mal— y el equipo no puede permitirse perderla de vista. **No sustituye a GLPI**, y por eso solo puede hacer tres cosas: **añadir** a quien falta, **mantenerlo vigente** hasta que GLPI se corrija, y **documentar** el caso. Lo que **nunca** hace es quitar a quien GLPI sí entrega. Si el login de una excepción ya viene del grupo, la excepción **no se aplica** y el login sale publicado en `unusedExceptions` para poder verlo: una decisión que quedó sin efecto se calla sola, y eso es justo lo que no se quiere.

```properties
# Anadir a alguien que GLPI no publica. Los corchetes conservan las mayusculas del login, que el
# sistema si distingue al pedir el plan de esa persona.
team.exceptions[NicoSuar].name=Nicolas Alejandro Suarez Flores
team.exceptions[NicoSuar].glpi-id=1071

# Mantener a alguien vigente hasta que GLPI se corrija. `active=false` lo deja en la tabla marcado
# como inactivo en vez de desaparecerlo.
team.exceptions[OtroLogin].active=false
```

`name` y `glpi-id` son opcionales: una excepción declarada solo con su login entra igual, con el identificador como nombre y sin número de GLPI. Se aplican al reiniciar el backend, y **GLPI sigue siendo la fuente**: el día que publique a esa persona, la excepción deja de hacer falta y se ve que sobra.

### 3. Base de datos local

A diferencia de GLPI, la base de datos **no es opcional**: sin ella no hay dónde guardar el plan ni el registro de idempotencia, así que el backend no arranca sin PostgreSQL. Los valores por defecto de las variables coinciden con los del servicio `postgres` de `docker-compose.yml`, de modo que basta con:

```bash
docker compose up -d postgres
```

Queda escuchando en **localhost:5432**. El esquema lo crea Hibernate al arrancar el backend (`spring.jpa.hibernate.ddl-auto=update`), así que no hay que ejecutar ningún script.

Los datos viven en un volumen con nombre, y por eso sobreviven a `docker compose down`. Solo `docker compose down -v` los borra.

### 4. Arranque sin GLPI configurado

Si las variables quedan vacías el backend **arranca igual**. `/api/glpi/health` responde indicando que no está configurado, sin lanzar errores. Esto permite desarrollar el frontend sin depender de un GLPI disponible.

---

## Configuración Frontend

El frontend no necesita configuración para desarrollo: Vite incluye un proxy que redirige `/api` al backend en `http://localhost:8080`.

Variables disponibles (opcionales, en `frontend/.env.local`):

| Variable | Por defecto | Descripción |
|---|---|---|
| `VITE_API_BASE_URL` | vacío | URL base del backend. Vacío = rutas relativas, resueltas por el proxy |
| `VITE_PROXY_TARGET` | `http://localhost:8080` | Destino del proxy de desarrollo |

Con `VITE_API_BASE_URL` vacío no hay CORS en desarrollo: el navegador solo habla con el origen de Vite.

---

## Ejecución Backend

En una terminal, desde la raíz del repositorio:

```bash
docker compose up -d postgres   # solo la primera vez
cd backend
mvn spring-boot:run
```

Servicio disponible en **http://localhost:8080**.

Para construir el JAR y ejecutarlo:

```bash
cd backend
mvn clean package
java -jar target/gestion-demanda-backend-0.1.0-SNAPSHOT.jar
```

Para ejecutar las pruebas:

```bash
cd backend
mvn test
```

---

## Ejecución Frontend

En una **segunda terminal**, desde la raíz del repositorio:

```bash
cd frontend
npm install
npm run dev
```

Servicio disponible en **http://localhost:5173**.

Otros comandos:

```bash
npm run build      # Compila TypeScript y genera el bundle de producción en dist/
npm run typecheck  # Solo verificación de tipos
npm run lint       # oxlint
npm test           # Vitest + Testing Library sobre jsdom
npm run preview    # Sirve localmente el bundle de producción
```

### La vista Timeline

La agenda de un plan vive en **`/calendario/:planId`**. En `/calendario`, sin identificador, la misma pantalla pide uno: no hay selector de planes porque todavía no existe ninguna pantalla que los genere.

Consume **una sola llamada**, `GET /api/planning/{planId}/timeline`, y no recalcula planificación: pinta lo que el backend ya calculó.

| Qué se ve | Cómo |
|---|---|
| Una fila por recurso | Hoy habrá normalmente uno. La rejilla itera `resources`, así que pintará varios sin cambios |
| Una columna por día | Los días salen de la capacidad que devuelve el plan, con los de los tramos sumados por si alguno cayera fuera |
| Un bloque por tramo | Posicionado por hora dentro de la columna de su día, con `workItemId`, tipo, rango horario, duración y estado. `estimatedHours`, `severity` y `committedDate` van en el `title` nativo |
| La capacidad del día | Disponible, ocupada y restante **tal como llegan**. El restante no se deriva restando: un negativo que viniera del plan tiene que verse |
| Los desplazamientos | Los `DESPLAZADO` llevan borde ámbar y distintivo. Se decide solo con `planningStatus`, sin reglas nuevas |
| Zoom temporal | Tres densidades —compacta, normal, amplia— que solo cambian los píxeles, no el rango |
| Filtros | Tipo, severidad y estado. `<select>` nativos que **filtran en memoria** el array ya recibido: no generan llamadas |

**Componentes.** `pages/Calendar.tsx` es el punto de entrada y quien lee el parámetro de la ruta. `components/timeline/ResourceTimeline.tsx` consulta y decide qué mostrar —sin plan, cargando, error, agenda vacía o rejilla—. `components/timeline/TimelineGrid.tsx` pinta la rejilla. `lib/timeline.ts` son los ayudantes puros: parseo de fecha y hora, eje horario, agrupación por día, filtrado y formato. `hooks/useTimeline.ts` y `services/timelineService.ts` son la consulta y la llamada, con las convenciones de siempre.

**Dependencias nuevas.** Cuatro, todas de desarrollo y ninguna de ejecución: `vitest`, `jsdom`, `@testing-library/react` y `@testing-library/jest-dom`. El render es CSS Grid propio, así que el bundle no crece.

**Limitaciones.** Es una vista de **solo lectura**: no hay arrastrar y soltar ni edición, porque el endpoint es una proyección de lectura y no acepta escrituras. Los bloques se rotulan con el `workItemId` porque **el plan no guarda títulos** (riesgo 66). El eje horario se deriva de los tramos observados y no del calendario que el plan obedeció, porque la jornada congelada no viaja en la respuesta (riesgo 67). La fila muestra el `developerId` y no el nombre del desarrollador: resolverlo exigiría una segunda llamada (riesgo 68). La vista sirve **un plan** —consolidar varios se resolvió después, en `/recursos`, pero no aquí: la Fase 21 consolidó **un plan vigente por desarrollador**, con la vigencia que el backend ya resuelve, no varios planes de la misma persona a la vez—. Y la paleta oscura existe en el CSS pero no tiene conmutador.

---

## Verificación

Con ambos servicios en marcha:

| Qué | Dónde | Resultado esperado |
|---|---|---|
| Backend vivo | http://localhost:8080/actuator/health | `{"status":"UP"}` |
| Endpoint de integración | http://localhost:8080/api/glpi/health | JSON con `connected` y `authenticated` |
| Simulación de planificación | `POST http://localhost:8080/api/planning/simulate` | JSON con `allocations`, `blocks`, `displacedRequirements`, `rescheduleEvents`, `calendar` e `incidentDeadlines`. No guarda nada |
| Plan guardado | `POST http://localhost:8080/api/planning/plan` | `201` con `planId` y el mismo JSON que la simulación |
| Plan desde GLPI | `POST http://localhost:8080/api/planning/from-glpi` | `201` con `planId`, el plan calculado y la lista de tickets descartados. Trae los datos de GLPI, los traduce y planifica. Requiere GLPI configurado |
| Plan releído | `GET http://localhost:8080/api/planning/{planId}` | El plan guardado: `allocations`, `blocks`, `rescheduleEvents` y `conflicts` |
| Agenda de un plan | `GET http://localhost:8080/api/planning/{planId}/blocks` | Solo los tramos de agenda |
| Timeline de un plan | `GET http://localhost:8080/api/planning/{planId}/timeline` | Los tramos con su estado, la capacidad del desarrollador día a día y las asignaciones. Solo lectura: no ejecuta el motor |
| Contexto de un plan | `GET http://localhost:8080/api/planning/{planId}/context` | Con qué se calculó: versión del motor, instante y zona, severidades y reglas vigentes (umbral, horizonte, OLA y calendario) |
| Entrada de un plan | `GET http://localhost:8080/api/planning/{planId}/input` | Con qué datos entró al motor: desarrollador, incidentes y requerimientos, con los atributos que el motor lee |
| Fotografía operativa | `GET http://localhost:8080/api/planning/metrics` | Qué puede planificarse, qué no, dónde están los cuellos de botella y cuánta capacidad queda, **sobre lo ya persistido**. No pide un plan: es la primera lectura del conjunto. Solo lectura: no ejecuta el motor, no genera planes y no consulta GLPI |
| Padrón del equipo | `GET http://localhost:8080/api/team` | Las personas del grupo de GLPI configurado **más** las excepciones declaradas, cada una con su origen (`GLPI` o `EXCEPTION`), su número de GLPI y su vigencia. Si GLPI no responde contesta `200` igual, con `glpi.available=false`, el motivo y las excepciones: **la degradación es parte del contrato**, no un estado de error |
| Declarar planificación | `POST http://localhost:8080/api/planning-metadata` | `201` con el estado sellado. `409` si el elemento ya tiene planificación declarada, `400` si no se declara ni estimación ni fecha compromiso |
| Modificar planificación | `PUT http://localhost:8080/api/planning-metadata/{workItemId}` | `200` con el estado nuevo. Reemplaza el recurso: hay que reenviar lo que no cambia, y `null` significa retirar el valor. `404` si no hay nada declarado |
| Leer planificación | `GET http://localhost:8080/api/planning-metadata/{workItemId}` | El estado declarado, con `estimatedBy`/`committedBy` y sus sellos, y el derivado `commitmentOverdue`. `404` si no hay nada declarado |
| Historial de planificación | `GET http://localhost:8080/api/planning-metadata/{workItemId}/history` | Cada cambio con su campo, valor anterior, valor nuevo, autor y fecha. En orden. `404` si no hay nada declarado |
| Información de la app | http://localhost:8080/actuator/info | Nombre, descripción y versión |
| Frontend | http://localhost:5173 | Dashboard con las cuatro tarjetas |
| Agenda de un plan en la UI | http://localhost:5173/calendario/{planId} | La rejilla de la agenda. En `/calendario`, sin identificador, la pantalla pide uno |
| Centro de alertas en la UI | http://localhost:5173/alertas | Las condiciones que hoy se cumplen, de más grave a menos, con filtros en memoria. Solo lectura: no reconoce, cierra ni archiva |
| Equipo en la UI | http://localhost:5173/recursos | El equipo de hoy: una persona por fila —su nombre, sus tickets, sus desplazamientos, sus renegociaciones pendientes, su capacidad y sus alertas—, ordenable, con la capacidad agregada y las alertas del conjunto. Responde «¿cómo está el equipo hoy?» sin abrir ninguna otra pantalla. Solo lectura: no fusiona planes ni recalcula capacidad |
| Integración en la UI | Dashboard › tarjeta **Estado GLPI** | Estado real, no mockeado |

### Respuesta de `/api/glpi/health`

```json
{
  "connected": true,
  "authenticated": true,
  "baseUrl": "https://glpi.midominio.com/apirest.php",
  "checkedAt": "2026-10-05T14:28:59.299Z",
  "detail": "Conexion y autenticacion verificadas contra GLPI"
}
```

| `connected` | `authenticated` | Interpretación |
|---|---|---|
| `true` | `true` | Todo correcto |
| `true` | `false` | El servidor responde pero rechaza las credenciales — revisar los tokens |
| `false` | `false` | GLPI no responde — revisar `GLPI_URL` y la conectividad de red |

El endpoint **nunca devuelve error HTTP por un fallo de GLPI**. Siempre responde `200` con el estado, porque su propósito es reportar, no fallar. Los errores sí llegan con su código cuando el problema es de la propia API (ver más abajo).

### Códigos de error de la API

| Código | Cuándo |
|---|---|
| `503 GLPI_UNAVAILABLE` | Se invocó una operación que requiere GLPI y este no está disponible |
| `502 GLPI_AUTHENTICATION_FAILED` | GLPI rechazó las credenciales — revisar los tokens |
| `502 GLPI_INVALID_DATA` | GLPI respondió algo que no se puede leer |
| `404 DEVELOPER_NOT_FOUND` | El desarrollador pedido no existe en GLPI |
| `404 PLAN_NOT_FOUND` | El identificador no corresponde a ningún plan guardado |
| `400 VALIDATION_ERROR` | La petición trae datos inválidos |
| `400 INVALID_PARAMETER` | Un parámetro de la ruta o de la consulta no tiene el tipo esperado |
| `500 INTERNAL_ERROR` | Error no controlado |

Formato uniforme (`ApiError`): `{ timestamp, status, error, message, path }`.

---

## Planificación

### Las reglas, en una frase

Un **incidente** es prioridad máxima: consume capacidad antes que cualquier requerimiento. Un **requerimiento** tiene una fecha pactada con el usuario, y es el trabajo que se desplaza: los que ya no cierran en su fecha quedan en estado `PENDIENTE_DE_RENEGOCIACION`, con un evento de auditoría que registra la fecha original, la nueva, la regla aplicada y la severidad que tenía el incidente causante.

Cuánto reclama cada incidente lo decide su **severidad**, según el acuerdo de nivel operativo (OLA) configurado:

| Severidad | OLA por defecto | Comportamiento |
|---|---|---|
| `ALTO` | 15 min / 4 h | **Replanificación inmediata.** Cierra lo que queda de la jornada en que arranca: el trabajo pactado para ese día se desplaza aunque hubiera capacidad. Cerrar la jornada es reclamarla, no consumirla — el incidente ocupa exactamente sus horas |
| `MEDIO` | 15 min / 8 h | **Compite por capacidad.** Consume sus horas y desborda a los días siguientes; desplaza solo lo que ya no cabe |
| `BAJO` | 15 min / 12 h | **Convive.** Se ubica después de los requerimientos, en el hueco sobrante. Solo desplaza si no cabe ni en una jornada completa (saturación) |

Los objetivos de la OLA son **metas que se reportan**, no volumen de trabajo: el motor planifica con la dedicación estimada de cada incidente. La tabla vigente se devuelve en cada simulación y se ajusta en `planning.incident-policies.*` sin tocar código.

Un incidente **sin** severidad es dato legado: se planifica con el umbral de dedicación y se audita con la regla antigua. Es la migración controlada mientras GLPI no envíe prioridad.

Un requerimiento **se reparte** entre los días que necesite: ocupa lo que queda de su fecha pactada y continúa en los siguientes. La entrega es el día en que cierra, y es esa fecha la que se audita. Solo se reporta como conflicto si no cabe en **todo** el horizonte, para que alguien decida si se amplía el horizonte o se suma capacidad.

### Calendario laboral

Las OLA y la capacidad se miden en **tiempo hábil**, no en horas de reloj. El sistema no trabaja 24 horas al día ni 7 días a la semana: trabaja cuando hay alguien trabajando, y eso lo declara el calendario.

| Pieza | Qué decide |
|---|---|
| `planning.calendar.start-time` / `end-time` | Cuándo abre y cierra la jornada. De aquí sale la capacidad de cada fecha |
| `planning.calendar.weekend` | Qué días de la semana nunca son laborables |
| `planning.calendar.holidays` | Qué fechas concretas tampoco lo son |

Con la configuración por defecto —lunes a viernes, de 09:00 a 17:00, sin festivos— una OLA de 4 horas pedida un **viernes a las 16:30** vence el **lunes a las 12:30**: 30 minutos el viernes y 3 h 30 el lunes. El fin de semana no consume OLA porque no es tiempo hábil. Un incidente reportado un sábado empieza a consumir el lunes, y un festivo intermedio corre el vencimiento sin gastar objetivo.

Sábados, domingos y festivos simplemente no ofrecen franjas, así que un incidente reportado en fin de semana se ubica el lunes y un requerimiento desplazado un viernes aterriza el lunes siguiente, no el sábado.

La respuesta de simulación devuelve el calendario vigente en `calendar` y el vencimiento de cada incidente en `incidentDeadlines`, calculado ya en tiempo hábil.

### Capacidad horaria

La capacidad de un desarrollador es una **agenda de franjas**, no un contador de horas por día. `CapacityBook` guarda, para cada fecha, las franjas ya ocupadas, y de ahí deriva las libres. Eso permite representar una jornada partida por el trabajo:

```
09:00 ─────── 11:00 ────────── 14:00 ─────── 17:00
    ocupado        libre           ocupado
```

Un incidente ALTO de 4 h reportado un **viernes a las 16:30** ocupa 30 minutos el viernes y 3 h 30 el lunes. La mañana del viernes no se toca: ya pasó, y no se le imputa al incidente. Un requerimiento de 20 h ocupa lunes 09:00–17:00, martes 09:00–17:00 y miércoles 09:00–13:00.

La capacidad y el vencimiento de la OLA comparten el **mismo** recorrido del calendario (`BusinessTimeCalculator`): son la misma pregunta —cuánto queda de la jornada, qué días no cuentan, dónde está el siguiente hueco— formulada por dos consumidores. Por eso ya no pueden discrepar.

### Endpoint de simulación

`POST /api/planning/simulate` — **temporal**. Existe para poder ejercitar las reglas antes de que haya persistencia y antes de que GLPI alimente datos reales. Recibe un escenario completo y devuelve la agenda resultante.

**Ejemplo** — un desarrollador con un incidente MEDIO de 6 h y un requerimiento de 4 h pactado para el mismo día:

```bash
curl -X POST http://localhost:8080/api/planning/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "developer": { "id": "dev-1", "name": "Ana" },
    "incidents": [
      { "id": "INC-1", "title": "Caida del portal", "estimatedHours": 6,
        "reportedAt": "2026-10-05T09:00:00Z", "status": "ABIERTO", "severity": "MEDIO" }
    ],
    "requirements": [
      { "id": "REQ-1", "title": "Reporte de cartera", "estimatedHours": 4,
        "plannedDate": "2026-10-05", "status": "PLANIFICADO" }
    ]
  }'
```

`severity` es opcional en cada incidente: omitirlo lo trata como dato legado. El campo `rules` también es opcional y permite sobrescribir el umbral, la jornada o el horizonte solo para esa petición. La OLA por severidad **no** se sobrescribe por petición: es el acuerdo vigente y se ajusta en la configuración de la aplicación.

**Respuesta** (recortada):

```json
{
  "developerId": "dev-1",
  "allocations": [
    { "workItemId": "INC-1", "workItemType": "INCIDENTE", "developerId": "dev-1",
      "date": "2026-10-05", "hours": 6 },
    { "workItemId": "REQ-1", "workItemType": "REQUERIMIENTO", "developerId": "dev-1",
      "date": "2026-10-05", "hours": 4 }
  ],
  "blocks": [
    { "workItemId": "INC-1", "workItemType": "INCIDENTE", "developerId": "dev-1",
      "start": "2026-10-05T09:00:00", "end": "2026-10-05T15:00:00", "hours": 6 },
    { "workItemId": "REQ-1", "workItemType": "REQUERIMIENTO", "developerId": "dev-1",
      "start": "2026-10-05T15:00:00", "end": "2026-10-05T17:00:00", "hours": 2 },
    { "workItemId": "REQ-1", "workItemType": "REQUERIMIENTO", "developerId": "dev-1",
      "start": "2026-10-06T09:00:00", "end": "2026-10-06T11:00:00", "hours": 2 }
  ],
  "displacedRequirements": [
    { "requirementId": "REQ-1", "originalDate": "2026-10-05", "newDate": "2026-10-06",
      "newStatus": "PENDIENTE_DE_RENEGOCIACION", "causedByIncidentId": "INC-1" }
  ],
  "rescheduleEvents": [
    { "timestamp": "2026-10-05T15:00:00Z", "incidentId": "INC-1", "requirementId": "REQ-1",
      "originalDate": "2026-10-05", "rescheduledDate": "2026-10-06",
      "appliedRule": "CAPACIDAD_COMPROMETIDA", "severity": "MEDIO",
      "reason": "El incidente comprometio la capacidad de la jornada pactada." }
  ],
  "conflicts": [],
  "incidentPolicies": [
    { "severity": "ALTO", "targetOwnershipMinutes": 15, "targetResolutionHours": 4,
      "displacementPolicy": "INMEDIATA" },
    { "severity": "MEDIO", "targetOwnershipMinutes": 15, "targetResolutionHours": 8,
      "displacementPolicy": "POR_CAPACIDAD" },
    { "severity": "BAJO", "targetOwnershipMinutes": 15, "targetResolutionHours": 12,
      "displacementPolicy": "POR_SATURACION" }
  ],
  "calendar": {
    "startTime": "09:00:00", "endTime": "17:00:00",
    "weekend": ["SATURDAY", "SUNDAY"], "holidays": []
  },
  "incidentDeadlines": [
    { "incidentId": "INC-1", "severity": "MEDIO",
      "reportedAt": "2026-10-05T09:00:00Z", "targetResolutionHours": 8,
      "dueAt": "2026-10-05T17:00:00Z" }
  ]
}
```

Con 6 h de incidente sobre una jornada de 8 h quedan 2 h libres ese día: el requerimiento ocupa esas 2 h el lunes y pone las 2 h restantes el martes. Cierra el martes, así que su fecha auditada es el martes, pero **arranca** el lunes: por eso `allocations[].date` es el lunes y `rescheduledDate` el martes. Los tres tramos están en `blocks`, que es la agenda real.

Con un incidente de 4 h el requerimiento cabría entero el mismo lunes y `rescheduleEvents` vendría vacío; con la misma entrada pero severidad `ALTO`, se desplazaría igualmente, porque esa severidad cierra la jornada en que arranca.

**Reglas aplicadas** (`appliedRule`):

| Valor | Significado |
|---|---|
| `REPLANIFICACION_INMEDIATA` | La severidad cerró lo que quedaba de la jornada en que arrancó el incidente |
| `CAPACIDAD_COMPROMETIDA` | El incidente comprometió la capacidad y el requerimiento ya no cabía |
| `SATURACION` | El día estaba saturado: el incidente no cabía ni conviviendo con el trabajo pactado |
| `UMBRAL_INCIDENTE_EXCEDIDO` | *(legado)* Un incidente sin severidad superó el umbral de dedicación |
| `CAPACIDAD_DIARIA_EXCEDIDA` | La jornada ya estaba comprometida, sin un incidente concreto a quien atribuirlo |

### Guardar un plan

`POST /api/planning/plan` recibe el mismo escenario que la simulación y hace lo mismo, más una cosa: guarda el resultado. Devuelve `201` con el identificador del plan y el resultado completo, para que quien acaba de planificar no tenga que volver a pedirlo.

```bash
curl -X POST http://localhost:8080/api/planning/plan \
  -H "Content-Type: application/json" \
  -d @escenario.json
```

```json
{
  "planId": "3f1c9b7e-...",
  "createdAt": "2026-10-05T13:47:12.004Z",
  "plan": { "developerId": "dev-1", "allocations": [], "blocks": [] }
}
```

A partir de ahí el plan se puede releer sin volver a planificar, que es lo que hace que sobreviva a un reinicio:

```bash
curl http://localhost:8080/api/planning/3f1c9b7e-...
curl http://localhost:8080/api/planning/3f1c9b7e-.../blocks
curl http://localhost:8080/api/planning/3f1c9b7e-.../context
curl http://localhost:8080/api/planning/3f1c9b7e-.../input
```

**Qué se guarda y qué no.** Se guardan la agenda (`blocks`), las asignaciones (`allocations`), la auditoría (`rescheduleEvents`) y los conflictos. El plan sigue enlazando con los datos de entrada por id y no los copia: son de GLPI, y una copia dentro del plan sería un segundo origen de verdad. Por eso `GET /{planId}` no devuelve `incidentDeadlines`, que se derivan de los incidentes.

Lo que la Fase 8 añade es otra cosa, en tablas aparte: la **fotografía de lo que entró al motor** el día del cálculo, que se lee por `/{planId}/input`. No es el valor vivo —ese sigue en GLPI— sino un hecho pasado. Guarda solo lo que el motor lee: identificadores, horas estimadas, fecha de reporte, severidad, fecha pactada y estado. Los títulos y el nombre del desarrollador no se copian porque no intervienen en el cálculo. Con la entrada y el contexto guardados, un plan se puede volver a calcular sin pedirle nada a GLPI.

Desde la Fase 7 sí se guarda la configuración **con la que se calculó ese plan** —umbral, horizonte, OLA por severidad y calendario—, y se lee por `/{planId}/context`. No es la configuración vigente, que sigue viviendo en `application.properties`: es la fotografía de la que estaba en pie el día del cálculo, y por eso no la sustituye. Sin ella, un evento de auditoría que dice «se aplicó `UMBRAL_INCIDENTE_EXCEDIDO`» es una afirmación que ya no se puede comprobar en cuanto alguien cambie el umbral.

Un identificador que no corresponda a ningún plan devuelve `404` con código `PLAN_NOT_FOUND`.

### Planificar con los datos reales de GLPI

Hasta la Fase 8 el motor se alimentaba de un cuerpo JSON escrito a mano. Desde la Fase 9 hay un segundo camino, que trae los datos de GLPI:

```bash
curl -X POST http://localhost:8080/api/planning/from-glpi \
  -H "Content-Type: application/json" \
  -d '{"developerId": "296"}'
```

**El desarrollador se identifica por su id numérico de GLPI**, no por su login. Desde la Fase 22 los tickets se piden a `/search/Ticket` con el criterio de técnico, y ese criterio solo sabe comparar por identificador: con un nombre, GLPI no falla, castea el valor a cero y devuelve los tickets del usuario cero. El adaptador rechaza los identificadores no numéricos sin llegar a preguntar, y `/User/{login}` —que devuelve un arreglo— responde `502 GLPI_INVALID_DATA`.

```json
{
  "planId": "3f1c9b7e-...",
  "createdAt": "2026-10-06T13:47:12.004Z",
  "plan": { "developerId": "296", "allocations": [], "blocks": [] },
  "discarded": [
    { "ticketId": "503", "reason": "sin horas estimadas" }
  ]
}
```

El cuerpo de la petición lleva **solo el desarrollador**. Las reglas no se aceptan aquí a propósito: un plan que dice de dónde salió cada dato no debería permitir además que quien llama cambie las reglas con las que se calculó, porque entonces la auditoría registraría algo que nadie eligió. Las reglas son las de la configuración vigente.

El recorrido es el mismo que el de un plan escrito a mano, con un tramo delante:

```
GLPI  →  capa anticorrupción  →  PlanningRequest  →  PlanningEngine  →  PostgreSQL
```

**La traducción no la hace el dominio.** Todo lo que hay que saber de GLPI —que `type` 1 es incidencia y 2 es petición, que `priority` va de 1 a 5, que `actiontime` son segundos, que `status` 5 es «solucionado»— vive en `integration/glpi/`, y `domain/` no tiene una sola referencia a GLPI. `PlanningEngine` no cambió una línea: recibe el mismo `PlanningRequest` de siempre, venga de donde venga.

**Un ticket de GLPI es una de dos cosas.** Su `type` decide: los de tipo 1 entran al motor como `Incident` y los de tipo 2 como `Requirement`. En GLPI los dos son la misma entidad; en el dominio son dos tipos que el motor trata de forma distinta, y la separación la hace el adaptador.

**La prioridad se traduce por tabla, no por número.** GLPI mide la prioridad en una escala de 1 a 5 y el dominio en tres severidades, así que hay un mapeo explícito: 5 y 4 son `ALTO`, 3 es `MEDIO`, 2 y 1 son `BAJO`. Cuando un ticket no trae `priority` se mira el mayor entre `impact` y `urgency`, que es como GLPI calcula la prioridad por dentro. Si no hay ninguno de los tres, la severidad queda nula: **no se inventa un valor**, y el incidente entra al motor sin severidad, que es un caso que el dominio ya sabía tratar.

**Un ticket que no se puede traducir no tumba la planificación.** Se descarta, se sigue con el resto y el motivo se devuelve en `discarded`. Se descarta cuando no hay identificador, cuando el `type` no es 1 ni 2, cuando no hay horas estimadas, cuando el `status` no está en la tabla, cuando falta la fecha de creación o cuando una petición no trae fecha comprometida. **Sin prioridad no se descarta**: la severidad nula es un caso previsto, no un dato que falte.

Los fallos de GLPI salen con su propio código, y ninguno se confunde con un error del motor: `503 GLPI_UNAVAILABLE` si no responde, `502 GLPI_AUTHENTICATION_FAILED` si rechaza las credenciales, `502 GLPI_INVALID_DATA` si responde algo ilegible y `404 DEVELOPER_NOT_FOUND` si el desarrollador no existe. En los cuatro casos **no se guarda nada**: o el plan sale entero, o no sale.

**Desde la Fase 28 esto ya no hace falta escribirlo a mano.** La pantalla **`/planificar`** invoca esta misma ruta —el `curl` de arriba sigue funcionando igual, porque no se tocó una línea del backend— y enseña lo que devuelve. Está descrita en [La pantalla de generación del plan](#la-pantalla-de-generación-del-plan).

### Leer lo que tiene un técnico, sin planificar

Planificar es escribir: `POST /api/planning/from-glpi` calcula un plan y lo guarda. Pero antes de planificar hay que saber **qué se va a declarar**, y esa pregunta no puede contestarla un endpoint que escribe: pedirle el listado dejaría un plan guardado por cada vez que alguien abre la pantalla. Desde la Fase 23 hay una lectura para eso:

```bash
curl http://localhost:8080/api/planning-metadata/declarations/296
```

```json
{
  "developer": { "id": "296", "name": "Ana Perez" },
  "items": [
    {
      "workItemId": "501",
      "type": "INCIDENTE",
      "status": "ABIERTO",
      "priority": 4,
      "createdAt": "2026-10-05T14:00:00Z",
      "title": "Falla en produccion",
      "declarationStatus": "PLANIFICABLE",
      "discards": [],
      "declaration": { "estimatedHours": 6.0000, "committedDate": "2026-10-20", "…": "…" }
    },
    {
      "workItemId": "502",
      "declarationStatus": "SIN_DECLARACION",
      "discards": [
        { "code": "SIN_ESTIMACION_DECLARADA", "reason": "no hay planificacion declarada para este elemento" },
        { "code": "SIN_COMPROMISO_DECLARADO", "reason": "no hay planificacion declarada para este elemento" }
      ],
      "declaration": null
    }
  ],
  "source": { "glpi": "…", "declaration": "…" }
}
```

**Es de solo lectura.** No ejecuta el motor, no guarda un plan y no toca la planificación declarada. Es la única forma de que abrir la pantalla de declaración no tenga efectos.

**Declaración y planificación no son lo mismo.** La planificación es el resultado de colocar el trabajo en un calendario: tiene bloques, asignaciones y desplazamientos, y se guarda. La declaración es lo que el negocio afirma sobre un ticket —cuánto dura y para cuándo— y es una **entrada** del cálculo. Esta lectura pone las dos cosas al lado: lo que GLPI tiene asignado y lo que el negocio ya declaró, sin calcular nada.

**Cinco estados, y ninguno es nuevo.** `declarationStatus` dice en cuál está cada ticket:

| Estado | Qué significa | A quién le toca |
|---|---|---|
| `PLANIFICABLE` | Tiene estimación y compromiso: entraría al plan | A nadie |
| `SIN_ESTIMACION` | Tiene compromiso y le faltan las horas | Al desarrollador asignado |
| `SIN_COMPROMISO` | Tiene horas y le falta la fecha | Al gestor de demanda |
| `SIN_DECLARACION` | Le faltan las dos, o no hay fila | A los dos |
| `NO_TRADUCIBLE` | GLPI lo entrega mal: sin id, tipo o estado desconocido, fecha ilegible | A quien opera GLPI |

**Qué tickets entran y cuáles no.** Esta lectura trae los **activos**: los estados 1 a 4 de GLPI —nuevo, asignado, planificado y pendiente—, y no trae lo solucionado ni lo cerrado (5 y 6), porque ahí no queda trabajo que declarar. El corte lo hace la búsqueda que se le pide a GLPI —viaja como criterio, no se descarta después— y el adaptador **vuelve a comprobarlo** sobre lo que llega, porque una búsqueda que filtra mal no falla: contesta otra cosa. La razón del corte ya estaba escrita en el contrato: `GlpiContract.REST_V1` traduce el 5 y el 6 al mismo estado del dominio —`RESUELTO` en incidencias, `FINALIZADO` en peticiones—, que es justo lo que `Incident.consumesCapacity()` y `Requirement.isPlannable()` excluyen desde antes. **El plan no cambia**: `POST /api/planning/from-glpi` sigue leyendo el histórico entero, porque necesita poder decir por qué descarta lo que descarta (decisión 169).

**Las reglas no están escritas dos veces.** Estos cinco estados no son un vocabulario paralelo: salen de los mismos descartes que produce `GlpiTicketValidator` —el que decide hoy qué entra al plan—, recorridos por el mismo camino que arma la petición del motor. Un ticket marcado `PLANIFICABLE` aquí es uno que `POST /from-glpi` metería al motor, y uno marcado `SIN_ESTIMACION` es uno que descartaría con ese mismo código. **Por construcción, no por coincidencia**, y hay una prueba que lo afirma sobre el mismo ticket por las dos rutas.

**Cada elemento se puede justificar.** `discards[]` trae el código —que es la regla aplicada y no cambia aunque se reescriba el texto— y el motivo en palabras, que nombra el campo concreto a corregir. `source` dice, para la respuesta entera, qué campos vienen de GLPI y cuáles de este sistema. Un ticket puede traer dos descartes: sin declaración falta la estimación, que la debe el desarrollador, y el compromiso, que lo debe el gestor —dos personas distintas, así que se informan las dos—.

**Los nulos son datos, no huecos.** Un ticket de tipo desconocido no tiene `type` ni `status`, y uno con fecha ilegible no tiene `createdAt`. Rellenarlos con algo «razonable» sería inventar justo el dato que el descarte está denunciando.

**Se pregunta una vez por todas las declaraciones.** El identificador del ticket está en GLPI y la declaración en este sistema, así que preguntarla dentro del bucle convertiría una consulta en una por ticket: con una agenda de 1.949 tickets, esa es la diferencia entre una lectura y dos mil. La consulta por lote ya existía para la capa anticorrupción, y esta lectura la reutiliza.

**Un técnico que no está en GLPI responde `404 DEVELOPER_NOT_FOUND`**, igual que el flujo que planifica, y no una lista vacía: un identificador equivocado no es «no tiene trabajo».

### El contrato de GLPI, declarado y comparable

Todo lo anterior funciona **si GLPI responde como se cree que responde**. La Fase 10 no añade recorrido: añade la posibilidad de comprobar que el recorrido es el correcto.

**El contrato es un dato, no código repartido.** Los códigos de `type`, las dos tablas de `status`, la escala de prioridad y el formato de fecha vivían en constantes y `switch` dentro de los mapeadores. Ahora viven en `GlpiContract`, un registro que se declara en `PlanningConfig`:

```java
@Bean
public GlpiContract glpiContract() {
    return GlpiContract.REST_V1;
}
```

Ese es el punto por el que se cambia de variante. Una instancia de GLPI con otros códigos de estado u otra escala de prioridad se adapta devolviendo otro contrato desde ese método, y ni el dominio ni el motor se enteran. Los mapeadores no leen la constante: reciben el bean.

**El verificador compara en lugar de suponer.** `GlpiContractVerifier` recibe el JSON que GLPI devolvió de verdad —copiado de una respuesta, de un registro, de un `curl` hecho a mano— y dice en qué se diferencia del contrato declarado. No consulta GLPI: recibe texto, y por eso se puede ejecutar contra una captura guardada sin que la instancia esté disponible.

```java
Report report = GlpiContractVerifier.verify(respuestaDeGlpi);
```

```json
{
  "adapterVersion": "glpi-rest-3",
  "contractVersion": "glpi-contract-1",
  "verdict": "DEGRADED",
  "tickets": 1,
  "missingRequired": [],
  "unknownFields": ["date_creation"],
  "typeMismatches": [],
  "outOfRangeValues": ["priority=9 fuera de la escala 1..5"],
  "unreadableDates": []
}
```

**Tres veredictos, porque son tres decisiones distintas.** `INCOMPATIBLE` es que falta un campo obligatorio o que uno llega con otro tipo: hay que cambiar el adaptador. `DEGRADED` es que se lee, pero algo entró por un camino de respaldo. `COMPATIBLE` es que todo se lee como se declaró. Un campo desconocido **no baja el veredicto**: que GLPI traiga más de lo que se modela es información, no un problema — y es exactamente cómo se responde la pregunta abierta sobre `date_creation`.

**Un cambio de GLPI se detecta antes de que rompa.** Un nombre de campo distinto aparece en `missingRequired`; una prioridad fuera de escala, en `outOfRangeValues`; un formato de fecha nuevo, en `unreadableDates`. El orden de actuación es siempre el mismo: ejecutar el verificador contra una respuesta capturada, leer el veredicto, y solo entonces decidir.

**Nada de esto toca al motor.** `PlanningEngine` no cambió una línea, y `domain/` sigue sin una sola referencia a GLPI. Lo único que cambió de sitio son las tablas de traducción, que pasaron de `switch` a datos.

### Por qué se desplazó un requerimiento

Un evento de auditoría dice **qué** ocurrió: qué requerimiento se movió, de qué fecha a qué fecha, bajo qué regla y con qué severidad tenía el incidente. El contexto dice **por qué**:

```bash
curl http://localhost:8080/api/planning/3f1c9b7e-.../context
```

```json
{
  "planId": "3f1c9b7e-...",
  "engineVersion": "1.0",
  "calculatedAt": "2026-10-05T13:47:12.004Z",
  "zoneId": "Z",
  "severities": ["ALTO"],
  "rules": {
    "incidentThresholdHours": 4.0000,
    "workingHoursPerDay": 8.0000,
    "planningHorizonDays": 10,
    "incidentPolicies": [ { "severity": "ALTO", "targetOwnershipMinutes": 15, "targetResolutionHours": 4.0000, "displacementPolicy": "POR_CAPACIDAD" } ],
    "calendar": { "startTime": "09:00:00", "endTime": "17:00:00", "weekend": ["SATURDAY", "SUNDAY"], "holidays": [] }
  }
}
```

Las tres severidades se devuelven siempre, aunque el escenario no declare ninguna: lo que se audita es el acuerdo vigente, no el trozo que se usó.

### Con qué datos entró

El contexto dice con qué reglas se decidió; la entrada dice con qué datos. Es la otra mitad de la auditoría, y se lee por `/{planId}/input`:

```bash
curl http://localhost:8080/api/planning/3f1c9b7e-.../input
```

```json
{
  "planId": "3f1c9b7e-...",
  "developerId": "dev-1",
  "source": "GLPI",
  "extractedAt": "2026-10-06T13:47:11.882Z",
  "adapterVersion": "glpi-rest-3",
  "incidents": [
    { "id": "INC-1", "estimatedHours": 6.0000, "reportedAt": "2026-10-05T08:00:00Z", "status": "ABIERTO", "severity": "ALTO" }
  ],
  "requirements": [
    { "id": "REQ-1", "estimatedHours": 8.0000, "plannedDate": "2026-10-08", "status": "PLANIFICADO" }
  ]
}
```

Desde la Fase 9 la entrada declara además **de dónde vino**: `source` es `HTTP` o `GLPI`, `extractedAt` es el instante de la extracción y `adapterVersion` la versión del adaptador que tradujo. Los planes calculados antes de esa fase se leen como `HTTP`, que es lo que eran. Sin esos tres campos, un plan traído de GLPI y uno escrito a mano serían indistinguibles en la auditoría, y la pregunta «¿por qué se planificó esto?» no tendría la primera respuesta.

Sin `title` y sin el nombre del desarrollador: el motor no los lee, así que no se guardan. Se guardan también los elementos que el motor descartó —un incidente `RESUELTO`, un requerimiento `FINALIZADO`—, porque la foto es de lo que **entró**, no de lo que se usó. Un plan calculado antes de la Fase 8 no tiene entrada registrada y responde `404`, que es distinto de una entrada vacía: un escenario sin incidentes ni requerimientos sí guarda su entrada, en blanco.

### Repetir la misma petición no duplica nada

El motor protege contra reprocesamiento por pareja *(incidente, requerimiento)*. Volver a enviar el mismo escenario devuelve **el mismo plan** y `rescheduleEvents` vacío: el desplazamiento ya estaba auditado, y lo sigue estando después de reiniciar la aplicación. Desde la Fase 6 el registro vive en la tabla `reschedule_claim`, con una restricción de unicidad sobre la pareja, y esa restricción —y no una consulta previa— es la que decide: dos peticiones simultáneas pueden leer las dos «no reclamado», pero solo un insert sobrevive. `PlanningEngine` no cambió una línea entre la implementación en memoria y esta.

### La fotografía operativa de la planificación

Todas las lecturas anteriores piden un plan. **`GET /api/planning/metrics`** es la primera que no: devuelve una fotografía del conjunto —qué puede planificarse, qué no, dónde están los cuellos de botella y cuánta capacidad queda— construida **solo con lo ya persistido**. No ejecuta el motor, no genera planes y no consulta GLPI.

La respuesta son **tres bloques**, porque son tres regímenes de dato distintos, y cada uno declara dentro del propio JSON de dónde sale y sobre qué se contó: un contador sin su procedencia es un número ambiguo.

| Bloque | Qué responde | Fuente | Ámbito |
|---|---|---|---|
| `declared` | Qué puede planificarse y qué no | `planning_metadata` | El estado declarado **hoy**, sin ventana temporal |
| `plans` | Cuánto se ha planificado | `plan_snapshot` | El histórico completo: una fila por ejecución guardada |
| `current` | Cuánta capacidad queda y cuánto se movió | El timeline de cada plan vigente | El plan vigente de cada desarrollador |

Las nueve métricas del brief, con el campo por el que se leen:

| # | Métrica | Campo |
|---|---|---|
| 1 | Tickets planificables | `declared.plannable` |
| 2 | Tickets sin estimación | `declared.withoutEstimation` |
| 3 | Tickets sin compromiso | `declared.withoutCommitment` |
| 4 | Tickets sin metadata completa | `declared.incomplete` |
| 5 | Requerimientos desplazados | `current.displacedRequirements` |
| 6 | Capacidad disponible | `current.capacity.availableHours` |
| 7 | Capacidad ocupada | `current.capacity.occupiedHours` |
| 8 | Capacidad restante | `current.capacity.remainingHours` |
| 9 | Total de planes generados | `plans.generated` |

Además de los totales, `current.byDeveloper[]` trae el desglose por desarrollador, con su `planId` y su `calculatedAt`, para poder volver al plan del que salió cada número.

**Los códigos de descarte no se inventan.** `withoutEstimation` y `withoutCommitment` viajan con el código que la capa anticorrupción ya usa —`SIN_ESTIMACION_DECLARADA` y `SIN_COMPROMISO_DECLARADO`—, tomado del enum y no copiado como texto, para que un descarte y una métrica no puedan nombrar la misma carencia de dos formas. Lo que cuentan no es «la ACL descartó esto», que no se puede saber, sino **cuántas filas declaradas producirían hoy ese descarte si se planificaran ahora**.

**La capacidad no se recalcula: se lee del timeline.** El endpoint llama a `/{planId}/timeline` por cada plan vigente y suma lo que esa proyección ya devuelve, así que **las métricas y la interfaz no pueden discrepar** —una prueba suma los arrays que devuelve el timeline y los compara con los del endpoint, en vez de compararlos con constantes escritas a mano—. Es la única aritmética que hace, y la hace sobre datos ya calculados.

**Vigencia: el plan más reciente de cada desarrollador**, por `created_at`, con desempate estable por identificador. No se agregan los planes históricos porque **duplicarían la capacidad y la carga**: dos planes del mismo desarrollador no son el doble de jornada. El criterio viaja en la respuesta —`scope`, `planId`, `calculatedAt`— para que se compruebe en los datos y no en la prosa.

**Limitaciones, dichas donde se leen.** «Sin estimación» y «sin compromiso» miden el **estado declarado de hoy**, no los descartes que una ejecución anterior de la capa anticorrupción observó: los descartes no se persisten (decisión 99), y reconstruirlos exigiría persistencia nueva, que esta fase no introduce (decisión 140). `plans.generated` cuenta **ejecuciones, no planes distintos**: guardar un plan no es idempotente, cada `POST /plan` inserta un identificador nuevo. Y `declared` y `current` **no son comparables entre sí** —el primero cambia con cada `PUT`, el segundo solo cuando alguien vuelve a planificar—, así que **no se expone ninguna tasa de ocupación**: dividir esos dos números daría un indicador que no mide nada (riesgo 69).

### De la cifra al elemento: el drill-down

Una fotografía que dice «sin estimación: 4» deja la pregunta en el mismo sitio: **cuáles son esos cuatro**. La observabilidad dice que hay un problema y no deja actuar sobre él. Cuatro de las nueve tarjetas llevan ahora a la **lista de los elementos que las producen**, con su causa, su desarrollador y su plan —sin recalcular nada: cada lista sale de la misma información que ya cuenta la tarjeta.

| Tarjeta | Ruta | Endpoint | Fuente |
|---|---|---|---|
| Sin estimación | `/metricas/sin-estimacion` | `GET /api/planning/metrics/declared/SIN_ESTIMACION` | `planning_metadata` |
| Sin compromiso | `/metricas/sin-compromiso` | `GET /api/planning/metrics/declared/SIN_COMPROMISO` | `planning_metadata` |
| Metadata incompleta | `/metricas/metadata-incompleta` | `GET /api/planning/metrics/declared/METADATA_INCOMPLETA` | `planning_metadata` |
| Requerimientos desplazados | `/metricas/desplazados` | `GET /api/planning/metrics/displaced` | El plan vigente y su auditoría |

Las otras cinco —planificables, planes generados y las tres de capacidad— **no se enlazan**, y es deliberado: `plans.generated` cuenta ejecuciones sin identidad propia, y la capacidad es un agregado sin lista de elementos. Una prueba afirma que su tarjeta no contiene ningún enlace, para que reponer una ruta inexistente se note.

**El mecanismo elegido es una página dedicada**, sobre el patrón que ya existía en `/calendario/:planId`. Se evaluaron cuatro: un **panel lateral** exigiría escribir a mano trampa de foco, `aria-modal`, cierre con `Esc` y bloqueo del scroll —la única Radix instalada es `@radix-ui/react-slot`, así que no hay primitiva de diálogo— a cambio de una pantalla sin URL propia que no se puede compartir ni enlazar; una **tabla expandible** tiene el mismo coste de accesibilidad y empuja el layout; y la **combinación** de ambas obligaría a mantener dos mecanismos para lo mismo. La página da URL compartible, atrás y adelante del navegador gratis, y `MainLayout` la envuelve sin escribir nada. **No se añadió ninguna dependencia** (decisión 144).

**La cuarta pregunta del brief no necesitó contenedor nuevo.** «¿Qué desarrolladores tienen capacidad agotada?» ya se responde resaltada en la tabla de cuellos de botella, y su detalle es la vista Timeline que ya existe: lo único que faltaba era llegar, así que la celda `Plan` deja de ser texto y pasa a ser un enlace a `/calendario/:planId`.

**Antes de crear nada se comprobó qué había.** «Sin estimación» y sus dos hermanas no tenían ninguna lectura de listado —`findByWorkItemIdIn` exige conocer los identificadores de antemano—, así que los dos endpoints son nuevos; pero **todo lo demás se reutilizó sin tocar una línea**: la fila declarada es el `PlanningMetadataResponse` que ya publicaba `GET /api/planning-metadata/{workItemId}`, con `commitmentOverdue` calculado, y la causa del desplazamiento es el `RescheduleEventView` que el plan ya entrega en `rescheduleEvents`, con su `reason`, su regla y su severidad. **`PlanningService` no cambió** —`reason` y `toEventView` siguen siendo privados— y `PlanningEngine`, las reglas, la integración con GLPI, la Timeline y la proyección de métricas siguen sin tocarse.

**La lista y el contador no pueden discrepar, por construcción.** El detalle declarado usa el mismo predicado sobre la misma tabla que el contador —`countByEstimatedHoursIsNull()` y `findByEstimatedHoursIsNull…()` son la misma condición escrita dos veces por Spring Data—, y los desplazamientos agrupan **los mismos eventos** de los que sale la marca `DESPLAZADO` del timeline. Las pruebas lo anclan comparando `items.length` contra la cifra que publica `/metrics`, leída en la misma prueba, y no contra un número escrito a mano.

**Un requerimiento desplazado dos veces es una fila con dos eventos**, no dos filas: la tarjeta cuenta **elementos** y su detalle también. La tabla de desplazados muestra además el rango de fechas, el incidente que movió, la regla aplicada y el motivo, todos leídos de la auditoría del plan. El coste es `N + d` lecturas por petición —un timeline por plan vigente, más el plan de cada desarrollador que sí tenga desplazamientos—, y es el precio de que las dos cifras no puedan discrepar.

**Limitaciones del detalle declarado.** `planning_metadata` guarda **quién declara** (`estimatedBy`, `committedBy`), no **quién planifica**: el desarrollador asignado no está en esa tabla y nombrarlo exigiría consultar GLPI. Las columnas se rotulan por lo que son —«Estimado por», «Comprometido por»— y una fila retirada, que no tiene ninguno de los dos valores, se ve con su guion en vez de con un cero que afirmaría una estimación de cero horas. El título del `Header` cae al valor por defecto en `/metricas/:gap`, porque la ruta no está en el menú lateral.

### De la métrica a la alerta: la observabilidad activa

Nueve contadores describen un estado, y ninguno dice **cuál de esos estados exige que alguien actúe**. `GET /api/planning/alerts` es la misma fotografía con la pregunta ya contestada: solo las condiciones que hoy se cumplen, de más grave a menos. **No recalcula nada** —no ejecuta el motor, no consulta GLPI y no lee la base por un camino distinto al de `/metrics`—: lee la respuesta de la fotografía y la cuenta. Es lo que significa que las alertas sean una proyección: no es una promesa, es que no existe un segundo camino que pudiera separarse del primero.

| Alerta | Severidad | `count` sale de | `detailUrl` |
|---|---|---|---|
| `CAPACIDAD_NEGATIVA` | **CRITICAL** | `current.byDeveloper[]` con `remainingHours < 0` | *(nulo)* |
| `REQUERIMIENTOS_DESPLAZADOS` | **WARNING** | `current.displacedRequirements` | `GET /api/planning/metrics/displaced` |
| `CAPACIDAD_AGOTADA` | **WARNING** | `current.byDeveloper[]` con `remainingHours == 0` | *(nulo)* |
| `SIN_ESTIMACION` | **WARNING** | `declared.withoutEstimation.count` | `GET /api/planning/metrics/declared/SIN_ESTIMACION` |
| `SIN_COMPROMISO` | **WARNING** | `declared.withoutCommitment.count` | `GET /api/planning/metrics/declared/SIN_COMPROMISO` |
| `METADATA_INCOMPLETA` | **INFO** | `declared.incomplete` | `GET /api/planning/metrics/declared/METADATA_INCOMPLETA` |

**Una alerta es una condición, no un elemento.** Lleva *cuántos* elementos la producen y a dónde ir a verlos; no lleva los elementos. Un equipo de veinte desarrolladores con la jornada agotada produce **una** alerta con `count: 20`, no veinte alertas. Solo se lista lo que se cumple: cuando no hay nada, `alerts` va vacío —que es el estado que una alerta existe para poder declarar— y la respuesta sigue viniendo fechada, porque sin fecha «no hay nada que mirar» y «no se ha mirado» se leerían igual.

**La severidad no se inventa: se hereda de condiciones que el backend ya distingue.** Un criterio por nivel, y ninguno es un umbral. **CRITICAL** es el estado que **se contradice a sí mismo**, y solo hay uno: capacidad restante negativa —un plan que ocupa más de lo que su propio calendario permite—, que `TimelineCapacity` ya declara imposible y `Capacity` se niega a recortar a cero precisamente para que se vea. **WARNING** es un estado **legal pero con dueño**: la capacidad *exactamente* agotada significa que el siguiente requerimiento desplaza a otro; un requerimiento desplazado es trabajo que no llegó a su fecha comprometida; y las dos carencias declaradas son **literalmente los dos motivos por los que la capa anticorrupción descarta un ticket**, cada una nombrando a una persona distinta que tiene que actuar —el desarrollador estima, el gestor compromete—. **INFO** es un **agregado sin dueño único**: `METADATA_INCOMPLETA` es la *unión* de las dos carencias anteriores, y subirla a aviso inflaría la cuenta de lo que urge con trabajo ya contado dos veces; su oficio es decir cuánto está incompleto, no reclamar.

**Cada alerta se explica sola**, sin abrir esta documentación: lleva su `type`, su `severity`, su `source` y su `scope` —los mismos textos que publica `/metrics` para el bloque del que sale el número, tomados de sus constantes y no copiados—, su `condition` en palabras —«filas de planning_metadata con estimated_hours nulo»—, su `count`, su `detailUrl` y su `generatedAt`. **`detailUrl` es una ruta de esta API**, no de la interfaz: el backend no conoce el prefijo con el que se sirve la aplicación ni si va detrás de un proxy, y publicar la pantalla sería la tercera copia de un hecho que ya tiene dos dueños en el frontend. Una ruta de la API, en cambio, **se puede recorrer**: una prueba pide cada `detailUrl` publicado y exige que responda y que el número de elementos cuadre con el `count` de la alerta, así que el literal deja de ser una promesa. Cuando la alerta no tiene listado propio el campo **viaja igual, con nulo**, para que el esquema sea el mismo en las seis —el precedente ya existía: el `code` del detalle declarado viaja nulo para `METADATA_INCOMPLETA`—.

**El catálogo es un enum**, `OperationalAlertType`, y ahí están escritas la severidad, la condición y el destino de cada alerta; el servicio solo aporta el número. Añadir una alerta sin decir cuánto urge no compila.

**Limitaciones, dichas donde se leen.** Las alertas **clasifican, no particionan**: una fila sin ninguno de los dos valores se cuenta en `SIN_ESTIMACION`, en `SIN_COMPROMISO` y en `METADATA_INCOMPLETA` a la vez —correcto, porque cada alerta responde a una pregunta distinta sobre el mismo elemento—, así que **sumar los `count` no mide nada** y no se publica ningún total. **Las dos alertas de capacidad miden el plan, no el día**: el restante que miran es el del plan vigente entero, que es el que publica `/metrics` y el que el tablero ya colorea fila a fila; un lunes exactamente lleno con holgura el martes **no dispara** la alerta —el detalle día a día sigue en el calendario del plan—, y contar por día daría además un falso positivo por cada sábado y domingo de la ventana, porque una jornada no laborable tiene cero disponible y cero ocupado. **La alerta de capacidad negativa no puede dispararse hoy**: el motor nunca sobrepasa la jornada, así que un restante negativo no ocurre por el camino real; existe como canario, se prueba donde el estado se construye a mano y sobre datos reales se prueba que **no** suena. **Dos de los seis contadores no existen en la fotografía** —los dos de capacidad—: son los únicos que la alerta calcula, y los calcula filtrando `byDeveloper[]` con los dos mismos predicados que la tabla de cuellos de botella ya usa. Y **un plan vigente roto tumba las alertas enteras**: si `/metrics` responde `404 PLAN_NOT_FOUND`, ese `404` sale sin recortarlo, porque una lista calculada sobre una fotografía incompleta diría que no hay problemas donde no se ha mirado.

### El centro de alertas en la interfaz

La Fase 19 dejó las alertas publicadas y **sin consumidor**: la única forma de verlas era pedir el endpoint a mano. **`/alertas`** es esa lista convertida en pantalla —la segunda entrada del menú lateral, justo después del Dashboard— y **no añade una sola regla**: consume exclusivamente `GET /api/planning/alerts` y pinta lo que recibe.

| Qué se ve en la fila | De dónde sale |
|---|---|
| `severity` | El badge, con un color por nivel. No hay umbrales en la vista: `CRITICAL`, `WARNING` e `INFO` son las tres clases que el enum del backend declara, y el mapa es total sobre ellas —añadir un nivel sin darle color no compila— |
| `type` y `condition` | Tal como llegan. La condición la escribe el backend; la vista solo la pinta |
| `count` | El número que produjo la alerta. **No hay total**: las alertas clasifican, no particionan, y sumarlas no mediría nada |
| `source` y `scope` | De dónde sale la condición y sobre qué universo. Los mismos textos que publica `/metrics` para el bloque del que sale el número |
| `detailUrl` | Traducido a la pantalla del desglose, o dicho con palabras cuando no hay ninguna. Ver abajo |
| `generatedAt` | El instante de la evaluación, arriba y a la vista en un `<time>`, y en el `title` de cada fila |

**El orden de la pantalla es el orden de la respuesta.** El backend ya las manda de más grave a menos, así que la vista **no ordena**: un `sort` en el cliente sería una segunda regla de prioridad invisible, encima de la del backend. Una prueba le entrega la respuesta al revés y exige que la tabla salga al revés también, que es la única forma de demostrar que no hay un orden escondido.

**Los filtros son de la vista y se aplican en memoria.** Severidad y tipo, con `<select>` nativos que filtran el array ya recibido —el mismo patrón que los filtros de la Timeline— y **sin generar ninguna llamada**: la proyección no acepta parámetros, así que filtrar en el servidor no sería más barato, sería imposible. Las opciones de cada filtro **salen de la respuesta**, no de un catálogo escrito en la vista: un tipo nuevo aparece en el desplegable el día que el backend lo publica. Y filtrar hasta dejar la lista vacía **no es lo mismo que no tener alertas**: «Ninguna alerta coincide con los filtros» y «Ninguna condición exige atención ahora» son estados distintos y la pantalla los escribe distinto. La lista vacía, además, va fechada —sin fecha, «no hay nada que mirar» y «no se ha mirado» se leerían igual—.

**El `detailUrl` se traduce en un solo sitio y sin inventar destinos.** El backend publica una ruta **de su API** (decisión 148), no de la interfaz; `alertDetailPath()`, en `routes/navigation.ts`, junto a la `metricPath()` que ya hacía el viaje de ida, es quien la convierte en pantalla. La tabla que hace la vuelta **se deriva de `METRIC_GAPS`** —la que ya relacionaba el token de la URL con la constante de la API— más el token de desplazados: escribirla a mano sería la tercera copia de un hecho que ya tiene dos dueños. La acción «Ver el desglose» **solo aparece si la traducción existe**, así que los cuatro enlaces reusan las páginas de la Fase 18 sin abrir ninguna nueva. Las dos alertas de capacidad, que viajan con el campo nulo, lo dicen con esas palabras —«Sin desglose propio: el detalle está en el calendario del plan»— en vez de ofrecer un botón que no lleve a ninguna parte. Y una ruta que esta aplicación **no** sepa abrir —porque el backend publicara un listado nuevo— se enseña tal cual, en monoespaciada, en vez de dejar un hueco mudo o de convertirla en un destino inventado.

**Navegación.** La pantalla entra al menú lateral como **Alertas**, con `/alertas` en `ROUTES` y un `NavItem` más, el mismo que usan las demás: el `Header` toma el título de ahí, así que no hay ninguna cadena duplicada. Las filas **no son enlaces**: lo que se abre es el desglose de la condición, no la alerta, y una alerta no tiene identificador porque no es una entidad —es una condición evaluada en el momento de la consulta—.

**Limitaciones.** Es una pantalla de **solo lectura**, y no por falta de tiempo: las alertas se derivan en cada consulta, así que **no hay nada que reconocer, cerrar ni descartar** —no hay estado que guardar—. Una alerta no tiene identificador: su identidad es su `type`, que aparece una sola vez porque el catálogo es un enum. No hay historial —qué se disparó ayer y cuándo dejó de hacerlo— porque nada se persiste, y no hay contadores globales —cuántas alertas hay, cuántas son críticas— porque sumarlas no mide nada. Y la pantalla **tampoco avisa: hay que ir a mirarla**.

**Preparación para futuras notificaciones.** Esta pantalla es el **centro de notificaciones en su forma mínima**: lo que notifica está a la vista, y nada más. **No hay correo, ni Teams, ni push, ni scheduler, ni job**, y no es una omisión sino el alcance: lo que falta para notificar de verdad no es el canal, es **el destinatario y la memoria**. Lo que ya está resuelto es lo que una notificación tendría que decidir *antes* de salir: **qué** merece interrumpir a alguien —el catálogo y su severidad, escritos una sola vez y heredados de condiciones que el backend ya distingue—, **de dónde sale** la condición —`source` y `scope` viajan en cada alerta— y **a dónde mandar** a quien la reciba —`detailUrl`, que el frontend ya sabe traducir a una pantalla—. Lo que falta es todo lo demás: **a quién** se le manda —el `source` dice de dónde sale la condición, no quién la arregla, y eso es lo que el riesgo 76 dejó abierto—, **dónde se recuerda lo ya enviado** —una alerta no se persiste, así que hoy no habría forma de saber si una condición ya se notificó o lleva tres días sonando— y **con qué se decide que dejó de sonar**, que es exactamente la misma pregunta que «dejó de cumplirse». El contrato ya lleva la costura: `type` como identidad estable, `severity` como clave de enrutado, `detailUrl` como carga útil y `generatedAt` como sello.

### La vista consolidada de equipo

El tablero ya enseñaba los cuellos de botella por desarrollador y la Timeline ya abría la agenda de **un** plan. Lo que faltaba era poder **comparar** esos planes: poner el de cada uno al lado del otro y ordenarlos por lo que a uno le interese mirar. **`/recursos`** es eso.

**La pantalla representa personas, no identificadores.** Durante veintiuna fases la fila del equipo se identificó con el `developerId`, que es la clave con la que se pide todo lo demás pero **no es nadie**: quien lee la tabla no reconoce a `dev-001`, reconoce a Ana Pérez. La Fase 29 giró la vista alrededor de la persona —**el nombre es la identificación y el identificador es el dato técnico**, en su propia columna, en monoespaciado y sin peso, ahí para copiarlo y no para leerlo— y la Fase 30 cerró lo que a ese giro le faltaba: **una persona sin plan vigente ya aparece**.

**Quién está en la tabla lo decide el padrón del equipo** (`GET /api/team`), que es la primera lectura del sistema que enumera personas. Antes la tabla se armaba con planes porque era lo único enumerable, y por eso quien no tenía uno no existía para ella. Hoy el padrón decide quién está y publica su nombre, su número de GLPI y su vigencia; la fotografía operativa aporta la capacidad y los desplazamientos, la declaración del técnico aporta los tickets y la lista de renegociaciones aporta las pendientes. **Se cruzan por el identificador y ninguna cifra se recalcula aquí.**

**La vista no crea un plan de equipo.** No fusiona planes, no suma tramos y no recalcula capacidad. Cada fila lleva **el plan que ya existe** —o ninguno— y cada cifra es la que el backend publicó para él. Lo único que la vista aporta es la comparación —ordenar por una columna— y la navegación hacia el detalle, que también existía.

| Qué se ve en la fila | De dónde sale |
|---|---|
| Nombre | `name` del padrón. **Es la identificación de la fila**; si GLPI no lo publica, la fila se queda con su identificador y lo dice |
| `developerId` | El login con el que el padrón nombra a la persona. Columna propia, en monoespaciado y sin peso: dato técnico |
| Origen | Una insignia **solo cuando no es `GLPI`**: «Excepción» si está en el equipo por una excepción declarada, «Solo plan» si no está en el padrón y aparece porque tiene un plan |

**Cada fila es una persona, y su plan puede faltar.** Una persona sin plan vigente se ve igual, con su columna de capacidad en «sin plan» en vez de con tres ceros que afirmarían una capacidad que nadie calculó. Y el plan se busca por **las dos claves** con las que pudo pedirse —el login o el número de GLPI—, porque un plan guardado tecleando el número es el plan de esa misma persona y no una segunda fila: sin esa segunda búsqueda, Nicolás Suárez aparecería dos veces.

**Un plan no puede desaparecer de la pantalla por no estar en el padrón.** Si un plan guardado tiene un `developerId` que el padrón no conoce, se añade al final marcado como «Solo plan» en vez de descartarse: perder de vista trabajo ya calculado es peor que una fila con una procedencia incógnita. Es el único origen que **no publica el backend**, y la vista lo dice para que no se confunda con alguien del equipo.

| Qué se ve en la fila | De dónde sale |
|---|---|
| Tickets | Los `items[]` de `GET /api/planning-metadata/declarations/{developerId}`: **cuántos tickets activos tiene hoy en GLPI**. Activos son los estados 1 a 4 —nuevo, asignado, planificado y pendiente—; lo solucionado y lo cerrado no se piden siquiera, porque no queda trabajo ahí (decisión 169). Es lo que hace visible el trabajo que el plan todavía no ve |
| `capacity.availableHours` / `occupiedHours` / `remainingHours` | Los tres números del plan, tal como llegan. **No se suman, no se restan y no se recortan**: el restante negativo se ve con su signo, y sin plan la celda dice «Sin plan» |
| `displacedRequirements` | Los elementos que ese plan desplazó, con enlace a su desglose cuando hay alguno |
| Renegociaciones pendientes | Los `items[]` de `GET /api/renegotiations` —**una sola consulta para todo el equipo**— filtrando los que están `PENDIENTE_DE_ACUERDO`, contados en la vista porque el backend los manda por elemento y no por persona |
| `planId` | El plan vigente, enlazado a su agenda —el mismo recurso que el calendario de la Fase 16—, con la ventana que cubre y el instante en que se calculó |
| Alertas | Las que esta persona produce por sí sola —capacidad agotada o negativa, y desplazamientos—, con enlace al centro de alertas |
| Capacidad agregada | Los tres totales de `current.capacity`, arriba y en tarjetas: **se publican, no se calculan** |
| Alertas activas del conjunto | Las del catálogo, en el orden en que el backend las manda |

**El nombre ya no cuesta una petición por persona.** Hasta la Fase 29 se pedía la declaración de cada fila para poder nombrarla —cuarenta lecturas para un equipo de cuarenta—. Ahora lo publica el padrón, **una sola lectura para todo el equipo**, y la declaración se sigue pidiendo por los tickets. **Se pide por todo el que está en la tabla**, tenga plan o no: hasta la Fase 32 se pedía solo por quien tenía plan vigente, y eso dejaba a las personas sin plan con «Sin dato» en una lectura que nunca se intentó. Cuesta **una lectura por persona la primera vez** —cacheadas después—, y a cambio **cero y «sin dato» dejan de confundirse**: quien no tiene tickets activos dice «Sin tickets», que es un cero verificado, y «Sin dato» queda solo para lo que de verdad no se pudo leer.

**Plan individual y vista de equipo no son lo mismo, y la vista no los confunde.** Un plan individual es la agenda de **una** persona para una ventana: tiene tramos, días, horas y reglas aplicadas, y se lee en `/calendario/{planId}`. La vista de equipo es una **fila por persona**, sin tramos y sin días: sirve para decidir a quién mirar, no para ver qué hace. Por eso **no hay mini timeline por fila** (decisión 154): pedir la agenda de cada desarrollador sería una petición por plan —el coste O(planes) que los riesgos 75 y 85 ya señalan— y, peor, volvería a calcular la capacidad día a día, que podría discrepar de los totales publicados. El día a día ya existe, a un clic, en el plan de cada fila.

**Ordenar es una acción del usuario, y el orden de partida sigue siendo el del backend.** El brief pide ordenación visual, así que la cabecera es un botón: el primer clic ordena por esa columna y el segundo la invierte, con la dirección declarada en `aria-sort` para que un lector de pantalla sepa por dónde va la tabla. Sin tocar nada, el orden es el que entregó el backend —por identificador, con la vigencia ya resuelta—, así que la vista **no impone una prioridad propia**: solo mueve filas cuando alguien se lo pide. Los números se comparan como números —una prueba fabrica un 9 y un 80, que como texto saldrían al revés— y los empates se rompen por `developerId`, para que el orden sea estable y no dependa del motor de turno. **Lo que no se pudo leer ordena como `-1` y no como `0`**: al ordenar ascendente la fila sin dato queda arriba, a la vista, en vez de confundirse con las que sí se leyeron y no tienen nada.

**La columna de alertas cuenta lo que la fila produce, no lo que el catálogo dice.** Las alertas **no tienen dimensión de desarrollador** (riesgo 76): las dos de capacidad son del conjunto, y su desglose por persona es, literalmente, esta tabla. La vista **no re-deriva** ese reparto —sería la tercera copia de un predicado que el backend ya aplica— ni **nombra los tipos**, que viven en el enum del backend y en la vista serían una segunda copia que solo se descubre el día que discrepen. Lo que hace es contar las **dos condiciones que sí tienen dueño** —capacidad agotada o negativa, con el mismo `remainingState` que pinta el resto, y desplazamientos sobre un plan vigente, que es esta misma fila— y enlazar al centro de alertas, donde están contadas y nombradas. Las otras cuatro se evalúan sobre lo declarado y no sobre un plan, así que son del conjunto: la tarjeta lo dice en vez de repartirlas. **Una persona sin plan vigente no produce ninguna** —no es que esté todo bien, es que no hay nada que medir— y por eso su celda queda vacía en vez de con un cero.

**Lo que no se pudo leer se declara y no se rellena.** `null` no es `0` en ninguna celda: un nombre que GLPI no publica deja la fila con su identificador y el motivo, una lectura caída deja «Sin dato» en vez de un cero que afirmaría un hecho que nadie comprobó, y una persona sin tickets dice «Sin tickets» —que es un cero verificado— y no «Sin dato». Un técnico con plan que GLPI no conozca cuesta una petición fallida y **no se lleva las otras filas**: cada consulta de declaración falla sola.

**Un GLPI que no responde no se lleva la pantalla, y tampoco se esconde.** El padrón contesta `200` con las excepciones declaradas y el fallo dentro de la respuesta, así que la tabla sigue en pie con quien se pudo saber, y la vista lo enseña **entero** —que no se pudo, qué grupo se intentó leer y por qué, con el motivo que da la propia integración—. Se declara así porque en ese estado la tabla no está incompleta por casualidad: le faltan justo las personas que solo GLPI conoce. Si lo que se cae es el padrón entero, las filas salen de los planes que ya existen y el fallo se dice: un plan guardado no desaparece de la pantalla porque una lectura no haya respondido.

**Limitaciones, dichas donde se leen.** Las alertas y las renegociaciones se leen **en su propia consulta y fallan por su cuenta**: si una se cae, la tabla sigue en pie y el fallo se declara donde se ve su efecto —la tarjeta de alertas, o la columna de pendientes quedándose en «Sin dato»—, no en toda la pantalla. La vista es de **solo lectura** —no hay edición, ni alta, ni baja, ni calendarios individuales—: el mantenimiento de recursos sigue pendiente y esta pantalla no lo adelanta. Y la tabla no cabe en un móvil: se desplaza en horizontal, como la del centro de alertas (riesgo 92).


### Declarar la planificación de un técnico

La Fase 23 dejó una lectura de las declaraciones de un técnico **y ningún sitio donde usarla**: la única forma de ver los cinco estados era pedir el endpoint a mano, y la única de declarar, llamar a `POST /api/planning-metadata` con un `curl`. **`/declaraciones`** —la entrada **Declaración** del menú— cierra el flujo entero: `GLPI → tickets asignados → estimación → compromiso → PlanningMetadata`. **No estrena backend**: consume la lectura de la Fase 23, lee el recurso de un ticket antes de reemplazarlo y escribe con los dos endpoints que ya existían.

**El flujo, de principio a fin.**

| Paso | Qué ocurre | Dónde |
|---|---|---|
| 1 | Se escribe el identificador del técnico y se consulta | `/declaraciones` |
| 2 | Se leen sus tickets asignados en GLPI **y** su planificación declarada, en una sola petición | `GET /api/planning-metadata/declarations/{developerId}` |
| 3 | Cada ticket llega ya clasificado, con lo que le falta y por qué | `declarationStatus` y `discards[]`, calculados en el backend |
| 4 | Se declara la estimación —las horas— o el compromiso —la fecha— | `POST` si el ticket no tenía nada, `PUT` si ya tenía fila |
| 5 | La escritura queda en `planning_metadata`, con su autor y su sello, y en su historial | Backend, sin cambios en esta fase |
| 6 | La lista se relee sola y la fila aparece con su estado nuevo | Invalidación de la consulta, sin recargar la página |

**La pantalla no clasifica nada, y eso es lo que la hace correcta.** Sería fácil pintar el estado de cada fila mirando si tiene horas y si tiene fecha, y sería la segunda versión de la regla que ya aplica `GlpiTicketValidator` —la que no falla el día que se escribe, sino el día que cambia la otra—. La tabla pinta `declarationStatus` y los `discards[]` tal como llegan, con su código y su motivo, y la prioridad se enseña cruda en su escala 1..5, sin traducirla a severidad: esa normalización es del motor y aquí todavía no ha ocurrido.

**Los cinco estados, en la columna de la derecha.**

| Estado | Qué se ve | Acción de la fila |
|---|---|---|
| `PLANIFICABLE` | Tiene estimación y compromiso | Editar |
| `SIN_ESTIMACION` | Le faltan las horas: las debe el desarrollador | Editar |
| `SIN_COMPROMISO` | Le falta la fecha: la debe el gestor de demanda | Editar |
| `SIN_DECLARACION` | Le faltan las dos, o no hay fila | Declarar si no hay fila; Editar si la hay |
| `NO_TRADUCIBLE` | GLPI lo entrega mal: sin tipo, sin estado o con la fecha ilegible | Declarar |

**Los campos que se declaran son dos, y los pone el negocio.** `estimatedHours` lo define el desarrollador asignado y `committedDate` el gestor de demanda —es la decisión funcional de la Fase 13—, y ninguno de los dos vive en GLPI. El tercer campo del formulario, `changedBy`, no es un dato del ticket: es **quién está declarando**, y viaja con la escritura para que el historial pueda responder quién, cuándo y de qué a qué.

**Se lee antes de escribir, porque el `PUT` reemplaza.** Abrir el formulario de un ticket que ya tiene declaración lanza una lectura fresca de `GET /api/planning-metadata/{workItemId}` y no enseña ningún campo hasta que llega. No es ceremonia: rellenar con lo que traía el listado —una foto de hace un minuto— y guardar borraría lo que alguien cambió en ese minuto. Por el mismo motivo el cuerpo que se envía lleva **siempre los dos valores**: un formulario que mandara solo la fecha al guardarla borraría la estimación. Un campo vacío se manda como nulo, que es «retíralo» y no «no lo toques» —retirar un valor es una operación legítima y queda registrada con su autor—.

**El verbo lo decide la fila, no el estado.** Un ticket con los dos valores retirados se clasifica `SIN_DECLARACION` pero **tiene fila**, así que lo que le corresponde es reemplazarla. Si el verbo saliera del estado, ese caso mandaría un `POST` sobre algo que ya existe y el backend respondería `409`: la pantalla convertiría un caso normal en un error.

**Después de guardar se invalida lo justo, y nada más.** La lista del técnico se relee en el acto —es lo que hay que ver cambiar—, y el recurso del ticket solo se marca viejo, sin releerlo: en ese instante el formulario todavía está montado y pediría exactamente los valores que se acaban de guardar. La relectura ocurre la próxima vez que se abra el formulario, que es cuando hace falta. No hay recarga de página, y la fotografía operativa, las alertas y el timeline no se tocan: miden otras cosas y no cambiaron porque alguien declarara unas horas.

**Los errores son del backend y se enseñan con sus palabras.** Un `400` de validación, un `404` y un `409` de conflicto dicen cosas distintas, y reescribirlos aquí sustituiría el diagnóstico por uno peor. El `409` es además un caso legítimo —alguien declaró primero— y no un fallo de la pantalla: la fila se queda como estaba y el mensaje dice qué pasó.

**Limitaciones, dichas donde se leen.** El técnico **se escribe a mano**: el backend no publica el padrón de personas (riesgo 91), así que el selector es un campo de texto y un identificador equivocado responde `404` con el mensaje del backend. **`changedBy` lo teclea el operador**, porque no hay autenticación: el historial de `planning_metadata` es la auditoría de quién cambió qué, y su autor es un campo libre —es la limitación que ya existía en el backend, y la pantalla no la empeora ni la disimula—. La pantalla **no pagina ni filtra**: un técnico con muchos tickets activos pinta una fila por ticket, y el filtro natural —por `declarationStatus`— todavía no se aplica (riesgo 106). Y **los tickets que aparecen son los activos**: lo solucionado y lo cerrado no se piden siquiera, porque no queda trabajo que declarar en ellos (decisión 169). Antes de la Fase 31 esta lista traía también lo cerrado —era paridad con lo que el plan recibe—, y por eso un técnico con 1.266 tickets cerrados llenaba la tabla con 1.266 filas: el **riesgo 109** queda cerrado.

---

### Renegociar lo que un incidente desplazó

El motor detecta desde la Fase 3 que un incidente le quita a un requerimiento su franja: deja un `RescheduleEvent` auditado, lo marca `DESPLAZADO` en el timeline y lo declara `PENDIENTE_DE_RENEGOCIACION`. Lo que no existía era **la operación con la que una persona confirma a qué fecha se llegó**, porque eso se habla por fuera del sistema. `GET|POST|PUT /api/renegotiations` cierra ese hueco. **La renegociación no entra al motor**: es una consecuencia humana de un desplazamiento ya detectado, así que registrar un acuerdo no recalcula capacidad, no mueve un desplazamiento y no altera ningún `RescheduleEvent` —se **añade** al lado de un hecho que ya estaba auditado—.

**Dos hechos distintos, y ninguno sustituye al otro.**

| Hecho | Quién lo produce | Qué dice | Dónde vive |
|---|---|---|---|
| **Desplazamiento** (`RescheduleEvent`) | El motor, al planificar | Que un incidente movió un requerimiento, de qué fecha pactada a qué fecha entregó de verdad, con qué regla y con qué severidad | `reschedule_event`, y el timeline del plan |
| **Renegociación** (el acuerdo) | Una persona, después | A qué fecha nueva se llegó, quién lo acordó, cuándo quedó registrado y **por qué se llegó a esa fecha** | `renegotiation` y `renegotiation_history` |

**Los dos motivos son hechos distintos, y por eso no comparten campo.** El `reason` del `RescheduleEvent` explica por qué **el motor** movió el requerimiento: se deduce de la regla aplicada y de la capacidad comprometida, y lo escribe el plan. El `agreedReason` del acuerdo explica por qué **una persona** llegó a esa fecha: que el cliente aplazara la instalación o que el analista entrara en vacaciones no se deduce de ningún dato, solo existe si alguien lo escribe. Los dos viajan en la misma fila de la lectura consolidada —uno dentro de `events[]`, el otro dentro de `renegotiation`— y **no comparten nombre ni sitio**, que es lo único que impide confundirlos sin depender de que quien lea el JSON mire bien de qué nivel está hablando. Por eso el campo se llama `agreedReason` y no `reason`.

**El desplazamiento dice dónde quedó, no qué se prometió.** Es la distinción que justifica todo lo demás: `rescheduledDate` es el día en que el requerimiento **cierra** tras el recálculo, no la fecha que se le comunicó a quien lo pidió. El motor puede decir «lo moví del 20 al 27 de octubre» y no puede decir si al usuario se le prometió el 30. Ese hueco —la fecha acordada, quién la acordó y cuándo— es exactamente lo que guarda la renegociación.

**La trazabilidad completa, en una sola fila.** `GET /api/renegotiations` contesta las siete preguntas sin pedir el plan ni el timeline por separado:

| Pregunta | De dónde sale |
|---|---|
| Qué requerimiento fue afectado | `workItemId` |
| Qué incidente causó el desplazamiento | `events[].incidentId` |
| Cuál era la fecha original | `events[].originalDate` |
| Cuál es la nueva fecha acordada | `renegotiation.agreedDate` |
| Quién registró el acuerdo | `renegotiation.agreedBy` |
| Cuándo se registró | `renegotiation.agreedAt` |
| Por qué se acordó esa fecha | `renegotiation.agreedReason` |

Un desplazamiento puede no tener incidente que lo cause —`incidentId` nulo—: el motor lo audita igual, porque lo que lo movió fue la falta de capacidad y no un ticket. La fila lo enseña como es.

**Dos estados, y se derivan.** `PENDIENTE_DE_ACUERDO` cuando hay desplazamientos que ningún acuerdo cubre, y `ACORDADA` cuando el acuerdo los cubre todos. **No se guardan**: salen de comparar el acuerdo vigente con los desplazamientos del plan, y por eso no pueden quedar desincronizados con ellos. **No se llaman `PENDIENTE_RENEGOCIACION` / `RENEGOCIADO`** porque `RequirementStatus.PENDIENTE_DE_RENEGOCIACION` ya existe desde la Fase 3 y significa otra cosa: es el estado **de salida** al que el motor lleva un requerimiento cuando un incidente le quita su franja, no se persiste y no se traduce de GLPI. Dos nombres iguales para dos hechos distintos habrían sido el estado redundante que no hay que introducir.

**Un acuerdo cubre lo que ya existía cuando se registró.** Es la única comparación posible: lo que se sabe de un desplazamiento es cuándo se auditó, y lo que se sabe de un acuerdo es cuándo se registró. Un incidente **posterior** sobre un requerimiento ya renegociado lo **reabre**: la fila vuelve a `PENDIENTE_DE_ACUERDO` y el acuerdo anterior sigue visible, porque esconderlo borraría la explicación de por qué la fecha acordada ya no sirve. Y un desplazamiento en el **mismo instante** que el acuerdo sí queda cubierto: el orden entre dos hechos con el mismo sello no es deducible, y suponer que el incidente llegó después inventaría una renegociación pendiente que nadie pidió.

**Los endpoints.**

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/renegotiations` | La lectura consolidada: desplazados, pendientes y acordados, con la trazabilidad de cada uno |
| `GET` | `/api/renegotiations/{workItemId}` | El acuerdo vigente de un elemento; `404` si todavía no hay ninguno |
| `GET` | `/api/renegotiations/{workItemId}/history` | Todo lo que le ha pasado al acuerdo; lista vacía si no hay |
| `POST` | `/api/renegotiations` | Registra el acuerdo. `201`, o `409` si ese elemento ya tenía uno |
| `PUT` | `/api/renegotiations/{workItemId}` | Reemplaza la fecha acordada y su motivo, y anota el cambio en el historial |

El `workItemId` va en el camino como texto, igual que en `/api/planning-metadata`: es el identificador del ticket en GLPI, no un UUID.

**Lo que un acuerdo no hace.** No borra el `RescheduleEvent` que lo motivó, no modifica el timeline histórico, no elimina el desplazamiento de ninguna lista y no altera el incidente que lo causó. Un requerimiento desplazado **no desaparece de la lectura al renegociarse**: pasa de `PENDIENTE_DE_ACUERDO` a `ACORDADA`, porque la lista es la historia de lo que se movió y esconder lo ya resuelto dejaría sin explicación por qué la fecha de un requerimiento no es la que se le prometió al usuario.

**El sello lo pone el servidor.** Quien registra un acuerdo dice a qué fecha se llegó, quién lo acordó y por qué; **cuándo** quedó registrado lo dice el `Clock` que ya fecha los planes, nunca el cuerpo de la petición —una fecha de registro que elige quien llama no es un sello, es una afirmación—. Reenviar la misma fecha **y el mismo motivo** no ensucia la auditoría: el acuerdo conserva su autor y su sello, y no se escribe ninguna fila de historial por un cambio que no ocurrió. Reenviar la misma fecha con **otro** motivo sí es un cambio, y queda anotado: lo que cambió fue la explicación, y la entrada del historial lo dice con sus dos fechas iguales.

**El motivo es obligatorio al escribir y nulo solo al leer.** `RenegotiationRequest` y `RenegotiationUpdateRequest` lo exigen (`@NotBlank`, hasta 500 caracteres): no hay forma de registrar un acuerdo sin decir por qué, porque un motivo que se puede omitir es un motivo que se omite y la mitad de una trazabilidad no es una trazabilidad. En la lectura es anulable, y nulo significa **siempre** «acuerdo registrado antes de que este campo existiera» — nunca «sin motivo»—: la migración añade la columna `agreed_reason` a las dos tablas y **no rellena ninguna fila**, porque cualquier texto que se escribiera ahí sería una explicación fabricada, y una auditoría que afirma algo falso es peor que una auditoría con un hueco declarado. Un hueco se ve; una invención no.

**La lectura consolidada no recorre los planes por su cuenta.** Llama a la misma lectura de desplazamientos de la que sale la tarjeta del tablero, así que las dos no pueden discrepar, y busca el acuerdo de todos los elementos **en una sola consulta**: una agenda con decenas de desplazados sigue costando una lectura, no una por fila.

**Limitaciones, dichas donde se leen.** Esta fase entregó el modelo **sin pantalla**, y eso lo atendió la Fase 26: `/renegociaciones` consume esta lectura y estos dos endpoints, y está documentada abajo —lo que aquí quedó resuelto y expuesto es exactamente lo que esa pantalla necesitaba, así que no tuvo que redefinir nada— (riesgo 110). **`agreedBy` lo teclea el operador**, porque no hay autenticación: el historial de `renegotiation` es la auditoría de quién acordó qué, y su autor es un campo libre —la misma limitación que ya tenía `planning_metadata`, y no se empeora ni se disimula (riesgo 111)—. **La fecha acordada no se valida contra la capacidad**: el sistema no comprueba que la fecha a la que dos personas llegaron sea planificable, porque validarla obligaría a ejecutar el motor sobre un acuerdo, que es justo lo que esta fase prohíbe (riesgo 113).

---

### La pantalla de renegociación

La Fase 25 dejó el modelo formal de la renegociación **y ningún sitio donde usarlo**: el estado de cada requerimiento desplazado solo se veía pidiendo el endpoint a mano, y acordar una fecha era un `curl`. **`/renegociaciones`** —la entrada **Renegociación** del menú— cierra el flujo operativo entero, `Incidente → Desplazamiento → Pendiente de acuerdo → Acuerdo registrado → Historial consultable`, y **no estrena backend**: consume las cinco rutas que la Fase 25 publicó, lee el acuerdo de un requerimiento antes de reemplazarlo y escribe con los dos verbos que ya existían.

**La pantalla no decide estados, y es lo que la define.** Sería fácil pintar el estado de una fila comparando el acuerdo con las fechas de los desplazamientos, y sería la segunda versión de la regla que aplica `RenegotiationService` —la que no falla el día que se escribe, sino el día que cambia la otra—. La tabla pinta `status` tal como llega, y el filtro compara contra ese mismo valor sin traducirlo. Los dos estados que existen en la pantalla son los dos del contrato, `PENDIENTE_DE_ACUERDO` y `ACORDADA`, y se usan literalmente.

**Un requerimiento puede estar pendiente y tener acuerdo, y la pantalla enseña las dos cosas.** Es el caso que distingue el estado del verbo de la escritura: un incidente **posterior** al acuerdo lo reabre, así que la fila vuelve a `PENDIENTE_DE_ACUERDO` **con su acuerdo anterior todavía visible** —esconderlo borraría la explicación de por qué la fecha acordada ya no sirve—. La acción de esa fila dice «Editar acuerdo» y no «Registrar», porque lo que le corresponde es reemplazar algo que existe.

**La lectura, de dónde sale cada celda.**

| Qué se ve en la fila | De dónde sale |
|---|---|
| `workItemId`, con el desarrollador y el plan enlazado a su agenda | `items[].workItemId`, `developerId`, `planId` |
| Estado | `items[].status`, derivado por el backend y sin traducir |
| Fecha desplazada | `items[].events[]`, uno por línea, con la pareja «de qué fecha a qué fecha» que el plan auditó, su severidad, su incidente y su regla |
| Fecha acordada | `renegotiation.agreedDate` |
| Acordó | `renegotiation.agreedBy` |
| Registrado el | `renegotiation.agreedAt`, con el sello del servidor |
| Por qué se acordó | `renegotiation.agreedReason`, el único campo de la fila que ningún dato puede deducir |
| Acuerdo | La acción, decidida por la **existencia** de `renegotiation` |

**Una fila por requerimiento, no por desplazamiento.** Uno que se movió dos veces por dos incidentes aparece una vez, con los dos dentro: es la misma cuenta que hace la tarjeta de desplazamientos del tablero, así que las dos cifras no pueden discrepar. La pantalla **no resume** los desplazamientos en una sola fecha —resumirlos escondería el segundo— y **no recalcula** ninguna: las parejas son las que el plan auditó.

**El formulario lee antes de escribir, y el verbo lo decide la existencia del acuerdo.** Es la misma regla que la pantalla de declaración (decisión 161), aplicada al mismo problema: el `PUT` **reemplaza**. Si el requerimiento ya tiene acuerdo, abrir el formulario lanza una lectura fresca de `GET /api/renegotiations/{workItemId}` y **no enseña ningún campo hasta que llega** —rellenar con lo que traía la lista, que es una foto del instante en que se consultó, y guardar borraría lo que alguien cambió desde entonces—. Si no tiene acuerdo no hay nada que leer y el verbo es `POST`. **El verbo nunca sale del estado visual**: decidirlo por `status` mandaría un `POST` contra un recurso que ya existe y el backend respondería `409`, convirtiendo un caso normal en un error.

**El motivo se enseña, no se captura, y hay que decir por qué.** El brief pedía un campo de motivo en el formulario, y **el contrato de la Fase 25 no lo tiene**: `RenegotiationRequest` son `workItemId`, `agreedDate` y `agreedBy`, y `RenegotiationUpdateRequest` son los dos últimos. Un campo de texto que el backend descarta al deserializar no es capturar un dato: es perderlo con la apariencia de haberlo guardado, y el brief prohíbe cambiar los contratos. Así que el formulario **no pide un motivo** y en su lugar enseña el `reason` que el plan ya publica para cada desplazamiento —«por qué se desplazó», que es un hecho auditado—. Lo que no queda registrado es **por qué se acordó esa fecha** (riesgo 114): añadirlo exige un campo nuevo en el contrato y una columna nueva en la tabla, y no se hace desde el frontend.

> **Superado por la Fase 27.** El razonamiento era correcto para un brief que prohibía tocar los contratos, y dejó de serlo en cuanto la Fase 27 los cambió: hoy el formulario **sí** pide el motivo, y el campo que esta fase se negó a pintar es el que la Fase 27 añadió al contrato. Lo que sobrevive intacto es la mitad que no dependía del contrato —enseñar el `reason` del plan en solo lectura y rotulado como lo que es—, que sigue en pie y es lo que impide confundir los dos motivos.

**El historial se lee de su propia ruta y no se reconstruye.** Una entrada por cambio, **en el orden exacto en que las publica el backend**, sin ordenar, sin deduplicar y sin completar con lo que traía la lista: un historial recompuesto en el cliente afirmaría un orden que nadie auditó. La primera entrada —`previousDate` nulo— dice «primer acuerdo» en vez de dejar un hueco, porque el momento en que no había fecha y alguien la trajo es justo lo que esa entrada significa. El historial existe **si y solo si** alguien registró un acuerdo alguna vez, y eso lo dice un hecho publicado —`renegotiation` nulo o no—, no una deducción de la vista: sin acuerdo **no se pide nada**, porque la ruta responde `404` y ese `404` es el estado normal de un requerimiento desplazado que nadie ha renegociado todavía.

**Después de guardar se invalida lo justo, y es distinto de lo que hace la pantalla de declaración.** Se relee la **lista** —es lo que hay que ver cambiar, y de donde sale el estado nuevo de la fila— y el **historial del requerimiento afectado**, que sigue montado y es donde la entrada recién escrita tiene que aparecer. El **detalle** del requerimiento solo se marca viejo, sin releerlo, porque el formulario se cierra en ese instante. Nada más: ni una petición por fila, ni una ruta ajena, ni una recarga de página —no hay `window.location`—. La fila **sigue elegida** después de guardar, para que el historial que se relee enseñe el cambio sin volver a abrir nada.

**Los filtros —Todas, Pendientes, Acordadas— se aplican en memoria**, sobre el array ya recibido: no vuelven a consultar, no cambian la clave de la consulta y no disparan una petición. Filtrar hasta vaciar la lista **no se confunde con no tener nada que renegociar**: «ningún requerimiento está desplazado» y «ningún requerimiento coincide con el filtro» son estados distintos y se dicen por separado. La fila seleccionada se busca en la lista **completa** y no en la filtrada, así que cambiar el filtro no cierra un formulario a medio escribir.

**Los errores son del backend y se enseñan con sus palabras.** Un `400` de validación, el `404` de un acuerdo que la lista decía que existía y ya no está, y el `409` de «ya hay renegociación registrada; para modificarla se usa `PUT`» dicen cosas distintas, y reescribirlos aquí sustituiría el diagnóstico por uno peor. El `409` es además un caso legítimo —alguien acordó primero— y no un fallo de la pantalla. Ante el `404` la pantalla **no se cae al `POST` por su cuenta**: eso crearía un acuerdo que la fila decía que existía.

**Ninguna lectura por fila.** La lista sale de una sola petición a `GET /api/renegotiations`, y el acuerdo y el historial de un requerimiento se piden **solo cuando alguien elige su fila** —y no se piden en absoluto si esa fila no tiene acuerdo—. Una agenda con decenas de desplazados sigue costando una lectura, no una por fila.

**Limitaciones, dichas donde se leen.** El **motivo de la renegociación no se persiste** (riesgo 114, **atendido en la Fase 27**): el contrato de la Fase 25 no tenía el campo y el brief de esta fase prohibía cambiarlo, así que la pantalla enseña el motivo del **desplazamiento** y no el de la **decisión** —lo cerró la fase que sí podía tocar los contratos, y la pantalla de hoy sí captura el motivo del acuerdo—. **`agreedBy` lo teclea el operador**, porque no hay autenticación (riesgo 111): el historial de `renegotiation` es la auditoría de quién acordó qué, y su autor es un campo libre —la misma limitación que ya tenía `planning_metadata`, y la pantalla no la empeora ni la disimula—. La pantalla **no filtra por desarrollador ni pagina**: un plan con muchos desplazados pinta todas sus filas, y el filtro por técnico todavía no existe (riesgo 115). Y **la fecha acordada no se valida contra la capacidad** (riesgo 113): la pantalla no comprueba que la fecha a la que dos personas llegaron sea planificable, porque eso obligaría a ejecutar el motor sobre un acuerdo.

---

### La pantalla de generación del plan

Las veintisiete fases anteriores sabían leer un plan, declararlo y renegociarlo, y **ninguna sabía producirlo desde la interfaz**: generar un plan era el `curl` de [Planificar con los datos reales de GLPI](#planificar-con-los-datos-reales-de-glpi), y para ver el resultado había que copiar el identificador que devolvía y armarlo a mano en la dirección del calendario. **`/planificar`** —la entrada **Planificación** del menú, entre **Declaración** y **Renegociación**, que es el orden del flujo— cierra ese tramo y **no estrena backend**: invoca el endpoint de la Fase 9, que sigue exactamente igual.

**La pantalla no planifica, y es la regla que la define.** El cuerpo de la petición lleva **solo el identificador del técnico**, así que no hay una sola regla, horizonte, prioridad o calendario que se pueda tocar desde aquí: el motor corre entero en el backend y lo que vuelve es un plan ya guardado. La consecuencia práctica conviene decirla: **cambiar cómo se planifica sigue siendo cambiar la configuración del backend**, no rellenar un formulario.

**Generar escribe, y la pantalla lo trata como tal.** Cada llamada guarda un plan y sube el contador de ejecuciones de `plans.generated`, así que la petición sale del botón y **nunca al abrir la pantalla** —abrirla no deja rastro—, sale al **enviar** y no al teclear —escribir «296» no genera el plan de «2» ni el de «29», porque cada intento deja un plan guardado— y no sale en absoluto con el campo vacío: el backend respondería `400` a una petición que no hacía falta enviar. **No hay reintento automático**: un `503` produce un solo intento, porque cada intento guardaría un plan, y el formulario de arriba sigue en pie con el identificador escrito, que es el reintento.

**Generar dos veces al mismo técnico es lo normal y no un error.** Se vuelve a planificar cuando lo declarado cambió, y cada corrida crea un plan **nuevo con su propio identificador**: la segunda no reemplaza a la primera. La pantalla enseña la última; las anteriores siguen donde estaban y sus timelines se abren con el suyo.

**Qué se ve del resultado, y de dónde sale.**

| Qué se ve | De dónde sale |
|---|---|
| El plan | `planId`, con el enlace al timeline construido por `calendarPath()` y no a mano |
| El técnico | `plan.developerId`, el que GLPI reconoció |
| Calculado el | `createdAt`, con el sello del servidor |
| Elementos ubicados, desplazados y conflictos | Las longitudes de `allocations`, `displacedRequirements` y `conflicts`, contadas y no calculadas |
| Descartes | `discarded[]`, una fila por entrada, con su código y el motivo que redactó el backend |
| Los cuatro destinos del flujo | Enlaces a `/calendario/{planId}`, `/`, `/alertas` y `/renegociaciones` |

**Los tres números son de esta ejecución y no del plan vigente.** El rótulo del desplazamiento lo dice —«los de esta corrida, no los del plan vigente»— porque el tablero publica el desplazamiento del plan vigente de cada técnico, y las dos cifras solo coinciden cuando este plan **es** el vigente.

**Un descarte es una causa y no un ticket, y la lista lo dice.** Un ticket sin ninguna declaración produce **dos** entradas con el mismo `ticketId` —`SIN_ESTIMACION_DECLARADA` y `SIN_COMPROMISO_DECLARADO`—, porque cada una nombra a una persona distinta que tiene que actuar (decisión 124.1). Agrupar por ticket en la vista daría 1 donde el backend publica 2, así que se pintan las dos filas y se explica.

**Cuántos tickets entregó GLPI no se enseña, y la pantalla dice por qué.** Ese número no viaja en la respuesta —el contrato publica el plan y los descartes, no el total consultado— y **no se deduce**: sumar asignaciones, desplazados, conflictos y descartes no da el total, y los descartes cuentan causas. Se prefiere no enseñar una cifra que nadie publicó antes que enseñar una que parece del backend y no lo es (riesgo 122).

**El error va antes que el resultado, y con las palabras del backend.** Una generación que falla deja en pie el plan de la anterior —la mutación conserva su último dato—, así que enseñarlo debajo del fallo lo haría pasar por el resultado de esta acción. El mensaje se repite sin traducir y el estado viaja en una etiqueta —`HTTP 404`, `HTTP 503`—, porque un `404` de técnico inexistente y un `503` de GLPI inalcanzable explican cada uno un problema distinto. **Esta ruta no produce `409`**: no hay unicidad que violar, porque cada generación crea un plan nuevo.

**Después de generar se refrescan tres lecturas y ninguna más**, y cada una por lo que lee:

| Qué se refresca | Por qué |
|---|---|
| `['planning','metrics']` | Su bloque `current` es el plan vigente de cada desarrollador y su contador `plans.generated` cuenta ejecuciones. **`/recursos` no tiene clave propia para esto: lee esta misma**, así que la vista de equipo se refresca por aquí. La vista añade sus propias claves —`['planning','declarations',{developerId}]` una por persona de la tabla, más las de alertas y renegociaciones— |
| `['planning','alerts']` | Es una proyección de esa fotografía —el servicio solo lee las métricas y cuenta—, pero es otra consulta con otra clave |
| `['renegotiations','list']` | La lista se construye sobre el plan vigente de cada desarrollador y su estado se recalcula en cada lectura |

Los dos desgloses de métricas —`declared/{gap}` y `displaced`— cuelgan del prefijo `['planning','metrics']` y caen con la primera. **El timeline no se invalida**: cada plan tiene su propio identificador, así que el recién creado no tiene entrada de caché y la del plan anterior sigue siendo la lectura correcta de *su* plan. Tampoco la salud de GLPI, que es un diagnóstico de conectividad.

**Limitaciones, dichas donde se leen.** El **técnico se escribe a mano**, porque el backend no publica un catálogo de personas (riesgo 107): un identificador que GLPI no conoce devuelve `404` con el mensaje del servidor. **No hay historial de ejecuciones navegable** —`plans.generated` cuenta ejecuciones y no planes distintos, y solo se expone un plan por desarrollador—, así que la pantalla enseña la última generación de la sesión de trabajo y nada más; al recargar, el resultado desaparece y el plan sigue existiendo, accesible por su timeline o por el tablero. La pantalla **enseña un resumen y no el plan**: los tramos, las asignaciones y los conflictos se leen en el calendario, a un clic. Y **un plan generado no se puede borrar ni marcar** (riesgo 119): no hay endpoint de borrado y esta fase no lo añade.

---

## Despliegue con Docker

```bash
cp .env.example .env   # completar las credenciales de GLPI
docker compose up --build
```

| Servicio | URL |
|---|---|
| Frontend (nginx) | http://localhost:3000 |
| Backend | http://localhost:8080 |
| PostgreSQL | localhost:5432 |

nginx sirve el bundle estático y redirige `/api` al backend, por lo que tampoco hay CORS en producción.

---

## Estado del proyecto

**Fase 1 · Integración GLPI** — completada.
**Fase 2 · Núcleo de dominio** — completada. Motor de planificación desacoplado, con auditoría de desplazamientos e idempotencia.
**Fase 3 · Priorización por severidad** — completada. OLA por severidad y tres comportamientos de planificación.
**Fase 4 · Tiempo hábil** — completada. Calendario laboral explícito; capacidad y vencimiento de las OLA se calculan en tiempo hábil.
**Fase 5 · Modelo temporal unificado** — completada. La capacidad es una agenda de franjas al minuto y comparte recorrido con el cálculo de la OLA. Desaparece la reserva artificial de jornadas completas; un requerimiento se reparte entre los días que necesite.

**Fase 6 · Persistencia del plan** — completada. El resultado del planificador y la auditoría de los desplazamientos se guardan en PostgreSQL: sobreviven al reinicio, la idempotencia deja de depender de la memoria y el plan se puede releer por su identificador. El dominio no cambió —`PlanningEngine` no incorpora ninguna dependencia de persistencia— y todas las pruebas de las fases anteriores siguen pasando sin cambiar una expectativa.

**Fase 7 · Contexto de decisión** — completada. Cada plan guarda la configuración **con la que se calculó** —versión del motor, instante y zona, severidades participantes, reglas y calendario— y se lee por `/{planId}/context`. El contexto explica el plan; no lo sustituye.

**Fase 8 · Reproducibilidad** — completada. Cada plan guarda también la **entrada exacta** que recibió el motor —desarrollador, incidentes y requerimientos, con los atributos que el motor lee— y se lee por `/{planId}/input`. Con la entrada y el contexto guardados, un plan se puede volver a calcular sin pedirle nada a GLPI. `PlanningEngine` no cambió una línea: la instantánea se arma en el servicio, con los mismos objetos de dominio que ya iban al motor.

**Fase 9 · Capa anticorrupción** — completada. `POST /api/planning/from-glpi` trae de GLPI los tickets de un desarrollador, los traduce al dominio y planifica con ellos. La traducción vive entera en `integration/glpi/`: el dominio sigue sin conocer GLPI —ni sus DTOs, ni sus prioridades, ni sus códigos, ni su JSON— y `PlanningEngine` no cambió una línea. La prioridad de GLPI se mapea a las tres severidades del dominio por una tabla explícita, los tickets que no se pueden traducir se descartan con su motivo en vez de tumbar el plan, y la entrada guardada declara su procedencia (`source`, `extractedAt`, `adapterVersion`). Sin sincronización automática: no hay trabajos programados, ni colas, ni escritura hacia GLPI.

**Fase 10 · Contrato de GLPI declarado y comparable** — completada. Las suposiciones sobre GLPI dejan de estar repartidas en constantes y `switch` dentro de los mapeadores y pasan a `GlpiContract`, un registro que se declara en `PlanningConfig`: ese es el punto por el que se adapta una variante distinta de GLPI sin tocar el dominio ni el motor. `GlpiContractVerifier` compara el contrato declarado contra una respuesta real —un ticket suelto o el arreglo de `/Ticket`— y devuelve un informe con veredicto (`COMPATIBLE`, `DEGRADED` o `INCOMPATIBLE`), campos obligatorios ausentes, tipos incompatibles, campos no modelados, prioridades fuera de escala y fechas ilegibles. La verificación no consulta GLPI: recibe texto, así que se puede ejecutar contra una captura guardada. `PlanningEngine` no cambió una línea y las 160 pruebas pasan. **La conexión con la instancia real ya se establece.** El host acumulaba dos defectos: `GLPI_URL` usaba un nombre que el certificado no cubre —es un comodín para `*.coltefinanciera.com.co`, así que ninguno de los dos nombres `connser.com.co` sirve—, y el servidor envía solo su certificado hoja, sin el intermedio que lo firma, que Windows obtiene por su cuenta y la JVM no. Ambos están resueltos y `GET /api/glpi/health` responde `connected` y `authenticated` contra `sac-i.coltefinanciera.com.co`, sin haber relajado la verificación en ningún punto.

**Fase 11 · El contrato, medido contra la instancia real** — completada. El plan de la decisión 102 se ejecutó entero: la instancia devolvió 1000 tickets reales y `GlpiContractVerifier` los comparó con el contrato declarado. El contrato acierta en la **forma** —los once campos están, con el tipo declarado, y las 1032 fechas tienen la forma `yyyy-MM-dd HH:mm:ss`— y falla en el **contenido**, con siete hallazgos documentados en las decisiones 104 a 108. Los tres que deciden: **`users_id_assign` no existe** en la respuesta —está en `links`, como subrecurso por ticket—, así que el filtro por asignado deja la lista en cero y el flujo devuelve una agenda vacía sin error; **`actiontime` vale cero en el 99,4 %** de la muestra y el validador descarta esos tickets; y la consulta trae **los mil tickets más antiguos de 67 599**, todos cerrados, así que la muestra valida presencia y formato pero no las tablas de estados. **No se corrigió el adaptador**: el brief pedía evidencia primero, y dos de los seis ajustes necesarios —la fuente de las horas estimadas y el tratamiento de las peticiones sin fecha comprometida— son decisiones de negocio. `PlanningEngine` no cambió una línea: las 161 pruebas pasan, con la de contrato omitida por defecto porque necesita credenciales reales.

**Fase 12 · El modelo funcional real de GLPI** — completada. La Fase 11 midió la **forma** del contrato; esta mide el **significado**, sobre una segunda captura contra `sac-i.coltefinanciera.com.co` que por fin trae **tickets vivos** (`/Ticket?range=67500-67599`: 100 tickets, 39 abiertos, 52 resueltos, 9 cerrados) además de los 1000 antiguos. Las siete preguntas del brief quedan respondidas con respuestas reales (decisiones 109 a 116). Lo que se encontró: el **responsable** vive en `Ticket_User` con `type=2` —33 de 33 tickets vivos lo traen, 10 de 12 de los antiguos— y la vía que escala es `/search/Ticket` con `criteria[0][field]=5`, verificado: **208 tickets en una sola llamada**, con `field=5` publicado por `/listSearchOptions/Ticket` como «Technician». El **esfuerzo estimado no existe en GLPI**: ninguna de sus 139 opciones de búsqueda declara una estimación, y `actiontime` —que la opción 45 llama «Total duration»— vale cero en las 100 respuestas vivas. La **fecha de inicio** es `date_creation`, no `date`: difieren en 33 de 100 vivos y `date` es *posterior* en 31 de esos 33, así que el adaptador desplaza el inicio siempre en la misma dirección. La **fecha comprometida** son dos, `time_to_resolve` (68/100) e `internal_time_to_resolve` (89/100) —juntas cubren el 100 %— y **se contradicen en 55 de 57**. Y un hallazgo que no estaba en ningún riesgo: el adaptador itera sobre `/User/`, que devuelve **30 usuarios de 2427**, el 1,2 % del padrón. **No se tocó una línea de código**: el brief pedía evidencia antes de corregir, y dos de los cuatro campos no tienen una fuente que el código pueda elegir solo. La decisión final es **requiere intervención funcional del negocio**. `PlanningEngine`, las reglas de negocio y el frontend siguen intactos.

**Fase 13 · La planificación propia** — completada. La Fase 12 dejó dos preguntas sin respuesta y el negocio las contestó: **el esfuerzo estimado lo define el desarrollador asignado** y **la fecha de compromiso la define el gestor de demanda**. Ninguno de los dos valores vive en GLPI —el primero no existe allí, el segundo son dos fechas que se contradicen—, así que ambos pasan a ser de este sistema: **GLPI es la fuente del trabajo, la planificación pertenece a aquí**. La fase construye `PlanningMetadata` —los ocho campos del brief, con `workItemId` como clave natural y sin clave foránea, porque los tickets viven en GLPI— y `planning_metadata_history`, una tabla de solo inserción con una fila por campo cambiado que responde quién, cuándo, de qué a qué. Cuatro endpoints en `/api/planning-metadata` (`POST`, `PUT`, `GET`, `GET .../history`), los siete casos límite del brief cubiertos con prueba, y dos decisiones de negocio escritas en el modelo: un compromiso ya vencido **se acepta y se marca** con el derivado `commitmentOverdue`, y un valor **se puede retirar enviando `null`**, lo que queda registrado como `anterior -> null` con su autor y su fecha sin tocar el historial. Los sellos de tiempo los pone el servidor con el `Clock` que ya fecha los planes, nunca el cuerpo de la petición. **Nadie consume la metadata todavía**, y es deliberado: la costura por la que `GlpiPlanningRequestFactory` la leerá en lugar de deducirla de GLPI queda documentada en la decisión 124 y no implementada. Con la puerta de entrada ya fijada: será planificable **solo el ticket que tenga a la vez estimación y fecha compromiso**; al que le falte cualquiera de las dos se descarta con su motivo explícito —`SIN_ESTIMACION_DECLARADA` o `SIN_COMPROMISO_DECLARADO`—, sin inferir valores ni generar planes parciales (decisión 124.1). `PlanningEngine`, las reglas, el frontend, `integration/glpi/` y `config/` siguen sin tocarse; las 195 pruebas pasan, 32 de ellas nuevas. La última pregunta funcional de la costura —si lo declarado **sustituye** o **complementa** lo registrado— quedó cerrada en la **decisión 124.2**: **sustituye**, así que cuando la ACL se escriba `actiontime` y `time_to_resolve` dejarán de ser entradas del motor.

**Fase 14 · La capa anticorrupción lee la planificación declarada** — completada. La costura que la Fase 13 dejó documentada y la decisión 124.2 dejó decidida ya está escrita: `GlpiPlanningRequestFactory` construye la `PlanningRequest` con `PlanningMetadata.estimatedHours` y `PlanningMetadata.committedDate`, **buscadas por `workItemId` en una sola consulta** —el puerto gana `findByWorkItemIdIn`, así que una agenda de N tickets sigue costando una lectura y no N—. Desde aquí `actiontime`, `time_to_resolve` e `internal_time_to_resolve` **no participan en la planificación**: la regla se cumple por construcción, porque los valores entran al mapeador como parámetro y no hay ningún camino que los deduzca del ticket. Las dos traducciones de GLPI se conservan —*diagnóstico sí, planificación no*—: `estimatedHours` y `plannedDate` siguen traduciendo `actiontime` y `time_to_resolve` para poder contrastar lo declarado con lo registrado, y nadie las llama desde el camino del plan. La planificabilidad se aplica **exactamente como la 124.1** la fijó: se exigen los dos valores, y al que le falte cualquiera se descarta con su motivo explícito. Los descartes pasan a llevar **código y texto** —`GlpiDiscardedItem(ticketId, code, reason)`, con el vocabulario cerrado en `GlpiDiscardReason`— porque las tres cosas que hacen falta —visibilidad, auditoría y poder contarlos— no caben en un campo. Se eligió **la opción B, varias causas explícitas**, sobre la A: `SIN_ESTIMACION_DECLARADA` y `SIN_COMPROMISO_DECLARADO` no son sinónimos de «incompleta», cada uno nombra **a una persona distinta** que tiene que actuar —el desarrollador estima, el gestor compromete—, y contarlos por separado es lo único que responde la pregunta que la transición necesita: «¿van los desarrolladores o los gestores por detrás?». El precio se paga nombrándolo: un ticket sin ninguna declaración produce **dos** entradas con el mismo `ticketId`, así que los registros que decían «descartados» ahora dicen «descartes sobre tickets» y llevan los dos números. `GlpiRestPlanningSource.VERSION` sube a **`glpi-rest-2`** —un plan de antes y uno de después tienen las horas en sitios distintos y se leen igual si no se distinguen— y **no se añadió ningún campo a la procedencia**: el origen ya está trazado por `planning_metadata_history`, que se une a la foto por el mismo `workItemId`. **`PlanningEngine`, las reglas de negocio, el frontend y la persistencia de planes siguen sin tocarse**, acreditado con fechas de modificación; las **217 pruebas pasan** (22 nuevas), con tres omitidas por defecto porque necesitan una instancia real de GLPI.

**Fase 15 · El contrato de lectura para la Timeline** — completada. La agenda persistida ya existía entera —`WorkBlock`, `WorkAllocation`, `PlanSnapshot`, `PlanningContextSnapshot`, `PlanningInputSnapshot`, `RescheduleEvent`— y lo que faltaba era una lectura pensada para pintarla: `/{planId}` da el plan completo y `/{planId}/blocks` da los tramos, pero responder «qué ocupa esta franja y cuánto queda libre ese día» exigía tres llamadas y una aritmética de calendario en el navegador. `GET /api/planning/{planId}/timeline` cierra esa mitad y **no recalcula nada**: no hay una sola llamada al motor en el camino de la lectura, así que el timeline no puede discrepar del plan que pinta. `TimelineItem` lleva los diez campos del brief —`workItemId`, `workItemType`, `startsAt`, `endsAt`, `durationHours`, `developerId`, `estimatedHours`, `committedDate`, `planningStatus` y `sourcePlanId`— más `severity`, que el brief pide en su sección de agrupaciones y está persistida: sin ella, agrupar por severidad exigiría una llamada más, que es justo lo que el brief prohíbe. `TimelineResource` y `TimelineCapacity` dan, por desarrollador y por fecha, cuánto cabe, cuánto está ocupado y cuánto queda —**derivado y no guardado**: lo disponible sale del calendario congelado del plan y lo ocupado de sumar sus tramos, y los días no laborables salen con jornada cero en lugar de desaparecer, para que el frontend no tenga que rellenar el eje—. La trazabilidad se conserva sin duplicar nada: `workBlockId` «o equivalente» es la pareja `workItemId` + `startsAt` —un bloque no tiene identificador propio por diseño, se reconoce por el elemento y el instante en que arranca—, y con `sourcePlanId` y la lista de asignaciones cada tramo llega hasta su origen, con la entrada y el contexto a una llamada de distancia. `TimelineItemStatus` se cierra en **dos** valores, `PLANIFICADO` y `DESPLAZADO`, y los candidatos descartados quedan razonados en el propio enum: «no cupo» sería inalcanzable —un elemento en conflicto no tiene bloques y por tanto no tiene tramo al que colgarle el estado— y «vencido» rompería la reproducibilidad al depender del reloj. Esa reproducibilidad es el eje de la fase y está **probada, no afirmada**: el mismo plan leído antes y después de cambiar la declaración devuelve la respuesta idéntica byte a byte, porque las horas y el compromiso salen de la foto de la entrada y nunca de `PlanningMetadata` viva. Los filtros —rango de fechas, desarrollador, tipo de trabajo— **no se implementan** y quedan documentados con su punto de entrada: la respuesta ya está acotada por un plan, un desarrollador y su ventana, y el frontend filtra en memoria sin coste. **`PlanningEngine`, las reglas de negocio, la integración con GLPI, el frontend y la persistencia de planes siguen sin tocarse**, acreditado con fechas de modificación —la fase no añade ni una tabla, ni una entidad, ni un método al puerto `PlanSnapshotRepository`, porque las tres lecturas que necesita ya existían—; las **228 pruebas pasan** (11 nuevas, todas de archivo nuevo, sin una sola expectativa anterior modificada), con tres omitidas por defecto porque necesitan una instancia real de GLPI.

**Fase 16 · La vista Timeline en React** — completada. El contrato que la Fase 15 dejó expuesto ya tiene quien lo pinte. La pantalla `/calendario/:planId` —la ruta `/calendario` ya estaba en el menú y su tarjeta de «decisiones pendientes» listaba justo este trabajo— pinta la agenda persistida de un plan con **una sola llamada** a `GET /api/planning/{planId}/timeline`: filas por recurso, columnas por día, un bloque por tramo posicionado por hora, la capacidad del día y los desplazamientos diferenciados. **No recalcula nada**: `remainingHours` se pinta tal como llega y la única aritmética de la vista es de píxeles. La decisión que el repositorio tenía abierta desde el frontend de la Fase 1 —la librería de línea de tiempo, «licenciamiento incluido»— se cierra con **CSS Grid y cero dependencias**: mientras el licenciamiento no esté decidido, la vista se sostiene con lo que ya hay, y sustituir `TimelineGrid` por FullCalendar o vis-timeline no cambia ni el contrato ni el backend (decisión 135). El modelo de datos **espeja el DTO del backend** —`types/timeline.ts`, como `types/glpi.ts`— en vez de mapear al `PlanningItem` de la Fase 1: el mapeo que la decisión 132 escribió obligaría a inventar `title`, `name` y `weeklyCapacityHours` —que no están persistidos— y perdería `planningStatus`, `severity` y toda la capacidad, justo lo que hay que pintar. `types/resource.ts` **no se toca** y queda declarado sin consumidores. Los filtros —tipo, severidad y estado— son `<select>` nativos que **filtran en memoria**, sin generar ni una llamada más, tal como la Fase 15 anticipó al no implementarlos en el servidor. Tres trampas reales quedaron resueltas y probadas: `new Date('2026-10-05')` se interpreta como UTC y en Colombia (UTC-5) pinta el día anterior, así que la fecha se construye campo a campo en hora local; la jornada del calendario congelado (09:00–17:00) **no viaja** en la respuesta, así que el eje horario se deriva de los tramos observados, redondeado hacia fuera (riesgo 67); y como el plan no guarda títulos, los bloques se rotulan con el `workItemId` (riesgo 66). La fase trae la **primera infraestructura de pruebas del frontend** —Vitest, jsdom y Testing Library, las cuatro como `devDependencies`, con `npm test`— y **24 pruebas que pasan**: las siete que el brief pidió, más el parseo de fechas, el eje horario, el filtrado y la ruta con reserva a campo. `npm run typecheck`, `npm run lint` y `npm run build` siguen limpios. **El backend no se tocó**: ni una línea, acreditado con fechas de modificación —los cinco archivos de `backend/src` con fecha de hoy son de la Fase 15, entre las 09:28 y las 09:42, y llevan hora anterior a la primera línea de frontend de esta fase (11:19)—, así que las **228 pruebas de Maven siguen valiendo** sin volver a correrlas.

**Fase 17 · Observabilidad operativa de la planificación** — completada. Las dieciséis fases anteriores saben leer **un plan**; esta añade la primera lectura que no pide ninguno: `GET /api/planning/metrics`, una fotografía del conjunto que responde qué puede planificarse, qué no, dónde están los cuellos de botella y cuánta capacidad queda —**sin recalcular planificación**: no ejecuta el motor, no genera planes y no consulta GLPI—. La respuesta son tres bloques porque son tres regímenes de dato distintos, y cada uno declara su fuente y su ámbito **dentro del propio JSON**, en vez de solo en el javadoc: `declared` (el estado declarado hoy en `planning_metadata`), `plans` (el histórico de `plan_snapshot`) y `current` (el plan vigente de cada desarrollador, con desglose en `byDeveloper[]`). Las nueve métricas del brief están todas: planificables, sin estimación, sin compromiso, sin metadata completa, requerimientos desplazados, capacidad disponible, ocupada y restante, y total de planes generados. **Los códigos de descarte no se inventan** —`SIN_ESTIMACION_DECLARADA` y `SIN_COMPROMISO_DECLARADO` salen del enum que la Fase 14 cerró, no de un literal nuevo—, y `plannable` se deriva del estado declarado por álgebra de conjuntos en vez de costar dos consultas más. **La capacidad se lee del timeline, no se re-deriva**: el servicio llama a `PlanningService.timeline` por cada plan vigente y suma lo que esa proyección ya devuelve, así que las métricas y la interfaz no pueden discrepar —una prueba suma los arrays del timeline y los compara con los del endpoint—, y `PlanningService` cambia **una sola palabra** en toda la fase (`published` pasa a `static`, para que el total se limpie con el mismo ayudante con el que el timeline publica sus horas). La vigencia es **el plan más reciente de cada desarrollador** por `created_at`, con desempate estable por identificador, y el criterio viaja en el payload; no se agregan los históricos porque duplicarían capacidad y carga (decisión 139). Tres hallazgos quedaron escritos en vez de tapados: los descartes de la capa anticorrupción **no se persisten** (decisión 99), así que «sin estimación» mide el estado declarado de hoy y no los descartes históricos (decisión 140); el estado «ambos valores retirados» es alcanzable por `PUT` y se expone como `declared.retracted` para que la aritmética del bloque cierre —`withoutEst + withoutComm == incomplete + retracted`, afirmado en dos pruebas—, porque sin él tres números del mismo bloque se contradirían para un estado legítimo; y **no se expone ninguna tasa de ocupación**, porque `declared` y `current` cambian con relojes distintos y dividirlos daría un indicador que no mide nada (riesgo 69). La ruta convive con `/{planId}` **por especificidad de patrón** —un segmento literal gana a una variable de captura, en cualquier orden de declaración—, y por eso se prueba en vez de asumirse: `GET /api/planning/no-es-un-uuid` sigue siendo un `400` (decisión 142). **`PlanningEngine`, las reglas de negocio, la integración con GLPI, los contratos de la Timeline, las entidades, las tablas y el frontend siguen sin tocarse**: la fase no añade ni una entidad, ni una tabla, ni un índice, y el endpoint no escribe nada —hay una prueba que cuenta las filas antes y después—; las **246 pruebas pasan** (18 nuevas: 12 del endpoint, 4 del criterio de vigencia y 2 de los contadores declarados), con tres omitidas por defecto porque necesitan una instancia real de GLPI.

**Fase 18 · Del tablero al elemento** — completada. La Fase 17 dejó nueve contadores y una pregunta abierta: cuando una tarjeta dice «sin estimación: 4», **cuáles son esos cuatro**. Esta fase cierra el salto de «hay un problema» a «estos son los elementos» con dos endpoints nuevos y una página, **sin recalcular una sola métrica**: `GET /api/planning/metrics/declared/{gap}` lista las filas de `planning_metadata` que producen cada carencia declarada, y `GET /api/planning/metrics/displaced` lista los elementos que el plan vigente movió, con el incidente que los movió, la regla aplicada y el motivo —los mismos campos que la auditoría del plan ya publicaba—. **La lista y el contador no pueden discrepar por construcción**: el detalle declarado usa el mismo predicado sobre la misma tabla que cuenta la tarjeta (`countByEstimatedHoursIsNull()` y `findByEstimatedHoursIsNull…()` son la misma condición escrita dos veces por Spring Data), y los desplazamientos agrupan los mismos eventos de los que sale la marca `DESPLAZADO` del timeline; las pruebas lo anclan comparando `items.length` contra la cifra que publica `/metrics`, leída en la misma prueba, y no contra un número escrito a mano. El mecanismo de drill-down elegido es **una página dedicada** sobre el patrón que ya existía en `/calendario/:planId` —con URL compartible, atrás del navegador gratis y **cero dependencias nuevas**—, descartando el panel lateral y la tabla expandible por su coste de accesibilidad, que no se puede simplificar y que la página no necesita pagar; la cuarta pregunta del brief, «quién tiene capacidad agotada», **no necesitó contenedor**: ya se responde resaltada en la tabla de cuellos de botella y su detalle es la Timeline que ya existe, así que bastó con que la celda `Plan` dejara de ser texto y pasara a ser un enlace. **Todo lo reutilizable se reutilizó sin tocar una línea**: la fila declarada es el `PlanningMetadataResponse` que ya publicaba `GET /api/planning-metadata/{workItemId}` —con `commitmentOverdue` incluido— y la causa del desplazamiento es el `RescheduleEventView` que el plan ya entrega en `rescheduleEvents`, así que `PlanningService` no cambió —`reason` y `toEventView` siguen privados—. Tres limitaciones quedaron escritas en vez de tapadas: `planning_metadata` guarda **quién declara, no quién planifica** —el desarrollador asignado no está en esa tabla y nombrarlo exigiría consultar GLPI, así que las columnas se rotulan por lo que son—; `plans.generated` **no es navegable**, porque `PlanSnapshotRepository` solo expone un plan por desarrollador y `POST /plan` no es idempotente, de modo que una lista de «planes» sería una lista de ejecuciones sin identidad propia; y el detalle de desplazados solo ve elementos con tramo en el timeline, así que uno desplazado más allá del horizonte tiene su evento y no tiene bloque. **`PlanningEngine`, las reglas de negocio, la integración con GLPI, los contratos de la Timeline y la proyección de métricas siguen sin tocarse**: la fase no añade ni una entidad, ni una tabla, ni un índice, y los dos endpoints no escriben nada —hay una prueba que lo comprueba leyendo dos veces y comparando—; las **258 pruebas del backend pasan** (12 nuevas) y el frontend queda en **47 pruebas**, con `typecheck` y `lint` limpios (13 nuevas entre el tablero y la página de detalle), con tres omitidas por defecto porque necesitan una instancia real de GLPI. Un hallazgo se corrigió de paso: el fixture de pruebas del tablero declaraba `retracted: 3` con `withoutCommitment: 2`, un estado que el backend **no puede producir** —exigiría un número negativo de filas—, y sin corregirlo la prueba central de esta fase habría afirmado una propiedad sobre datos imposibles.

**Fase 19 · Alertas Operativas** — completada. Las dieciocho fases anteriores dejan leer un estado; esta dice **cuál de esos estados exige que alguien actúe**. `GET /api/planning/alerts` publica las condiciones que hoy se cumplen, de más grave a menos —tickets sin estimación, sin compromiso, metadata incompleta, requerimientos desplazados, capacidad agotada y capacidad negativa—, cada una con su severidad, de dónde sale, con qué condición, sobre qué universo, cuántos elementos la producen, a dónde ir a verlos y cuándo se evaluó. **Es una proyección, y se toma la palabra en serio**: el servicio no tiene repositorios ni reloj, su única dependencia es `PlanningMetricsService`, y todo lo que hace es leer su respuesta y contar —así que una alerta y la métrica de la que sale **no pueden discrepar**, porque no existe la forma de que se separen—. **Cuatro de los seis contadores ya estaban contados**: las dos carencias declaradas, lo incompleto y los desplazamientos son literalmente el número que `/metrics` publica; los dos de capacidad son lo único que se cuenta aquí, y se cuentan filtrando `byDeveloper[]` con **los dos mismos predicados que la tabla de cuellos de botella ya usa** —restante exactamente cero y restante negativo—, no con umbrales nuevos. `PlanningMetricsService` **no se tocó**, que es la forma más barata de garantizar que no se recalcula ninguna métrica; por el mismo motivo el catálogo es un enum, `OperationalAlertType`, donde están escritas la severidad, la condición y el destino de cada alerta, y añadir una sin decir cuánto urge no compila. **La severidad no se inventa: se hereda de condiciones que el backend ya distingue**, con un criterio por nivel y ninguno es un umbral —CRITICAL es el estado que se contradice a sí mismo y solo hay uno, el restante negativo, que el contrato ya declara imposible y `Capacity` se niega a recortar a cero para que se vea; WARNING es un estado legal con dueño, y las dos carencias declaradas son literalmente los dos motivos por los que la capa anticorrupción descarta un ticket, cada una nombrando a una persona distinta—; e INFO es un agregado sin dueño único, que es por lo que `METADATA_INCOMPLETA` —la *unión* de las dos carencias— no sube a aviso: inflaría la cuenta de lo que urge con trabajo ya contado dos veces. **Las alertas enlazan con el drill-down de la Fase 18 y no construyen listados nuevos**: `detailUrl` publica una ruta **de esta API** —no de la interfaz, que el backend no puede construir bien—, y eso la hace comprobable: una prueba pide cada ruta publicada y exige que responda y que el número de elementos cuadre con el `count`; las dos de capacidad van con `detailUrl` nulo **y el campo viaja igual**, para que el esquema sea el mismo en las seis. **Dos hallazgos quedaron escritos en vez de tapados**: la alerta de capacidad **negativa no puede dispararse** —el motor nunca sobrepasa la jornada, así que existe como canario: se prueba donde la fotografía se escribe a mano y sobre datos reales se prueba que **no** suena—, y las dos alertas de capacidad **miden el plan y no el día** —un lunes exactamente lleno con holgura el martes no dispara, y contar por día daría además un falso positivo por cada sábado y domingo de la ventana, porque una jornada no laborable tiene cero disponible y cero ocupado—; el escenario conocido, que deja el lunes lleno y el plan con seis horas de holgura, es justo el que fija esa decisión. **Las alertas clasifican, no particionan** —una fila sin ninguno de los dos valores cuenta en tres alertas a la vez, correcto porque cada una responde a una pregunta distinta sobre el mismo elemento—, así que sumar los `count` no mide nada y **no se publica ningún total**. **`PlanningEngine`, las reglas de negocio, la integración con GLPI, los contratos de la Timeline, la proyección de métricas y el frontend siguen sin tocarse**: la fase no añade ni una entidad, ni una tabla, ni una columna, ni un índice, y el endpoint no escribe nada —hay una prueba que lee dos veces y compara—; las **282 pruebas del backend pasan** (24 nuevas: 13 de la proyección, sin Spring, y 11 del endpoint), con tres omitidas por defecto porque necesitan una instancia real de GLPI.

**Fase 20 · El centro de alertas operativas** — completada. La Fase 19 publicó las alertas **y las dejó sin consumidor**: la única forma de verlas era pedir el endpoint a mano. Esta fase las convierte en pantalla —`/alertas`, segunda entrada del menú lateral— y **no añade una sola regla**: consume exclusivamente `GET /api/planning/alerts`, no recalcula ninguna alerta —no cuenta elementos, no re-deriva prioridades y no pide las métricas para comprobar nada: hay una prueba que exige que la petición sea exactamente una, y esa—. **La vista no ordena**, porque el backend ya las manda de más grave a menos: un `sort` en el cliente sería una segunda regla de prioridad invisible encima de la del backend, así que una prueba le entrega la respuesta **al revés** y exige que la tabla salga al revés también, que es la única forma de demostrar que no hay un orden escondido. **Los filtros —severidad y tipo— se aplican en memoria** sobre el array ya recibido, con el mismo patrón que los de la Timeline, y **sus opciones salen de la respuesta**, no de un catálogo escrito en la vista: un tipo nuevo aparece en el desplegable el día que el backend lo publica, sin tocar el frontend. Filtrar hasta vaciar la lista **no se confunde con no tener alertas**: «ninguna coincide con los filtros» y «ninguna condición exige atención» son estados distintos, y la lista vacía va fechada —sin fecha, «no hay nada que mirar» y «no se ha mirado» se leerían igual—. **La traducción de `detailUrl` a una pantalla vive ahora en el frontend, y se deriva en vez de escribirse** (decisión 151): `alertDetailPath()` invierte la tabla `METRIC_GAPS` —la que ya hacía el viaje de ida para el tablero— más el token de desplazados, así que no hay una tercera copia del token; la acción «ver el desglose» **solo aparece cuando la traducción existe**, los cuatro destinos reusan las páginas de la Fase 18 sin abrir ninguna nueva, las dos alertas de capacidad dicen que su detalle es el calendario del plan en vez de ofrecer un botón que no lleve a ninguna parte, y **una ruta que la aplicación no sepa abrir se enseña tal cual** en vez de convertirse en un destino inventado —el riesgo 81 queda atendido por el lado que le tocaba—. **Todo lo presentacional se reutilizó**: `Card`, `Badge`, `Skeleton`, `Button` y `EmptyState`, más el patrón de `useTimeline`/`usePlanningMetrics` y el `<select>` que la Timeline guarda en privado, copiado aquí por el mismo motivo por el que la Fase 18 no pudo sustituir el suyo —la Timeline es intocable en esta fase—; **no se añadió ninguna dependencia** y **el diff de la fase es enteramente del frontend**: ni una línea del motor, de las reglas, de la integración con GLPI, de los contratos ni de la proyección de métricas. Es una pantalla de **solo lectura**, y no por falta de tiempo: las alertas se derivan en cada consulta, así que no hay nada que reconocer, cerrar ni descartar, no hay historial que persistir y no hay totales que sumar. **Queda documentado lo que no hay** —correo, Teams, push, scheduler y jobs— y lo que ya está resuelto para el día que se quiera notificar de verdad: qué merece interrumpir, de dónde sale la condición y a dónde mandar a quien la reciba; lo que falta no es el canal, es **el destinatario y la memoria de lo ya enviado**. Las **60 pruebas del frontend pasan** (13 nuevas) con `typecheck` y `lint` limpios, y las **282 del backend siguen pasando** (3 omitidas por necesitar una instancia real de GLPI), porque esta fase no lo toca.

**Fase 21 · La vista consolidada de equipo** — completada. El tablero ya enseñaba los cuellos de botella por desarrollador y la Timeline ya abría la agenda de un plan; lo que faltaba era **compararlos**. `/recursos` —la entrada **Recursos** del menú, cuya descripción ya decía «Equipo de desarrollo y su capacidad»— pone el plan vigente de cada uno al lado del otro, ordenable por cualquier columna, con la capacidad agregada y las alertas del conjunto. **No estrena backend, y eso es el resultado del análisis, no una casualidad**: `current.byDeveloper[]` de `/metrics` **ya era** «un plan vigente por desarrollador», con la vigencia resuelta por el backend (decisión 139), así que las siete columnas que el brief pedía ya viajaban publicadas; añadir una ruta nueva habría sido la tercera copia de un hecho que ya tiene dos dueños y un segundo sitio donde decidir qué plan manda. **La vista no crea un plan de equipo**: no fusiona planes, no suma tramos y no recalcula capacidad —cada fila **es** un plan y sus cifras son las que el backend publicó para él—; lo único que aporta es la comparación y la navegación, y el diff de la fase es enteramente del frontend. **Sin mini timeline por fila** (decisión 154): sería una petición por plan —el coste O(planes) que los riesgos 75 y 85 ya señalan— y recalcularía la capacidad día a día, que podría discrepar de los totales publicados; el día a día ya existe a un clic, en el calendario del plan de cada fila. **Ordenar es una acción del usuario y el orden de partida sigue siendo el del backend**: la cabecera es un botón, el segundo clic invierte, la dirección se declara en `aria-sort`, los números se comparan como números —una prueba fabrica un 9 y un 80, que como texto saldrían al revés— y los empates se rompen por `developerId` para que el orden sea estable. **La correspondencia entre la tabla y las alertas se comprueba, no se programa**: las alertas no tienen dimensión de desarrollador (riesgo 76), así que la vista **no re-deriva** el reparto por persona —sería la tercera copia de un predicado que el backend ya aplica—; enseña las dos cosas y una prueba afirma que las filas con el restante agotado o negativo son exactamente el `count` de su alerta. **Tres duplicados se eliminaron de paso** en vez de copiarse por tercera vez: los dos predicados de capacidad y la ordenación viven ahora en `lib/capacity.ts`, el formato de instante en `lib/format.ts` y el color por severidad en `lib/alerts.ts`, y el tablero, el centro de alertas y esta vista los comparten. **`PlanningEngine`, las reglas de negocio, la integración con GLPI, `PlanningMetadata`, los contratos y la proyección de métricas siguen sin tocarse**: no hay endpoint nuevo, ni entidad, ni tabla, ni columna, ni dependencia nueva. Las **76 pruebas del frontend pasan** (16 nuevas) con `typecheck` y `lint` limpios, y las **282 del backend siguen pasando** (3 omitidas por necesitar una instancia real de GLPI), porque esta fase no lo toca.

**Fase 22 · La recuperación de los tickets asignados** — completada. `POST /api/planning/from-glpi` devolvía **cero tickets** para cualquier desarrollador, y con ellos un plan vacío que parecía decir «esta persona no tiene trabajo». La causa no estaba en el motor ni en la planificación declarada: **el adaptador preguntaba por el técnico asignado en un sitio donde GLPI no lo publica**. Quien tiene asignado un ticket no es un campo del ticket —es una fila de `Ticket_User` con `type=2`, y `/Ticket` no proyecta esa relación—, así que el filtro en memoria sobre `users_id_assign` no encontraba nada nunca. La medición: `/Ticket?range=0-999` devolvió 1000 tickets y **ninguno de los mil traía la clave**; el contrato la declaraba como opcional, así que el verificador no protestaba y el fallo aparecía lejos, como un plan vacío. Y había un segundo defecto debajo: la misma llamada a través del cliente de la aplicación **fallaba antes de llegar al filtro** —`503 GLPI_UNAVAILABLE`, `GLPI respondio HTTP 206 en /Ticket?range=0-999: (cuerpo vacio)`—, porque el cuerpo pesa 8 MB y el transporte guarda 256 KB en memoria; la sonda de rango mínimo, que también responde 206 y se lee entera, es la que separa «el 206 es intolerable» de «el cuerpo no cabe». **La estrategia se sustituye y la anterior se retira**: los tickets se piden a **`/search/Ticket` con la opción de búsqueda 5 —«Technician»**, publicada por `/listSearchOptions/Ticket` y validada en la Fase 12, que sigue siendo correcta hoy— y el filtro lo hace el servidor. La opción 5 se compara **por id numérico**: con un login GLPI no falla, castea a cero y devuelve los tickets del usuario cero, así que el adaptador rechaza los identificadores no numéricos **sin llegar a preguntar**. `GlpiTicket.assignedUserId`, la clave `users_id_assign` del contrato y la ruta `/Ticket` **salen del código**: un campo opcional inventado es peor que uno ausente, porque el verificador no lo delata y la prueba nueva fija ese mecanismo. Aparece `GlpiTicketSearchPage`, porque la búsqueda **devuelve un sobre con `totalcount`** y no un arreglo en la raíz —y omite `data` cuando no hay resultados—; `totalcount` es lo que hace verificable el recorrido de páginas, y **una lectura corta no se devuelve: se denuncia**, porque medio trabajo produce un plan que parece completo. `forcedisplay` deja de ser solo fidelidad de contrato y pasa a ser **lo que hace que la página quepa**: mil filas proyectadas pesan 153 KB y sin proyección 6,2 MB —a un técnico GLPI le respondió `HTTP 500`—. **La verificación funcional, contra la instancia real y el mismo endpoint**: antes, `developerId` 296 → `503`, **0 tickets**; después, 296 → **1266 tickets** y 13 → **1949** (dos páginas, 1000 + 949), coincidiendo exactamente con el `totalcount` que la instancia declara para cada uno. Los recuperados se descartan todos por falta de `PlanningMetadata` —1266 tickets producen 2532 descartes, dos por ticket—, que es lo correcto: recuperar y planificar son dos preguntas distintas y esta fase arregla la primera. Las **289 pruebas del backend pasan** (3 omitidas por necesitar una instancia real de GLPI), sin debilitar ninguna: las dos que afirmaban la versión del adaptador se actualizan al corte `glpi-rest-3` y trece construcciones de `GlpiTicket` en otras suites pierden el argumento que ya no existe. **`PlanningEngine`, las reglas de planificación, el frontend y `PlanningMetadata` siguen sin tocarse.**

**Fase 23 · La lectura de las declaraciones de un técnico** — completada. La Fase 22 dejó de devolver cero tickets, y con eso quedó al descubierto la pregunta que la pantalla de declaración iba a hacer primero: **qué tiene asignado un técnico y qué le falta a cada cosa**. La respuesta no podía salir de `POST /api/planning/from-glpi`, que es un endpoint de escritura —pedirle el listado habría dejado un plan guardado por cada vez que alguien abre la pantalla—, así que aparece `GET /api/planning-metadata/declarations/{developerId}`: **una lectura, sin motor, sin plan y sin escribir nada** —hay una prueba que cuenta las filas de `planning_metadata`, su historia y los planes antes y después—. Cada elemento trae `workItemId`, `type`, `status`, `priority`, `createdAt`, `title`, `declarationStatus`, sus `discards[]` con código y motivo, y la `declaration` con el **mismo contrato** que su propio `GET /{workItemId}`, para que quien vaya a modificarla no necesite una segunda lectura. **Los cinco estados —`PLANIFICABLE`, `SIN_ESTIMACION`, `SIN_COMPROMISO`, `SIN_DECLARACION`, `NO_TRADUCIBLE`— no son una segunda clasificación**: el recorrido se extrajo al mismo sitio donde ya vivía, `GlpiPlanningRequestFactory`, que ahora expone `verdicts()` y lo usa para las dos cosas —armar la petición del motor y contestar esta lectura—, así que un ticket no puede salir planificable en la pantalla y descartado en el plan; una prueba lo afirma sobre el mismo ticket por las dos rutas, y otra comprueba que los códigos son literalmente los que produjo `GlpiTicketValidator` y no una traducción de sus reglas. `statusOf` **deriva de los códigos, no de volver a mirar los nulos**, que es la forma de que la regla siga teniendo un solo dueño. **La consulta por lote ya existía** —`findByWorkItemIdIn`, que la capa anticorrupción usa desde la decisión 124.2— y esta lectura la reutiliza: una consulta para toda la agenda, no una por ticket, con una prueba que la cuenta sobre un doble y exige que `findByWorkItemId` no se llame nunca. Un técnico que no está en GLPI responde `404 DEVELOPER_NOT_FOUND` y no una lista vacía, y un técnico sin tickets responde `200` con la lista vacía, que es la respuesta correcta a «no tiene trabajo». **`PlanningEngine`, las reglas de planificación, `PlanningMetadata`, la integración con GLPI y el frontend siguen sin tocarse**: no hay entidad, ni tabla, ni columna, ni dependencia nueva, y el endpoint solo lee. Las **309 pruebas del backend pasan** (20 nuevas: 11 del endpoint y 9 de la clasificación), con tres omitidas por necesitar una instancia real de GLPI.

**Fase 24 · La pantalla de declaración** — completada. La Fase 23 dejó una lectura de las declaraciones **y ningún sitio donde usarla**: los cinco estados solo se veían pidiendo el endpoint a mano, y declarar era un `curl`. **`/declaraciones`** —la entrada **Declaración** del menú— cierra el flujo entero, `GLPI → tickets asignados → estimación → compromiso → PlanningMetadata`, y **no estrena backend**: consume la lectura consolidada, lee el recurso de un ticket antes de reemplazarlo y escribe con los dos endpoints que ya existían. Es la primera pantalla de la aplicación que **escribe**, y eso obligó a decidir lo que ninguna lectura obliga a decidir (decisión 161). **El formulario lee antes de escribir**, porque el `PUT` reemplaza: abrir el de un ticket que ya tiene declaración lanza una lectura fresca de `GET /{workItemId}` y no enseña ningún campo hasta que llega —rellenar con lo que traía el listado, que es una foto de hace un minuto, y guardar borraría lo que alguien cambió en ese minuto—; por el mismo motivo el cuerpo lleva **siempre los dos valores**, con nulo para decir «retíralo», porque un formulario que mandara solo la fecha borraría la estimación. **El verbo lo decide la existencia de la fila y no el estado**: un ticket con los dos valores retirados se clasifica `SIN_DECLARACION` pero tiene fila, y decidir por el estado mandaría un `POST` sobre algo que ya existe y recibiría un `409` —la pantalla convertiría un caso normal en un error—. **Después de guardar se invalida lo justo**: la lista del técnico se relee en el acto, que es lo que hay que ver cambiar, y el recurso del ticket solo se marca viejo, sin releerlo, porque en ese instante el formulario todavía está montado y pediría exactamente los valores que se acaban de guardar; no hay recarga de página y la fotografía operativa, las alertas y el timeline no se tocan. **La pantalla no clasifica nada**, que es la obligación que la decisión 160 dejó escrita y lo que más fácil era romper aquí: la tabla pinta `declarationStatus` y los `discards[]` con su código y su motivo tal como llegan, y la prioridad se enseña cruda en su escala 1..5 sin traducirla a severidad —una prueba construye el caso imposible para la vista y posible para el backend, un ticket con horas y fecha y estado `SIN_ESTIMACION`, y exige que gane el backend—. Los errores se enseñan con las palabras del backend, sin reinterpretarlos: un `400`, un `404` y un `409` dicen cosas distintas, y el `409` es un caso legítimo —alguien declaró primero— y no un fallo de la pantalla. **Ninguna lectura nueva y ninguna por ticket**: la lista sale de la lectura consolidada de la Fase 23 y la declaración ya viaja dentro de cada elemento, así que no hay una petición por fila. **El `apiGet` que ya existía conserva su firma y su comportamiento** —la extracción del cliente HTTP dejó el mismo contrato por delante y añadió `apiPost` y `apiPut`—, no se tocó ningún componente que ya estuviera probado, y **las 86 pruebas del frontend pasan** (10 nuevas), con `typecheck` y `lint` limpios. `PlanningEngine`, las reglas de negocio, `PlanningMetadata` y `integration/glpi/` siguen sin tocarse: **no hay una línea de backend en esta fase**. Limitaciones que quedan dichas: el técnico se escribe a mano porque el backend no publica el padrón de personas (riesgo 107), `changedBy` lo teclea el operador porque no hay autenticación (riesgo 108), y la pantalla no pagina ni filtra, así que un técnico con 1.949 tickets pinta 1.949 filas (riesgo 106).

**Fase 25 · El modelo de renegociación** — completada. El motor detecta desde la Fase 3 que un incidente le quita a un requerimiento su franja —deja un `RescheduleEvent` auditado, lo marca `DESPLAZADO` en el timeline y lo declara `PENDIENTE_DE_RENEGOCIACION`— y la operación con la que una persona confirma **a qué fecha se llegó** no existía: se acordaba por fuera del sistema y el sistema no lo sabía. Esta fase construye el modelo formal de esa renegociación y su lectura consolidada, **sin tocar el motor**: `PlanningEngine` no cambió una línea, no se recalcula capacidad, no se recalculan desplazamientos y no se altera la generación de ningún `RescheduleEvent` —la renegociación es una consecuencia humana de un desplazamiento ya detectado, no una entrada del cálculo—. El modelo elegido, entre los tres que el brief pedía evaluar, es **un agregado propio con su historial de solo inserción** (`renegotiation` + `renegotiation_history`), espejo de `PlanningMetadata`: **reutilizar `RescheduleEvent`** habría mezclado en la misma tabla un hecho que produce el motor con uno que produce una persona, y un acuerdo **abarca varios eventos** —un requerimiento movido por dos incidentes tiene un solo acuerdo— así que no cabe dentro de uno; **un historial sin agregado** habría dejado el `PUT` sin fila que bloquear, y leer-antes-de-reemplazar necesita esa fila. La clave es `workItemId`, el ticket de GLPI como texto, **sin clave foránea al desplazamiento ni al plan**: un acuerdo es sobre el requerimiento, no sobre una fila de un plan concreto, y atarlo a un evento obligaría a elegir cuál de los dos. **Los estados se derivan y no se guardan** —`PENDIENTE_DE_ACUERDO` y `ACORDADA`—, y **no se llaman `PENDIENTE_RENEGOCIACION` / `RENEGOCIADO`** porque `RequirementStatus.PENDIENTE_DE_RENEGOCIACION` ya existe y significa otra cosa: es el estado **de salida** al que el motor lleva un requerimiento cuando un incidente le quita su franja, no se persiste y no se traduce de GLPI —dos nombres iguales para dos hechos distintos habrían sido el estado redundante que el brief prohíbe—. **Un acuerdo cubre los desplazamientos que ya existían cuando se registró**, que es la única comparación posible: lo que se sabe de un desplazamiento es cuándo se auditó y lo que se sabe de un acuerdo es cuándo se registró; un incidente posterior **reabre** la renegociación —vuelve a `PENDIENTE_DE_ACUERDO` con el acuerdo anterior todavía visible, porque esconderlo borraría la explicación de por qué la fecha acordada ya no sirve—, y un desplazamiento en el **mismo instante** que el acuerdo sí queda cubierto, porque el orden entre dos hechos del mismo sello no es deducible. **El desplazamiento dice dónde quedó, no qué se prometió**: `rescheduledDate` es el día en que el requerimiento cierra tras el recálculo, no la fecha que se le comunicó a quien lo pidió, y ese hueco es justo lo que la renegociación guarda. **La lectura consolidada no recorre los planes por su cuenta**: llama a `PlanningMetricsService.displaced()`, la misma fuente de la que sale la tarjeta de desplazamientos, así que las dos no pueden discrepar; el acuerdo se busca para todos los elementos **en una sola consulta** (`findByWorkItemIdIn`), y un elemento no desaparece de la lista al renegociarse. **El sello de tiempo sale del `Clock`**, nunca del cuerpo de la petición, y reenviar la misma fecha no escribe una fila de historial por un cambio que no ocurrió. Cinco endpoints en `/api/renegotiations` —la lectura consolidada, el acuerdo vigente, su historial, `POST` y `PUT`—, con el `409` de conflicto capturado fuera de la transacción igual que en la declaración, y el `404` de un requerimiento desplazado del que nadie ha acordado nada todavía, que es el estado normal y no una avería. **`PlanningEngine`, las reglas de negocio, la integración con GLPI, `PlanningMetadata`, los contratos de la Timeline y la proyección de métricas siguen sin tocarse.** Las **329 pruebas del backend pasan** (20 nuevas), sin debilitar ninguna de las 309 que ya había.

**Fase 26 · La pantalla de renegociación** — completada. La Fase 25 dejó el modelo formal de la renegociación **y ningún sitio donde usarlo**: el estado de cada requerimiento desplazado solo se veía con `curl`, y acordar una fecha era una llamada a mano. **`/renegociaciones`** —la entrada **Renegociación** del menú— cierra el flujo operativo entero, `Incidente → Desplazamiento → Pendiente de acuerdo → Acuerdo registrado → Historial consultable`, y **no estrena backend**: consume exclusivamente las cinco rutas de `/api/renegotiations`, lee el acuerdo de un requerimiento antes de reemplazarlo y escribe con los dos verbos que ya existían. El diff de la fase es **enteramente del frontend**: ni una línea de `PlanningEngine`, de las reglas de negocio, de la integración con GLPI, de `PlanningMetadata` ni de los contratos. **La regla que define la pantalla es la que le prohíbe decidir**: sería fácil pintar el estado comparando el acuerdo con las fechas de los desplazamientos, y sería la segunda versión de la regla que aplica `RenegotiationService` —la que no falla el día que se escribe sino el día que cambia la otra—; la tabla pinta `status` tal como llega y el filtro compara contra ese mismo valor, sin traducirlo, con los dos únicos estados del contrato. Una prueba construye el caso que la vista no puede resolver por su cuenta y el backend sí —un requerimiento **pendiente con acuerdo vigente**, porque un incidente posterior al acuerdo lo reabre— y exige que la fila enseñe las dos cosas y ofrezca «Editar acuerdo» y no «Registrar». **El verbo lo decide la existencia del acuerdo y nunca el estado visual** (decisión 164): decidirlo por `status` mandaría un `POST` contra un recurso que existe y el backend respondería `409` —la pantalla convertiría un caso normal en un error—, y hay dos pruebas que fijan justo ese caso. **El formulario lee antes de escribir**, porque el `PUT` reemplaza: con acuerdo, abre una lectura fresca de `GET /api/renegotiations/{workItemId}` y no enseña ningún campo hasta que llega —rellenar con lo que traía la lista, que es una foto del instante en que se consultó, y guardar borraría lo que alguien cambió desde entonces—; sin acuerdo no hay nada que leer y el verbo es `POST`. **El brief pedía un campo de motivo y el contrato no lo tiene**, así que el formulario **no lo captura** y en su lugar enseña el `reason` que el plan ya publica para cada desplazamiento: un campo de texto que el backend descarta al deserializar no es capturar un dato, es perderlo con la apariencia de haberlo guardado, y el brief prohíbe cambiar los contratos —queda como riesgo 114, y añadirlo exige campo nuevo en el contrato y columna nueva en la tabla—. **El historial se lee de su propia ruta y no se reconstruye**: una entrada por cambio, **en el orden exacto en que la publica el backend**, sin ordenar, sin deduplicar y sin completar con lo que traía la lista, con «primer acuerdo» para la entrada de `previousDate` nulo —el momento en que no había fecha y alguien la trajo—; sin acuerdo **no se pide nada**, porque el `404` de esa ruta es el estado normal de un requerimiento desplazado que nadie ha renegociado todavía, y una prueba exige que la petición no salga. **Después de guardar se invalida lo justo, y no es lo mismo que en la declaración**: se relee la lista —de donde sale el estado nuevo de la fila— y el historial del requerimiento afectado, que sigue montado y es donde la entrada recién escrita tiene que aparecer, mientras el detalle solo se marca viejo porque el formulario se cierra en ese instante; la fila **sigue elegida**, para que el historial releído enseñe el cambio sin volver a abrir nada, y una prueba afirma la conversación entera —lista dos veces, lectura previa una, historial dos, detalle una— sin una petición por fila ni una ruta ajena. **Ninguna lectura por fila**: la lista sale de una sola petición y el acuerdo y el historial se piden solo al elegir una fila, y no se piden en absoluto si esa fila no tiene acuerdo. **Los filtros —Todas, Pendientes, Acordadas— se aplican en memoria**, sin volver a consultar, y filtrar hasta vaciar la lista **no se confunde con no tener nada que renegociar**: son dos estados distintos y se dicen por separado; la fila seleccionada se busca en la lista completa y no en la filtrada, así que cambiar el filtro no cierra un formulario a medio escribir. **Los errores se enseñan con las palabras del backend**, sin reinterpretarlos —el `400`, el `404` de un acuerdo que la lista decía que existía y el `409` de «para modificarla se usa `PUT`»—, y ante el `404` la pantalla **no se cae al `POST` por su cuenta**, porque eso crearía un acuerdo que la fila decía que existía. Todo lo presentacional se reutilizó —`Card`, `Badge`, `Button`, `EmptyState`, `Skeleton`, el `<select>` nativo y el patrón de `useQuery`/`useMutation` de la declaración— y **no se añadió ninguna dependencia**. Las **102 pruebas del frontend pasan** (16 nuevas), con `typecheck`, `lint` y `build` limpios, y las **329 del backend siguen pasando** (3 omitidas por necesitar una instancia real de GLPI), porque esta fase no lo toca. El riesgo 110 —el modelo sin consumidor— queda atendido.

**Fase 27 · El motivo del acuerdo** — completada. Las dos fases anteriores dejaron el acuerdo respondiendo **quién** lo registró, **cuándo** y **a qué fecha** se llegó, y ninguna podía contestar **por qué** se llegó a esa fecha: el contrato no tenía dónde guardarlo, y la Fase 26 lo dejó escrito como riesgo 114 en vez de inventarlo. Esta fase cierra esa pregunta con **un campo nuevo en el modelo de renegociación y en sus cuatro contratos**, una columna nueva en sus dos tablas y el campo correspondiente en la pantalla. **No toca el motor**: ni una línea de `PlanningEngine`, de las reglas, de los desplazamientos, del Timeline, de las métricas ni de las alertas. **El motivo vive en el acuerdo vigente y en cada fila de su historial**, que es la misma colocación que ya tenían `agreedDate`, `agreedBy` y `agreedAt` —el cuarto dato del mismo hecho, en el mismo sitio—: el vigente contesta «cómo está hoy el acuerdo» y el historial «qué pasó y por qué pasó entonces», y si el motivo viviera **solo** en el vigente, corregirlo **reescribiría el pasado** —la primera fila del historial afirmaría que entonces se dijo lo que se dice hoy—, mientras que si viviera **solo** en el historial, el acuerdo vigente no podría declarar su propio motivo y cada lectura tendría que recorrer el historial de cada elemento, que es justo lo que la lectura consolidada de la Fase 25 se construyó para no hacer. **El campo se llama `agreedReason` y no `reason`**, porque en la misma fila de `GET /api/renegotiations` convive con el `reason` del `RescheduleEvent`: los dos motivos son hechos de productores distintos —el motor audita el suyo a partir de la regla aplicada, la persona firma el suyo y no se deduce de ningún dato— y el nombre es lo único que impide confundirlos sin depender de que quien lea el JSON mire de qué nivel está hablando. **El motivo es obligatorio al escribir y anulable solo al leer**: `@NotBlank` y hasta 500 caracteres en `RenegotiationRequest` y `RenegotiationUpdateRequest`, porque un motivo que se puede omitir es un motivo que se omite y la mitad de una trazabilidad no es una trazabilidad; y nulo en el dominio, las entidades y las respuestas, donde significa **siempre** «acuerdo registrado antes de que este campo existiera» —nunca «sin motivo»—. **La migración añade la columna y no rellena ninguna fila**: `ddl-auto=update` sobre `agreed_reason varchar(500)` en `renegotiation` y `renegotiation_history`, sin backfill, porque cualquier texto que se escribiera en las filas viejas sería una explicación fabricada por una migración y la base afirmaría que alguien dijo algo que nadie dijo. **El motivo cuenta como cambio, y la invariante del cambio se mudó de sitio**: la regla que vivía en `RenegotiationChange` —«un cambio tiene que cambiar algo», que exigía que las dos fechas difirieran— era **de fecha sola** y con el motivo en el modelo se habría convertido en un borrado silencioso, porque corregir el motivo sin tocar la fecha no habría dejado ninguna fila y la auditoría habría afirmado que el motivo vigente es el que siempre estuvo —el modo de fallo del riesgo 114 reapareciendo un nivel más abajo—; la comparación **no se pierde, se muda** a `Renegotiation.changesFrom`, que es el único sitio donde están los dos motivos, y una fila del historial con las dos fechas iguales pasa a ser legítima y significa que lo que cambió fue la explicación. **El formulario gana el campo**, «Por qué se acuerda esta fecha», precargado con el motivo vigente cuando el acuerdo ya existe —por la misma razón que la fecha: es contenido que el `PUT` reemplaza, y no verlo antes de escribir es como se borra sin querer—; **la lista gana la columna** «Por qué se acordó», el único campo de la fila que ningún dato puede deducir; y **el historial gana el motivo de cada entrada** —el de entonces, no el vigente—, con «motivo corregido» para la entrada que trae las dos fechas iguales, que de otro modo se leería como un error del plan. **Lo que no cambia es la mitad que no dependía del contrato**: el `reason` del plan se sigue enseñando en solo lectura y rotulado como lo que es, y ahora las dos etiquetas dicen quién redacta cada uno. **Siete pruebas nuevas en el backend** (20 → 27) y **tres en el frontend** (16 → 19), una por caso que el brief pedía, y **ninguna prueba existente se debilitó** —las 20 del servicio y las 16 de la pantalla siguen pasando; lo que sí se actualizó son los cuerpos de `POST` y `PUT` que la pantalla afirma, porque el contrato cambió y una prueba que afirmara el cuerpo viejo estaría afirmando un `400`—. **Las pruebas encontraron un defecto real durante la implementación**: la primera ejecución falló con siete pruebas en rojo porque `Renegotiation.agreedWith` construía el acuerdo con el motivo y el autor **intercambiados** respecto al orden del `record` —los dos son `String`, así que el compilador no podía verlo y ninguna prueba anterior podía verlo tampoco, porque hasta esta fase no había dos campos de texto seguidos en el mismo `record`—. Las **336 pruebas del backend pasan** (0 fallos, 3 omitidas por necesitar una instancia real de GLPI) y las **105 del frontend** (9 archivos), con `typecheck` y `lint` limpios. El riesgo 114 queda atendido, y esta fase añade el 117 —el motivo es texto libre y no hay catálogo, así que no se puede agrupar por causa— y el 118 —el contrato de escritura gana un campo obligatorio y un cliente que llamara sin él recibe ahora un `400`—.

**Fase 28 · La generación operativa del plan** — completada. Las veintisiete fases anteriores sabían leer un plan, declararlo y renegociarlo, y **ninguna sabía producirlo desde la interfaz**: generar un plan era un `curl` a `POST /api/planning/from-glpi` y ver el resultado exigía copiar el identificador y armarlo a mano en la dirección del calendario. Esta fase abre **`/planificar`** —la entrada **Planificación** del menú, entre Declaración y Renegociación, que es el orden del flujo—, la primera pantalla que **invoca** la generación, y con ella el flujo que el brief pedía cerrar —`GLPI → Declaración → Generación del plan → Timeline → Métricas → Alertas → Renegociación`— queda operativo de punta a punta, sin un solo paso que exija un `curl`. **La regla crítica se cumple por construcción**: el cuerpo de la petición lleva **solo el identificador del técnico**, así que no hay en la pantalla una sola regla, horizonte, prioridad o calendario que se pueda tocar y el motor corre entero en el backend; la interfaz **no planifica**, invoca la ruta que ya existía y enseña lo que devuelve. **El diff es enteramente del frontend** —cinco archivos nuevos y tres editados—: ni una línea de `PlanningEngine`, de las reglas de negocio, de la integración con GLPI, de los contratos, de `PlanningMetadata` ni de la proyección de métricas. **Generar escribe**, y eso ordena toda la pantalla: la petición sale del botón y no del montaje —abrirla no deja rastro, y una prueba lo afirma sobre el `fetch`—, sale al **enviar** y no al teclear —escribir «296» no debe generar el plan de «2» ni el de «29», porque cada intento guarda un plan—, **no sale** con el campo vacío —el backend respondería `400` a una petición que no hacía falta enviar— y **no se reintenta sola**, porque cada intento guardaría un plan; el formulario de arriba **es** el reintento. **Generar dos veces al mismo técnico es lo normal**: se replanifica cuando lo declarado cambió y cada corrida crea un plan **nuevo con su propio identificador**, así que la segunda no reemplaza a la primera —hay una prueba que lo exige—. **Lo que se enseña son hechos publicados y no cálculos de la vista**: el identificador, el sello del servidor, el técnico que GLPI reconoció y tres cifras que son **longitudes de listas** —elementos ubicados, desplazados **de esta ejecución** y conflictos, con el rótulo diciendo explícitamente que no son los del plan vigente—, más los descartes **tal como llegan**, uno por causa y no por ticket, porque un ticket sin declaración produce dos entradas con el mismo `ticketId` y agrupar daría 1 donde el backend publica 2. **La cifra que el contrato no publica no se inventa**: cuántos tickets entregó GLPI no viaja en la respuesta —vive en el log del servidor— y la pantalla lo dice en vez de deducirlo, porque ninguna suma de asignaciones, desplazados, conflictos y descartes da ese número. **El refresco alcanza tres claves y ninguna más**, cada una justificada por lo que lee —las métricas, cuyo bloque `current` es el plan vigente y cuyo contador cuenta ejecuciones y que **es también lo que lee `/recursos`**, que por eso no necesita una cuarta—, las alertas, que son una proyección de esa fotografía pero otra consulta con otra clave, y la lista de renegociaciones, que se construye sobre el plan vigente y recalcula su estado en cada lectura; los dos desgloses de métricas caen con la primera porque `invalidateQueries` invalida **por prefijo**, y **el timeline no se invalida** porque cada plan tiene su propio identificador y el recién creado no tiene nada que releer. La prueba de esa selectividad necesitó **montar las tres consultas al lado de la pantalla**, porque `invalidateQueries` solo relee lo que está activo: sin montarlas no se podría distinguir «no se invalidó» de «se invalidó y no había nadie mirando». **El error se enseña con las palabras del backend** —el `404` y el `503` son los textos literales que produce el servidor, no traducciones— y **antes que el resultado**, porque una generación que falla deja en pie el plan de la anterior y enseñarlo debajo lo haría pasar por el resultado de esta acción; esta ruta **no produce `409`**, porque no hay unicidad que violar. **Ocho pruebas nuevas** en el frontend —generación exitosa, navegación al timeline sin armar la dirección a mano, el `404` tal cual, un `5xx` sin reintento, identificador vacío, refresco selectivo, descartes por causa y generación repetida—, con **ninguna prueba existente debilitada**: las **113 pruebas del frontend pasan** (10 archivos) con `typecheck`, `lint` y `build` limpios, y las **336 del backend siguen pasando** (3 omitidas por necesitar una instancia real de GLPI), ejecutadas igualmente para confirmarlo aunque esta fase no lo toca. Quedan dichas las limitaciones: el técnico se escribe a mano porque el backend no publica el padrón de personas (riesgo 107), no hay historial de ejecuciones navegable, la pantalla enseña un resumen y no el plan, y un plan generado no se puede borrar ni marcar (riesgo 119). El riesgo 110 —el modelo sin consumidor— ya quedó atendido en la Fase 26, y esta fase añade los riesgos 119 a 122.

**Fase 29 · Recursos representa personas** — completada. La Fase 21 construyó `/recursos` como una comparación de planes y **la identificó por el `developerId`**: la tabla era correcta y aun así no se podía leer, porque quien la mira no reconoce `dev-001`, reconoce a Ana Pérez. Esta fase **gira la pantalla alrededor de la persona** —el nombre pasa a ser la identificación y el identificador baja a dato técnico, en su columna, en monoespaciado y sin peso— y con el giro la vista pasa a contestar de un vistazo la pregunta que antes exigía abrir el tablero, la declaración, la planificación y la renegociación: **¿cómo está el equipo hoy?** La regla del brief se cumple por construcción: **descubrir el nombre fue primero un problema de dónde vive, y vive en un solo sitio**. El nombre no está en la fotografía operativa, ni en el plan, ni en el snapshot: lo publica **únicamente** `GET /api/planning-metadata/declarations/{developerId}`, que es la lectura de la Fase 23. Las dos salidas eran **enriquecer `/metrics` con nombres** —meter GLPI dentro de una ruta que hoy no lo consulta y que por eso mismo sigue en pie cuando GLPI no responde— o **pedir la declaración de cada persona de la tabla**. Se eligió la segunda, y es la **única lectura de la aplicación que multiplica peticiones, a propósito** (decisión 167): la fotografía se deja sin tocar, la propiedad de que el tablero no depende de GLPI se conserva, y **a quien no tiene plan vigente no se le pregunta nada** —su nombre no se pide y no cuesta una petición—. `useQueries` y no un hook por fila: la lista de personas cambia con la fotografía y los hooks no se pueden llamar en un bucle; además deja las respuestas en el orden en que se pidieron, que es lo que permite emparejarlas con los identificadores. **Cada consulta falla sola**: un técnico que GLPI no conozca deja su fila con el identificador y el motivo, sin llevarse las otras. **La tabla gana cuatro columnas y ninguna cuesta una petición nueva**: Nombre y Tickets salen de esa declaración —los `items[]`, que es el trabajo que el plan todavía no ve—, Renegociaciones pendientes sale de **una sola consulta para todo el equipo** —`GET /api/renegotiations`, que manda los elementos por requerimiento con su `status` ya calculado, así que contarlos por persona es agrupar, no volver a decidir—, y Alertas **no lleva columna propia de estado**: la columna Restante **es** el estado de capacidad —el número con el color de los dos casos que el backend distingue—, porque añadir «agotada» al lado del `0` diría dos veces lo mismo en la misma fila. **La columna de alertas cuenta lo que la fila produce y no lo que el catálogo dice**: dos de las seis alertas tienen dueño —capacidad agotada o negativa, con el mismo `remainingState` que pinta el resto de la vista, y desplazamientos sobre un plan vigente, que es esa misma fila— y las otras cuatro se evalúan sobre lo declarado y no sobre un plan, así que son del conjunto y la tarjeta lo declara en vez de repartirlas; los **nombres** de los tipos no se escriben en la vista, porque viven en el enum del backend y aquí serían una segunda copia que solo se descubre el día que discrepen. **`null` sigue sin ser `0` en ninguna celda, y ahora se nota más**: un nombre que GLPI no publica deja la fila con su identificador y el motivo, una lectura caída deja «Sin dato» —también en las renegociaciones, cuyo fallo se declara justo donde se ve su efecto— y una persona sin tickets dice «Sin tickets», que es un cero verificado, y no «Sin dato»; al ordenar, lo desconocido va al final y no se disfraza de cero. **El diff es enteramente del frontend** —un fichero nuevo (`lib/team.ts`, el modelo de la persona, el emparejamiento y la ordenación), cuatro reescritos y uno editado—: ni una línea de `PlanningEngine`, de las reglas de negocio, de los desplazamientos, de las renegociaciones, de la integración con GLPI ni de los contratos. **Las 16 pruebas que ya existían siguen pasando sin debilitarse** y se añaden **11** —el conjunto exacto de direcciones que la pantalla pide y que no haya una de más, el nombre visible, el identificador como dato secundario, la persona con plan y la que no lo tiene —que **no cuesta ninguna consulta**—, los tickets en sus tres estados, los desplazamientos por persona, las pendientes contadas de una sola lectura, los marcadores de alerta 0/2/1, la ordenación por las columnas nuevas y el estado vacío—: **124 pruebas del frontend en 10 archivos, 0 fallos**, con `typecheck`, `lint` y `build` limpios, y las del backend ejecutadas igualmente —**sin cambios en esta fase**— para confirmarlo. Queda dicha la limitación que la fase no puede cerrar: **un técnico sin plan vigente sigue sin aparecer**, porque la pantalla consolida planes y **el backend todavía no publica la lista de personas** —el hueco no se rellena con una fila de ceros, que afirmaría una capacidad que nadie calculó, y el estado vacío lo declara—; cerrarlo pide un catálogo de GLPI que el puerto `GlpiPlanningSource` aún no ofrece, y por eso el nombre se pide persona a persona en vez de leerse de una lista. La descripción de la entrada **Recursos** del menú pasa a decir el propósito nuevo —«El equipo de hoy: personas, carga y alertas»—, y esta fase añade los riesgos 123 a 125.

**Fase 30 · El catálogo híbrido del equipo** — completada. La Fase 29 giró `/recursos` alrededor de la persona y dejó escrito su techo: **no existía forma de enumerar a nadie**. Todo el sistema preguntaba **por alguien que ya se conocía** —el plan por `developerId`, la declaración por `developerId`, los tickets por el número de usuario de GLPI, la renegociación por elemento— y la única lectura que devolvía una colección de personas, el `byDeveloper[]` de la fotografía operativa, **era una colección de planes, no de personas**: traía a quien tenía un plan vigente y a nadie más, que es el riesgo 124. Esta fase estrena **`GET /api/team`**, el primer contrato del sistema que **enumera personas**: lee el grupo de GLPI configurado —**con sus subgrupos**, que sobre Desarrollo N2 son 41 personas frente a las 21 de la búsqueda directa—, le suma las **excepciones declaradas a mano** y publica un padrón con el origen de cada fila. **GLPI sigue siendo la fuente principal y esta fase no la degrada**: quien GLPI publica en el grupo está en el equipo sin que nadie lo declare, y la vía de excepción tiene tres usos y ninguno más —**agregar** a quien GLPI no publica, **mantener vigente** a alguien hasta que GLPI se corrija y **documentar** el caso para que quede en el diff con su autor—. **Una excepción no puede quitar a nadie, y no es una convención: está en el tipo.** `DeclaredException` no tiene un campo que exprese «quitar» —lo único que puede hacer con la vigencia es marcarla en falso— y la fusión comprueba que el login no venga ya de GLPI **antes** de aplicar nada; si ya vino, GLPI gana, la excepción **no se aplica** y su login se publica en `unusedExceptions`. La dirección posible es una sola: añadir. **La excepción vive en `application.properties`**, bajo `team.exceptions` (decisión 168.1), y se eligió entre cuatro sitios: se descartó el `.yml` —la misma decisión con un formato que el repositorio no usa en ningún archivo—, el JSON aparte —paga un lector propio por la misma trazabilidad que ya da git— y la tabla propia —la más cara para el caso menos frecuente, y con el esquema derivando sin control porque no hay Flyway (decisión 66)—; se eligió el archivo de configuración porque **una excepción es configuración de operación y no un dato de negocio**, porque un `Map` de `@ConfigurationProperties` ya es el idioma del proyecto (`planning.incident-policies.ALTO.*`), y porque el cambio entra en un diff con autor, fecha y mensaje. **El precio se dice en voz alta: cambiar una excepción exige reiniciar**, y se acepta porque el caso no es urgente y porque la alternativa lo pagaba con un esquema sin versionar. **El login es la clave y las mayúsculas no lo son, pero el identificador publicado conserva su texto original**: dos orígenes pueden escribir `NicoSuar` y `nicosuar` y estar hablando de la misma persona —comparar distinguiendo mayúsculas crearía un duplicado silencioso—, y a la vez el `developerId` es con el que se pide el plan de esa persona y **ese sí distingue mayúsculas**, así que normalizarlo «para que quede bonito» rompería justo la lectura que existe para no depender del catálogo. **La degradación es parte del contrato, no un estado de error**: si GLPI no responde, el endpoint contesta **`200`** con las excepciones declaradas, `glpi.available` en falso y **el motivo que da la propia integración** —un `500` diría «no hay padrón» y habría uno, un `200` mudo mentiría, y el motivo es lo que convierte el hueco en algo accionable: dice a quién hay que llamar—; solo se capturan `GlpiConnectionException` y `GlpiInvalidDataException`, nunca un `RuntimeException` a secas, porque un fallo de programación tiene que romper y no disfrazarse de GLPI caído. **`/recursos` deja de consolidar planes y pasa a consolidar el equipo**: quién está en la tabla lo decide el padrón, y una persona sin plan vigente **aparece igual**, con su columna de capacidad en «sin plan» en vez de con tres ceros que nadie calculó; el plan se le cuelga buscándolo **por su login y por su número de GLPI**, que son las dos formas en que se puede haber tecleado al pedirlo, y **un plan que el padrón no conoce tampoco desaparece** —se añade al final marcado como «Solo plan», porque un plan guardado que se cae de la pantalla es peor que una fila con una procedencia incómoda—. **El nombre cambia de dueño y con él se cierra el riesgo 123**: lo publicaba la declaración de cada técnico, así que nombrar la tabla costaba **una petición por persona**; ahora lo publica el padrón, **una sola lectura para todo el equipo**, y la declaración se sigue pidiendo —una por persona, igual que antes— pero **solo por quien tiene plan vigente**, porque los tickets son de la columna que sí se pinta y pedirlos por las 41 personas del grupo serían 41 lecturas a GLPI en cada carga. **El contrato de `/api/planning/metrics` no se toca, y es lo que mantiene el tablero en pie**: añadirle nombres lo ataría a GLPI, y hoy esa ruta no lo consulta, que es por lo que sigue respondiendo cuando GLPI no responde (decisión 167); el padrón es una lectura **nueva y aparte** precisamente para que su caída no se lleve nada más. **La integración encontró un defecto real, y lo encontró una prueba**: los planes, los tickets y las renegociaciones se cruzaban por el login mientras el plan podía estar guardado bajo el número de GLPI, así que una persona cuyo plan se pidió por número aparecía **dos veces** —una fila por clave— o se quedaba sin sus tickets en una lectura que sí había respondido; se corrigió en un solo sitio, `keysOf()`, que devuelve las dos claves con las que el sistema puede haberse referido a alguien. **No se tocó `PlanningEngine`, ni una regla de negocio, ni los desplazamientos, ni las renegociaciones.** Se añadieron **9 pruebas de servicio**, **2 de endpoint** y **4 de interfaz**, una por escenario que el brief pedía —solo GLPI, solo excepciones, mixto, deduplicación, Nicolás Suárez, persona sin plan, GLPI caído, origen visible y compatibilidad con Recursos— más dos que el contrato exigía: una excepción retirada entra marcada y un usuario sin login no entra al padrón. **El caso obligatorio se comprueba con nombres y números**: `NicoSuar` —Nicolás Alejandro Suárez Flores, usuario 1071 de GLPI— no lo publica el grupo, entra por una excepción declarada, y la prueba lo verifica en las tres formas en que puede llegar, incluida la que lo enseñaría duplicado: con su plan pedido **por el número 1071**. Cinco pruebas existentes se reescribieron porque esta fase **invierte su premisa** —afirmaban que una persona sin plan no aparece, y ese era el defecto que la fase corrige— y **ninguna se borró**. Las **347 pruebas del backend pasan** (0 fallos, 3 omitidas por necesitar una instancia real de GLPI) y las **128 del frontend** (10 archivos), con `typecheck` y `lint` limpios. Quedan dichas las limitaciones: una excepción no se puede editar sin reiniciar, el padrón no dice quién tiene trabajo sin plan, la pantalla de generación sigue pidiendo el técnico a mano aunque ya tenga de dónde sacarlo (riesgo 107) y las excepciones no se pueden consultar por API. El riesgo 124 queda cerrado —su mitigación escrita, «exponer el catálogo de usuarios de GLPI por el puerto», es literalmente lo que esta fase hizo—, y esta fase añade los riesgos 126 a 130.

**Fase 31 · La columna de tickets cuenta carga, no histórico** — completada. La Fase 29 puso una columna **Tickets** en `/recursos` y la Fase 30 la dejó donde estaba; esta fase responde al caso con el que se reportó el defecto: **Jose Alejandro Diaz Urrego aparecía con 1.266 tickets** mientras buena parte del equipo aparecía con «Sin dato». Medido contra la instancia real, sus 1.266 eran **los 1.266 cerrados**, y su carga operativa era cero: la búsqueda pedía los tickets del técnico **sin filtrar por estado**, así que «cuántos tickets tiene» significaba «cuántos ha tenido nunca». Dos controles lo confirman y descartan las dos hipótesis con las que llegó el reporte: la instancia entera tiene 68.273 tickets y un técnico inexistente devuelve 0 —así que el criterio del técnico sí se aplicaba, no era un recuento global— y el desglose por estado del 296 da 0 en los cuatro activos y 1.266 en el cerrado —así que no era una mezcla de estados, era el que no cuenta—. El arreglo va **en la capa que obtiene los tickets y en ninguna otra**: el puerto gana una pregunta —`activeTicketsOf`, «los que siguen siendo carga»— y la declaración usa esa en lugar de `ticketsOf`, que es la que alimenta el plan. **`ticketsOf` no se toca a propósito**: el motor ya ignora lo cerrado por su cuenta —`PlanningEngine` filtra por `Incident::consumesCapacity()` y por `Requirement::isPlannable()`—, pero filtrarla cambiaría **su entrada, los descartes que publica y la instantánea que guarda**, y nada de eso está en el alcance del brief. Cada lectura contesta la suya, y la divergencia es deliberada: el plan pregunta por el histórico porque necesita justificar sus descartes, la pantalla pregunta por la carga porque es lo que mide. **El corte son los estados 5 y 6 de GLPI** —solucionado y cerrado—, que el contrato traduce al mismo estado del dominio: `RESUELTO` en incidencias y `FINALIZADO` en peticiones, que es exactamente lo que `Incident.consumesCapacity()` y `Requirement.isPlannable()` excluyen desde antes. Los cuatro anteriores se quedan dentro, incluido el 3: planificado es trabajo acordado y todavía no hecho. **Se piden en positivo, y no es estilo**: medido contra la instancia, `notequals 5` devuelve 237, que es el recuento exacto de `equals 5`, y `lessthan 5` devuelve lo mismo —los dos operadores se comportan como una igualdad, **sin fallar**—, así que enunciar la exclusión como negación daba **cero activos a un técnico que tenía dieciséis**. Los cuatro códigos van además **agrupados** —un grupo con `OR` por dentro, en `AND` con el técnico— porque sueltos se leerían como «técnico AND estado1 OR estado2…» y del segundo estado en adelante entrarían los tickets activos de cualquier otro. Y la garantía son **dos capas**: el criterio hace que lo cerrado no viaje —los 1.266 del 296 ya no salen de GLPI— y al volver se comprueba que cada ticket esté entre los cuatro activos, con un aviso en el registro si no lo está, porque una búsqueda que filtra mal no falla: contesta otra cosa. **El frontend no se tocó** —ni `TeamTable.tsx`, ni `lib/team.ts`, ni `useDeclarations.ts`, ni `Resources.tsx`— y no se ocultó ninguna fila: la tabla sigue contando `items.length` y sigue diciendo «Sin tickets» cuando son cero, que es un cero verificado y no un «Sin dato». Los «Sin dato» que venían en el mismo reporte **no eran el mismo defecto**, y se dice para que nadie los «arregle» dos veces: la declaración se pide solo a quien tiene plan vigente, así que quien no lo tiene no tiene respuesta, y sin respuesta la celda declara el hueco en lugar de inventar un cero. **`PlanningEngine`, los desplazamientos, las renegociaciones y las reglas del plan siguen sin tocarse**, y el plan guardado por número o por login sigue resolviéndose igual, porque la resolución del identificador no cambió. **Las 357 pruebas del backend pasan** (10 nuevas: 8 del adaptador y 2 del endpoint) y las **128 del frontend** siguen verdes sin cambios. Esta fase añade los riesgos 131 a 133.

**Fase 32 · El catálogo encuentra a la persona, y el login la resuelve** — completada. El brief llega con una captura: personas visibles en `/recursos`, con su nombre y con «Sin dato» en la columna **Tickets**, y la pregunta de por qué el catálogo sí encuentra a la persona y no consigue obtener sus tickets. **Eran dos defectos independientes y ninguno estaba en GLPI.** El primero, en la pantalla: `Resources.tsx` construía la lista de identificadores desde `current.byDeveloper` —los planes vigentes, no el padrón—, con un comentario que lo razonaba por coste; medido contra la instancia, esa respuesta trae **dos** planes y el grupo del equipo tiene **cuarenta y una** personas, así que **treinta y nueve filas visibles decían «Sin dato» en una lectura que nunca se intentó**. El segundo, en el adaptador: `findUser` resolvía todo identificador con `GET /User/{id}`, y medido con los cuatro logins del brief, un login **no da un 404: da `206 Partial Content` con la colección de usuarios entera**, empezando por el id 2 —`Admin`—, que no se puede leer como una ficha, así que la lectura moría en un **502**. La cadena `persona → login → glpiId → tickets` no se rompía al final: se rompía en el segundo paso, siempre. **La respuesta a la pregunta clave del brief es «ambas», y esa es exactamente la causa**: el sistema nombra a las personas por su **login** —es el `developerId` que publica `/api/team`— y GLPI solo sabe buscar un técnico por su **número**, así que el paso que faltaba era traducir uno en otro. Preguntar por login directamente no vale —`field=5` con un login no falla, castea a cero y devuelve los tickets del usuario cero (decisión 159)— y preguntar por `glpiId` tampoco, porque no es lo que se teclea ni lo que viaja en las rutas, y una excepción declarada no tiene número. **La traducción pasa a ser responsabilidad del puerto**, que es lo que su contrato decía desde el principio: `numericId` discrimina, un número va por la ruta del elemento y un login por la **búsqueda de usuarios** sobre la opción 1 —«Login», sobre `glpi_users.name`—, reutilizando la paginación y la comprobación al volver que ya existían. **Y la igualdad se comprueba en el código, porque `equals` miente en esta instancia**: medido, `criteria[field=1][searchtype=equals]` sobre un login que existe devuelve **cero filas** —el tercer operador de esta instancia que no hace lo que dice, tras los `notequals` y `lessthan` de la Fase 31—, así que la búsqueda se usa como filtro ancho con `contains` y **solo vale el login exacto**, comparado sin distinguir mayúsculas porque GLPI tampoco las distingue; lo que `contains` traiga de más —«jose» trae a `JoseDiaz` y a `JosePerez`— se descarta, porque quedarse con la primera fila habría dado los tickets de otra persona. **La columna de tickets se pregunta ahora por todo el padrón**, más los planes que el padrón no reclama, deduplicando por las claves de cada persona: la columna es del equipo y no del plan, y atar la lectura a que hubiera plan era lo que la dejaba mintiendo a treinta y nueve de cuarenta y una. **El arreglo está donde el brief pedía** —en la capa que obtiene los tickets y en la que los pide— y **no** en la tabla: `TeamTable.tsx` sigue sin saber de dónde vienen y sigue distinguiendo nulo de cero, así que **cero sigue diciendo «Sin tickets»** —un hecho— y **«Sin dato» queda únicamente para lo que no se pudo leer**. **Las cuatro personas del brief, verificadas una a una con sonda de solo lectura**: Abraham Arana Aldana (`AbraAran` → **1179**, 10 activos), Alejandro Pineda Machado (`AlejPine` → **583**, 6), Analy Ruiz (`AnalRuiz` → **36**, 2) y Jose Alejandro Diaz Urrego (`JoseDiaz` → **296**, **0** — sus 1.266 están cerrados, así que la columna dirá «Sin tickets» y no «Sin dato»). **Siete pruebas nuevas** —seis del adaptador y una de la pantalla, que reproduce el escenario de la captura con un equipo de cero planes— más cuatro reapuntadas y tres ampliadas, **ninguna borrada**; el backend pasa de 357 a **363** y el frontend de 128 a **129**. El arreglo sirve **para todas las rutas a la vez** —la declaración, la planificación y el plan comparten la resolución— y no se tocó `PlanningEngine`, ni una regla del plan, ni los desplazamientos, ni las renegociaciones. Esta fase añade los riesgos 134 a 137 y **corrige dos afirmaciones de la Fase 31** que la medición desmintió: que «lo que se teclee —login o número— se resuelve antes con `findUser`» y que la resolución del login no se tocaba.
**Fase 33 · El equipo operativo: visibilidad sin sustituir a GLPI** — completada. La Fase 30 puso a todo Desarrollo N2 en la tabla y la Fase 32 hizo que la columna de tickets se preguntara por todos; esta fase responde a lo que se ve al mirar el resultado: **la gestión diaria de la demanda se hace con dieciocho personas concretas y las otras veintitrés ocupan la tabla sin aportar**. El brief lo enmarca con dos prohibiciones que el diseño respeta al pie de la letra —**no volver a una lista fija y no perder visibilidad del resto de Desarrollo N2**—, y la salida es una **pertenencia declarada**: `team.operational[<login>]` en `application.properties`, un mapa hermano de `team.exceptions` que dice quién se enseña por defecto. **No es un catálogo paralelo y la distinción es la que sostiene todo el diseño**: una lista de pertenencia no enumera a nadie —nombra a alguien que GLPI ya enumera—, así que la configuración local decide **quién se muestra** sin ser nunca una segunda fuente de verdad sobre quién existe. El padrón no se recorta: medido contra la instancia real, `GET /api/team` sigue publicando **cuarenta y dos personas** (cuarenta y una del grupo más la excepción `NicoSuar`), de las cuales **dieciocho son operativas**, y **ninguna desaparece** de la respuesta. **De dónde vive la visibilidad estaba abierto en el brief y se justifica en la decisión 171**: se elige la configuración y no una tabla por tres motivos comprobables —es lo que el brief pide de sí mismo («la configuración local únicamente decide quién se muestra»), tiene el precedente ya argumentado de la decisión 168 —que eligió `application.properties` sobre una tabla porque el esquema lo gobierna `ddl-auto` y el proyecto no usa Flyway (decisión 66)—, y deja el cambio en el historial de git, que es donde el área mira para saber quién decidió qué. **La consecuencia se asume entera en vez de disimularse**: los botones por fila `[ Ocultar ]` / `[ Incluir en equipo ]` **no se implementaron** porque persistir exige una tabla, y un botón que aparenta guardar y no guarda es peor que no tenerlo (decisión 171.1); la UX que sí se implementó son **dos modos de vista más una marca en la fila** —`[ Solo equipo operativo ]` / `[ Mostrar todos ]` con los dos `Button` que ya existen, sin añadir `Switch` ni `Tabs`, y una insignia **Fuera del equipo operativo** que solo aparece en «Mostrar todos»—. **Un login ausente no pertenece** (171.2), y el precio se dice con el caso concreto: *una persona nueva en Desarrollo N2 no aparece en la vista por defecto hasta que alguien la declare*, que es el criterio 5 del brief; la alternativa —ausente = dentro— habría convertido el equipo operativo en un residuo del directorio, donde cualquiera que GLPI diera de alta entraría sin que nadie lo decidiera. **La marca se busca por el login exacto, distinguiendo mayúsculas** (171.3), deliberadamente al revés que la fusión contra GLPI —que compara en minúsculas porque el servidor tampoco las distingue—: la clave de la configuración **es** el identificador con el que se pide todo lo demás, y la comprobación estricta es segura porque **el error se publica** en `unusedOperational`. Ese aviso se añadió **aunque el brief no lo pedía**, y es la única defensa que existe contra una errata: una marca que no alcanza a nadie no cambia nada visible —la persona sigue fuera y quien la escribió no se entera—. **Y el borde que habría roto la regla se resuelve en la vista** (171.4): una fila `PLAN` —alguien a quien solo se conoce por un plan guardado, con el número de GLPI como clave— **nunca** podría coincidir con una marca indexada por login, así que bajo «ausente = fuera» un plan ya guardado habría desaparecido de la pantalla; el predicado `inOperationalTeam` vive en `lib/team.ts` y lo usan **los dos** sitios que lo necesitan —el filtro y la insignia— para que no puedan discrepar. **El filtro es del cliente y eso es lo que impide que esta fase deshaga la Fase 32**: el padrón se sigue leyendo entero, `/api/team` no gana parámetros, y las declaraciones de tickets se siguen pidiendo por el padrón completo (decisión 170.3, no enmendada), así que cambiar de modo **no dispara ninguna lectura nueva** a GLPI. **Verificado en ejecución real, con el backend reiniciado antes de medir nada** —en la Fase 32 las pruebas pasaban y la pantalla mentía porque el proceso del 8080 era más viejo que el código—: al abrir, **19 filas de 43** con el recuento «19 de 43 personas · 24 fuera del equipo operativo · 17 sin plan vigente»; las cuatro personas del brief con dato real (**Abraham Arana Aldana 10** activos, **Alejandro Pineda Machado 6**, **Analy Ruiz 2**, **Jose Alejandro Diaz Urrego «Sin tickets»**) y **cero filas con «Sin dato»**; `NicoSuar` presente con su insignia **Excepción**; «Mostrar todos» con **43 filas** y **24** marcadas `data-operational="false"`; y la vuelta al modo operativo con las peticiones de declaraciones **idénticas** —cuarenta y tres antes y después—. **Siete pruebas nuevas en el backend y ocho en el frontend, ninguna borrada**; el backend pasa de 363 a **370** y el frontend de 129 a **137**. Una modificación se declara porque es la que mantiene verde todo lo demás: las tres personas de `teamCatalogFixture` pasan a `operational: true`, y las pruebas que necesitan a alguien de fuera sobrescriben `people` explícitamente. Esta fase añade los riesgos **138 a 142** —el 142 es la cifra que no cuadra: el padrón tiene 42 personas y la tabla abre con 43 filas, porque un plan guardado con el número `13` entra como fila `PLAN` y el conmutador la hace contar—, y **no tocó `PlanningEngine`, ni una regla de negocio, ni la planificación, ni los desplazamientos, ni las renegociaciones; no borró ninguna persona, no modificó ningún grupo de GLPI y no creó una segunda fuente de verdad.**
**Fase 34 · Incidentes: el trabajo activo del equipo, ticket por ticket** — completada. `/incidentes` existía en el menú desde la Fase 1 y era una tarjeta que prometía la pantalla para más adelante; esta fase la convierte en **la tabla que contesta qué trabajo activo tiene hoy el equipo**, con las ocho columnas del brief —tipo, identificador de GLPI, título, estado, persona asignada, prioridad, fecha publicada y estado de declaración— y **sin estrenar ni un contrato**: el trabajo por persona ya lo publicaba `GET /api/planning-metadata/declarations/{developerId}` desde la Fase 23 y el padrón `GET /api/team` desde la Fase 30, así que lo único que faltaba era **cruzarlos para saber de quién es cada ticket**, porque el ítem trae siete de los ocho campos y el octavo —la persona— no hace falta que lo traiga: la respuesta entera es de alguien. **La decisión de cómo leer es el corazón de la fase (172.1), y se tomó con la instancia delante**: la alternativa era una búsqueda agregada a GLPI con los dieciocho técnicos en un `OR` anidado, **medida en 0,21 s y funcional**, y se descartó por tres motivos —exigiría vocabulario nuevo en la integración, contradiría la decisión 170.3 sin necesidad, y sobre todo **habría que inventar una regla para el ticket que pertenece a dos personas**, que medido es **uno de los 83** activos del equipo—, mientras que la lectura por persona da esa columna **gratis y por construcción**: cada fila sabe de quién es porque viene de la respuesta de esa persona, y el ticket compartido aparece en las dos filas porque las dos lo tienen como carga. **El precio se dice con la cifra medida**: una petición por persona visible —18 por defecto, 42 en «Mostrar todo Desarrollo N2»—, ~0,78 s cada una en paralelo, **~2,4 s la primera vez y cero después**, porque las claves de caché son las mismas que usa `/recursos` y visitar las dos pantallas no repite ninguna lectura de GLPI. **Y hay una divergencia deliberada con la Fase 33 que se declara en vez de disimularse (172.2)**: allí el filtro de equipo operativo no cambiaba lo que se preguntaba porque la columna de tickets era del equipo entero; **aquí las filas *son* los tickets**, así que no hay tabla sin la lectura por persona y ampliar la vista es ampliar la lectura —«Mostrar todo Desarrollo N2» pide las veinticuatro personas que faltan—, con el esqueleto de carga condicionado a que no haya filas ya leídas para que cambiar de modo no vacíe la pantalla. **La regla crítica del brief —solo activos, nunca Cerrado ni Resuelto— ya la cumplía el backend por partida doble** —el puerto pide el grupo `12=1,2,3,4` y vuelve a filtrar en cliente, con pruebas desde la Fase 31— y **aun así la vista la repite en dos líneas (172.3)**: el brief la fija como garantía de pantalla y no como confianza, la comprobación vive en una función pura con prueba propia, y **un estado nulo no se descarta** porque no saber si un ticket está cerrado no es saber que lo está. **El orden por defecto se implementa y se justifica (172.4)**: incidentes antes que requerimientos —un incidente es trabajo que ya está pasando y un requerimiento es trabajo planificable—, después **prioridad descendente** con la prioridad ausente cayendo al final a la vista en vez de disfrazarse de prioridad baja, y después **fecha de apertura ascendente**, porque a igual tipo y prioridad lo que lleva más tiempo abierto es lo que más ha esperado y es lo que convierte la tabla en una lista de trabajo y no en un historial. **Los cuatro filtros se justifican por la pregunta que contestan** —persona («¿qué tiene Abraham?»), tipo (11 incidentes frente a 72 requerimientos), estado (pendiente frente a asignado) y declaración, que **es** la respuesta a «¿qué tickets necesitan declaración?» y por eso **no** se añadió una tarjeta con la cifra—, se aplican en memoria como los de `/alertas`, y las opciones de tipo y estado se derivan del dato porque el vocabulario del estado cambia con el tipo. **Sin duplicar el tablero**: no hay tarjetas de métricas ni tabla de alertas, y una prueba lo fija —el simulador de red **lanza** ante cualquier dirección que no sea el padrón o una declaración por persona, así que pedir las métricas haría fallar la suite en vez de pasar enseñando una segunda copia—. **Medido contra GLPI con sonda de solo lectura, no contra la pantalla**: 41 personas en el grupo, los 18 logins operativos resueltos sin una errata, **83 tickets activos repartidos entre 14 personas** (uno compartido por dos técnicos), 11 incidentes y 72 requerimientos, 56 pendientes y 27 asignados; y **la verificación con la aplicación corriendo y navegador real** sobre `/incidentes`: **81 filas cuadrando con las 81 del backend en el mismo minuto y con los recuentos idénticos para las catorce personas**, **cero filas resueltas o cerradas**, las ocho columnas con datos reales, y **las cuatro preguntas del brief contestadas sin salir de la pantalla** —`AbraAran` 8 filas, `AlejPine` 6, `AnalRuiz` 2, y `Declaración = Pendiente` las 81 con `Declarado` en cero—, más «Mostrar todo Desarrollo N2» con **96 filas, 18 personas con carga y 43 opciones**, sin que se moviera ninguno de los recuentos operativos. **El hallazgo que la fase no esperaba y que se declara en vez de maquillarse: hoy ningún ticket activo tiene declaración** —las 81 filas leen `SIN_DECLARACION` con sus dos descartes, y se comprobó que es **dato y no defecto de pintado** pidiendo el endpoint directamente y contando las dieciocho personas, que dan 81 de 81—, que es exactamente la clase de cosa que esta pantalla existía para hacer visible. **Veinte pruebas nuevas en el frontend** —de 137 a **157**, en 11 archivos— con las dos que fijan la regla crítica desde dentro, la del orden con las tres claves contradiciéndose a propósito, la del ticket que no se pudo traducir y **no** se descarta, y la del conmutador que además comprueba que se piden las declaraciones de quien entra; **el backend pasa de 370 sin cambios** —no se tocó ni un fichero— y ninguna prueba existente se borró ni se debilitó. Se borró `ComingSoon.tsx`, previa comprobación con `grep` de que era su único consumidor. Tres capturas de Playwright como evidencia, en `.playwright-mcp/` y **fuera del repositorio**, porque no hay un solo PNG versionado y esta fase no cambia esa convención. **No se tocó `PlanningEngine`, ni una regla de negocio, ni la planificación, ni los desplazamientos, ni las renegociaciones, ni una línea del backend.** Esta fase añade los riesgos 143 a 149 —el 149 es la advertencia de método: la instancia es de producción y la cifra se mueve, así que la tabla se contrasta persona a persona y en el mismo minuto, no contra una sonda vieja—.

**Fase 35 · De Incidentes a la declaración, sin teclear un identificador** — completada. La Fase 34 dejó la tabla que **identifica** el problema —con el filtro «Declaración: Pendiente» aislaba exactamente lo que faltaba declarar— y ahí se acababa: **la tabla no tenía una sola acción**, y el propio documento de la fase anterior lo anotó como riesgo 148. Esta fase cierra ese riesgo y **solo cambia el acceso y la navegación**, que es lo que el brief acota al pie de la letra: cada fila pendiente lleva ahora un atajo que abre la declaración de ese ticket con el técnico, el ticket y la vuelta ya puestos. **El análisis que el brief pide antes de tocar nada es lo que decide la fase entera.** La pantalla de declaración se llama `Declarations.tsx` —no hay `Declaration.tsx`—, es autocontenida, no lee nada del router y vive de tres `useState`; el técnico entra tecleado en un `<input>` que se confirma con «Consultar» y el ticket se elige pulsando la acción de su fila. Son **nueve acciones discretas** de punta a punta, y los pasos 2 a 4 —teclear el identificador, pulsar «Consultar», buscar la fila a ojo— **se repiten en cada visita**, porque `developerId` es estado de un componente que se desmonta al salir de la ruta y la tabla no tiene buscador ni orden propio. **El atajo elimina cuatro de los nueve, y justo los dos que exigen saber algo de memoria.** Y lo que ya existe en la tabla es todo lo que el atajo necesita: cada `<tr>` lleva `data-work-item` y `data-developer`, y `declarationSideOf` ya separa declarado de pendiente sin recalcular la regla, así que **no se pide ningún dato nuevo ni se estrena contrato**. La decisión que hace barato todo lo demás (**173.2**) es que **la dirección siembra y no espeja**: los parámetros se leen una sola vez en el inicializador de `useState` y el estado local sigue mandando, sin ningún efecto que sincronice en las dos direcciones. No es un atajo —es lo que deja **las veinte pruebas de `Incidents.test.tsx` sin tocar una línea**, porque todas montan sin query string—; si la dirección fuera la dueña, cada `<select>` sería una navegación —`MemoryRouter` envuelve su `setState` en `React.startTransition`— y el botón «atrás» del navegador **desharía filtros en vez de salir de la pantalla**. La conservación de filtros que el brief exige se cumple igual y por el camino más directo: el enlace de vuelta se compone **en el momento del clic**, con los filtros y el modo vivos en ese instante, así que lo que se guarda es **a dónde volver**, no el estado de la pantalla. **El modo de equipo viaja y es obligatorio que viaje** (173.3): sin él, declarar el ticket de alguien de fuera del equipo operativo y volver a la vista por defecto dejaría la fila invisible, incumpliendo el criterio justo cuando la función servía para algo. **El atajo es solo para las filas pendientes** (173.5) y el lado lo decide el mismo predicado que el filtro, no una comparación escrita en la tabla; el nombre accesible lleva el ticket y la persona porque **un ticket asignado a dos personas produce dos enlaces con el mismo texto y destinos distintos** —y hay uno así hoy, el 66913 entre `AbraAran` y `JoseGarc`—; y el enlace se pinta con `<Button asChild><Link>`, cuyo rol es `link` y no `button`, así que no colisiona con ninguna prueba. **`volver` se valida antes de usarse** (173.6) —`startsWith('/') && !startsWith('//')`, porque `//evil.com` es una URL protocolo-relativa y pasa el primer filtro— y navega con **`replace`**, porque con `push` el botón «atrás» devolvería a `/declaraciones?ticket=…` y **reabriría el formulario** que se acaba de cerrar. **Y «Quién declara» no se prerrellena, a propósito** (173.7): el autor de la estimación y el del compromiso son **dos personas distintas** —`estimatedBy` y `committedBy`, con su propio sello cada uno— y ninguno es necesariamente el técnico, así que rellenarlo con el técnico convertiría la trazabilidad en un dato falso la mitad de las veces. La observabilidad que el brief pide se resuelve con **un desglose, no cuatro cifras sueltas** (173.8), porque las cuentas **se solapan** —un ticket sin estimación también está pendiente— y presentarlas como cajones separados sería un error de lectura que la propia pantalla provocaría; se cuenta sobre las filas visibles, así que cuadra con la tabla de debajo, y **lee el estado en vez de recalcularlo**, como fijan las decisiones 172 y 161.3. **La quinta prueba es la que podía mentir y se impidió que mintiera**: el arnés usa `staleTime: 0` y producción usa `30_000`, así que con caché cero cualquier remontaje relee y la prueba habría pasado **aunque alguien borrara el `invalidateQueries`**; se le da la política de caché de producción —más fiel, no menos—, el servidor de la prueba **tiene estado y no una cola posicional** —lo declarado lo lleva el hecho, no el número de llamada—, y **afirma la secuencia exacta de peticiones**, cuatro y ninguna de más: la lista, la escritura, la relectura que la invalidación provoca. Se comprobó que discrimina: **comentada la invalidación, la prueba se pone en rojo y solo esa**, y después se restauró el fichero. **Nueve pruebas nuevas —de 157 a 166, en 12 archivos— y ninguna existente editada, borrada ni debilitada**; el fichero nuevo `DeclarationFlow.test.tsx` vive aparte porque el `serve` de `Incidents.test.tsx` **lanza** ante cualquier dirección que no sea una de las suyas y aflojarlo debilitaría lo que ese fichero fija. **El backend pasa de 370 sin cambios** —no se tocó ni un fichero— y se ejecutó igualmente para confirmarlo. **Verificado en ejecución real, con navegador y sobre datos de producción**: el padrón trae 42 personas, 18 operativas, y entre las 18 suman **83 filas de trabajo activo sobre 82 tickets distintos, las 83 en `SIN_DECLARACION`** —el mismo hallazgo que dejó la Fase 34: el equipo no ha declarado nada, así que el atajo no es un adorno, es la única forma de declarar que tiene—; filtrado `AbraAran` salen sus 8 filas con su acción «Declarar»; el clic lleva a `/declaraciones?tecnico=AbraAran&ticket=68319&volver=%2Fincidentes%3Fpersona%3DAbraAran` con **el técnico, los 8 tickets y el formulario ya abiertos: cero teclas y cero clics de búsqueda**; declarado el 68319 con 8 h y 2026-10-31 la fila pasa a `PLANIFICABLE`; y al volver **la fila lee `PLANIFICABLE`, su celda de acciones queda vacía, el filtro sigue en `AbraAran` y el desglose pasó de «0 declarados y 8 pendientes» a «1 y 7»**, sin recargar nada. Tres capturas en `.playwright-mcp/`, **fuera del repositorio**, porque no hay un solo PNG versionado. **Y un residuo que se declara en vez de maquillarse**: el ticket se retiró después con un `PUT` de los dos valores en nulo y el estado volvió al de partida, pero **la fila de `planning_metadata` sobrevive** —es el diseño, y es lo que distingue «nunca se declaró» de «se declaró y se retiró»— con sus entradas *append-only* en el historial, y **no existe endpoint `DELETE`**; el efecto visible está medido —la celda del 68319 añade «sin estimación · sin compromiso» bajo la insignia, cosa que sus siete hermanos no hacen—. **No se tocó `PlanningEngine`, ni los desplazamientos, ni las renegociaciones, ni una regla de negocio, ni la integración con GLPI, ni la lógica de declaración** —`useDeclarations.ts`, `DeclarationForm.tsx` y `declarationsService.ts` están sin una línea de diferencia— **ni el backend**. Esta fase añade los riesgos 150 a 158.
**Fase 36 · El estado de entrada del plan, antes de generarlo** — completada. `/planificar` genera un plan y no enseña nada antes de hacerlo: se teclea un identificador, se pulsa el botón y el motor corre. Con la instancia como estaba —**83 tickets activos repartidos entre 18 personas, 82 sin declaración y uno solo planificable**—, quien pulsara «Generar plan» sin mirar antes iba a obtener casi siempre un plan vacío, sin forma de saberlo de antemano ni de saber por qué. Esta fase construye **la vista previa operativa**: `/planificar/estado`, una pantalla que contesta «¿qué pasará si genero el plan ahora?» leyendo **la misma entrada que el motor** —el padrón y la declaración de cada persona, las mismas lecturas que Incidentes y Recursos, así que no repite ninguna petición— y publicando, por equipo y por persona, cuántos tickets son planificables, cuántos están bloqueados y por qué. **No toca el backend ni una línea**, y no cambia `PlanningEngine`: la pregunta del brief es qué **recibirá** el motor, no qué hará con ello —`/simulate` existe, pero recibe un escenario entero y obligaría a inventar las reglas—. **Las cinco cuentas particionan** —`DeclarationStatus` es mutuamente excluyente, así que suman los activos—, que es lo contrario del desglose de la Fase 35 y la razón por la que `declarationBreakdown` no se reutiliza. **Los bloqueadores se abren en Incidentes**, no en una segunda tabla de tickets: la tabla por persona dice quién bloquea, y cada fila enlaza con `incidentsPath` a los pendientes de esa persona, que dicen qué. **El veredicto nombra su propio límite** en la misma frase —«cuántos quepan en el horizonte y cuáles desplacen a cuáles lo decide el motor con las reglas vigentes, que esta pantalla no publica»— porque la configuración viva sigue sin publicarse (riesgo 121). Vive en su propia pantalla y no dentro de `/planificar` por un motivo medido: esa pantalla tiene un contrato fijado por ocho pruebas que afirman que **abrirla no sale a la red**, y la vista previa necesita una lectura por persona. Añadir la ruta hermana obligó a arreglar dos resoluciones por prefijo que hasta ahora nadie había pisado: el menú, que resaltaba **dos** entradas a la vez, y el encabezado, que titulaba la vista previa con el nombre y la descripción de la pantalla de al lado. La fase deja **174 pruebas en el frontend** —las 166 anteriores sin editar— y las **370 del backend sin cambios**. Esta fase añade los riesgos 159 a 166.
**Fase 37 · Declarar con personas y tickets, no con identificadores** — completada. La Fase 35 quitó cuatro pasos del camino de entrada, pero **la pantalla de declaración seguía siendo la de la Fase 12**: un `<input>` con la pista «Identificador en GLPI, p. ej. 296» y un botón «Consultar» —donde la pista **nombraba un identificador que no era el que había que escribir**, porque el backend espera el *login* de GLPI y no el número—, el ticket buscado a ojo entre filas que para quien más trabajo tiene pasan de veinte, y un enlace de vuelta que decía «Volver a Incidentes» **desde cualquier sitio**, incluso a quien había entrado desde Recursos o desde el estado del plan. Esta fase cierra los cuatro huecos de golpe y **solo cambia el frontend**: el campo libre se sustituye por un desplegable que trae el padrón de `GET /api/team` —publicado desde la Fase 30, y por el que el **riesgo 107** llevaba cinco fases esperando—, agrupado en «Equipo operativo» y «Resto del padrón» y rotulado **con el nombre de la persona, nunca con su login**; el ticket sale de la lista de esa persona; el enlace de vuelta se nombra **con el menú**, así que dice «Volver a Recursos» o «Volver a Estado del plan» según de dónde se venga; y encima de la tabla aparece un **resumen operativo de cinco cifras** y un atajo que abre el siguiente pendiente. **El agrupado ordena, no esconde** (175.1): de las 42 personas del padrón, 24 están fuera del equipo operativo y **todas se pueden elegir y consultar**, porque una persona sin trabajo repartido sigue teniendo tickets que declarar; y quien no está en el padrón de hoy —un enlace viejo, o alguien a quien GLPI dejó de publicar— **se sigue ofreciendo** con la marca «· no está en el padrón de hoy», porque quitarlo dejaría el desplegable en blanco sobre un técnico que sí se pidió. **La marca «· excepción» sigue la convención de la Fase 30** —se señala lo que no es GLPI y nada más— y es lo que explica por qué alguien que no está en el grupo aparece en la lista. **La dirección siembra y no espeja, otra vez** (175.4, es la decisión 173.2): el técnico, el ticket y la vuelta se leen una sola vez en el inicializador de `useState`, así que cerrar el formulario no lo reabre aunque el parámetro siga en la dirección, y consultar no reescribe la dirección. **El resumen dice lo que es y lo que no** (175.6): «activos» es el total, «declarados» y «pendientes» **lo parten en dos**, y «sin estimación» y «sin compromiso» son **dos de las causas** de estar pendiente y no lo agotan —falta el trabajo sin ninguna declaración, que son los dos descartes a la vez, y el tipo que el contrato no sabe leer—, así que la pantalla lleva debajo la misma advertencia que el desglose de Incidentes arrastra desde la Fase 35, y cuenta sobre las filas activas para que cuadre con la tabla de al lado. **El atajo salta el ticket que ya está abierto** (175.7) —`declarables.find(item => item.workItemId !== selected) ?? declarables[0]`—, que es lo que hace que el botón sirva dos veces seguidas, y **solo ofrece lo que se arregla declarando**: `NO_TRADUCIBLE` queda fuera y el botón desaparece cuando no queda nada, porque un botón que lleva a rellenar un formulario que no cambia nada es una promesa vacía. **La lista de estados declarables se declara una sola vez** (175.8): `DECLARABLE_STATUSES` en `lib/declarations.ts`, leída por la pantalla —`isDeclarable`— y por la vista previa del estado de entrada —`declarableOf`, que pasa a recorrerla en vez de sumar tres literales—, porque escribirla dos veces sería la segunda versión de la misma regla. **Y la resolución de rótulos del menú se muda a `routes/navigation.ts`** (175.5): `navItemFor` ya existía dentro de `Header.tsx` y **dejó de ser la única que la necesita** —el encabezado la usa para titularse y el enlace de vuelta para nombrar su destino—, así que la regla de «gana el prefijo más largo» pasa a existir una vez. **Trece pruebas nuevas —once en `Declarations.test.tsx`, de 10 a 21, y dos en `PlanningPreview.test.tsx`, de 8 a 10, que fijan la entrada que le faltaba al estado del plan y que el modo viaje en la vuelta—: de 174 a 187, en 13 archivos, y ninguna existente borrada ni debilitada**; el simulador ganó el padrón y con él una trampa que hubo que desarmar —el listado de un técnico y el recurso de un ticket **comparten prefijo**, así que las dos comprobaciones van de la más larga a la más corta—, y **tres anclas dejaron de servir y se sustituyeron por una más fuerte**: desde que el desplegable trae el padrón el nombre del técnico está en dos sitios, así que `getByText('Ana Perez')` encuentra dos y las tres esperas que lo usaban pasaron a `esperarGuardado()`, que espera a que **el formulario se cierre** —lo que ocurre en el `onSuccess` de la escritura, y como `useSaveDeclaration` invalida la lista **antes** de cerrar, es estrictamente más fuerte que la espera anterior—. **`DeclarationFlow.test.tsx` no se tocó ni una línea**, y se comprobó por qué: ya servía `/api/team` y ya afirmaba `getByRole('link', { name: 'Volver a Incidentes' })`, que el rótulo derivado del menú conserva por construcción. **El backend pasa de 370 sin cambios** —no se tocó ni un fichero— y se ejecutó igualmente para confirmarlo. **Verificado en ejecución real, con navegador y sobre datos de producción**, con las siete demostraciones del brief hechas y capturadas: desde **Recursos** el enlace llega a `/declaraciones?tecnico=JoseGarc&volver=%2Frecursos` con el desplegable leyendo **«Jose Luis Garces Gonzalez»** —un nombre, no un identificador—, el resumen en **8 activos · 1 declarado · 7 pendientes** y el botón diciendo **«Volver a Recursos»**; desde **Incidentes** llega con el formulario del 66666 **ya abierto** y la fecha compromiso `20/10/2026` puesta; desde el **estado del plan** la columna «Acciones» de `/planificar/estado` lleva con el técnico puesto y el botón leyendo **«Volver a Estado del plan»**; desde el **menú**, `/declaraciones` sin un solo parámetro **no pide ninguna declaración** —solo el padrón— y ofrece **43 opciones** en dos grupos, y elegido `Abraham Arana Aldana` salen **sus** 8 tickets con **8 activos · 0 declarados · 8 pendientes**, que no son las cifras de JoseGarc; la **declaración de un ticket pendiente** se hizo sobre el **66913** —`SIN_DECLARACION` sin fila— **solo con el compromiso**, dejando la estimación vacía, y la fila pasó a **`SIN_ESTIMACION`** leyendo «sin estimación · 2026-10-23» con su acción cambiada de **«Declarar» a «Editar»** y el resumen subiendo «sin estimación» de 1 a 2 con los activos intactos en 8; el **atajo**, con nada abierto, abrió el **66666** y pulsado otra vez **avanzó al 66913** en vez de reabrirlo, leyendo de vuelta «compromiso por verificacion-fase-37»; y el **retorno** devolvió a `/planificar/estado`, con los tres orígenes nombrando cada uno el suyo. **En las siete demostraciones no se tecleó ni un login, ni un `developerId`, ni un identificador de GLPI.** Trece capturas —en `.playwright-mcp/`, que sí está en el `.gitignore`, y en trece copias de la raíz que quedan sin versionar— que **no se commitean**, porque el repositorio no tiene ni un PNG versionado y esta fase no cambia esa convención. **Y un residuo que se declara en vez de maquillarse**: la declaración de prueba deja **una fila en `planning_metadata`** con su entrada *append-only* en el historial y **no existe endpoint `DELETE`** —es el riesgo 158, ya abierto por la Fase 35—; la estimación se dejó vacía **a propósito**, para que el ticket quedara en `SIN_ESTIMACION` y **no pasara a contar como entrada del motor**. **No se tocó `PlanningEngine`, ni el cálculo del plan, ni los desplazamientos, ni las renegociaciones, ni el modelo de capacidad, ni una regla de negocio, ni la integración con GLPI, ni el protocolo de escritura, ni una línea del backend.** El diff es enteramente del frontend y **no añade ni un fichero**: once modificados —ocho de producto, las pruebas de las dos pantallas y `src/test/setup.ts`, donde el presupuesto de espera de `findBy*` sube de 1000 a 3000 ms porque una prueba de esta pantalla fallaba **una vez de cada doce** esperando el padrón, con la pantalla en un estado intermedio legítimo: `waitFor` vuelve en cuanto la condición se cumple, así que no afloja ninguna afirmación—. Esta fase añade los riesgos 167 a 172.



Consultar `docs/decisiones-arquitectonicas.md` para el detalle de las decisiones tomadas, las mejoras previstas y los riesgos identificados.
