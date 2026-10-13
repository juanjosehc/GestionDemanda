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
| Declarar planificación | `POST http://localhost:8080/api/planning-metadata` | `201` con el estado sellado. `409` si el elemento ya tiene planificación declarada, `400` si no se declara ni estimación ni fecha compromiso |
| Modificar planificación | `PUT http://localhost:8080/api/planning-metadata/{workItemId}` | `200` con el estado nuevo. Reemplaza el recurso: hay que reenviar lo que no cambia, y `null` significa retirar el valor. `404` si no hay nada declarado |
| Leer planificación | `GET http://localhost:8080/api/planning-metadata/{workItemId}` | El estado declarado, con `estimatedBy`/`committedBy` y sus sellos, y el derivado `commitmentOverdue`. `404` si no hay nada declarado |
| Historial de planificación | `GET http://localhost:8080/api/planning-metadata/{workItemId}/history` | Cada cambio con su campo, valor anterior, valor nuevo, autor y fecha. En orden. `404` si no hay nada declarado |
| Información de la app | http://localhost:8080/actuator/info | Nombre, descripción y versión |
| Frontend | http://localhost:5173 | Dashboard con las cuatro tarjetas |
| Agenda de un plan en la UI | http://localhost:5173/calendario/{planId} | La rejilla de la agenda. En `/calendario`, sin identificador, la pantalla pide uno |
| Centro de alertas en la UI | http://localhost:5173/alertas | Las condiciones que hoy se cumplen, de más grave a menos, con filtros en memoria. Solo lectura: no reconoce, cierra ni archiva |
| Equipo en la UI | http://localhost:5173/recursos | El plan vigente de cada desarrollador, uno por fila y ordenable, con la capacidad agregada y las alertas del conjunto. Solo lectura: no fusiona planes ni recalcula capacidad |
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

El tablero ya enseñaba los cuellos de botella por desarrollador y la Timeline ya abría la agenda de **un** plan. Lo que faltaba era poder **comparar** esos planes: poner el de cada uno al lado del otro y ordenarlos por lo que a uno le interese mirar. **`/recursos`** es eso, y **no estrena backend**: la vista es una **proyección de dos respuestas que ya existían** —`GET /api/planning/metrics`, de donde sale `current.byDeveloper`, y `GET /api/planning/alerts`— y no pide ninguna tercera cosa.

**La vista no crea un plan de equipo.** No fusiona planes, no suma tramos y no recalcula capacidad. Cada fila **es** un plan que ya está guardado, y cada cifra es la que el backend publicó para él. Lo único que la vista aporta es la comparación —ordenar por una columna— y la navegación hacia el detalle, que también existía.

| Qué se ve en la fila | De dónde sale |
|---|---|
| `developerId` | El plan vigente de ese desarrollador, ya resuelto por el backend |
| `capacity.availableHours` / `occupiedHours` / `remainingHours` | Los tres números del plan, tal como llegan. **No se suman, no se restan y no se recortan**: el restante negativo se ve con su signo |
| `displacedRequirements` | Los elementos que ese plan desplazó, con enlace a su desglose cuando hay alguno |
| `planId` | El plan vigente, enlazado a su agenda —el mismo recurso que el calendario de la Fase 16—, con la ventana que cubre y el instante en que se calculó |
| Capacidad agregada | Los tres totales de `current.capacity`, arriba y en tarjetas: **se publican, no se calculan** |
| Alertas activas | Las del catálogo, en el orden en que el backend las manda, con enlace al centro de alertas |

**Reutilización de contratos: no hay endpoint nuevo, porque no falta información.** `current.byDeveloper[]` **ya era** «un plan vigente por desarrollador», con la vigencia resuelta del lado del backend (decisión 139: el plan más reciente por `created_at`, con desempate estable por `planId`). Traerlo otra vez por una ruta nueva habría sido la tercera copia de un hecho que ya tiene dos dueños —el tablero y las alertas— y habría creado un segundo sitio donde decidir qué plan manda. Las columnas que el brief pedía —`developerId`, plan vigente, disponible, ocupada, restante, desplazados y alertas— **están todas** en esa respuesta, así que la fase entera es frontend.

