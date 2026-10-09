# Graph Report - GestionDemanda  (2026-10-08)

## Corpus Check
- 203 files · ~152,081 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .properties 3, .example 1)

## Summary
- 1845 nodes · 5736 edges · 92 communities (79 shown, 13 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 445 edges (avg confidence: 0.81)
- Token cost: 281,784 input · 0 output

## Community Hubs (Navigation)
- Endpoint Integration Tests
- GLPI Ticket Contract & Mapping
- JPA Entities & Spring Data
- Plan Snapshot Persistence
- Reschedule Idempotency Ledger
- Plan Snapshot Model
- Context Persistence & Numbers
- GLPI REST Client
- Planning Engine Core
- Working Calendar & Capacity
- Domain Model & Work Blocks
- Planning Engine Test DSL
- UI Primitives (shadcn)
- GLPI Ticket Mapper Tests
- Planning REST Controllers
- Dashboard Components
- GLPI Contract Verifier
- Planning Endpoint Tests
- Planning Service & Input
- Docs Phase 6 · Plan Persistence
- Docs Phase 7-8 · Context
- Frontend Test Infrastructure
- Frontend Build Setup
- Frontend Page Tests
- API Error Handling
- GLPI Session Lifecycle
- Planning Metadata Domain
- Metadata Persistence Tests
- GLPI Planning Source
- App Shell & Timeline View
- Docs Phase 9 · Anti-Corruption
- Metadata Service Tests
- TS App Config
- GLPI Request Factory Tests
- Metadata JPA Adapter
- Docs Phase 13 · Declared Planning
- Docs Phase 16 · Timeline View
- Metadata Service
- Metrics Endpoint Tests
- shadcn Config
- Timeline Date Helpers
- WebClient Setup
- Timeline Projection
- Docs Phase 11-12 · Real GLPI
- TS Node Config
- Operational Metrics Service
- Metadata Repository Port
- Docs Phase 10 · GLPI Contract
- Frontend Dev Dependencies
- README Concepts
- Plan Snapshot Repository Port
- Simulation & Plan Contracts
- GLPI Model Discovery
- Docker Compose Stack
- Docs Phase 15 · Timeline Contract
- Business Time Tests
- GLPI Priority Mapping Tests
- Metrics to Timeline Coupling
- Docs Phase 2 · Domain Core
- Timeline Grid Rendering
- README Timeline Contracts
- Displacement Policies
- GLPI Live Validation Tests
- Frontend Runtime Dependencies
- Core Domain Concepts
- Plan Context Read Contract
- Docs Phase 17 · Observability
- GLPI Contract Validation
- Docs Phase 3 · Severity Priority
- Frontend Metrics Types
- Contract Verifier Implementation
- Docs Phase 4 · Business Time
- Docs Phase 5 · Unified Time Model
- npm Scripts
- Legacy Resource Types
- Plan Input Read Contract
- Spring Boot Entry Point
- Test Clock
- Docs Persistence · Idempotency
- Oxlint Config
- README Declared Planning
- SPA HTML Shell
- Brand Favicon
- Navigation & Routes
- API Client
- README Observability
- Docs Schema & Timeline Prep
- TS Root Config
- Persistence Concepts
- Vite Env Types
- GLPI Health Types
- Maven Backend Module

## God Nodes (most connected - your core abstractions)
1. `IncidentSeverity` - 53 edges
2. `PlanningMetadata` - 51 edges
3. `Fase 6 — Persistencia del plan` - 45 edges
4. `PlanningService` - 44 edges
5. `JpaPlanSnapshotRepositoryTest` - 43 edges
6. `PlanningRules` - 41 edges
7. `Incident` - 40 edges
8. `PlanningEngineTest` - 40 edges
9. `PlanningTimelineEndpointsTest` - 37 edges
10. `GlpiTicket` - 35 edges

## Surprising Connections (you probably didn't know these)
- `docker-compose service frontend (nginx, puerto 3000 -> 80)` --references--> `frontend/index.html (shell HTML de la SPA)`  [INFERRED]
  docker-compose.yml → frontend/index.html
- `Gestión de Demanda` --references--> `docker-compose service postgres (postgres:17-alpine)`  [EXTRACTED]
  README.md → docker-compose.yml
- `PostgreSQL gestiondemanda (persistencia del plan)` --shares_data_with--> `docker-compose service postgres (postgres:17-alpine)`  [EXTRACTED]
  README.md → docker-compose.yml
- `/src/main.tsx (entrada del bundle Vite)` --conceptually_related_to--> `Frontend SPA (React 19 / TypeScript / Vite / Tailwind v4)`  [INFERRED]
  frontend/index.html → README.md
- `Despliegue con Docker (frontend nginx, backend, PostgreSQL)` --references--> `docker-compose service backend (Spring Boot)`  [EXTRACTED]
  README.md → docker-compose.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Despliegue local de los tres servicios en docker compose** — docker_compose_postgres_service, docker_compose_backend_service, docker_compose_frontend_service, docker_compose_postgres_data_volume, docker_compose_env_db_url [EXTRACTED 1.00]
- **Modelo temporal en tiempo hábil compartido por capacidad y OLA** — readme_fase_4_tiempo_habil, readme_fase_5_modelo_temporal_unificado, readme_calendario_laboral, readme_tiempo_habil, readme_capacidad_agenda_de_franjas [EXTRACTED 1.00]
- **La planificación declarada como fuente del plan y su medición** — readme_fase_13_planificacion_propia, readme_fase_14_acl_lee_planificacion_declarada, readme_fase_17_observabilidad_operativa, readme_planificacion_declarada, readme_decision_124_planificabilidad [EXTRACTED 1.00]
- **Favicon Visual Identity System (mark + glow + palette + P3 fills)** — frontend_public_favicon_lightning_bolt_mark, frontend_public_favicon_masked_gradient_glow, frontend_public_favicon_brand_palette, frontend_public_favicon_wide_gamut_p3_fill [INFERRED 0.75]
- **Las cuatro capas de la auditoría de un plan** — docs_decisiones_arquitectonicas_decision_45, docs_decisiones_arquitectonicas_decision_55, docs_decisiones_arquitectonicas_decision_66, docs_decisiones_arquitectonicas_decision_61, docs_decisiones_arquitectonicas_decision_72 [EXTRACTED 1.00]
- **Unificación de los dos relojes del sistema** — docs_decisiones_arquitectonicas_decision_37, docs_decisiones_arquitectonicas_decision_38, docs_decisiones_arquitectonicas_decision_39, docs_decisiones_arquitectonicas_decision_42 [EXTRACTED 1.00]
- **La cadena que exige una respuesta de negocio sobre la planificación** — docs_decisiones_arquitectonicas_decision_116, docs_decisiones_arquitectonicas_decision_119, docs_decisiones_arquitectonicas_decision_120, docs_decisiones_arquitectonicas_decision_124_1, docs_decisiones_arquitectonicas_decision_124_2 [EXTRACTED 1.00]

## Communities (92 total, 13 thin omitted)

### Community 0 - "Endpoint Integration Tests"
Cohesion: 0.05
Nodes (35): application_json, autowired, GlpiSessionResponse, PlanningMetadataRequest, PlanningMetadataUpdateRequest, GlpiPlanningSource, GlpiUser, PlanningMetadataHistoryJpaRepository (+27 more)

### Community 1 - "GLPI Ticket Contract & Mapping"
Cohesion: 0.05
Nodes (24): DiscardedView, Field, GlpiContract, GlpiDiscardedItem, GlpiDiscardReason, ESTADO_DESCONOCIDO, FECHA_CREACION_ILEGIBLE, SIN_COMPROMISO_DECLARADO (+16 more)

### Community 2 - "JPA Entities & Spring Data"
Cohesion: 0.07
Nodes (36): accesslevel, PlanningConflictEntity, PlanningConflictJpaRepository, PlanningContextEntity, PlanningContextJpaRepository, PlanningContextPolicyEntity, PlanningContextPolicyJpaRepository, PlanningInputEntity (+28 more)

### Community 3 - "Plan Snapshot Persistence"
Cohesion: 0.16
Nodes (5): Override, JpaPlanSnapshotRepository, WorkBlockJpaRepository, JpaPlanSnapshotRepositoryTest, jakarta.persistence.EntityManager

### Community 4 - "Reschedule Idempotency Ledger"
Cohesion: 0.08
Nodes (15): PlanningConfig, RescheduleLedger, Override, JpaRescheduleLedger, InMemoryRescheduleLedger, Override, JpaRescheduleLedgerTest, RelojDelSistema (+7 more)

### Community 5 - "Plan Snapshot Model"
Cohesion: 0.09
Nodes (12): PlanningContextSnapshot, PlanReference, PlanSnapshot, TimelineResource, concurrenthashmap, instant, list, min (+4 more)

### Community 6 - "Context Persistence & Numbers"
Cohesion: 0.14
Nodes (19): arraylist, arrays, PlanningMetadataField, COMMITTED_DATE, ESTIMATED_HOURS, bigdecimal, collectors, dayofweek (+11 more)

### Community 7 - "GLPI REST Client"
Cohesion: 0.10
Nodes (22): anystring, GlpiProperties, GlpiHealthResponse, GlpiAuthenticationException, GlpiConnectionException, GlpiItemNotFoundException, GlpiUnreachableException, decodingexception (+14 more)

### Community 8 - "Planning Engine Core"
Cohesion: 0.13
Nodes (12): IncidentPolicyProperties, PlanningProperties, IncidentSeverity, ALTO, BAJO, MEDIO, Incident, PlanningEngine (+4 more)

### Community 9 - "Working Calendar & Capacity"
Cohesion: 0.13
Nodes (9): CalendarProperties, BusinessHours, TimeSlot, BusinessSegment, BusinessTimeCalculator, CapacityBook, WorkingCalendar, CapacityBookTest (+1 more)

### Community 10 - "Domain Model & Work Blocks"
Cohesion: 0.14
Nodes (19): AppliedRule, CAPACIDAD_COMPROMETIDA, CAPACIDAD_DIARIA_EXCEDIDA, REPLANIFICACION_INMEDIATA, SATURACION, UMBRAL_INCIDENTE_EXCEDIDO, DisplacementPolicy, WorkItemType (+11 more)

### Community 12 - "UI Primitives (shadcn)"
Cohesion: 0.08
Nodes (15): ICON_TONES, StatCardProps, StatTone, Badge(), BadgeVariant, badgeVariants, Button(), ButtonProps (+7 more)

### Community 13 - "GLPI Ticket Mapper Tests"
Cohesion: 0.14
Nodes (5): GlpiTicketMapperTest, MapeoIncidente, MapeoRequerimiento, TraduccionesDeDiagnostico, org.junit.jupiter.api.Test

### Community 14 - "Planning REST Controllers"
Cohesion: 0.15
Nodes (19): GlpiController, PlanningController, PlanningMetadataController, PlanningFromGlpiRequest, PlanningFromGlpiResponse, PlanningMetadataResponse, GlpiPlanningService, Decisión 23 — Endpoint de simulación, declarado temporal (+11 more)

### Community 15 - "Dashboard Components"
Cohesion: 0.09
Nodes (16): ComingSoonProps, BottleneckTableProps, RemainingState, formatTimestamp(), GlpiStatusCard(), resolveStatus(), STATUS, StatusKey (+8 more)

### Community 16 - "GLPI Contract Verifier"
Cohesion: 0.13
Nodes (9): GlpiContractVerifier, Report, Verdict, COMPATIBLE, DEGRADED, INCOMPATIBLE, GlpiContractVerifierTest, com.fasterxml.jackson.databind.JsonNode (+1 more)

### Community 18 - "Planning Service & Input"
Cohesion: 0.12
Nodes (15): RequirementStatus, EN_EJECUCION, FINALIZADO, PENDIENTE_DE_RENEGOCIACION, PLANIFICADO, Developer, InputProvenance, PlanningInputSnapshot (+7 more)

### Community 19 - "Docs Phase 6 · Plan Persistence"
Cohesion: 0.07
Nodes (28): Decisión 46 — Cuatro entidades planas: el agregado se arma con consultas, no con relaciones, Decisión 47 — La identidad: el plan la recibe del adaptador; el resto son claves sustitutas, Decisión 49 — Las pruebas corren contra H2, no contra PostgreSQL, Decisión 51 — `POST /plan` y `GET /{planId}` no devuelven lo mismo, Decisión 53 — Preparación para la integración con GLPI, Fase 6 — Persistencia del plan, Riesgo 1 — La URL de GLPI debe incluir /apirest.php, Riesgo 10 — El puerto 8090 está reservado por Windows (+20 more)

### Community 20 - "Docs Phase 7-8 · Context"
Cohesion: 0.10
Nodes (28): Decisión 55 — `PlanningContextSnapshot`: la fotografía, no la configuración, Decisión 56 — Qué se persiste, dato por dato, Decisión 57 — El contexto entra por el puerto que ya existe, Decisión 58 — La jornada se deriva; las severidades se copian enteras, Decisión 59 — `ENGINE_VERSION` es una constante escrita a mano, Decisión 60 — `GET /api/planning/{planId}/context`, Decisión 61 — Estrategia de trazabilidad, Decisión 62 — Estrategia de auditoría (+20 more)

### Community 21 - "Frontend Test Infrastructure"
Cohesion: 0.08
Nodes (12): glpiHealthQueryKey, planningMetricsQueryKey, timelineQueryKey(), useTimeline(), DEVELOPER_ID, EMPTY_DEVELOPER_ID, FULL_DEVELOPER_ID, OVER_DEVELOPER_ID (+4 more)

### Community 22 - "Frontend Build Setup"
Cohesion: 0.08
Nodes (22): name, private, type, version, container, ref_app, clsx, ref_index_css (+14 more)

### Community 23 - "Frontend Page Tests"
Cohesion: 0.09
Nodes (9): fetchMock, plan, fetchMock, fetchMock, ref_pages, ref_test, @testing-library/jest-dom, @testing-library/react (+1 more)

### Community 24 - "API Error Handling"
Cohesion: 0.25
Nodes (10): ApiError, GlobalExceptionHandler, GlpiDeveloperNotFoundException, org.springframework.http.HttpStatus, org.springframework.http.ResponseEntity, org.springframework.web.bind.annotation.ExceptionHandler, org.springframework.web.bind.annotation.RestControllerAdvice, org.springframework.web.bind.MethodArgumentNotValidException (+2 more)

### Community 25 - "GLPI Session Lifecycle"
Cohesion: 0.20
Nodes (5): GlpiClient, GlpiConnectivityService, GlpiConnectivityServiceTest, org.springframework.stereotype.Service, reactor.core.publisher.Mono

### Community 26 - "Planning Metadata Domain"
Cohesion: 0.15
Nodes (4): DomainPreconditions, PlanningMetadata, InMemoryPlanningMetadataRepository, Override

### Community 27 - "Metadata Persistence Tests"
Cohesion: 0.25
Nodes (4): Override, JpaPlanningMetadataRepository, JpaPlanningMetadataRepositoryTest, org.springframework.transaction.annotation.Transactional

### Community 28 - "GLPI Planning Source"
Cohesion: 0.17
Nodes (5): GlpiInvalidDataException, GlpiRestPlanningSource, Override, GlpiRestPlanningSourceTest, lombok.extern.slf4j.Slf4j

### Community 29 - "App Shell & Timeline View"
Cohesion: 0.10
Nodes (11): queryClient, EmptyStateProps, FilterProps, ResourceTimelineProps, SEVERITY_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS, HeaderProps (+3 more)

### Community 30 - "Docs Phase 9 · Anti-Corruption"
Cohesion: 0.13
Nodes (20): Decisión 78 — Qué objetos espera el dominio, Decisión 79 — Por qué había que construir la ACL desde cero, Decisión 80 — Dónde vive la capa anticorrupción, Decisión 81 — Mapeo de prioridad → severidad, Decisión 82 — Mapeo de tipo y estado: un ticket, dos objetos del dominio, Decisión 83 — Unidades y fechas, Decisión 84 — Descartar el ticket, no la planificación, Decisión 85 — Cuatro clases, cuatro códigos (+12 more)

### Community 32 - "TS App Config"
Cohesion: 0.09
Nodes (21): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+13 more)

