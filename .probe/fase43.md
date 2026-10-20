
# Fase 43 — Validación del Timeline con datos reales

## Qué se hizo, en una frase

Esta fase **no cambia el producto**: audita, con evidencia y sin suposiciones, qué parte del Timeline que se ve hoy nace de GLPI y qué parte es un artefacto de demostración, y responde si el flujo real —GLPI entrega los tickets, alguien declara, el motor planifica, el Timeline pinta— puede operar ya. **No se borró ni se modificó ningún dato. `PlanningEngine`, las reglas de capacidad, los desplazamientos, las renegociaciones, la integración con GLPI y la persistencia no tienen una línea de diferencia.**

## 1. El inventario de planes, medido en la base

`plan_snapshot` tiene **21 filas** y **8 identificadores de técnico**. Dos clases, separadas por el identificador y no por una bandera: **12 planes de cinco identidades reales** y **9 planes de tres identificadores de demostración**.

| Tipo | Identificador | Planes | Primer plan | Último plan | Tramos | Conflictos | Desplazamientos |
|---|---|---:|---|---|---:|---:|---:|
| Real | `13` | 2 | 2026-10-13 | 2026-10-19 | 2 | 0 | 0 |
| Real | `160` | 4 | 2026-10-16 | 2026-10-19 | 0 | 0 | 0 |
| Real | `17` | 2 | 2026-10-16 | 2026-10-19 | 1 | 0 | 0 |
| Real | `296` | 2 | 2026-10-13 | 2026-10-16 | 0 | 0 | 0 |
| Real | `AbraAran` | 2 | 2026-10-16 | 2026-10-19 | 3 | 0 | 1 |
| Demo | `demo-f38` | 5 | 2026-10-16 12:35 | 2026-10-16 12:38 | 15 | 4 | 7 |
| Demo | `demo-f39` | 2 | 2026-10-16 14:54 | 2026-10-16 14:54 | 6 | 2 | 0 |
| Demo | `demo-f39b` | 2 | 2026-10-16 14:56 | 2026-10-16 14:56 | 8 | 0 | 3 |

Los tramos de esta tabla cuentan **todos los planes** de cada identidad, no solo el vigente. Los identificadores de demostración son exactamente tres y no hay ningún otro que se les parezca: la consulta sobre `developer_id` devuelve `demo-f38`, `demo-f39` y `demo-f39b`, y nada más con prefijo `demo`, `test` o `e2e`.

**De dónde salió cada plan.** `planning_input.source` lo dice sin ambigüedad: `GLPI` cuando el plan se calculó con la extracción real —con fecha y versión del adaptador— y `HTTP` cuando la entrada llegó escrita en el cuerpo de `POST /api/planning`. **Los cinco planes `GLPI` de identidades reales están vacíos**: cero incidentes, cero requerimientos, cero tramos. Los tres planes vigentes con tramos de personas reales son `HTTP`, es decir, alimentados a mano. Ese es el hecho central de esta auditoría.

| Plan vigente | Fuente | Incidentes de entrada | Requerimientos de entrada | Tramos |
|---|---|---:|---:|---:|
| `13` | HTTP | 1 (`INC-13-1`, sintético) | 0 | 2 |
| `160` | HTTP | 0 | 0 | 0 |
| `17` | HTTP | 0 | 1 (`67677`, real) | 1 |
| `296` | GLPI | 0 | 0 | 0 |
| `AbraAran` | HTTP | 1 (`INC-ABRA-1`, sintético) | 1 (`67923`, real) | 3 |
| `demo-f38` | HTTP | 1 (`INC-F38E`) | 5 (`REQ-F38E-*`) | 4 |
| `demo-f39` | HTTP | 0 | 4 (`REQ-F39-*`) | 3 |
| `demo-f39b` | HTTP | 1 (`INC-F39B`) | 4 (`REQ-F39B-*`) | 4 |

## 2. Dónde está guardado cada dato de demostración

**Los planes demo no son filas sueltas: arrastran hijos en siete tablas.** Ninguna de esas tablas declara clave foránea —la consulta a `pg_constraint` no devuelve ninguna restricción `FOREIGN KEY` en `public`—, así que borrar un plan no borra nada más y cada hijo quedaría huérfano.

