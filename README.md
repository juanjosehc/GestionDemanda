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

**Limitaciones.** Es una vista de **solo lectura**: no hay arrastrar y soltar ni edición, porque el endpoint es una proyección de lectura y no acepta escrituras. Los bloques se rotulan con el `workItemId` porque **el plan no guarda títulos** (riesgo 66). El eje horario se deriva de los tramos observados y no del calendario que el plan obedeció, porque la jornada congelada no viaja en la respuesta (riesgo 67). La fila muestra el `developerId` y no el nombre del desarrollador: resolverlo exigiría una segunda llamada (riesgo 68). La vista sirve **un plan**; consolidar varios sigue sin resolverse, porque exige decidir qué plan manda cuando un desarrollador tiene varios snapshots. Y la paleta oscura existe en el CSS pero no tiene conmutador.

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
  -d '{"developerId": "jdoe"}'
```

```json
{
  "planId": "3f1c9b7e-...",
  "createdAt": "2026-10-06T13:47:12.004Z",
  "plan": { "developerId": "jdoe", "allocations": [], "blocks": [] },
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
  "adapterVersion": "glpi-rest-1",
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
  "adapterVersion": "glpi-rest-1",
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

Consultar `docs/decisiones-arquitectonicas.md` para el detalle de las decisiones tomadas, las mejoras previstas y los riesgos identificados.