### Community 33 - "GLPI Request Factory Tests"
Cohesion: 0.17
Nodes (11): assertthat, assertthatthrownby, IncidentStatus, ABIERTO, EN_ATENCION, RESUELTO, InputSource, GLPI (+3 more)

### Community 34 - "Metadata JPA Adapter"
Cohesion: 0.14
Nodes (8): Override, PlanningMetadataEntity, PlanningMetadataJpaRepository, lockmodetype, org.springframework.data.domain.Persistable, org.springframework.data.jpa.repository.Lock, org.springframework.data.jpa.repository.Query, param

### Community 35 - "Docs Phase 13 · Declared Planning"
Cohesion: 0.16
Nodes (21): Decisión 117 — GLPI es la fuente del trabajo; la planificación es de este sistema, Decisión 118 — La forma del modelo, y por qué `work_item_id` es la clave, Decisión 121 — La trazabilidad: qué se guarda en cada cambio, Decisión 122 — El borrado se permite y queda registrado, Decisión 123 — El compromiso vencido se acepta y se marca, Decisión 124 — La costura por la que entrará la ACL, Decisión 124.1 — La regla de planificabilidad: hacen falta los dos valores, Decisión 124.2 — La estimación y el compromiso declarados sustituyen a los de GLPI (+13 more)

