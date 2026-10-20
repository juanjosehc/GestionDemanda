
---

# Fase 46 — La cobertura accionable: qué hacer hoy para que más tickets entren al plan

La fase 45 midió cuánto trabajo llega al plan y a quién llamar. Esta fase responde la pregunta que seguía abierta: **¿qué hago hoy, concretamente, para que el mayor número posible de tickets entre al plan?** No se tocó el motor: ni `PlanningEngine`, ni las reglas de capacidad, ni los desplazamientos, ni las renegociaciones, ni la integración con GLPI, ni la persistencia. Todo el cambio es observabilidad, priorización y flujo operativo, en el frontend.

## Parte 1: la auditoría sobre datos reales

Medición en la instancia local, con GLPI real, el 2026-10-19 a las **19:04 UTC** y a las **19:32 UTC**. Los dos números no coinciden entre sí **y eso no es un fallo de la pantalla: es que GLPI siguió publicando mientras se validaba**. El cuadro los separa:

| Dato | Brief | Medición 19:04 | Medición 19:32 |
|---|---:|---:|---:|
| Personas operativas | 18 | 18 | 18 |
| Tickets activos | 86 | **87** | **88** |
| Estados «en el plan» (cubiertos) | 2 | **2 (2,3 %)** | **2 (2,3 %)** |
| Pendientes | 84 | **85** | **86** |
| Bloqueados por información (P1) | 82 | **83** | **84** |
| Bloqueados por capacidad | 0 | **0** | **0** |
| Sin acuerdo | — | 1 | 1 |
| No incluidos en el último plan | — | 1 | 1 |
| Planificables | 4 | **4** | **4** |
| Cobertura potencial | — | **85 de 87 (97,7 %)** | **86 de 88 (97,7 %)** |

**Lo que se movió en 28 minutos, y en los dos sentidos:** Jose Luis Garcés pasó de 9 a 10 tickets activos; Jhonnatan Atehortua pasó de 2 a 0; Nicolás Suárez y Andrés Felipe González pasaron de 0 a 1. No se puede afirmar que un ticket «pasó» de una persona a otra —la lectura solo publica conteos, no asignaciones—, pero sí que **una cobertura leída hoy puede no ser la de mañana**, y la pantalla debe enseñarse con esa advertencia.

**El reparto de causas es el que manda la acción.** De los 86 pendientes, **84 se desbloquean con una declaración** (97,7 % de todo lo pendiente), **1** espera un acuerdo de renegociación y **1** está planificable pero el plan no lo incluyó. **Ninguno está bloqueado por capacidad**: hoy no hay un solo ticket que el motor haya rechazado por falta de horas. El cuello de botella es **información que nadie ha escrito**, no capacidad.

**Tener plan no es tener trabajo planificado.** A las 19:32, Nilson Cortés tiene plan vigente y **0 de 9** tickets cubiertos; Abraham Arana tiene plan y cubre **2 de 9**; Francisco Zuluaga tiene plan y **0 de 3**. De las personas con plan, solo una cubre algo. La cobertura no se arregla regenerando el plan: se arregla declarando.

**Las personas con más volumen pendiente** (impacto = tickets que una sola llamada desbloquea):

| # | Persona | Activos | Bloqueados por información | Dónde quedaría |
|---:|---|---:|---:|---:|
| 1 | Maury Marmolejo Din | 10 | 10 | 10 de 10 |
| 2 | Jose Luis Garcés González | 10 | 9 | 9 de 10 |
| 3 | Cesar Giraldo Muñoz | 9 | 9 | 9 de 9 |
| 4 | Nilson Cortés | 9 | 9 | 9 de 9 |
| 5 | Alejandro Pineda Machado | 7 | 7 | 7 de 7 |
| 6 | Jose Fabian González Tavera | 7 | 7 | 7 de 7 |
| 7 | Abraham Arana Aldana | 9 | 6 | 8 de 9 |
| 8 | Silvia Alejandra Castro García | 6 | 6 | 6 de 6 |
| 9 | Stella Patricia Medina O. | 6 | 6 | 6 de 6 |
| 10 | Andrés Steven Beltrán Forero | 5 | 5 | 5 de 5 |

Y tres personas sin tickets activos (Daniel Felipe López, Jhonnatan Atehortua, Jose Alejandro Díaz): aparecen con «—», no con un 0 % que las haría parecer un problema.

**Los tickets que conviene trabajar primero**, con el criterio escrito en el código:

1. **`66666` · Jose Luis Garcés · Sin estimación** — solo falta un dato.
2. **`66913` · Jose Luis Garcés · Sin estimación** — solo falta un dato.
3. **`66913` · Abraham Arana · Sin estimación** — el mismo ticket aparece asignado a dos personas (ver riesgo 227).
4. **`33219`, `60448`, `61398`, `62711`, `65798` · Maury Marmolejo · Sin declaración** — les faltan los dos datos.

El orden no es alfabético ni por identificador: **primero lo que solo espera un dato** (la llamada más corta), **después lo que desbloquea más gente**, y a igual impacto **la prioridad cruda de GLPI** (5 antes que 4) y **el más viejo primero**.

## Parte 2: el cambio, archivo por archivo

| Archivo | Qué cambió | Por qué ahí |
|---|---|---|
| `frontend/src/lib/pending.ts` | `PendingItem` gana `priority` y `createdAt`, tal como los publica el backend | La capa de pendientes ya era la fuente única de causas; ordenar por prioridad sin volver a leer las declaraciones exige que esos dos campos viajen con el pendiente |
| `frontend/src/lib/coverage.ts` | `DeveloperCoverage.potential`; `CoverageTotals.potential` y `potentialRate`; nueva función pura `priorityTickets` | La cobertura ya contaba; ahora dice también dónde queda cada persona y ordena los tickets por impacto. Sigue sin clasificar nada |
| `frontend/src/pages/TeamTimeline.tsx` | Línea de cobertura potencial; «Llamar hoy a» con el impacto («quedaría en N de M»); lista «Tickets que desbloquea una declaración»; columna «Recuperables»; el nombre de la tabla y el de la rejilla enlazan a la declaración | Es la pantalla donde el gestor ya mira la cobertura y los pendientes: la acción tiene que estar donde está la pregunta |
| `frontend/src/components/timeline/TimelineGrid.tsx` | La fila enseña «N recuperables» junto a «N pendientes»; el nombre de cada fila puede ser enlace (`nameLinks`) | La rejilla ya pintaba los pendientes por persona; el número que falta es el que se puede recuperar. El enlace convierte la fila «Sin plan» en el camino a «cuáles y qué les falta» |
| `frontend/src/pages/Declarations.tsx` | El párrafo de entrada explica que registrar estimación y fecha **es** registrar el acuerdo operativo | La pantalla ya era el sitio donde se escribe el acuerdo; el texto ahora lo dice |
| `frontend/src/components/declarations/DeclarationForm.tsx` | La ayuda del formulario distingue quién pone cada mitad: el desarrollo estima, el usuario acuerda la fecha | Es el momento en que se escribe el acuerdo; decirlo en el formulario evita que se lea como un trámite técnico |

**La regla del cálculo, escrita tal como quedó:** `potential = covered + blockedByInformation`. No es una predicción del motor —es **una resta del trabajo demostrable**: lo que hoy está en el plan más lo que solo espera información. La capacidad y las reglas de colocación pueden reducirlo; no pueden aumentarlo, porque un ticket sin declarar no es planificable de ninguna forma. Por eso se llama «cobertura potencial» y no «cobertura esperada».

**La lista de tickets no reclasifica.** Lee las causas de `lib/pending.ts` y solo ordena. Un `NO_TRADUCIBLE` —un tipo que el contrato no sabe leer— queda fuera: no se arregla escribiendo horas. Los grupos P2 (capacidad), P3 (acuerdo) y P4 (plan viejo) tienen su propio panel y no entran en la lista de una llamada.

## Parte 3: la pantalla de Declaración frente al acuerdo real

La evaluación de la pantalla, con lo que hoy hace y lo que sigue rozando con el proceso real:

**Lo que ya sostiene el acuerdo.** La pantalla no pide identificadores técnicos: el técnico sale del padrón y el ticket de su lista. El resumen por persona separa los activos, los declarados y los pendientes. El atajo «Declarar siguiente pendiente» convierte la pantalla en un recorrido, no en una búsqueda. El formulario escribe **estimación y fecha compromiso**, que son exactamente las dos cosas que GLPI no guarda; al guardar, la fila se refresca con la clasificación que el backend vuelve a decidir. El texto de entrada y el del formulario ahora dicen que esas dos mitades son el acuerdo —el desarrollo pone el esfuerzo, el usuario acuerda la fecha— para que no se lean como un trámite.

**Lo que todavía parece técnico, y no se cambió:**

