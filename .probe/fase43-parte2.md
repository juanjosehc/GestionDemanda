
## Fase 43 — Parte 2: la demostración operativa con datos reales

La auditoría anterior contestó **qué hay hoy**. Esta parte contesta la otra pregunta: **si el flujo real funciona de punta a punta**. No se simula nada: se usó un ticket real de una persona real, la pantalla de declaración, la generación desde GLPI, el Timeline del equipo, el desplazamiento que calculó el motor y la renegociación que quedó pendiente.

**Se hizo una sola escritura sobre datos de negocio**, y está documentada abajo. `PlanningEngine`, las reglas de capacidad, el cálculo de desplazamientos, la renegociación y la integración con GLPI **no tienen una línea de diferencia**. Todo lo demás que esta parte reporta es lectura.

### 1. La escritura: una declaración real sobre un incidente real

`68319` es el incidente *«RESPUESTA DADA A TRX CON TD EN EXTERIOR»*, asignado en GLPI a Abraham Arana Aldana (`AbraAran`, usuario GLPI `1179`), en estado `EN_ATENCION`, creado el 2026-10-14. Antes de la demostración no tenía declaración:

| Lectura | Estimación | Compromiso | Quién | Estado de declaración |
|---|---|---|---|---|
| Antes | nulo | nulo | — | `SIN_DECLARACION` |
| Después | **6 h** | **2026-10-19** | `validacion-fase-43` | `PLANIFICABLE` |

Se hizo por `PUT /api/planning-metadata/68319` con `{"estimatedHours":6,"committedDate":"2026-10-19","changedBy":"validacion-fase-43"}`. **Es la única escritura de la fase.** La declaración anterior de la persona sobre `67923` (4 h, 2026-10-17) no se tocó, y el historial de `planning_metadata` conserva las dos escrituras de `68319` con su actor.

**Es reversible**: volver a `PUT` con ambos campos en nulo devuelve el ticket a `SIN_DECLARACION` sin borrar su historia.

### 2. El plan que produjo GLPI

`POST /api/planning/from-glpi` con `{"developerId":"AbraAran"}` respondió `201`:

| Dato | Valor |
|---|---|
| Plan | `59668f8c-4391-4612-8a92-d278cc7ad061` |
| Calculado | 2026-10-19 17:03:49 UTC |
| Recibidos por el motor | 3 |
| Planificados | 2 |
| Desplazados | 1 |
| Fuera del horizonte / excluidos | 0 / 0 |
| Conflictos | 0 |
| Capacidad | 13 h ocupadas de 64 h disponibles; 51 h libres |

Tramos, todos de tickets reales:

| Elemento | Tipo | Fecha | Horas | Estado |
|---|---|---|---:|---|
| `68319` | Incidente | 2026-10-14 09:23–15:23 | 6 | Planificado · MEDIO |
| `67923` | Requerimiento | 2026-10-19 09:00–13:00 | 4 | **Desplazado** desde 2026-10-17 |
| `66222` | Requerimiento | 2026-10-23 09:00–12:00 | 3 | Planificado |

### 3. El desplazamiento, con su causa

| Campo | Valor |
|---|---|
| Requerimiento | `67923` · *«ASEGURAMIENTO APLICACIÓN PROPIA - SARAS»* |
| Fecha original | sábado 2026-10-17 (su compromiso declarado por la persona) |
| Fecha nueva | lunes 2026-10-19 |
| Regla aplicada | `CAPACIDAD_COMPROMETIDA` |
| Incidente causante | `68319` · severidad `MEDIO` |
| Motivo | *«El incidente comprometio la capacidad de la jornada pactada.»* |
| Acuerdo | **`PENDIENTE_DE_ACUERDO`** |

El motor no produce el acuerdo: produce el desplazamiento y lo deja pendiente. La renegociación la registra una persona, y en esta demostración **no se registró acuerdo** para que se viera el estado real.

### 4. El efecto colateral que hay que decir: la ventana se movió al pasado

`68319` se planificó el **2026-10-14**, la fecha en que se reportó, no la fecha declarada (2026-10-19). Como la ventana del equipo se calcula con el mínimo y el máximo de los tramos:

| Lectura | Ventana | Capacidad disponible | Ocupada | Libre | Desplazamientos |
|---|---|---:|---:|---:|---:|
| Antes | 2026-10-19 → 2026-10-21 | 104 h | 74 h | 30 h | 4 |
| Después | **2026-10-14 → 2026-10-23** | 152 h | 77 h | 75 h | 4 |