### Community 36 - "Docs Phase 16 · Timeline View"
Cohesion: 0.12
Nodes (17): Decisión 134 — La vista consume el contrato, no lo reinterpreta, Decisión 135 — CSS Grid propio, y por qué la librería puede esperar, Decisión 136 — La ruta con reserva a campo, Decisión 137 — Solo lectura, filtros en memoria, Fase 16 — La vista Timeline en React, Riesgo 6 — Sin pruebas de frontend, Riesgo 66 — Los bloques se rotulan con el workItemId, Riesgo 67 — El eje horario se deriva de los tramos, no del calendario (+9 more)

### Community 37 - "Metadata Service"
Cohesion: 0.14
Nodes (5): ChangeView, PlanningMetadataHistoryResponse, PlanningMetadataAlreadyExistsException, PlanningMetadataNotFoundException, PlanningMetadataService

### Community 39 - "shadcn Config"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 40 - "Timeline Date Helpers"
Cohesion: 0.14
Nodes (14): DAY_FORMAT, DEFAULT_AXIS, EMPTY_FILTERS, formatDay(), formatTime(), hourAxis, HOURS_FORMAT, itemDate() (+6 more)

### Community 41 - "WebClient Setup"
Cohesion: 0.13
Nodes (15): WebClientConfig, channeloption, clientauth, Decisión 1 — Aislamiento de GLPI, Decisión 10 — Timeline sin librería, Decisión 14 — Los tokens nunca se registran en el log, Decisión 2 — `connected` y `authenticated` como campos separados, Decisión 3 — WebClient en una aplicación servlet (+7 more)