| Tabla | Filas demo | Cómo se identifica |
|---|---:|---|
| `plan_snapshot` | 9 | `developer_id like 'demo-%'` |
| `planning_input` | 9 | `plan_id` de esos planes |
| `planning_input_incident` | 6 | `plan_id` |
| `planning_input_requirement` | 33 | `plan_id` |
| `work_block` | 29 | `plan_id` |
| `work_allocation` | 29 | `plan_id` |
| `planning_conflict` | 6 | `plan_id`; los seis son demo, con el motivo literal *«Sin capacidad en el horizonte de 10 dias»* |
| `reschedule_event` | 10 | `plan_id` |
| `reschedule_claim` | 10 | `incident_id`/`requirement_id` con prefijo `INC-F38*`, `REQ-F38*`, `REQ-F39B*` |
| `renegotiation` | 2 | `work_item_id` `REQ-F38B-1` y `REQ-F38E-1`; **no cuelgan de un plan**, se identifican solo por el ticket |
| `renegotiation_history` | 2 | las dos filas anteriores, actor `verificacion-fase-38` |

Además hay **artefactos de prueba más antiguos, sin plan**: `reschedule_claim` guarda los pares `INC-1`/`REQ-1` y `INC-E2E-1`/`REQ-E2E-1` del 2026-10-05. No aparecen en ninguna pantalla y no pertenecen a ningún plan vivo.

**Metadatos escritos por actores de demostración sobre tickets reales.** Esto no vive en `plan_snapshot` y por eso no se arregla borrando planes:

| Ticket real | Actor | Valores actuales | Estado |
|---|---|---|---|
| `66222` | `Demostracion Fase 40` | 3 h, compromiso 2026-10-23 | **Vigente**; el ticket es real, la declaración la hizo la demostración |
| `66913` | `verificacion-fase-37` | solo compromiso 2026-10-23 | Vigente y parcial (`SIN_ESTIMACION` en GLPI) |
| `66560` | `Demostracion Fase 42` | estimación y compromiso en nulo | **Revertido**; el historial conserva las dos escrituras |
| `67501` | `dev-ana` / `gestor-luis` | 8 h y fecha `2020-01-01`, luego estimación en nulo | Residuo de una prueba; el ticket es real |
| `67923` | `Abraham` | 4 h, compromiso 2026-10-17 | Declaración real de la persona |
| `68440` | `Jose Luis Garces` | 6 h, compromiso 2026-10-15 | Declaración real de la persona |

## 3. Qué pantallas consumen los datos demo

| Pantalla | Ruta | Datos | ¿Muestra los demo? |
|---|---|---|---|
| Timeline del equipo | `/` | `team/timeline` + padrón + renegociaciones + declaraciones por lote | **Sí**: tres filas y once tramos demo; además los incidentes sintéticos sobre personas reales |
| Tablero | `/tablero` | `planning/metrics` (bloque `current`) | **Sí**: capacidad, planes vigentes y desplazamientos incluyen a los tres |
| Alertas | `/alertas` | `planning/alerts` | **Sí**, derivadas de las mismas métricas |
| Renegociaciones | `/renegociaciones` | `renegotiations` | **Sí**: 3 de las 4 filas vigentes son demo (`REQ-F38E-1` acordada, `REQ-F38E-2` y `REQ-F38E-3` pendientes) |
| Calendario y comparación | `/calendario/:planId` | timeline del plan + planes del técnico | **Sí**, alcanzables desde una fila demo del Timeline |
| Recursos | `/recursos` | métricas + padrón + alertas + renegociaciones | **Sí** en las métricas; el padrón no los conoce |
| Incidentes | `/incidentes` | padrón + declaraciones por persona | **No**: GLPI no conoce los identificadores demo |
| Declaraciones | `/declaraciones` | padrón + declaración por técnico | **No**, por el mismo motivo |
| Estado de entrada | `/planificar/estado` | padrón + declaraciones | **No** |
| Planificar | `/planificar` | `POST from-glpi` | **No**: el endpoint real rechaza un identificador que GLPI no tiene |

La prueba en vivo de que GLPI no los conoce es la respuesta del lote: `unknownDevelopers` es exactamente `["demo-f38", "demo-f39", "demo-f39b"]`, y el resto de la respuesta se sirve igual.