El Timeline ahora enseña dos días no laborables (17 y 18 de octubre) dentro de la ventana y **nueve días** en vez de tres. No es un defecto del motor —el incidente ocurrió el 14 y su carga pertenece a ese día—, pero sí es un comportamiento operativo que el brief pedía descubrir: **un incidente viejo arrastra el horizonte hacia atrás**. Queda como riesgo 214; no se corrigió porque la fase prohíbe tocar las reglas de planificación.

### 5. Lo que cambió en las cifras

La sección 5 de la parte 1 es la foto de las 11:56. Esta es la foto de las 17:03, después de la demostración:
| Medida | Antes | Después | Por qué cambió |
|---|---:|---:|---|
| Tramos en el Timeline | 17 | **17** | El plan GLPI sustituyó el plan `HTTP` de AbraAran: salieron `INC-ABRA-1` (sintético) y un `67923` duplicado; entraron `68319` y `66222` |
| Tramos que referencian un ticket real | 3 | **4** | `68319` y `66222` son tickets reales del plan GLPI |
| Tramos sintéticos sobre personas reales | 3 | **2** | `INC-ABRA-1` desapareció de la vista |
| Tramos de identidades demo | 11 | **11** | Sin cambios |
| Tramos de un plan generado desde GLPI | **0** | **3** (17,6 %) | El plan `59668f8c…` |
| Filas reales del Timeline | 5 de 8 | **5 de 8** | Sin cambios |
| Planes generados (histórico) | 21 | **22** | El plan de la demostración |
| Elementos planificables del equipo | 3 | **4** | `68319` pasó a `PLANIFICABLE` |
| Incidentes reales planificables | **0** | **1** | `68319` |
| Renegociaciones | 4 desplazadas / 3 pendientes / 1 acordada | **4 / 3 / 1** | El desplazamiento real sustituyó al sintético de AbraAran; el recuento no cambió |
| Tickets activos del equipo operativo | 86 | **85** | `68672` de `JhonAteh` dejó de aparecer entre las dos lecturas: GLPI ya no lo devuelve como activo. **No lo tocó esta fase** |

**El porcentaje que el brief pide, con el denominador dicho, en la foto de las 17:03:**

- **Por filas: 5 de 8 son personas reales (62,5 %)**, y 4 de 18 operativas (22,2 %) tienen plan.
- **Por tramos: 4 de 17 referencian un ticket real (23,5 %)**; 2 son sintéticos sobre personas reales (11,8 %) y **11 son demo (64,7 %)**.
- **Por origen: 3 de 17 provienen de un plan generado desde GLPI (17,6 %)**; el resto de los tramos reales viene de planes sembrados por `HTTP`.
- **Por carga: de los 85 tickets activos del equipo operativo, 4 son planificables (4,7 %)**; 78 no tienen declaración y 3 tienen compromiso sin estimación.

### 6. La otra cifra que el brief pidió descubrir: qué lee la generación

La respuesta de `POST /from-glpi` trae **295 descartes sobre 148 tickets distintos** de AbraAran: 148 por «no hay planificación declarada» y 147 por «no tiene fecha compromiso». Es decir, **la generación leyó 148 tickets del técnico y solo 9 están activos hoy**. La diferencia es el histórico: `ticketsOf` no filtra por estado a propósito —el plan necesita el historial para poder explicar sus descartes—, y lo que sigue siendo trabajo lo mide `activeTicketsOf`. No es un error, pero sí una carga de lectura que conviene tener medida; queda como riesgo 213.

### 7. Evidencia Playwright con datos reales

Capturas en la raíz del repositorio, sin versionar, tomadas contra la instancia real (`localhost:5173` → `localhost:8080` → GLPI):

| Archivo | Qué demuestra |
|---|---|
| `f43-timeline-real.png` | El Timeline del equipo completo: 8 personas, 17 tramos, ventana 14–23 de octubre |
| `f43-timeline-abraaran.png` | La fila de Abraham Arana Aldana: `68319` planificado el 14 y `67923` desplazado 17/10 → 19/10 |
| `f43-desplazamiento-67923.png` | El panel del tramo: fecha original, fecha nueva, `CAPACIDAD_COMPROMETIDA`, incidente `68319` · MEDIO, motivo, «Pendiente de acuerdo» y enlaces a Declarar y Renegociar |
| `f43-renegociacion-67923.png` | `/renegociaciones`: la fila real de `67923` junto a las demo, con «Registrar acuerdo» |
| `f43-declaracion-68319.png` | La declaración real del incidente: 6 h, 2026-10-19, actor `validacion-fase-43`, y los 9 tickets de la persona con su estado |
| `f43-plan-real-abraaran.png` | El calendario del plan `59668f8c…`: 3 recibidos, 2 planificados, 1 desplazado, 13 h de 64 h, y la tabla con la regla y el motivo |