### Community 42 - "Timeline Projection"
Cohesion: 0.20
Nodes (6): Conflict, RescheduleEventView, PlanSnapshotResponse, TimelineCapacity, TimelineItem, PlanningService

### Community 43 - "Docs Phase 11-12 · Real GLPI"
Cohesion: 0.12
Nodes (17): Decisión 104 — Qué devolvió la instancia, Decisión 106 — Los siete hallazgos, Decisión 107 — Qué habría que cambiar en el adaptador, y por qué no se cambió, Decisión 108 — Decisión recomendada (Fase 11), Decisión 109 — El instrumento y el método, Decisión 110 — Las siete preguntas del brief, respondidas, Decisión 111 — La matriz funcional, Decisión 114 — Limitaciones encontradas (+9 more)

### Community 44 - "TS Node Config"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 45 - "Operational Metrics Service"
Cohesion: 0.23
Nodes (8): Capacity, Current, Declared, DeclaredGap, DeveloperCurrent, PlanningOperationalMetricsResponse, Plans, PlanningMetricsService

### Community 46 - "Metadata Repository Port"
Cohesion: 0.23
Nodes (4): DeclaredPlanningMetrics, PlanningMetadataChange, PlanningMetadataRepository, collection

### Community 47 - "Docs Phase 10 · GLPI Contract"
Cohesion: 0.17
Nodes (15): Decisión 100 — Estrategia ante un cambio de GLPI, Decisión 101 — Respuesta parcial: qué se usa, qué se ignora, qué se degrada, Decisión 102 — Plan de validación contra la instancia real, Decisión 103 — La cadena de confianza del cliente de GLPI, Decisión 91 — El inventario de suposiciones, Decisión 93 — Qué campos son críticos para el motor, Decisión 95 — La matriz del contrato, campo por campo, Decisión 96 — `GlpiContract`: el contrato como dato (+7 more)