## 4. El inventario de datos reales

El padrón que sirve `GET /api/team` —grupo **Desarrollo N2** de GLPI, con subgrupos— tiene **42 personas**, de las cuales **18 son operativas**. La lectura de declaraciones del equipo operativo entero devuelve **86 tickets activos** y **ningún identificador desconocido**:

| Estado de declaración | Tickets | Qué significa |
|---|---:|---|
| `PLANIFICABLE` | **3** | `67923` y `66222` de `AbraAran`; `68440` de `JoseGarc` |
| `SIN_DECLARACION` | **80** | Hay ticket, pero nadie dijo cuánto dura ni para cuándo |
| `SIN_ESTIMACION` | **3** | Hay compromiso, falta la estimación derivada de la declaración |

**Ningún incidente real es planificable hoy.** Los nueve incidentes activos del equipo están en `SIN_DECLARACION`. Los tres elementos planificables son requerimientos.

**Personas reales con plan vigente: cinco identidades.** Cuatro pertenecen al equipo operativo —`AbraAran` (Abraham Arana Aldana), `160` (Francisco Javier Zuluaga A., `FranZulu`), `17` (Nilson Cortes, `NilsCort`) y `296` (Jose Alejandro Diaz Urrego, `JoseDiaz`)— y una, `13` (Juan Carlos Villamizar Villamizar), es un usuario real de GLPI que no está en el grupo del padrón. **Las otras catorce personas operativas no tienen ningún plan.**

**Planes reales vacíos y por qué.** `160` y `296` tienen plan vigente sin un solo tramo. La razón está en la entrada: sus tickets activos están todos en `SIN_DECLARACION` (`160` tiene tres requerimientos, `296` ninguno), y la capa anticorrupción descarta lo que no tiene estimación y compromiso. No es un fallo del motor ni de la persistencia: es la respuesta correcta a «nadie declaró horas ni fecha».

## 5. Qué alimenta hoy cada pieza del Timeline

| Pieza | Fuente real | Estado actual |
|---|---|---|
| **Filas** | `plan_snapshot` del plan vigente de cada técnico + nombres del padrón y de la declaración | 8 filas: 5 personas reales y 3 identificadores demo |
| **Tramos** | `work_block` del plan vigente | 17 tramos: **3 referencian tickets reales** (`67677` de Nilson, `67923` dos veces de AbraAran), **3 son incidentes sintéticos sobre personas reales** (`INC-13-1`, `INC-ABRA-1`) y **11 son de personas demo** |
| **Pendientes** | declaraciones por lote + plan + acuerdos + conflictos | Personas reales: 86 tickets, 3 planificables. Los demo no aportan pendientes: su declaración no se puede leer y salen como «sin leer» |
| **Desplazamientos** | `reschedule_event` del plan vigente | Uno visible, `67923` de AbraAran, y su causa es `INC-ABRA-1`, **un incidente que GLPI no tiene**. Los otros diez eventos vivos son demo. **Cero desplazamientos nacidos de un incidente real** |
| **Renegociaciones** | `renegotiation` + planes vigentes | 4 filas: 1 real (`67923`, pendiente sin acuerdo) y 3 demo; las dos acordadas del histórico son demo |
| **Declaración** | `planning_metadata` | 8 filas; 2 son declaraciones reales de la persona (`67923`, `68440`), 2 son demo sobre tickets reales (`66222`, `66913`), 2 son parciales, 2 están vacías |

**El porcentaje que el brief pide, con el denominador dicho:**

- **Por filas del Timeline: 5 de 8 son personas reales (62,5 %)**; dentro del equipo operativo, **4 de 18 (22,2 %)** tienen plan.
- **Por tramos: 3 de 17 referencian un ticket real (17,6 %)**; 3 son sintéticos sobre personas reales (17,6 %) y **11 son demo (64,7 %)**.
- **Por origen del plan: 0 de 17 tramos provienen de un plan generado desde GLPI.** Los cinco planes `GLPI` de personas reales están vacíos; los tres planes con tramos se alimentaron por HTTP.

## Las decisiones

### 204. Los datos de demostración se identifican por su origen y no se borran en esta fase

