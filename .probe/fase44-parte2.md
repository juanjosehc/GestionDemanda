
## Fase 44 — Parte 2: el cambio, las pruebas y la pantalla

La parte 1 midió el defecto y demostró su causa. Esta parte cuenta qué se cambió, qué pruebas lo sostienen y qué se vio en la instancia real. **No se tocó el backend**: ni `PlanningEngine`, ni las reglas de capacidad, ni el cálculo de desplazamientos, ni la renegociación, ni la integración con GLPI, ni la persistencia. La lectura del backend (`/api/planning/team/timeline`) sigue devolviendo exactamente lo mismo; **quien cambió es la pantalla, que ahora decide sus filas con el padrón.**

### 1. El cambio, archivo por archivo

| Archivo | Qué cambió | Por qué ahí |
|---|---|---|
| `frontend/src/lib/timeline.ts` | Nueva función pura `teamAgenda(people, timeline)` y el tipo `TeamAgenda`; ayudante `countOf` | Es el punto donde ya vivían las funciones puras de la vista (`timelineDays`, `itemsByDate`, `capacityOn`). El cruce padron↔plan es lógica de lectura, no de pintura, y así se puede probar sin montar la página |
| `frontend/src/pages/TeamTimeline.tsx` | Las filas salen de `team.data.people` filtrado por `operational`; la ventana, los días y el eje salen de esa agenda; cabecera «N personas del equipo · M con plan»; nota de lo que quedó fuera; estado vacío nuevo; estado de error del padrón | Es la página que ya pedía las dos lecturas (`useTeam()` y el timeline). No hubo que crear una llamada nueva ni cambiar el contrato |
| `frontend/src/components/timeline/TimelineGrid.tsx` | La fila sin capacidad pinta la etiqueta **«Sin plan»** en vez de «0 tramos» | La rejilla es genérica: recibe recursos y no sabe de dónde salen. Solo necesitaba dejar de afirmar «0 tramos» sobre una persona de quien no se leyó ningún plan |

**La regla, escrita tal como quedó en el código:** el padrón decide **quién** tiene fila; el plan decide **qué** tiene la fila. Un plan no puede crear una persona, y una persona sin plan no puede desaparecer.

**El cruce usa dos claves, y no es un detalle.** `teamAgenda` construye un mapa `developerId → developerId` y `String(glpiId) → developerId`, y canonicaliza con él tanto los recursos como los tramos y los conflictos. Sin la segunda clave, `FranZulu` (plan guardado como `160`), `NilsCort` (`17`) y `JoseDiaz` (`296`) habrían quedado con una fila vacía con su nombre **y** su trabajo fuera del equipo, contado en la nota de «sin fila». Con las dos claves, cada uno conserva su capacidad y sus tramos en su única fila. Es el riesgo 207 de la fase 43, esta vez en el camino crítico.

### 2. Qué ve ahora la pantalla

**Una persona operativa con plan** → su fila con la capacidad de su plan (los días, las horas disponibles/ocupadas/libres) y sus tramos, como antes.

**Una persona operativa sin plan** → su fila, la etiqueta «Sin plan» bajo el nombre y las celdas con «—» en la franja de capacidad. No se le inventan horas ni tramos: la fila dice el hecho, que es que hoy no tiene nada planificado.

**Una persona fuera del equipo operativo** → no tiene fila. Si tiene tramos o conflictos, **no se descartan en silencio**: una nota bajo la rejilla dice cuántos son y de qué identificadores. Eso deja ver, en la misma pantalla, el trabajo de un usuario real de GLPI que no está en el grupo (`13`) y el de los artefactos de demostración (`demo-f38`, `demo-f39`, `demo-f39b`) sin darles una fila que los convertiría en personas del equipo.

**El equipo sin ningún plan** → no se pinta una rejilla vacía de columnas sin sentido: el estado vacío dice cuántas personas tiene el equipo y que ninguna tiene plan vigente, y explica qué aparecerá cuando haya uno. Es el caso que hoy no se distingue de «no hay datos».

**El padrón no carga** → error explícito con reintento. Antes la página seguía con las filas del timeline; ahora no puede saber quién es el equipo, y decirlo es mejor que pintar una lista que no es el equipo.

**La demostración ya no estira el calendario.** La ventana, los días y el eje horario se calculan sobre `agenda.resources`/`agenda.items`, no sobre la respuesta completa. Un plan demo fuera del equipo ya no añade columnas ni ensancha el rango: lo único que hace es sumar a la nota de lo que quedó fuera.

### 3. Las pruebas añadidas

Cinco casos nuevos en `frontend/src/pages/TeamTimeline.test.tsx`, uno por cada regla:

| Prueba | Qué fija |
|---|---|
| «deja la fila de una persona operativa con plan con su capacidad y su trabajo» | Persona operativa con plan: 3 tramos, capacidad en los 3 días, sin etiqueta «Sin plan» |
| «enseña a una persona operativa sin plan, marcada como tal, en vez de omitirla» | Persona operativa sin plan: fila presente y etiqueta «Sin plan» |
| «no deja que un identificador de demostración cree una fila» | Un recurso/tramo `demo-*` no crea fila y se cuenta en la nota de lo que quedó fuera |
| «enseña a todo el equipo operativo y solo a él, tenga plan o no» | 3 operativas (con plan, sin plan, con plan vacío) → 3 filas; una persona no operativa no tiene fila |
| «no le inventa una fila a quien el padrón no conoce, y dice cuánto quedó fuera» | Reescrita: el padrón decide las filas; un tramo de un identificador desconocido no tiene fila y se anuncia |