### Community 48 - "Frontend Dev Dependencies"
Cohesion: 0.13
Nodes (15): devDependencies, jsdom, oxlint, tailwindcss, @tailwindcss/vite, @testing-library/jest-dom, @testing-library/react, tw-animate-css (+7 more)

### Community 49 - "README Concepts"
Cohesion: 0.18
Nodes (15): Arquitectura en capas con dependencia hacia el dominio, Capa anticorrupción (GLPI traducido en un solo sitio), Códigos de error de la API (GLPI_UNAVAILABLE, PLAN_NOT_FOUND, ...), El contrato de GLPI es un dato, no código repartido, docs/decisiones-arquitectonicas.md, POST /api/planning/plan, POST /api/planning/simulate, Fase 10 · Contrato de GLPI declarado y comparable (+7 more)

### Community 50 - "Plan Snapshot Repository Port"
Cohesion: 0.20
Nodes (3): PlanSnapshotRepository, Block, PlanNotFoundException

### Community 51 - "Simulation & Plan Contracts"
Cohesion: 0.27
Nodes (6): PlanningPlanResponse, DeveloperInput, PlanningSimulationRequest, RulesInput, DisplacedRequirement, PlanningSimulationResponse

### Community 53 - "Docker Compose Stack"
Cohesion: 0.19
Nodes (14): docker-compose service backend (Spring Boot), DB_NAME, DB_PASSWORD, DB_URL, DB_USER, GLPI_APP_TOKEN, GLPI_TIMEOUT, GLPI_URL (+6 more)