La auditoría demuestra que son nueve planes con hijos en siete tablas y sin claves foráneas. **Borrarlos exige un orden manual y una copia previa**, y no aporta nada al objetivo del brief, que es saber si el producto opera con datos reales. Se quedan, se identifican y se documentan; la limpieza es una decisión posterior y explícita, no un efecto colateral de una validación.

### 205. La validación operativa usa el flujo real, no planes sembrados por HTTP

Un plan `HTTP` prueba que el motor y la pantalla funcionan, pero **no prueba que GLPI alimente el Timeline**. La demostración que cuenta es `POST /from-glpi` sobre una persona real, con sus tickets reales y sus declaraciones reales. Todo lo demás es una maqueta del flujo.

### 206. Un ticket real con metadatos de demostración sigue siendo un ticket real

`66222` y `66913` son tickets de GLPI; lo que la demostración escribió fue su declaración. **No se pueden borrar «los datos demo» sin distinguir la fila del ticket de la fila de la declaración**: borrar la segunda devuelve el ticket a «sin declaración», y borrar la primera no está en la mano de este sistema. La recomendación los trata aparte del resto.

## Riesgos identificados

| # | Riesgo | Severidad | Tratamiento |
|---|---|---|---|
| 207 | **Dos nombres para la misma persona** | **Medio, y se ve hoy** | El plan de `160` está guardado con el número de GLPI y el padrón lo conoce como `FranZulu`. El Timeline los une por `glpiId` al pintar el nombre, pero `planning_metadata` y las declaraciones usan el login: una consulta por login no ve el plan guardado por número. **No se corrige en esta fase**: unificarlo exige migrar datos y elegir el identificador canónico, y el código ya lo declara como riesgo |
| 208 | **Los planes `GLPI` reales están vacíos** | **Alto para la operación, bajo para el código** | No es un defecto: el 93 % de los tickets reales no tiene declaración. Mientras no se declare, el Timeline de una persona real será una fila sin trabajo. **La acción es operativa —declarar—, no de ingeniería** |
| 209 | **Los incidentes reales no entran al plan** | **Alto para la promesa «incidente real»** | Los nueve incidentes activos están `SIN_DECLARACION`. Sin horas estimadas el motor no los recibe, y sin incidente no hay umbral, ni desplazamiento, ni renegociación. La pantalla lo dice con la causa correcta |
| 210 | **La demo contamina personas reales** | **Medio, y es reversible por sustitución** | `INC-13-1` e `INC-ABRA-1` son incidentes inventados dentro de planes de personas reales. Generar el plan desde GLPI los sustituye en la vista —el plan viejo queda en el historial— sin borrar nada |
| 211 | **El borrado de demo deja huérfanos** | **Medio si alguien lo intenta sin orden** | Sin claves foráneas, un `delete` sobre `plan_snapshot` deja bloques, entradas, conflictos, eventos y reclamaciones apuntando a un plan que ya no existe. Cualquier limpieza futura tiene que borrar por `plan_id` en orden inverso y copiar antes |

## La recomendación de limpieza

**No borrar ahora.** Los nueve planes demo son la única evidencia reproducible de las fases 38 y 39, no interfieren con la operación real —solo ensucian la lectura del Timeline— y su eliminación exige tocar once tablas sin red de integridad referencial. La vía barata y reversible es **separar por origen en la lectura** (excluir de la agenda los identificadores que GLPI no conoce) o archivar los planes demo en una tabla histórica; la vía destructiva, si algún día se decide, es:

1. Copiar `plan_snapshot` y todas las tablas hijas filtrando `developer_id like 'demo-%'`.
2. Borrar en orden inverso: `reschedule_claim`, `reschedule_event`, `planning_conflict`, `work_allocation`, `work_block`, `planning_input_incident`, `planning_input_requirement`, `planning_input`, `renegotiation_history`, `renegotiation`, `plan_snapshot`.
3. Verificar después que ningún `plan_id` de las tablas hijas apunta a un plan inexistente.

**Lo que no se debe borrar con el paquete demo**: `planning_metadata` de `66222`, `66913`, `67923`, `68440`. Las dos primeras son declaraciones de demostración sobre tickets reales y las otras dos son declaraciones reales; ninguna es un artefacto demo en el sentido del punto 2, y borrarlas cambia el estado operativo de un ticket real.