**Plan individual y vista de equipo no son lo mismo, y la vista no los confunde.** Un plan individual es la agenda de **una** persona para una ventana: tiene tramos, días, horas y reglas aplicadas, y se lee en `/calendario/{planId}`. La vista de equipo es una **fila por plan**, sin tramos y sin días: sirve para decidir a quién mirar, no para ver qué hace. Por eso **no hay mini timeline por fila** (decisión 154): pedir la agenda de cada desarrollador sería una petición por plan —el coste O(planes) que los riesgos 75 y 85 ya señalan— y, peor, volvería a calcular la capacidad día a día, que podría discrepar de los totales publicados. El día a día ya existe, a un clic, en el plan de cada fila.

**Ordenar es una acción del usuario, y el orden de partida sigue siendo el del backend.** El brief pide ordenación visual, así que la cabecera es un botón: el primer clic ordena por esa columna y el segundo la invierte, con la dirección declarada en `aria-sort` para que un lector de pantalla sepa por dónde va la tabla. Sin tocar nada, el orden es el que entregó el backend —por desarrollador, con la vigencia ya resuelta—, así que la vista **no impone una prioridad propia**: solo mueve filas cuando alguien se lo pide. Los números se comparan como números —una prueba fabrica un 9 y un 80, que como texto saldrían al revés— y los empates se rompen por `developerId`, para que el orden sea estable y no dependa del motor de turno.

**La correspondencia entre la tabla y las alertas se comprueba, no se programa.** Las alertas **no tienen dimensión de desarrollador** (riesgo 76): las dos de capacidad son del conjunto, y su desglose por persona es, literalmente, esta tabla. La vista **no re-deriva** ese reparto —sería la tercera copia de un predicado que el backend ya aplica—: lo que hace es enseñar las dos cosas y dejar que una prueba afirme que el número de filas con el restante agotado o negativo es exactamente el `count` de su alerta. La correspondencia existe porque las dos salen de la misma fotografía, y eso es lo que se verifica.

**Limitaciones, dichas donde se leen.** Un desarrollador **sin plan vigente no aparece**, y eso no es un hueco: la vista consolida planes, no personas —la lista de personas del equipo todavía no existe en el backend, y rellenar la ausencia con una fila de ceros afirmaría una capacidad que nadie calculó—. Las alertas se leen **en su propia consulta y fallan por su cuenta**: si su petición se cae, la tabla sigue en pie y el fallo se declara en su tarjeta, no en toda la pantalla. La vista es de **solo lectura** —no hay edición, ni alta, ni baja, ni calendarios individuales—: el mantenimiento de recursos sigue pendiente y esta pantalla no lo adelanta. Y la tabla no cabe en un móvil: se desplaza en horizontal, como la del centro de alertas (riesgo 92).


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

**Limitaciones, dichas donde se leen.** El técnico **se escribe a mano**: el backend no publica el padrón de personas (riesgo 91), así que el selector es un campo de texto y un identificador equivocado responde `404` con el mensaje del backend. **`changedBy` lo teclea el operador**, porque no hay autenticación: el historial de `planning_metadata` es la auditoría de quién cambió qué, y su autor es un campo libre —es la limitación que ya existía en el backend, y la pantalla no la empeora ni la disimula—. La pantalla **no pagina ni filtra**: un técnico con 1.949 tickets pinta 1.949 filas, y el filtro natural —por `declarationStatus`— todavía no se aplica (riesgo 106). Y los **tickets cerrados aparecen**, porque la búsqueda de GLPI no filtra por estado: es paridad con lo que el plan recibe, pero aquí se ve (riesgo 109).

---

### Renegociar lo que un incidente desplazó

El motor detecta desde la Fase 3 que un incidente le quita a un requerimiento su franja: deja un `RescheduleEvent` auditado, lo marca `DESPLAZADO` en el timeline y lo declara `PENDIENTE_DE_RENEGOCIACION`. Lo que no existía era **la operación con la que una persona confirma a qué fecha se llegó**, porque eso se habla por fuera del sistema. `GET|POST|PUT /api/renegotiations` cierra ese hueco. **La renegociación no entra al motor**: es una consecuencia humana de un desplazamiento ya detectado, así que registrar un acuerdo no recalcula capacidad, no mueve un desplazamiento y no altera ningún `RescheduleEvent` —se **añade** al lado de un hecho que ya estaba auditado—.

**Dos hechos distintos, y ninguno sustituye al otro.**