### Community 54 - "Docs Phase 15 · Timeline Contract"
Cohesion: 0.21
Nodes (12): Decisión 128 — El contrato de la Timeline: una proyección de lectura, Decisión 129 — La planificación y la visualización se separan aquí, Decisión 130 — La estrategia de capacidad, Decisión 131 — El estado de planificación: dos valores, y los dos que se rechazaron, Decisión 132 — Preparación para React, Decisión 133 — Preparación para Resource Planning, Decisión 44 — Preparación para el Timeline de React (Fase 5), Fase 15 — El contrato de lectura para la Timeline (+4 more)

### Community 56 - "GLPI Priority Mapping Tests"
Cohesion: 0.30
Nodes (3): GlpiPriorityMapperTest, org.junit.jupiter.params.ParameterizedTest, org.junit.jupiter.params.provider.CsvSource

### Community 57 - "Metrics to Timeline Coupling"
Cohesion: 0.24
Nodes (10): TimelineItemStatus, DESPLAZADO, PLANIFICADO, TimelineCapacity, TimelineItem, TimelinePlanResponse, TimelineResource, comparator (+2 more)

### Community 58 - "Docs Phase 2 · Domain Core"
Cohesion: 0.18
Nodes (11): Decisión 15 — El dominio es Java puro, Decisión 16 — El motor no es un `@Service`, Decisión 17 — Las reglas son un objeto de dominio, no configuración de Spring, Decisión 18 — Orden de resolución: primero incidentes, después requerimientos, Decisión 19 — Idempotencia: reclamo atómico detrás de una interfaz, Decisión 20 — Auditoría obligatoria y atribución de la causa, Decisión 22 — Restricción de modelo: un requerimiento cabe completo en una jornada, Decisión 42 — Se levanta la restricción de la decisión 22: un requerimiento se reparte (+3 more)

### Community 59 - "Timeline Grid Rendering"
Cohesion: 0.20
Nodes (8): Block(), BlockProps, describe(), SEVERITY, STATUS, TimelineGridProps, TYPE, ZOOM

### Community 60 - "README Timeline Contracts"
Cohesion: 0.22
Nodes (11): Decisión 135 · CSS Grid y cero dependencias para la Timeline, GET /api/planning/metrics, GET /api/planning/{planId}/timeline, Fase 15 · El contrato de lectura para la Timeline, Fase 16 · La vista Timeline en React, Fotografía operativa de la planificación, Riesgo 66 · El plan no guarda títulos, Riesgo 67 · La jornada congelada no viaja en la respuesta (+3 more)

### Community 61 - "Displacement Policies"
Cohesion: 0.27
Nodes (4): INMEDIATA, POR_CAPACIDAD, POR_SATURACION, Override

### Community 62 - "GLPI Live Validation Tests"
Cohesion: 0.31
Nodes (8): files, hashmap, httpheaders, ioexception, org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable, path, qualifier, typereference

### Community 63 - "Frontend Runtime Dependencies"
Cohesion: 0.20
Nodes (10): dependencies, class-variance-authority, clsx, lucide-react, @radix-ui/react-slot, react, react-dom, react-router-dom (+2 more)

### Community 64 - "Core Domain Concepts"
Cohesion: 0.22
Nodes (10): Calendario laboral, Capacidad como agenda de franjas al minuto, Fase 2 · Núcleo de dominio, Fase 3 · Priorización por severidad, Fase 4 · Tiempo hábil, Fase 5 · Modelo temporal unificado, Incidente sin severidad como dato legado, OLA · Acuerdo de nivel operativo por severidad (+2 more)

### Community 65 - "Plan Context Read Contract"
Cohesion: 0.36
Nodes (4): PlanningContextResponse, RulesView, IncidentPolicyView, WorkingCalendarView