En ninguna captura los identificadores `demo-f38`, `demo-f39` o `demo-f39b` son el caso principal: la fila de AbraAran es la que se abre y la que se documenta.

### 8. Las tres preguntas del brief, contestadas

**¿Timeline First funciona ya con datos reales?**
**Sí, de punta a punta.** Una persona real, un ticket real, una declaración real, un plan generado desde GLPI, tramos reales en el Timeline, un desplazamiento calculado por el motor con su causa y una renegociación pendiente de acuerdo. Las seis capturas lo demuestran. Lo que no funciona todavía es **la cobertura**: una sola persona tiene trabajo planificado, y 14 de las 18 operativas no tienen ningún plan porque nadie declaró. El producto funciona; la organización todavía no lo alimenta.

**¿Qué porcentaje del Timeline mostrado hoy proviene de datos reales de GLPI?**
Depende del denominador, y los tres importan:
- **62,5 % de las filas** son personas reales (5 de 8); el resto son tres identificadores demo.
- **23,5 % de los tramos** referencian un ticket real (4 de 17); 2 son incidentes inventados sobre personas reales y **64,7 % son demo**.
- **17,6 % de los tramos** provienen además de un plan **generado desde GLPI** (3 de 17). El resto de lo real viene de planes escritos por `HTTP`.
- **4,7 % del trabajo activo** del equipo operativo es planificable (4 de 85 tickets).

**¿Es seguro eliminar los artefactos demo?**
**Sí, técnicamente, si se hace en el orden del punto 9 y con copia previa; no, sin ese orden.** El producto no depende de ellos: no hay claves foráneas que los protejan ni código que los necesite, y GLPI no conoce sus identificadores. **Lo que sí hay que distinguir es qué se borra:**
- **Se pueden borrar** los 9 planes de `demo-f38`, `demo-f39` y `demo-f39b` y sus hijos en las 11 tablas del inventario de la parte 1, en orden inverso.
- **No se deben borrar** las declaraciones de `66222`, `66913`, `67923`, `68440` ni la nueva de `68319`: son filas de `planning_metadata` sobre tickets reales y borrarlas cambia el estado operativo de un ticket que GLPI sí tiene.
- **La dependencia que sigue existiendo** no es de datos: es que borrar los planes demo **no limpia** lo que la demo escribió sobre tickets reales. Eso exige una decisión aparte, ticket por ticket.

**Recomendación:** no borrar en esta fase. Separar por origen en la lectura —excluir de la agenda los identificadores que GLPI no conoce— resuelve el 64,7 % de los tramos demo con un cambio reversible y sin tocar once tablas. Si se decide borrar, la lista y el orden están en la parte 1; la copia previa no es opcional.

## Las decisiones de la parte 2

### 212. La demostración operativa se hizo con una escritura declarada y reversible, y con el flujo real

La única escritura de la fase fue la declaración de `68319` (6 h, 2026-10-19, actor `validacion-fase-43`), necesaria porque GLPI no guarda estimación ni fecha. El plan se generó con `POST /from-glpi`, no sembrando un plan por `HTTP`. Todo lo demás —Timeline, desplazamiento, renegociación, métricas— se leyó. La declaración se puede retirar con un `PUT` de dos nulos y su historial queda auditado.

## Riesgos de la parte 2

| # | Riesgo | Severidad | Tratamiento |
|---|---|---|---|
| 213 | **La generación lee el histórico completo del técnico** | **Medio: se nota al crecer** | AbraAran tiene 9 tickets activos y la generación leyó **148 distintos**, con 295 filas de descarte. Es deliberado —el plan necesita el historial para explicar sus descartes— y `activeTicketsOf` es la lectura de carga. No se tocó por la prohibición de esta fase. **Medir antes de cambiar**: si el volumen de una persona crece, la lectura deja de ser barata |
| 214 | **Un incidente viejo arrastra la ventana al pasado** | **Medio: cambia lo que se ve** | `68319` se planificó en su fecha de reporte (2026-10-14) y no en su compromiso (2026-10-19), así que la ventana del equipo pasó de 19–21 a **14–23 de octubre**. La carga del incidente pertenece al día en que ocurrió, pero el horizonte de la pantalla se ensancha hacia atrás. No se corrigió: tocar reglas de planificación está fuera de esta fase. **Decidir si la ventana del equipo debe anclarse a hoy** |