| Hecho | Quién lo produce | Qué dice | Dónde vive |
|---|---|---|---|
| **Desplazamiento** (`RescheduleEvent`) | El motor, al planificar | Que un incidente movió un requerimiento, de qué fecha pactada a qué fecha entregó de verdad, con qué regla y con qué severidad | `reschedule_event`, y el timeline del plan |
| **Renegociación** (el acuerdo) | Una persona, después | A qué fecha nueva se llegó, quién lo acordó y cuándo quedó registrado | `renegotiation` y `renegotiation_history` |

**El desplazamiento dice dónde quedó, no qué se prometió.** Es la distinción que justifica todo lo demás: `rescheduledDate` es el día en que el requerimiento **cierra** tras el recálculo, no la fecha que se le comunicó a quien lo pidió. El motor puede decir «lo moví del 20 al 27 de octubre» y no puede decir si al usuario se le prometió el 30. Ese hueco —la fecha acordada, quién la acordó y cuándo— es exactamente lo que guarda la renegociación.

**La trazabilidad completa, en una sola fila.** `GET /api/renegotiations` contesta las seis preguntas sin pedir el plan ni el timeline por separado:

| Pregunta | De dónde sale |
|---|---|
| Qué requerimiento fue afectado | `workItemId` |
| Qué incidente causó el desplazamiento | `events[].incidentId` |
| Cuál era la fecha original | `events[].originalDate` |
| Cuál es la nueva fecha acordada | `renegotiation.agreedDate` |
| Quién registró el acuerdo | `renegotiation.agreedBy` |
| Cuándo se registró | `renegotiation.agreedAt` |

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
| `PUT` | `/api/renegotiations/{workItemId}` | Reemplaza la fecha acordada y anota el cambio en el historial |

El `workItemId` va en el camino como texto, igual que en `/api/planning-metadata`: es el identificador del ticket en GLPI, no un UUID.

**Lo que un acuerdo no hace.** No borra el `RescheduleEvent` que lo motivó, no modifica el timeline histórico, no elimina el desplazamiento de ninguna lista y no altera el incidente que lo causó. Un requerimiento desplazado **no desaparece de la lectura al renegociarse**: pasa de `PENDIENTE_DE_ACUERDO` a `ACORDADA`, porque la lista es la historia de lo que se movió y esconder lo ya resuelto dejaría sin explicación por qué la fecha de un requerimiento no es la que se le prometió al usuario.

**El sello lo pone el servidor.** Quien registra un acuerdo dice a qué fecha se llegó y quién lo acordó; **cuándo** quedó registrado lo dice el `Clock` que ya fecha los planes, nunca el cuerpo de la petición —una fecha de registro que elige quien llama no es un sello, es una afirmación—. Reenviar la misma fecha no ensucia la auditoría: el acuerdo conserva su autor y su sello, y no se escribe ninguna fila de historial por un cambio que no ocurrió.

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
| Acuerdo | La acción, decidida por la **existencia** de `renegotiation` |

**Una fila por requerimiento, no por desplazamiento.** Uno que se movió dos veces por dos incidentes aparece una vez, con los dos dentro: es la misma cuenta que hace la tarjeta de desplazamientos del tablero, así que las dos cifras no pueden discrepar. La pantalla **no resume** los desplazamientos en una sola fecha —resumirlos escondería el segundo— y **no recalcula** ninguna: las parejas son las que el plan auditó.

**El formulario lee antes de escribir, y el verbo lo decide la existencia del acuerdo.** Es la misma regla que la pantalla de declaración (decisión 161), aplicada al mismo problema: el `PUT` **reemplaza**. Si el requerimiento ya tiene acuerdo, abrir el formulario lanza una lectura fresca de `GET /api/renegotiations/{workItemId}` y **no enseña ningún campo hasta que llega** —rellenar con lo que traía la lista, que es una foto del instante en que se consultó, y guardar borraría lo que alguien cambió desde entonces—. Si no tiene acuerdo no hay nada que leer y el verbo es `POST`. **El verbo nunca sale del estado visual**: decidirlo por `status` mandaría un `POST` contra un recurso que ya existe y el backend respondería `409`, convirtiendo un caso normal en un error.