### Community 66 - "Docs Phase 17 · Observability"
Cohesion: 0.33
Nodes (8): Decisión 139 — La vigencia es el plan más reciente por `created_at`, Decisión 141 — La trazabilidad viaja en el payload, no solo en el javadoc, Decisión 142 — `metrics` convive con `{planId}` por especificidad de patrón, y por eso se prueba, Fase 17 — Observabilidad operativa de la planificación, Riesgo 70 — plans.generated cuenta ejecuciones, no planes distintos, Riesgo 71 — Carga completa de plan_snapshot y cuatro COUNT(*) sin índice, Riesgo 72 — Un plan vigente sin contexto o sin entrada tumba la foto entera, Riesgo 73 — El desempate de vigencia es arbitrario

### Community 68 - "Docs Phase 3 · Severity Priority"
Cohesion: 0.22
Nodes (9): Decisión 24 — `IncidentSeverity` entra al modelo, y no tener severidad es un estado válido, Decisión 25 — `IncidentPolicy`: la OLA por severidad, donde los objetivos no son volumen de trabajo, Decisión 26 — `DisplacementPolicy`: cómo se tradujo cada regla de negocio, Decisión 27 — `incidentThresholdHours` se conserva, con fecha de retiro, Decisión 28 — La auditoría copia la severidad; el motivo se deriva en la frontera, Decisión 29 — La simulación acepta severidad y devuelve la OLA vigente, Fase 3 — Priorización por severidad, Riesgo 16 — Los incidentes sin severidad pueden quedarse indefinidamente (+1 more)

### Community 69 - "Frontend Metrics Types"
Cohesion: 0.22
Nodes (8): CurrentMetrics, DeclaredGap, DeclaredMetrics, DeveloperPlanningMetrics, GlpiDiscardReason, PlanningCapacity, PlanningOperationalMetricsResponse, PlansMetrics

### Community 70 - "Contract Verifier Implementation"
Cohesion: 0.25
Nodes (7): com.fasterxml.jackson.databind.ObjectMapper, datetimeformatter, datetimeparseexception, iterator, jsonprocessingexception, linkedhashset, streamsupport

### Community 71 - "Docs Phase 4 · Business Time"
Cohesion: 0.25
Nodes (8): Decisión 21 — Puntos de extensión previstos, no implementados, Decisión 31 — `WorkingCalendar` es el calendario, y la jornada se deriva de él, Decisión 32 — La aritmética de tiempo hábil se hace en minutos, no en horas, Decisión 34 — El bloque por defecto es 09:00–17:00 porque son exactamente ocho horas, Decisión 35 — `end-time` es opcional para no romper `PLANNING_WORKING_HOURS_PER_DAY`, Decisión 36 — Tres objetos nuevos; `WorkingDay` y `Holiday`, descartados, Fase 4 — Tiempo hábil, Riesgo 12 — La capacidad es uniforme: 8 h al día, todos los días

### Community 72 - "Docs Phase 5 · Unified Time Model"
Cohesion: 0.29
Nodes (8): Decisión 37 — La capacidad es una agenda de franjas, no un contador de horas, Decisión 38 — Un solo recorrido del calendario para la OLA y para la capacidad, Decisión 39 — Desaparece la planificación por día, Decisión 41 — La reserva de prioridad reclama la jornada, no la consume, Decisión 43 — Preparación para la Fase 6 (persistencia), Fase 5 — Modelo temporal unificado, Riesgo 21 — El motor consume por días completos; la OLA se calcula al minuto, Riesgo 22 — DayBook.consumeGreedy devolvía el día del reporte aunque no fuera laborable

### Community 73 - "npm Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, preview, test, typecheck

### Community 74 - "Legacy Resource Types"
Cohesion: 0.29
Nodes (6): PlanningItem, Priority, Resource, ResourceKind, TimelineWindow, WorkItemSource

### Community 76 - "Spring Boot Entry Point"
Cohesion: 0.47
Nodes (4): GestionDemandaApplication, org.springframework.boot.autoconfigure.SpringBootApplication, org.springframework.boot.context.properties.ConfigurationPropertiesScan, springapplication

### Community 78 - "Docs Persistence · Idempotency"
Cohesion: 0.33
Nodes (6): Decisión 45 — El modelo persistente: Spring Data JPA, y qué se guarda de todo lo que el motor produce, Decisión 48 — El registro de idempotencia deja de vivir en memoria (cierra el riesgo 11), Decisión 50 — Guardar no forma parte de calcular, Riesgo 11 — El registro de idempotencia se pierde al reiniciar, Riesgo 32 — Un plan guardado no se puede reproducir: guarda el resultado, no las entradas, Riesgo 35 — El registro de idempotencia no expira: crece sin límite