También se ajustaron las pruebas existentes que dependían de que el padrón fuera solo decorativo: el identificador de demostración de los fixtures ahora entra en la lectura por lote de declaraciones —se piden las declaraciones del padrón, no las de las filas— y el conteo de «sin leer» pasó de 2 a 3 porque hay una tercera persona operativa (`Diana Lopez`, `OVER_DEVELOPER_ID`).

**Totales, re-ejecutados después del último cambio** (`countOf` compartido, importación en `TimelineGrid`):

| Suite | Resultado |
|---|---|
| Frontend (`vitest run`) | **293 pruebas / 18 archivos, todas en verde** |
| TypeScript (`tsc --noEmit`) | 0 errores |
| Lint (`oxlint`) | limpio |
| Backend (`mvn -q -o test`) | **392 pruebas, 0 fallos, 0 errores, 3 omitidas** |

### 4. La validación en la instancia real (Playwright)

Sobre el backend y el frontend locales, contra la base de desarrollo y GLPI real, el 2026-10-19:

| Criterio del brief | Resultado medido |
|---|---|
| Las 18 personas operativas aparecen | **18 filas**, cabecera «18 personas del equipo · 4 con plan» |
| Las personas sin plan aparecen | **14 filas con «Sin plan»**; entre ellas Stella Patricia Medina O., Silvia Alejandra Castro Garcia, Maury Marmolejo Din |
| Las personas con plan siguen mostrando trabajo | **4 filas con capacidad y tramos**: `AbraAran` (3 tramos), `NilsCort` (1 tramo), `FranZulu` y `JoseDiaz` (plan vigente sin tramos) |
| Los datos demo no crean filas adicionales | **0 filas** con identificador `demo-*` ni `13`; la nota dice «13 tramos y 2 conflictos de 13, demo-f38, demo-f39, demo-f39b» |
| El Timeline sigue funcionando | 10 columnas de día (14–23 de octubre); el detalle de `67923` abre con su causa (CAPACIDAD_COMPROMETIDA, incidente 68319), su renegociación pendiente y sus tres acciones |

Capturas:

| Archivo | Qué muestra |
|---|---|
| `f44-timeline-equipo.png` | La rejilla con las 18 filas y la cabecera «18 personas del equipo · 4 con plan» |
| `f44-fuera-del-equipo.png` | Las filas «Sin plan» y la franja de capacidad con «—» |
| `f44-nota-fuera-del-equipo.png` | La nota de lo que quedó fuera del equipo |
| `f44-detalle-67923.png` | El detalle del tramo desplazado |

**Una medición que conviene dejar escrita:** el panel de pendientes pasó de contar lo que traía el timeline a contar lo de las personas del equipo —**84 pendientes** sobre 18 personas—, porque `useTeamDeclarationsBatch` ahora recibe los identificadores del padrón. Antes el panel contaba solo lo de las ocho filas que existían; el cambio también lo hace completo.

### 5. Decisiones

### 215. El padrón decide las filas y el plan solo las rellena

`teamTimeline()` no consulta el equipo y no debe hacerlo: el Timeline es una lectura de planes y la de equipo es otra ruta, con otra fuente (GLPI) y otro fallo posible. La pantalla ya pide las dos y es la que puede cruzarlas. **Una fila existe porque la persona está en el padrón operativo; su capacidad y sus tramos vienen del plan más reciente si lo hay.** Así, desaparecer de la pantalla exige dejar de estar en el equipo —un hecho administrativo—, no dejar de tener plan —un hecho operativo que cambia todos los días—.

### 216. Lo que no es del equipo no se borra: se cuenta

Los tramos y conflictos de identificadores que el padrón no conoce se excluyen de la rejilla y se anuncian en una nota. Descartarlos sin decirlo escondería trabajo real —el de un usuario de GLPI fuera del grupo—; pintarlos les daría una fila que no les corresponde. La nota resuelve las dos cosas a la vez y deja la limpieza como una decisión visible.

## Riesgos identificados

| # | Riesgo | Severidad | Tratamiento |
|---|---|---|---|
| 217 | **Una fila sin plan es indistinguible de una fila sin capacidad** | **Bajo: la etiqueta lo evita** | La rejilla decide «Sin plan» por `capacity.length === 0`, que es cierto tanto si no hay plan como si el plan no trae capacidad. Hoy el backend publica capacidad para todo plan vigente, así que los dos casos coinciden; si alguna vez un plan vigente llegara sin filas de capacidad, la etiqueta afirmaría «Sin plan» sobre un plan que existe. **La señal adicional es la nota de fuera del equipo y la cabecera «M con plan»**; si aparece un plan sin capacidad, separar los estados |
| 218 | **El padrón se lee en cada carga de la página** | **Bajo** | Añadir una fila por persona no añade peticiones: `useTeam()` ya se pedía antes para poner nombres. Pero ahora la pantalla **espera** al padrón para pintar, así que si GLPI tarda más que el timeline, la página tarda más en aparecer. **Es el precio de que el equipo sea la fuente de verdad**; si llega a notarse, cachear el padrón con la clave de React Query que ya tiene |