1. **La tabla enseña el código crudo del estado** (`SIN_ESTIMACION`, `SIN_COMPROMISO`, `SIN_DECLARACION`) y los descartes con su código de regla. Es deliberado —es la traza del validador—, pero obliga a traducir. *Mejora propuesta:* etiqueta en palabras con el código en el `title`, igual que la columna de prioridad ya documenta que su escala es la cruda de GLPI.
2. **«Quién declara» es texto libre.** El formulario no sabe quién está operando; el gestor escribe su nombre en cada ticket. *Mejora propuesta:* prellenarlo con la identidad de la sesión o con el técnico elegido, y registrar por separado quién estima y quién acuerda.
3. **Un solo actor firma las dos mitades.** `changedBy` firma estimación y compromiso; el servidor deriva `estimatedBy` y `committedBy` del último cambio de cada campo. Si el gestor registra la fecha que el usuario aceptó, el historial dice que el compromiso lo puso el gestor. *Mejora propuesta:* dos firmas explícitas.
4. **La negociación no es un objeto.** No hay propuesta, contrapropuesta, aceptación ni rechazo; solo la fecha final. *Mejora propuesta:* un estado de solicitud («pedida al desarrollo», «esperando al usuario») que permita asignar la llamada y seguirla. Hoy la cobertura dice *qué* falta, no *quién lo debe*.
5. **El `PUT` reemplaza y no tiene bloqueo optimista.** Editar solo la fecha obliga a releer y reenviar la estimación; dos escrituras concurrentes, la segunda gana en silencio. *Mejora propuesta:* `@Version` o un `PATCH` con campos opcionales.

Ninguna de estas cinco se corrigió: cambiar el modelo de declaración es cambiar el proceso, no la observabilidad. Quedan propuestas y documentadas.

## Parte 4: el Timeline desde una fila «Sin plan»

La fila de una persona sin plan ya dice los tres datos que el brief pide, sin abrir nada: **«Sin plan · 10 pendientes · 10 recuperables»**. Los dos contadores son el hecho —cuántos faltan— y su parte accionable —cuántos se desbloquean declarando—.

El paso que faltaba era «exactamente qué falta». Ahora:

- **El nombre de la fila es un enlace** a la declaración de esa persona (`/declaraciones?tecnico=MaurMarm&volver=%2F`). La lista trae sus 10 tickets con el estado de cada uno y lo que le falta, y el botón «Declarar siguiente pendiente» abre el primero.
- **La tabla de cobertura** añade la columna «Recuperables» y, bajo el nombre, el desglose por causa («10 sin declaración», «2 sin estimación · 6 sin declaración · 1 no incluido…»), así que la respuesta a «qué falta» está en la misma fila.
- **La lista de tickets** del panel enlaza directo al formulario del ticket concreto (`&ticket=33219`), que se abre ya cargado sobre esa persona.

Verificado en Playwright: la fila de Maury dice «10 pendientes · 10 recuperables», su enlace abre sus 10 tickets, y el enlace del ticket `33219` abre el formulario con los tres campos («Horas estimadas», «Fecha compromiso», «Quién declara»).

## Parte 5: la métrica, tal como se enseña

Una sola línea, en la cabecera del panel:

> **2 de 88 tickets activos en el plan (2,3%) · 84 recuperables mediante declaración · cobertura potencial 86 de 88 (97,7%)**

Las tres cifras responden las tres preguntas del brief en el orden en que se hacen: **dónde estamos** (2 de 88), **cuánto se puede recuperar** (84) y **dónde se puede llegar** (86 de 88). Debajo, las causas por grupo; después, a quién llamar; después, qué pedirle.

## Parte 6: la validación en la instancia real (Playwright)

| Criterio del brief | Resultado medido |
|---|---|
| Cobertura actual | «2 de 88 tickets activos en el plan (2,3%)» |
| Cobertura potencial | «84 recuperables mediante declaración · cobertura potencial 86 de 88 (97,7%)» |
| Ranking de personas | 15 personas con impacto, de Maury (10) a Nicolás Suárez (1), ordenadas por tickets desbloqueables |
| Ranking de tickets | 8 tickets visibles: primero los de un solo dato (`66666`, `66913`, `66913`), después los de Maury; «76 más en Trabajo pendiente» |
| Acceso desde el Timeline | El nombre de la fila «Sin plan» abre `/declaraciones?tecnico=MaurMarm&volver=%2F` con sus 10 tickets |
| Acceso a la Declaración | El enlace del ticket `33219` abre `/declaraciones?tecnico=MaurMarm&ticket=33219&volver=%2F` con el formulario de ese ticket |
| Impacto esperado | La llamada dice «quedaría en 10 de 10», «9 de 10», «9 de 9»… |
| Sin datos inventados | Tres personas sin tickets muestran «—», no «0 %» |

Capturas: `f46-cobertura-total.png`, `f46-llamadas.png`, `f46-tickets-prioritarios.png`, `f46-fila-sin-plan.png`, `f46-declaracion-desde-ticket.png`, `f46-declaracion-lista.png`, `f46-cobertura-potencial.png`. Datos crudos: `.probe/f46-cobertura.json`.