### Community 79 - "Oxlint Config"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 80 - "README Declared Planning"
Cohesion: 0.40
Nodes (6): Decisión 124.2 · Lo declarado sustituye lo registrado, Decisión 124 · Planificable solo con estimación y compromiso declarados, POST/PUT/GET /api/planning-metadata, Fase 13 · La planificación propia, Fase 14 · La capa anticorrupción lee la planificación declarada, Planificación declarada (PlanningMetadata)

### Community 81 - "SPA HTML Shell"
Cohesion: 0.40
Nodes (5): /favicon.svg, frontend/index.html (shell HTML de la SPA), /src/main.tsx (entrada del bundle Vite), div#root (punto de montaje de React), Frontend SPA (React 19 / TypeScript / Vite / Tailwind v4)

### Community 82 - "Brand Favicon"
Cohesion: 0.90
Nodes (5): GestionDemanda Frontend Favicon (48x46 SVG), Favicon Brand Palette (violet 863bff / deep violet 7e14ff / cyan 47bfff / lavender ede6ff), Lightning Bolt Zigzag Logo Mark, Masked Gaussian-Blur Glow Composition, Display-P3 Wide-Gamut Fill Declarations

### Community 83 - "Navigation & Routes"
Cohesion: 0.40
Nodes (3): NAV_ITEMS, NavItem, ROUTES

### Community 84 - "API Client"
Cohesion: 0.60
Nodes (3): ApiError, apiGet(), describeError()

### Community 85 - "README Observability"
Cohesion: 0.40
Nodes (5): Decisión 139 · Vigencia es el plan más reciente por desarrollador, Decisión 140 · Los descartes de la ACL no se persisten, Decisión 142 · La ruta literal gana a la variable de captura, Fase 17 · Observabilidad operativa de la planificación, Riesgo 69 · No se expone ninguna tasa de ocupación

### Community 86 - "Docs Schema & Timeline Prep"
Cohesion: 0.67
Nodes (3): Decisión 52 — `ddl-auto=update` mientras el plan sea un borrador, Decisión 54 — Preparación para el Timeline de React (Fase 6), Riesgo 33 — ddl-auto=update en todos los entornos

### Community 88 - "Persistence Concepts"
Cohesion: 1.00
Nodes (3): Fase 6 · Persistencia del plan, Idempotencia decidida por restricción de unicidad, PostgreSQL gestiondemanda (persistencia del plan)

## Knowledge Gaps
- **256 isolated node(s):** `co.com.coltefinanciera:gestion-demanda-backend`, `REPLANIFICACION_INMEDIATA`, `CAPACIDAD_COMPROMETIDA`, `SATURACION`, `UMBRAL_INCIDENTE_EXCEDIDO` (+251 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 410 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Gestión de Demanda` connect `README Concepts` to `Core Domain Concepts`, `Docs Phase 16 · Timeline View`, `GLPI REST Client`, `Domain Model & Work Blocks`, `Planning REST Controllers`, `Dashboard Components`, `README Declared Planning`, `SPA HTML Shell`, `Planning Service & Input`, `README Observability`, `Docker Compose Stack`, `Persistence Concepts`, `Metrics to Timeline Coupling`, `README Timeline Contracts`?**
  _High betweenness centrality (0.257) - this node is a cross-community bridge._
- **Why does `react` connect `UI Primitives (shadcn)` to `Docs Phase 16 · Timeline View`, `Dashboard Components`, `Frontend Test Infrastructure`, `Frontend Build Setup`, `Timeline Grid Rendering`, `App Shell & Timeline View`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `react-router-dom` connect `App Shell & Timeline View` to `Docs Phase 16 · Timeline View`, `UI Primitives (shadcn)`, `Frontend Test Infrastructure`, `Frontend Build Setup`, `Frontend Page Tests`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `co.com.coltefinanciera:gestion-demanda-backend`, `REPLANIFICACION_INMEDIATA`, `CAPACIDAD_COMPROMETIDA` to the rest of the system?**
  _256 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Endpoint Integration Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.05384615384615385 - nodes in this community are weakly interconnected._
- **Should `GLPI Ticket Contract & Mapping` be split into smaller, more focused modules?**
  _Cohesion score 0.05297876726448155 - nodes in this community are weakly interconnected._
- **Should `JPA Entities & Spring Data` be split into smaller, more focused modules?**
  _Cohesion score 0.06593406593406594 - nodes in this community are weakly interconnected._