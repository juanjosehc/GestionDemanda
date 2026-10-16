# Graph Report - GestionDemanda  (2026-10-16)

## Corpus Check
- 304 files · ~474,418 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 64 file(s) not represented in the graph (top: .csv 50, (none) 7, .properties 3)

## Summary
- 2816 nodes · 8541 edges · 155 communities (124 shown, 31 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 672 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `007738ec`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- PlanningTimelineEndpointsTest.java
- GlpiPlanningRequestFactoryTest
- jakarta.persistence.Entity
- JpaPlanSnapshotRepositoryTest
- PlanningMetadataChange
- PlanningPreview.test.tsx
- PlanningMetricsService
- PlanningOperationalAlertsEndpointsTest
- Incident
- WorkBlock
- JpaPlanSnapshotRepositoryTest.java
- PlanningEngineTest
- IncidentSeverity
- .request
- PlanningController.java
- ref_lib
- GlpiContractVerifier.java
- org.junit.jupiter.api.Test
- PlanningOperationalMetricsResponse
- Fase 6 — Persistencia del plan
- Fase 7 — Contexto de decisión
- ref_types
- package.json
- vitest
- .build
- GlpiModelDiscoveryTest.java
- list
- JpaPlanningMetadataRepositoryTest
- .verify
- .create
- Fase 9 — La capa anticorrupción: GLPI traducido antes de entrar
- PlanningTimelineEndpointsTest
- compilerOptions
- ref_hooks
- JpaRenegotiationRepository
- Fase 13 — PlanningMetadata: la planificación propia
- Calendar.tsx
- WebClientConfig.java
- Renegotiation
- components.json
- lib/timeline.ts
- GlpiClient.java
- GlpiRestPlanningSource
- Fase 12 — El modelo funcional real de GLPI
- compilerOptions
- JpaRescheduleLedgerTest
- PlanningService
- Fase 10 — El contrato de GLPI, declarado y comparable
- devDependencies
- Gestión de Demanda
- PlanningDeclarationService.java
- Renegotiations.test.tsx
- GlpiModelDiscoveryTest
- docker-compose service backend (Spring Boot)
- Fase 15 — El contrato de lectura para la Timeline
- planResult.ts
- org.junit.jupiter.api.DisplayName
- PlanningService.java
- Fase 2 — Núcleo de dominio
- PlanningMetricsEndpointsTest
- Fase 16 · La vista Timeline en React
- Override
- RescheduleLedger
- dependencies
- Tiempo hábil como unidad de medida
- PlanningPreview.tsx
- Fase 17 — Observabilidad operativa de la planificación
- GlpiTicket
- Fase 3 — Priorización por severidad
- planningMetrics.ts
- OperationalAlertType
- Incidents.test.tsx
- Fase 5 — Modelo temporal unificado
- .create
- resource.ts
- fixtures.ts
- GestionDemandaApplication.java
- Planning.test.tsx
- RenegotiationServiceTest
- .oxlintrc.json
- Fase 13 · La planificación propia
- frontend/index.html (shell HTML de la SPA)
- GestionDemanda Frontend Favicon (48x46 SVG)
- navigation.ts
- apiClient.ts
- TeamEndpointsTest
- Riesgo 33 — ddl-auto=update en todos los entornos
- tsconfig.json
- PostgreSQL gestiondemanda (persistencia del plan)
- env.d.ts
- glpi.ts
- co.com.coltefinanciera:gestion-demanda-backend
- PlanningMetadata
- Calendar.test.tsx
- Declarations.test.tsx
- PlanningMetricsDrilldownEndpointsTest
- TeamCatalogServiceTest
- PlanningDeclarationEndpointsTest
- org.springframework.data.jpa.repository.JpaRepository
- TeamCatalogService
- DeclarationFlow.test.tsx
- GlpiPlanningEndpointsTest
- lib/team.ts
- react
- org.junit.jupiter.api.BeforeEach
- Resources.test.tsx
- PlanningMetadataResponse
- Fase 4 — Tiempo hábil
- types/declarations.ts
- GlpiConnectionException
- DeclarationForm.tsx
- types/team.ts
- incidents.ts
- .paginate
- planning.ts
- capacity.ts
- useDeclarations.ts
- RelojMovil
- ResourceTimeline.tsx
- types/renegotiations.ts
- TimelineGrid.tsx
- .segments
- PlanningMetadataRepository
- scripts
- types/alerts.ts
- planningPreview.ts
- format.ts
- useRenegotiations.ts
- Planning.tsx
- PlanningMetadataRequest.java
- Alerts.test.tsx
- GlpiRestPlanningSourceTest.java
- ref_pages
- httpstatus
- Override
- source
- GlpiStatusCard.tsx
- Incidents.tsx
- Decisión 45 — El modelo persistente: Spring Data JPA, y qué se guarda de todo lo que el motor produce
- main.tsx
- lucide-react
- vite.config.ts
- Declarations.tsx
- DeclaredPlanningMetrics
- InMemoryRescheduleLedger
- RelojMovil
- Fase 17 · Observabilidad operativa de la planificación
- RenegotiationForm.tsx
- com.fasterxml.jackson.annotation.JsonIgnoreProperties
- Decisión 127 — La ACL deja de leer las horas y la fecha de GLPI
- lib/renegotiations.ts
- DeclarationTable.tsx
- utils.ts
- RelojDelSistema

## God Nodes (most connected - your core abstractions)
1. `PlanningMetadata` - 60 edges
2. `IncidentSeverity` - 54 edges
3. `Fase 6 — Persistencia del plan` - 45 edges
4. `PlanningService` - 44 edges
5. `JpaPlanSnapshotRepositoryTest` - 43 edges
6. `PlanningOperationalAlertsEndpointsTest` - 43 edges
7. `PlanningRules` - 42 edges
8. `Incident` - 42 edges
9. `RenegotiationServiceTest` - 41 edges
10. `PlanningEngineTest` - 40 edges

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
- **Las cuatro capas de la auditoría de un plan** — docs_decisiones_arquitectonicas_decision_45, docs_decisiones_arquitectonicas_decision_55, docs_decisiones_arquitectonicas_decision_66, docs_decisiones_arquitectonicas_decision_61, docs_decisiones_arquitectonicas_decision_72 [EXTRACTED 1.00]
- **La cadena que exige una respuesta de negocio sobre la planificación** — docs_decisiones_arquitectonicas_decision_116, docs_decisiones_arquitectonicas_decision_119, docs_decisiones_arquitectonicas_decision_120, docs_decisiones_arquitectonicas_decision_124_1, docs_decisiones_arquitectonicas_decision_124_2 [EXTRACTED 1.00]
- **Unificación de los dos relojes del sistema** — docs_decisiones_arquitectonicas_decision_37, docs_decisiones_arquitectonicas_decision_38, docs_decisiones_arquitectonicas_decision_39, docs_decisiones_arquitectonicas_decision_42 [EXTRACTED 1.00]
- **Despliegue local de los tres servicios en docker compose** — docker_compose_postgres_service, docker_compose_backend_service, docker_compose_frontend_service, docker_compose_postgres_data_volume, docker_compose_env_db_url [EXTRACTED 1.00]
- **Modelo temporal en tiempo hábil compartido por capacidad y OLA** — readme_fase_4_tiempo_habil, readme_fase_5_modelo_temporal_unificado, readme_calendario_laboral, readme_tiempo_habil, readme_capacidad_agenda_de_franjas [EXTRACTED 1.00]
- **La planificación declarada como fuente del plan y su medición** — readme_fase_13_planificacion_propia, readme_fase_14_acl_lee_planificacion_declarada, readme_fase_17_observabilidad_operativa, readme_planificacion_declarada, readme_decision_124_planificabilidad [EXTRACTED 1.00]
- **Favicon Visual Identity System (mark + glow + palette + P3 fills)** — frontend_public_favicon_lightning_bolt_mark, frontend_public_favicon_masked_gradient_glow, frontend_public_favicon_brand_palette, frontend_public_favicon_wide_gamut_p3_fill [INFERRED 0.75]

## Communities (155 total, 31 thin omitted)

### Community 0 - "PlanningTimelineEndpointsTest.java"
Cohesion: 0.24
Nodes (25): application_json, autowired, PlanningMetadataRequest, PlanningMetadataUpdateRequest, GlpiPlanningSource, PlanningMetadataHistoryJpaRepository, PlanningMetadataJpaRepository, RescheduleClaimJpaRepository (+17 more)

### Community 1 - "GlpiPlanningRequestFactoryTest"
Cohesion: 0.23
Nodes (4): GlpiPlanningRequestFactoryTest, PlanificabilidadDeclarada, SustitucionDeGlpi, org.junit.jupiter.api.Nested

### Community 2 - "jakarta.persistence.Entity"
Cohesion: 0.09
Nodes (32): accesslevel, PlanningConflictEntity, PlanningContextEntity, PlanningContextPolicyEntity, PlanningInputEntity, PlanningInputIncidentEntity, PlanningInputRequirementEntity, Override (+24 more)

### Community 3 - "JpaPlanSnapshotRepositoryTest"
Cohesion: 0.11
Nodes (10): Override, JpaPlanSnapshotRepository, PlanningContextPolicyJpaRepository, PlanningInputIncidentJpaRepository, PlanningInputRequirementJpaRepository, RescheduleEventJpaRepository, WorkAllocationJpaRepository, JpaPlanSnapshotRepositoryTest (+2 more)

### Community 4 - "PlanningMetadataChange"
Cohesion: 0.24
Nodes (6): PlanningMetadataField, COMMITTED_DATE, ESTIMATED_HOURS, PlanningMetadataChange, ChangeView, PlanningMetadataHistoryResponse

### Community 5 - "PlanningPreview.test.tsx"
Cohesion: 0.12
Nodes (11): ANA_PERSON, bucketOf(), BUCKETS, bucketsSum(), CARLOS_PERSON, DIANA_PERSON, errorResponse(), fetchMock (+3 more)

### Community 6 - "PlanningMetricsService"
Cohesion: 0.15
Nodes (6): DeclaredGapDetailResponse, DisplacedRequirementsResponse, Element, Plans, TimelineItem, PlanningMetricsService

### Community 8 - "Incident"
Cohesion: 0.09
Nodes (19): any, IncidentStatus, ABIERTO, EN_ATENCION, RESUELTO, RequirementStatus, EN_EJECUCION, FINALIZADO (+11 more)

### Community 9 - "WorkBlock"
Cohesion: 0.12
Nodes (9): CalendarProperties, TimeSlot, WorkBlock, BusinessTimeCalculator, CapacityBook, WorkingCalendar, TimelineCapacity, TimelineResource (+1 more)

### Community 10 - "JpaPlanSnapshotRepositoryTest.java"
Cohesion: 0.09
Nodes (29): AppliedRule, CAPACIDAD_COMPROMETIDA, CAPACIDAD_DIARIA_EXCEDIDA, REPLANIFICACION_INMEDIATA, SATURACION, UMBRAL_INCIDENTE_EXCEDIDO, DisplacementPolicy, WorkItemType (+21 more)

### Community 12 - "IncidentSeverity"
Cohesion: 0.12
Nodes (18): IncidentPolicyProperties, PlanningProperties, IncidentSeverity, ALTO, BAJO, MEDIO, PlanningContextSnapshot, IncidentPolicy (+10 more)

### Community 13 - ".request"
Cohesion: 0.15
Nodes (4): GlpiTicketMapperTest, MapeoIncidente, MapeoRequerimiento, TraduccionesDeDiagnostico

### Community 14 - "PlanningController.java"
Cohesion: 0.14
Nodes (21): GlpiController, PlanningController, PlanningMetadataController, RenegotiationController, TeamController, GlpiHealthResponse, PlanningFromGlpiRequest, RenegotiationHistoryResponse (+13 more)

### Community 15 - "ref_lib"
Cohesion: 0.05
Nodes (25): BottleneckTableProps, DisplacedRequirementsTableProps, INSTANT_FORMAT, SEVERITY, ICON_TONES, StatCardProps, StatTone, declarationSummary() (+17 more)

### Community 16 - "GlpiContractVerifier.java"
Cohesion: 0.11
Nodes (14): GlpiInvalidDataException, GlpiContractVerifier, Verdict, COMPATIBLE, DEGRADED, INCOMPATIBLE, com.fasterxml.jackson.databind.JsonNode, com.fasterxml.jackson.databind.ObjectMapper (+6 more)

### Community 17 - "org.junit.jupiter.api.Test"
Cohesion: 0.12
Nodes (3): PlanningEndpointsTest, PlanningMetadataEndpointsTest, org.junit.jupiter.api.Test

### Community 18 - "PlanningOperationalMetricsResponse"
Cohesion: 0.23
Nodes (7): Capacity, Current, Declared, DeclaredGap, DeveloperCurrent, PlanningOperationalMetricsResponse, OperationalAlertServiceTest

### Community 19 - "Fase 6 — Persistencia del plan"
Cohesion: 0.07
Nodes (28): Decisión 46 — Cuatro entidades planas: el agregado se arma con consultas, no con relaciones, Decisión 47 — La identidad: el plan la recibe del adaptador; el resto son claves sustitutas, Decisión 49 — Las pruebas corren contra H2, no contra PostgreSQL, Decisión 51 — `POST /plan` y `GET /{planId}` no devuelven lo mismo, Decisión 53 — Preparación para la integración con GLPI, Fase 6 — Persistencia del plan, Riesgo 1 — La URL de GLPI debe incluir /apirest.php, Riesgo 10 — El puerto 8090 está reservado por Windows (+20 more)

### Community 20 - "Fase 7 — Contexto de decisión"
Cohesion: 0.10
Nodes (28): Decisión 55 — `PlanningContextSnapshot`: la fotografía, no la configuración, Decisión 56 — Qué se persiste, dato por dato, Decisión 57 — El contexto entra por el puerto que ya existe, Decisión 58 — La jornada se deriva; las severidades se copian enteras, Decisión 59 — `ENGINE_VERSION` es una constante escrita a mano, Decisión 60 — `GET /api/planning/{planId}/context`, Decisión 61 — Estrategia de trazabilidad, Decisión 62 — Estrategia de auditoría (+20 more)

### Community 21 - "ref_types"
Cohesion: 0.06
Nodes (9): declaredGapQueryKey(), displacedQueryKey, planningMetricsQueryKey, useDeclaredGap(), SEVERITY_VARIANTS, DECLARABLE_STATUSES, DECLARATION_VARIANTS, ref_services (+1 more)

### Community 22 - "package.json"
Cohesion: 0.14
Nodes (13): name, private, type, version, jsdom, oxlint, tailwindcss, tw-animate-css (+5 more)

### Community 23 - "vitest"
Cohesion: 0.09
Nodes (7): fetchMock, plan, fetchMock, ref_test, @testing-library/jest-dom, @testing-library/react, vitest

### Community 24 - ".build"
Cohesion: 0.22
Nodes (10): ApiError, GlobalExceptionHandler, PlanningMetadataAlreadyExistsException, RenegotiationAlreadyExistsException, org.springframework.http.ResponseEntity, org.springframework.web.bind.annotation.ExceptionHandler, org.springframework.web.bind.annotation.RestControllerAdvice, org.springframework.web.bind.MethodArgumentNotValidException (+2 more)

### Community 25 - "GlpiModelDiscoveryTest.java"
Cohesion: 0.11
Nodes (15): GlpiClient, GlpiProperties, GlpiConnectivityService, Captura, GlpiContractValidationTest, GlpiConnectivityServiceTest, files, httpheaders (+7 more)

### Community 26 - "list"
Cohesion: 0.08
Nodes (22): assertthat, assertthatthrownby, InputSource, GLPI, HTTP, RenegotiationStatus, ACORDADA, PENDIENTE_DE_ACUERDO (+14 more)

### Community 28 - ".verify"
Cohesion: 0.18
Nodes (3): GlpiSearchPage, GlpiRestPlanningSourceTest, Override

### Community 30 - "Fase 9 — La capa anticorrupción: GLPI traducido antes de entrar"
Cohesion: 0.13
Nodes (19): Decisión 78 — Qué objetos espera el dominio, Decisión 79 — Por qué había que construir la ACL desde cero, Decisión 81 — Mapeo de prioridad → severidad, Decisión 82 — Mapeo de tipo y estado: un ticket, dos objetos del dominio, Decisión 83 — Unidades y fechas, Decisión 84 — Descartar el ticket, no la planificación, Decisión 85 — Cuatro clases, cuatro códigos, Decisión 86 — La procedencia de la entrada (+11 more)

### Community 32 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+13 more)

### Community 33 - "ref_hooks"
Cohesion: 0.10
Nodes (9): RenegotiationHistoryProps, AlertFilters, Alerts(), filterAlerts(), NO_FILTERS, optionsOf(), Renegotiations(), ENV_VARIABLES (+1 more)

### Community 34 - "JpaRenegotiationRepository"
Cohesion: 0.20
Nodes (7): Override, JpaRenegotiationRepository, RenegotiationJpaRepository, lockmodetype, org.springframework.data.jpa.repository.Lock, org.springframework.data.jpa.repository.Query, param

### Community 35 - "Fase 13 — PlanningMetadata: la planificación propia"
Cohesion: 0.20
Nodes (16): Decisión 116 — Decisión final (Fase 12), Decisión 117 — GLPI es la fuente del trabajo; la planificación es de este sistema, Decisión 121 — La trazabilidad: qué se guarda en cada cambio, Decisión 122 — El borrado se permite y queda registrado, Decisión 123 — El compromiso vencido se acepta y se marca, Decisión 124 — La costura por la que entrará la ACL, Decisión 124.1 — La regla de planificabilidad: hacen falta los dos valores, Decisión 124.2 — La estimación y el compromiso declarados sustituyen a los de GLPI (+8 more)

### Community 36 - "Calendar.tsx"
Cohesion: 0.11
Nodes (17): Decisión 134 — La vista consume el contrato, no lo reinterpreta, Decisión 135 — CSS Grid propio, y por qué la librería puede esperar, Decisión 136 — La ruta con reserva a campo, Decisión 137 — Solo lectura, filtros en memoria, Fase 16 — La vista Timeline en React, Riesgo 6 — Sin pruebas de frontend, Riesgo 66 — Los bloques se rotulan con el workItemId, Riesgo 67 — El eje horario se deriva de los tramos, no del calendario (+9 more)

### Community 37 - "WebClientConfig.java"
Cohesion: 0.20
Nodes (10): WebClientConfig, channeloption, clientauth, Decisión 77 — Qué conocía el sistema de GLPI, httpclient, jdksslcontext, org.springframework.boot.ssl.SslBundles, org.springframework.context.annotation.Configuration (+2 more)

### Community 38 - "Renegotiation"
Cohesion: 0.10
Nodes (7): DomainPreconditions, Renegotiation, RenegotiationChange, RenegotiationRepository, ChangeView, InMemoryRenegotiationRepository, Override

### Community 39 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 40 - "lib/timeline.ts"
Cohesion: 0.14
Nodes (14): DAY_FORMAT, DEFAULT_AXIS, EMPTY_FILTERS, formatDay(), formatTime(), hourAxis, HOURS_FORMAT, itemDate() (+6 more)

### Community 41 - "GlpiClient.java"
Cohesion: 0.18
Nodes (10): GlpiItemNotFoundException, Decisión 1 — Aislamiento de GLPI, Decisión 10 — Timeline sin librería, Decisión 14 — Los tokens nunca se registran en el log, Decisión 2 — `connected` y `authenticated` como campos separados, Decisión 3 — WebClient en una aplicación servlet, Decisión 6 — El endpoint de salud nunca falla, Decisión 80 — Dónde vive la capa anticorrupción (+2 more)

### Community 43 - "Fase 12 — El modelo funcional real de GLPI"
Cohesion: 0.13
Nodes (16): Decisión 104 — Qué devolvió la instancia, Decisión 106 — Los siete hallazgos, Decisión 107 — Qué habría que cambiar en el adaptador, y por qué no se cambió, Decisión 108 — Decisión recomendada (Fase 11), Decisión 109 — El instrumento y el método, Decisión 110 — Las siete preguntas del brief, respondidas, Decisión 111 — La matriz funcional, Decisión 114 — Limitaciones encontradas (+8 more)

### Community 44 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 45 - "JpaRescheduleLedgerTest"
Cohesion: 0.25
Nodes (4): Override, JpaRescheduleLedger, JpaRescheduleLedgerTest, JpaRescheduleLedgerTest.RelojDelSistema

### Community 46 - "PlanningService"
Cohesion: 0.08
Nodes (18): InputProvenance, PlanningInputSnapshot, PlanSnapshot, PlanSnapshotRepository, PlanningInputResponse, PlanningPlanResponse, DeveloperInput, PlanningSimulationRequest (+10 more)

### Community 47 - "Fase 10 — El contrato de GLPI, declarado y comparable"
Cohesion: 0.17
Nodes (15): Decisión 100 — Estrategia ante un cambio de GLPI, Decisión 101 — Respuesta parcial: qué se usa, qué se ignora, qué se degrada, Decisión 102 — Plan de validación contra la instancia real, Decisión 103 — La cadena de confianza del cliente de GLPI, Decisión 91 — El inventario de suposiciones, Decisión 93 — Qué campos son críticos para el motor, Decisión 95 — La matriz del contrato, campo por campo, Decisión 96 — `GlpiContract`: el contrato como dato (+7 more)

### Community 48 - "devDependencies"
Cohesion: 0.13
Nodes (15): devDependencies, jsdom, oxlint, tailwindcss, @tailwindcss/vite, @testing-library/jest-dom, @testing-library/react, tw-animate-css (+7 more)

### Community 49 - "Gestión de Demanda"
Cohesion: 0.18
Nodes (15): Arquitectura en capas con dependencia hacia el dominio, Capa anticorrupción (GLPI traducido en un solo sitio), Códigos de error de la API (GLPI_UNAVAILABLE, PLAN_NOT_FOUND, ...), El contrato de GLPI es un dato, no código repartido, docs/decisiones-arquitectonicas.md, POST /api/planning/plan, POST /api/planning/simulate, Fase 10 · Contrato de GLPI declarado y comparable (+7 more)

### Community 50 - "PlanningDeclarationService.java"
Cohesion: 0.10
Nodes (21): DeclarationItem, DeveloperDeclarationsResponse, DeveloperView, DiscardView, Source, DiscardedView, PlanningFromGlpiResponse, GlpiDeveloperNotFoundException (+13 more)

### Community 51 - "Renegotiations.test.tsx"
Cohesion: 0.11
Nodes (15): abrir(), at(), detail(), escribir(), esperarAcuerdo(), fetchMock, guardar(), history() (+7 more)

### Community 53 - "docker-compose service backend (Spring Boot)"
Cohesion: 0.19
Nodes (14): docker-compose service backend (Spring Boot), DB_NAME, DB_PASSWORD, DB_URL, DB_USER, GLPI_APP_TOKEN, GLPI_TIMEOUT, GLPI_URL (+6 more)

### Community 54 - "Fase 15 — El contrato de lectura para la Timeline"
Cohesion: 0.21
Nodes (12): Decisión 128 — El contrato de la Timeline: una proyección de lectura, Decisión 129 — La planificación y la visualización se separan aquí, Decisión 130 — La estrategia de capacidad, Decisión 131 — El estado de planificación: dos valores, y los dos que se rechazaron, Decisión 132 — Preparación para React, Decisión 133 — Preparación para Resource Planning, Decisión 44 — Preparación para el Timeline de React (Fase 5), Fase 15 — El contrato de lectura para la Timeline (+4 more)

### Community 55 - "planResult.ts"
Cohesion: 0.20
Nodes (8): firstOf(), ORDER, PlanElement, planOutcome, PlanSources, PlanVerdict, PlanVerdictToken, sumBy()

### Community 56 - "org.junit.jupiter.api.DisplayName"
Cohesion: 0.14
Nodes (6): Report, GlpiContractVerifierTest, GlpiPriorityMapperTest, org.junit.jupiter.api.DisplayName, org.junit.jupiter.params.ParameterizedTest, org.junit.jupiter.params.provider.CsvSource

### Community 57 - "PlanningService.java"
Cohesion: 0.11
Nodes (25): arraylist, arrays, TimelineItemStatus, DESPLAZADO, PLANIFICADO, Developer, PlanningRequest, PlanReference (+17 more)

### Community 58 - "Fase 2 — Núcleo de dominio"
Cohesion: 0.18
Nodes (11): Decisión 15 — El dominio es Java puro, Decisión 16 — El motor no es un `@Service`, Decisión 17 — Las reglas son un objeto de dominio, no configuración de Spring, Decisión 18 — Orden de resolución: primero incidentes, después requerimientos, Decisión 19 — Idempotencia: reclamo atómico detrás de una interfaz, Decisión 20 — Auditoría obligatoria y atribución de la causa, Decisión 22 — Restricción de modelo: un requerimiento cabe completo en una jornada, Decisión 42 — Se levanta la restricción de la decisión 22: un requerimiento se reparte (+3 more)

### Community 60 - "Fase 16 · La vista Timeline en React"
Cohesion: 0.22
Nodes (11): Decisión 135 · CSS Grid y cero dependencias para la Timeline, GET /api/planning/metrics, GET /api/planning/{planId}/timeline, Fase 15 · El contrato de lectura para la Timeline, Fase 16 · La vista Timeline en React, Fotografía operativa de la planificación, Riesgo 66 · El plan no guarda títulos, Riesgo 67 · La jornada congelada no viaja en la respuesta (+3 more)

### Community 61 - "Override"
Cohesion: 0.27
Nodes (4): INMEDIATA, POR_CAPACIDAD, POR_SATURACION, Override

### Community 62 - "RescheduleLedger"
Cohesion: 0.25
Nodes (3): PlanningConfig, RescheduleLedger, org.springframework.context.annotation.Bean

### Community 63 - "dependencies"
Cohesion: 0.20
Nodes (10): dependencies, class-variance-authority, clsx, lucide-react, @radix-ui/react-slot, react, react-dom, react-router-dom (+2 more)

### Community 64 - "Tiempo hábil como unidad de medida"
Cohesion: 0.22
Nodes (10): Calendario laboral, Capacidad como agenda de franjas al minuto, Fase 2 · Núcleo de dominio, Fase 3 · Priorización por severidad, Fase 4 · Tiempo hábil, Fase 5 · Modelo temporal unificado, Incidente sin severidad como dato legado, OLA · Acuerdo de nivel operativo por severidad (+2 more)

### Community 65 - "PlanningPreview.tsx"
Cohesion: 0.08
Nodes (14): queryClient, alertsQueryKey, glpiHealthQueryKey, planInputQueryKey(), planSnapshotQueryKey(), usePlanInput(), usePlanSnapshot(), teamQueryKey (+6 more)

### Community 66 - "Fase 17 — Observabilidad operativa de la planificación"
Cohesion: 0.33
Nodes (8): Decisión 139 — La vigencia es el plan más reciente por `created_at`, Decisión 141 — La trazabilidad viaja en el payload, no solo en el javadoc, Decisión 142 — `metrics` convive con `{planId}` por especificidad de patrón, y por eso se prueba, Fase 17 — Observabilidad operativa de la planificación, Riesgo 70 — plans.generated cuenta ejecuciones, no planes distintos, Riesgo 71 — Carga completa de plan_snapshot y cuatro COUNT(*) sin índice, Riesgo 72 — Un plan vigente sin contexto o sin entrada tumba la foto entera, Riesgo 73 — El desempate de vigencia es arbitrario

### Community 67 - "GlpiTicket"
Cohesion: 0.05
Nodes (27): DeclarationStatus, NO_TRADUCIBLE, PLANIFICABLE, SIN_COMPROMISO, SIN_DECLARACION, SIN_ESTIMACION, Field, GlpiContract (+19 more)

### Community 68 - "Fase 3 — Priorización por severidad"
Cohesion: 0.22
Nodes (9): Decisión 24 — `IncidentSeverity` entra al modelo, y no tener severidad es un estado válido, Decisión 25 — `IncidentPolicy`: la OLA por severidad, donde los objetivos no son volumen de trabajo, Decisión 26 — `DisplacementPolicy`: cómo se tradujo cada regla de negocio, Decisión 27 — `incidentThresholdHours` se conserva, con fecha de retiro, Decisión 28 — La auditoría copia la severidad; el motivo se deriva en la frontera, Decisión 29 — La simulación acepta severidad y devuelve la OLA vigente, Fase 3 — Priorización por severidad, Riesgo 16 — Los incidentes sin severidad pueden quedarse indefinidamente (+1 more)

### Community 69 - "planningMetrics.ts"
Cohesion: 0.11
Nodes (19): CurrentMetrics, DeclaredGap, DeclaredGapDetailResponse, DeclaredMetrics, DeveloperPlanningMetrics, DISPLACED_TOKEN, DisplacedRequirement, DisplacedRequirementsResponse (+11 more)

### Community 70 - "OperationalAlertType"
Cohesion: 0.11
Nodes (16): AlertSeverity, CRITICAL, INFO, WARNING, OperationalAlertType, CAPACIDAD_AGOTADA, CAPACIDAD_NEGATIVA, METADATA_INCOMPLETA (+8 more)

### Community 71 - "Incidents.test.tsx"
Cohesion: 0.11
Nodes (13): byDeveloper(), ELENA_PERSON, fetchMock, INCIDENTE, okResponse(), orderOf(), REQUERIMIENTO, requestedDeclarations() (+5 more)

### Community 72 - "Fase 5 — Modelo temporal unificado"
Cohesion: 0.29
Nodes (8): Decisión 37 — La capacidad es una agenda de franjas, no un contador de horas, Decisión 38 — Un solo recorrido del calendario para la OLA y para la capacidad, Decisión 39 — Desaparece la planificación por día, Decisión 41 — La reserva de prioridad reclama la jornada, no la consume, Decisión 43 — Preparación para la Fase 6 (persistencia), Fase 5 — Modelo temporal unificado, Riesgo 21 — El motor consume por días completos; la OLA se calcula al minuto, Riesgo 22 — DayBook.consumeGreedy devolvía el día del reporte aunque no fuera laborable

### Community 73 - ".create"
Cohesion: 0.15
Nodes (5): RenegotiationRequest, RenegotiationResponse, RenegotiationUpdateRequest, RenegotiationNotFoundException, RenegotiationService

### Community 74 - "resource.ts"
Cohesion: 0.29
Nodes (6): PlanningItem, Priority, Resource, ResourceKind, TimelineWindow, WorkItemSource

### Community 75 - "fixtures.ts"
Cohesion: 0.07
Nodes (21): ACORDADO_ID, DECLARATION_DEVELOPER_ID, declarationItemFixture(), declarationsFixture(), DEVELOPER_GLPI_ID, DEVELOPER_ID, EMPTY_DEVELOPER_ID, FULL_DEVELOPER_GLPI_ID (+13 more)

### Community 76 - "GestionDemandaApplication.java"
Cohesion: 0.47
Nodes (4): GestionDemandaApplication, org.springframework.boot.autoconfigure.SpringBootApplication, org.springframework.boot.context.properties.ConfigurationPropertiesScan, springapplication

### Community 77 - "Planning.test.tsx"
Cohesion: 0.15
Nodes (8): escribirTecnico(), fetchMock, generar(), okResponse(), queue(), Routes, serve(), Served

### Community 78 - "RenegotiationServiceTest"
Cohesion: 0.28
Nodes (4): Item, RenegotiationsResponse, Summary, RenegotiationServiceTest

### Community 79 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 80 - "Fase 13 · La planificación propia"
Cohesion: 0.40
Nodes (6): Decisión 124.2 · Lo declarado sustituye lo registrado, Decisión 124 · Planificable solo con estimación y compromiso declarados, POST/PUT/GET /api/planning-metadata, Fase 13 · La planificación propia, Fase 14 · La capa anticorrupción lee la planificación declarada, Planificación declarada (PlanningMetadata)

### Community 81 - "frontend/index.html (shell HTML de la SPA)"
Cohesion: 0.40
Nodes (5): /favicon.svg, frontend/index.html (shell HTML de la SPA), /src/main.tsx (entrada del bundle Vite), div#root (punto de montaje de React), Frontend SPA (React 19 / TypeScript / Vite / Tailwind v4)

### Community 82 - "GestionDemanda Frontend Favicon (48x46 SVG)"
Cohesion: 0.90
Nodes (5): GestionDemanda Frontend Favicon (48x46 SVG), Favicon Brand Palette (violet 863bff / deep violet 7e14ff / cyan 47bfff / lavender ede6ff), Lightning Bolt Zigzag Logo Mark, Masked Gaussian-Blur Glow Composition, Display-P3 Wide-Gamut Fill Declarations

### Community 83 - "navigation.ts"
Cohesion: 0.15
Nodes (9): ALERT_DETAIL_TOKENS, alertDetailPath(), DeclarationContext, declarationContextOf(), metricPath(), NAV_ITEMS, NavItem, ROUTES (+1 more)

### Community 84 - "apiClient.ts"
Cohesion: 0.43
Nodes (6): ApiError, apiGet(), apiPost(), apiPut(), call(), describeError()

### Community 86 - "Riesgo 33 — ddl-auto=update en todos los entornos"
Cohesion: 0.67
Nodes (3): Decisión 52 — `ddl-auto=update` mientras el plan sea un borrador, Decisión 54 — Preparación para el Timeline de React (Fase 6), Riesgo 33 — ddl-auto=update en todos los entornos

### Community 88 - "PostgreSQL gestiondemanda (persistencia del plan)"
Cohesion: 1.00
Nodes (3): Fase 6 · Persistencia del plan, Idempotencia decidida por restricción de unicidad, PostgreSQL gestiondemanda (persistencia del plan)

### Community 92 - "PlanningMetadata"
Cohesion: 0.16
Nodes (3): PlanningMetadata, InMemoryPlanningMetadataRepository, Override

### Community 93 - "Calendar.test.tsx"
Cohesion: 0.24
Nodes (7): calendar(), calendarRoutes(), errorResponse(), fetchMock, okResponse(), serve(), ServeOptions

### Community 94 - "Declarations.test.tsx"
Cohesion: 0.09
Nodes (15): abrir(), ANA, escribir(), EXCEPTION, fetchMock, field(), okResponse(), OUTSIDE (+7 more)

### Community 97 - "PlanningDeclarationEndpointsTest"
Cohesion: 0.21
Nodes (6): PlanningDeclarationEndpointsTest, co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicket, co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataHistoryJpaRepository, co.com.coltefinanciera.gestiondemanda.persistence.PlanningMetadataJpaRepository, co.com.coltefinanciera.gestiondemanda.persistence.PlanSnapshotJpaRepository, co.com.coltefinanciera.gestiondemanda.service.PlanningMetadataService

### Community 98 - "org.springframework.data.jpa.repository.JpaRepository"
Cohesion: 0.19
Nodes (7): PlanningConflictJpaRepository, PlanningContextJpaRepository, PlanningInputJpaRepository, PlanSnapshotJpaRepository, RenegotiationHistoryJpaRepository, WorkBlockJpaRepository, org.springframework.data.jpa.repository.JpaRepository

### Community 99 - "TeamCatalogService"
Cohesion: 0.16
Nodes (10): DeclaredException, TeamProperties, Glpi, Person, Source, TeamCatalogResponse, GlpiUser, Reading (+2 more)

### Community 100 - "DeclarationFlow.test.tsx"
Cohesion: 0.12
Nodes (14): ANA_PERSON, CARLOS_PERSON, declararDesde(), ELENA_PERSON, esperarFila(), fetchMock, listaDeTrabajo(), okResponse() (+6 more)

### Community 101 - "GlpiPlanningEndpointsTest"
Cohesion: 0.26
Nodes (3): GlpiTicket, GlpiUser, GlpiPlanningEndpointsTest

### Community 102 - "lib/team.ts"
Cohesion: 0.18
Nodes (9): countPending(), declarationKeysFor(), keysOf(), SORT_ACCESSORS, SortDirection, TeamMember, TeamMemberSource, TeamSortKey (+1 more)

### Community 103 - "react"
Cohesion: 0.07
Nodes (12): Badge(), BadgeVariant, badgeVariants, Button(), ButtonProps, buttonVariants, DECLARED, DISPLACED (+4 more)

### Community 104 - "org.junit.jupiter.api.BeforeEach"
Cohesion: 0.14
Nodes (8): anystring, GlpiUnreachableException, intstream, never, org.junit.jupiter.api.BeforeEach, propagation, verify, when

### Community 105 - "Resources.test.tsx"
Cohesion: 0.13
Nodes (10): cellOf(), declarationResponse(), fetchMock, okResponse(), orderOf(), rowOf(), serve(), Served (+2 more)

### Community 107 - "Fase 4 — Tiempo hábil"
Cohesion: 0.25
Nodes (8): Decisión 21 — Puntos de extensión previstos, no implementados, Decisión 31 — `WorkingCalendar` es el calendario, y la jornada se deriva de él, Decisión 32 — La aritmética de tiempo hábil se hace en minutos, no en horas, Decisión 34 — El bloque por defecto es 09:00–17:00 porque son exactamente ocho horas, Decisión 35 — `end-time` es opcional para no romper `PLANNING_WORKING_HOURS_PER_DAY`, Decisión 36 — Tres objetos nuevos; `WorkingDay` y `Holiday`, descartados, Fase 4 — Tiempo hábil, Riesgo 12 — La capacidad es uniforme: 8 h al día, todos los días

### Community 108 - "types/declarations.ts"
Cohesion: 0.22
Nodes (8): DeclarationCreateRequest, DeclarationItem, DeclarationStatus, DeclarationUpdateRequest, DeveloperDeclarationsResponse, Discard, PlanningMetadata, WorkItemType

### Community 109 - "GlpiConnectionException"
Cohesion: 0.22
Nodes (3): GlpiAuthenticationException, GlpiConnectionException, org.springframework.web.reactive.function.client.WebClientResponseException

### Community 110 - "DeclarationForm.tsx"
Cohesion: 0.32
Nodes (6): DeclarationFormProps, Fields(), submit(), FieldsProps, initialHours(), valuesOf()

### Community 111 - "types/team.ts"
Cohesion: 0.33
Nodes (5): TeamCatalogResponse, TeamCatalogSource, TeamGlpiStatus, TeamPerson, TeamPersonSource

### Community 112 - "incidents.ts"
Cohesion: 0.11
Nodes (17): ANY, declarationBreakdown, declarationSideOf(), DECLARED, filterIncidents(), FINAL_STATUSES, IncidentFilters, IncidentRow (+9 more)

### Community 114 - "planning.ts"
Cohesion: 0.22
Nodes (8): DiscardedTicket, GeneratedPlan, PlanConflict, PlanInputIncident, PlanInputRequirement, PlanningFromGlpiResponse, PlanningInputResponse, PlanSnapshotResponse

### Community 116 - "useDeclarations.ts"
Cohesion: 0.39
Nodes (7): declarationQueryKey(), declarationsQueryKey(), SaveDeclarationInput, useDeclaration(), useDeclarations(), useSaveDeclaration(), useTeamDeclarations()

### Community 118 - "ResourceTimeline.tsx"
Cohesion: 0.20
Nodes (6): EmptyStateProps, FilterProps, ResourceTimelineProps, SEVERITY_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS

### Community 119 - "types/renegotiations.ts"
Cohesion: 0.20
Nodes (9): Renegotiation, RenegotiationChange, RenegotiationCreateRequest, RenegotiationHistoryResponse, RenegotiationItem, RenegotiationsResponse, RenegotiationStatus, RenegotiationSummary (+1 more)

### Community 120 - "TimelineGrid.tsx"
Cohesion: 0.20
Nodes (10): Block(), BlockProps, describe(), nonWorkingDays(), SEVERITY, STATUS, TimelineGrid(), TimelineGridProps (+2 more)

### Community 122 - "PlanningMetadataRepository"
Cohesion: 0.15
Nodes (7): DeclaredGap, METADATA_INCOMPLETA, SIN_COMPROMISO, SIN_ESTIMACION, PlanningMetadataRepository, JpaPlanningMetadataRepository, collection

### Community 123 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, preview, test, typecheck

### Community 124 - "types/alerts.ts"
Cohesion: 0.50
Nodes (3): AlertSeverity, OperationalAlert, OperationalAlertResponse

### Community 125 - "planningPreview.ts"
Cohesion: 0.33
Nodes (7): declarableOf(), emptyCounts(), entrySummary, personEntries(), PersonEntry, PlanVerdict, statusCounts

### Community 127 - "useRenegotiations.ts"
Cohesion: 0.33
Nodes (7): renegotiationHistoryQueryKey(), renegotiationQueryKey(), renegotiationsQueryKey, SaveRenegotiationInput, useRenegotiation(), useRenegotiationHistory(), useSaveRenegotiation()

### Community 128 - "Planning.tsx"
Cohesion: 0.40
Nodes (3): Planning(), run(), submit()

### Community 129 - "PlanningMetadataRequest.java"
Cohesion: 0.29
Nodes (6): decimalmax, decimalmin, jakarta.validation.constraints.AssertTrue, notblank, notnull, size

### Community 130 - "Alerts.test.tsx"
Cohesion: 0.25
Nodes (3): alertRows(), fetchMock, typesOf()

### Community 131 - "GlpiRestPlanningSourceTest.java"
Cohesion: 0.12
Nodes (17): argumentcaptor, bifunction, co.com.coltefinanciera.gestiondemanda.client.GlpiClient, co.com.coltefinanciera.gestiondemanda.config.GlpiProperties, decodingexception, Decisión 74 — Preparación para la integración con GLPI (Fase 8), eq, hashmap (+9 more)

### Community 136 - "GlpiStatusCard.tsx"
Cohesion: 0.38
Nodes (5): formatTimestamp(), GlpiStatusCard(), resolveStatus(), STATUS, StatusKey

### Community 137 - "Incidents.tsx"
Cohesion: 0.43
Nodes (4): filtersExcludeNothing(), Incidents(), optionsOf(), personOptions()

### Community 138 - "Decisión 45 — El modelo persistente: Spring Data JPA, y qué se guarda de todo lo que el motor produce"
Cohesion: 0.33
Nodes (6): Decisión 45 — El modelo persistente: Spring Data JPA, y qué se guarda de todo lo que el motor produce, Decisión 48 — El registro de idempotencia deja de vivir en memoria (cierra el riesgo 11), Decisión 50 — Guardar no forma parte de calcular, Riesgo 11 — El registro de idempotencia se pierde al reiniciar, Riesgo 32 — Un plan guardado no se puede reproducir: guarda el resultado, no las entradas, Riesgo 35 — El registro de idempotencia no expira: crece sin límite

### Community 139 - "main.tsx"
Cohesion: 0.40
Nodes (4): container, ref_app, ref_index_css, react-dom

### Community 140 - "lucide-react"
Cohesion: 0.15
Nodes (12): DeclaredGapTable(), DeclaredGapTableProps, formatInstant(), INSTANT_FORMAT, valor(), alertsOf(), COLUMNS, TeamTable() (+4 more)

### Community 141 - "vite.config.ts"
Cohesion: 0.50
Nodes (3): ref_node_path, @tailwindcss/vite, @vitejs/plugin-react

### Community 142 - "Declarations.tsx"
Cohesion: 0.29
Nodes (3): Declarations(), DeveloperPicker(), personLabel()

### Community 146 - "Fase 17 · Observabilidad operativa de la planificación"
Cohesion: 0.40
Nodes (5): Decisión 139 · Vigencia es el plan más reciente por desarrollador, Decisión 140 · Los descartes de la ACL no se persisten, Decisión 142 · La ruta literal gana a la variable de captura, Fase 17 · Observabilidad operativa de la planificación, Riesgo 69 · No se expone ninguna tasa de ocupación

### Community 147 - "RenegotiationForm.tsx"
Cohesion: 0.33
Nodes (5): Fields(), submit(), FieldsProps, RenegotiationFormProps, valuesOf()

### Community 148 - "com.fasterxml.jackson.annotation.JsonIgnoreProperties"
Cohesion: 0.60
Nodes (3): GlpiSessionResponse, com.fasterxml.jackson.annotation.JsonIgnoreProperties, jsonproperty

### Community 149 - "Decisión 127 — La ACL deja de leer las horas y la fecha de GLPI"
Cohesion: 0.60
Nodes (5): Decisión 126 — Decisión final (Fase 13), Decisión 127 — La ACL deja de leer las horas y la fecha de GLPI, Decisión 140 — Los descartes se miden sobre el estado declarado, no sobre el historial de la ACL, Fase 14 — La ACL lee la planificación declarada, Riesgo 62 — Un descarte ya no es un ticket

### Community 150 - "lib/renegotiations.ts"
Cohesion: 0.33
Nodes (4): ANY_STATUS, FILTER_OPTIONS, RenegotiationFilter, STATUS_VARIANTS

### Community 151 - "DeclarationTable.tsx"
Cohesion: 0.67
Nodes (3): declarationSummary(), DeclarationTable(), DeclarationTableProps

## Knowledge Gaps
- **427 isolated node(s):** `VERDICT_VARIANTS`, `PlanResultSummaryProps`, `PlanTraceabilityProps`, `ZOOM`, `STATUS` (+422 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 760 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **31 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Gestión de Demanda` connect `Gestión de Demanda` to `Tiempo hábil como unidad de medida`, `GlpiRestPlanningSourceTest.java`, `Calendar.tsx`, `JpaPlanSnapshotRepositoryTest.java`, `PlanningController.java`, `ref_lib`, `Fase 13 · La planificación propia`, `frontend/index.html (shell HTML de la SPA)`, `Fase 17 · Observabilidad operativa de la planificación`, `docker-compose service backend (Spring Boot)`, `PostgreSQL gestiondemanda (persistencia del plan)`, `PlanningService.java`, `Fase 16 · La vista Timeline en React`?**
  _High betweenness centrality (0.364) - this node is a cross-community bridge._
- **Why does `react` connect `react` to `Planning.tsx`, `ref_hooks`, `PlanningPreview.tsx`, `Calendar.tsx`, `GlpiStatusCard.tsx`, `Incidents.tsx`, `main.tsx`, `lucide-react`, `DeclarationForm.tsx`, `ref_lib`, `Declarations.tsx`, `RenegotiationForm.tsx`, `vitest`, `package.json`, `ResourceTimeline.tsx`, `TimelineGrid.tsx`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `react-router-dom` connect `ref_lib` to `Planning.tsx`, `PlanningPreview.tsx`, `ref_hooks`, `Calendar.tsx`, `DeclarationFlow.test.tsx`, `ref_pages`, `react`, `Incidents.tsx`, `lucide-react`, `Declarations.tsx`, `vitest`, `ResourceTimeline.tsx`, `package.json`, `Calendar.test.tsx`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `VERDICT_VARIANTS`, `PlanResultSummaryProps`, `PlanTraceabilityProps` to the rest of the system?**
  _427 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `jakarta.persistence.Entity` be split into smaller, more focused modules?**
  _Cohesion score 0.08925673482635509 - nodes in this community are weakly interconnected._
- **Should `JpaPlanSnapshotRepositoryTest` be split into smaller, more focused modules?**
  _Cohesion score 0.1110576923076923 - nodes in this community are weakly interconnected._
- **Should `PlanningPreview.test.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.12280701754385964 - nodes in this community are weakly interconnected._