**El motivo se enseña, no se captura, y hay que decir por qué.** El brief pedía un campo de motivo en el formulario, y **el contrato de la Fase 25 no lo tiene**: `RenegotiationRequest` son `workItemId`, `agreedDate` y `agreedBy`, y `RenegotiationUpdateRequest` son los dos últimos. Un campo de texto que el backend descarta al deserializar no es capturar un dato: es perderlo con la apariencia de haberlo guardado, y el brief prohíbe cambiar los contratos. Así que el formulario **no pide un motivo** y en su lugar enseña el `reason` que el plan ya publica para cada desplazamiento —«por qué se desplazó», que es un hecho auditado—. Lo que no queda registrado es **por qué se acordó esa fecha** (riesgo 114): añadirlo exige un campo nuevo en el contrato y una columna nueva en la tabla, y no se hace desde el frontend.

**El historial se lee de su propia ruta y no se reconstruye.** Una entrada por cambio, **en el orden exacto en que las publica el backend**, sin ordenar, sin deduplicar y sin completar con lo que traía la lista: un historial recompuesto en el cliente afirmaría un orden que nadie auditó. La primera entrada —`previousDate` nulo— dice «primer acuerdo» en vez de dejar un hueco, porque el momento en que no había fecha y alguien la trajo es justo lo que esa entrada significa. El historial existe **si y solo si** alguien registró un acuerdo alguna vez, y eso lo dice un hecho publicado —`renegotiation` nulo o no—, no una deducción de la vista: sin acuerdo **no se pide nada**, porque la ruta responde `404` y ese `404` es el estado normal de un requerimiento desplazado que nadie ha renegociado todavía.

**Después de guardar se invalida lo justo, y es distinto de lo que hace la pantalla de declaración.** Se relee la **lista** —es lo que hay que ver cambiar, y de donde sale el estado nuevo de la fila— y el **historial del requerimiento afectado**, que sigue montado y es donde la entrada recién escrita tiene que aparecer. El **detalle** del requerimiento solo se marca viejo, sin releerlo, porque el formulario se cierra en ese instante. Nada más: ni una petición por fila, ni una ruta ajena, ni una recarga de página —no hay `window.location`—. La fila **sigue elegida** después de guardar, para que el historial que se relee enseñe el cambio sin volver a abrir nada.

**Los filtros —Todas, Pendientes, Acordadas— se aplican en memoria**, sobre el array ya recibido: no vuelven a consultar, no cambian la clave de la consulta y no disparan una petición. Filtrar hasta vaciar la lista **no se confunde con no tener nada que renegociar**: «ningún requerimiento está desplazado» y «ningún requerimiento coincide con el filtro» son estados distintos y se dicen por separado. La fila seleccionada se busca en la lista **completa** y no en la filtrada, así que cambiar el filtro no cierra un formulario a medio escribir.

**Los errores son del backend y se enseñan con sus palabras.** Un `400` de validación, el `404` de un acuerdo que la lista decía que existía y ya no está, y el `409` de «ya hay renegociación registrada; para modificarla se usa `PUT`» dicen cosas distintas, y reescribirlos aquí sustituiría el diagnóstico por uno peor. El `409` es además un caso legítimo —alguien acordó primero— y no un fallo de la pantalla. Ante el `404` la pantalla **no se cae al `POST` por su cuenta**: eso crearía un acuerdo que la fila decía que existía.

**Ninguna lectura por fila.** La lista sale de una sola petición a `GET /api/renegotiations`, y el acuerdo y el historial de un requerimiento se piden **solo cuando alguien elige su fila** —y no se piden en absoluto si esa fila no tiene acuerdo—. Una agenda con decenas de desplazados sigue costando una lectura, no una por fila.

**Limitaciones, dichas donde se leen.** El **motivo de la renegociación no se persiste** (riesgo 114): el contrato no tiene el campo y el brief prohíbe cambiarlo, así que la pantalla enseña el motivo del **desplazamiento** y no el de la **decisión**. **`agreedBy` lo teclea el operador**, porque no hay autenticación (riesgo 111): el historial de `renegotiation` es la auditoría de quién acordó qué, y su autor es un campo libre —la misma limitación que ya tenía `planning_metadata`, y la pantalla no la empeora ni la disimula—. La pantalla **no filtra por desarrollador ni pagina**: un plan con muchos desplazados pinta todas sus filas, y el filtro por técnico todavía no existe (riesgo 115). Y **la fecha acordada no se valida contra la capacidad** (riesgo 113): la pantalla no comprueba que la fecha a la que dos personas llegaron sea planificable, porque eso obligaría a ejecutar el motor sobre un acuerdo.

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

Consultar `docs/decisiones-arquitectonicas.md` para el detalle de las decisiones tomadas, las mejoras previstas y los riesgos identificados.