## Parte 7: las pruebas

| Suite | Resultado |
|---|---|
| Frontend (`vitest run`) | **306 pruebas / 19 archivos, todas en verde** |
| TypeScript (`tsc --noEmit`) | 0 errores |
| Lint (`oxlint`) | limpio (se retiró un `useMemo` que el compilador de React no podía preservar) |
| Backend | **sin cambios en esta fase**; última corrida completa: 392 pruebas, 0 fallos, 0 errores, 3 omitidas |

Casos nuevos (4):

- `coverage.test.ts` · «pone primero lo que solo espera un dato y deja fuera lo que declarar no arregla»: P1 sí, P4/P3/NO_TRADUCIBLE no; un dato antes que dos; apalancamiento después.
- `coverage.test.ts` · «a igual impacto respeta la prioridad y después la antigüedad de GLPI».
- `coverage.test.ts` · «sin lecturas de cobertura no inventa apalancamiento».
- `TeamTimeline.test.tsx` · «enseña la cobertura potencial y la lista de tickets que la desbloquea»: la línea de potencial, la lista sin el P4, «quedaría en 1 de 2», la columna «Recuperables», la marca de la rejilla y el enlace de la fila.

Se ajustaron, sin debilitarlas, dos pruebas existentes: la de cobertura ahora busca la fila de la tabla con `[data-slot="coverage-row"]` —la lista de llamadas también lleva `data-developer-id`— y el resumen de totales comprueba `potential` y `potentialRate`.

## Parte 8: decisiones y riesgos

### 224. La cobertura potencial es una resta del trabajo demostrable, no una promesa del motor

`potential = covered + blockedByInformation` se puede calcular sin preguntarle nada al motor y sin simular un plan. **Es el techo que la información permite, no lo que el motor va a colocar**: si mañana la capacidad no alcanza, el potencial seguirá siendo correcto como medida del trabajo que ya no está bloqueado por información. Llamarlo «esperado» o «previsto» habría sido afirmar una predicción que esta pantalla no hace.

### 225. La lista de tickets ordena por esfuerzo y después por apalancamiento

Primero lo que solo espera un dato, porque es la llamada más corta y la que antes cierra una persona; después lo que desbloquea más gente; a igual impacto, la prioridad cruda de GLPI y el más viejo. **Ordenar solo por apalancamiento pondría delante a la persona con más tickets aunque cada uno exija abrir dos datos**; ordenar solo por prioridad de GLPI ignoraría que cerrar a una persona destraba varios tickets a la vez. El criterio es el de la acción, no el del identificador, y el desempate final es estable para que dos gestores vean la misma lista.

### 226. «Dónde queda» va junto a «cuánto falta»

Un contador de tickets bloqueados no dice si la llamada resuelve el problema o solo lo reduce. Por eso la lista de llamadas dice «10 tickets bloqueados · quedaría en 10 de 10» y la tabla separa recuperables de pendientes. **El gestor no decide a quién llamar por el volumen, sino por la distancia entre lo que hay y lo que puede haber.**

## Riesgos identificados

| # | Riesgo | Severidad | Tratamiento |
|---|---|---|---|
| 227 | **La cobertura cuenta asignaciones, no tickets únicos** | **Medio: puede sobreestimar** | El ticket `66913` aparece asignado a Jose Garcés y a Abraham Arana, y suma en los dos. Si el motor solo puede colocar un ticket una vez, la cobertura potencial del equipo está sobreestimada en las asignaciones repetidas. Hoy es **1 caso de 88**; la pantalla no lo marca. **No se cambió el backend**: deduplicar exige decidir qué persona es la dueña del ticket, y eso es una regla de negocio |
| 228 | **Los números se mueven mientras se validan** | **Medio: una cifra sin fecha envejece** | En 28 minutos la lectura pasó de 87 a 88 activos y de 83 a 84 recuperables. La cabecera no dice **cuándo** se leyó. **Tratamiento propuesto:** enseñar la hora de la lectura junto a la cobertura, como ya se hace con la fecha del plan en otras vistas |
| 229 | **El potencial asume que lo declarado se puede colocar** | **Bajo hoy, alto si la capacidad se llena** | Hoy hay 0 tickets fuera por capacidad, así que el techo está libre; en cuanto las declaraciones lleguen, el motor puede rechazar por jornada. **El potencial no lo predice y no debe leerse como un compromiso**. La pantalla ya separa «cobertura» de «cobertura potencial»; falta que el plan regenerado se compare contra el techo |
