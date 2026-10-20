
## Fase 45 — La cobertura del plan: qué tickets impiden que el equipo planifique

La fase 44 dejó a las 18 personas operativas en pantalla, con plan o sin él. Esta fase responde la pregunta que seguía abierta: **de todo el trabajo activo del equipo, cuánto puede llegar hoy al plan y qué lo impide**. No se cambió ninguna regla de planificación: ni `PlanningEngine`, ni la capacidad, ni los desplazamientos, ni las renegociaciones, ni la integración con GLPI, ni la persistencia. **Todo lo que sigue se midió antes de escribir una línea de código**, contra la base de desarrollo y GLPI real el 2026-10-19, con los cuatro artefactos de `.probe/` (`f45-declarations.json`, `f45-timeline.json`, `f45-renegotiations.json`, `f44-team.json`).

### 1. La auditoría: los números reales, sin suponer

**El método.** Las cifras salen de tres lecturas que ya existían y no se reinterpretaron: los tickets activos y su `declarationStatus` vienen del lote `GET /api/planning-metadata/declarations` para los 18 identificadores del padrón operativo; la pertenencia al plan viene de `GET /api/planning/team/timeline`; y la causa de cada pendiente viene de `lib/pending.ts`, que ya cruzaba las dos. **La cobertura no es una cuarta clasificación: es el conteo de lo que esas tres lecturas dicen.**

**La cobertura global, hoy:**

| Medida | Valor real |
|---|---|
| Personas operativas en el padrón | **18** |
| Tickets activos (todos los del equipo) | **86** |
| Tickets con algo declarado (estimación o compromiso) | **7** |
| Tickets planificables (`PLANIFICABLE`) | **4** |
| Tickets dentro del plan vigente | **2** |
| **Cobertura** | **2 de 86 = 2,3 %** |
| Tickets pendientes | **84** |

**Las 18 personas, una por una.** La tabla es la que publica la pantalla; el orden es el del padrón, no el de prioridad (ese va en el punto 3).

| Persona | Plan | Activos | Declarados | Planificables | Pendientes | En el plan | Cobertura | Causas |
|---|---|---|---|---|---|---|---|---|
| Maury Marmolejo Din | Sin plan | 10 | 0 | 0 | 10 | 0 de 10 | 0 % | 10 sin declaración |
| Cesar Giraldo Muñoz | Sin plan | 9 | 0 | 0 | 9 | 0 de 9 | 0 % | 9 sin declaración |
| Nilson Cortes | Con plan | 9 | 0 | 0 | 9 | 0 de 9 | 0 % | 9 sin declaración |
| Jose Luis Garces Gonzalez | Sin plan | 9 | 3 | 1 | 9 | 0 de 9 | 0 % | 2 sin estimación · 6 sin declaración · 1 no incluido en el plan |
| Alejandro Pineda Machado | Sin plan | 7 | 0 | 0 | 7 | 0 de 7 | 0 % | 7 sin declaración |
| Jose Fabian Gonzalez Tavera | Sin plan | 7 | 0 | 0 | 7 | 0 de 7 | 0 % | 7 sin declaración |
| Silvia Alejandra Castro Garcia | Sin plan | 7 | 0 | 0 | 7 | 0 de 7 | 0 % | 7 sin declaración |
| Abraham Arana Aldana | Con plan | 9 | 4 | 3 | 7 | **2 de 9** | **22,2 %** | 1 sin estimación · 5 sin declaración · 1 sin acuerdo |
| Stella Patricia Medina O. | Sin plan | 6 | 0 | 0 | 6 | 0 de 6 | 0 % | 6 sin declaración |
| Andres Steven Beltran Forero | Sin plan | 5 | 0 | 0 | 5 | 0 de 5 | 0 % | 5 sin declaración |
| Andres Felipe Escobar Arango | Sin plan | 3 | 0 | 0 | 3 | 0 de 3 | 0 % | 3 sin declaración |
| Francisco Javier Zuluaga A. | Con plan | 3 | 0 | 0 | 3 | 0 de 3 | 0 % | 3 sin declaración |
| Analy Ruiz | Sin plan | 2 | 0 | 0 | 2 | 0 de 2 | 0 % | 2 sin declaración |
| Andres Felipe Gonzalez Gonzalez | Sin plan | 0 | 0 | 0 | 0 | 0 de 0 | — | — |
| Daniel Felipe Lopez Rendon | Sin plan | 0 | 0 | 0 | 0 | 0 de 0 | — | — |
| Jhonnatan Atehortua Alvarez | Sin plan | 0 | 0 | 0 | 0 | 0 de 0 | — | — |
| Jose Alejandro Diaz Urrego | Con plan | 0 | 0 | 0 | 0 | 0 de 0 | — | — |
| Nicolas Alejandro Suarez Florez | Sin plan | 0 | 0 | 0 | 0 | 0 de 0 | — | — |

**Quiénes tienen plan y quiénes no.** Con plan vigente hay **4**: Abraham Arana Aldana, Nilson Cortes, Francisco Javier Zuluaga A. y Jose Alejandro Diaz Urrego. Sin plan hay **14**. Pero el dato importante está cruzado: **solo 2 de las 4 personas con plan tienen algo cubierto** (las dos de AbraAran), y **Nilson Cortes tiene plan y cero cobertura** —su plan no coloca ninguno de sus 9 tickets—. Tener plan no equivale a tener trabajo planificado.

**Cinco personas sin tickets activos** —Andres Felipe Gonzalez, Daniel Felipe Lopez, Jhonnatan Atehortua, Jose Alejandro Diaz y Nicolas Alejandro Suarez—. No son un problema de declaración: no tienen trabajo que declarar. Se cuentan en la tabla con «—» en cobertura para no confundirlas con un cero, y se listan aparte en la pantalla.

### 2. La clasificación de los no planificables: por qué no entran

De los 84 tickets pendientes, el motivo se reparte así:

| Grupo | Causa | Tickets | Qué significa |
|---|---|---|---|
| **P1 — falta información** | `SIN_DECLARACION` | **79** | No hay estimación ni fecha compromiso |
| | `SIN_ESTIMACION` | **3** | Hay fecha compromiso, falta la estimación |
| | `SIN_COMPROMISO` | **0** | Hay estimación, falta la fecha |
| | `NO_TRADUCIBLE` | **0** | GLPI rechaza el ticket; no es un problema de declaración |
| **P2 — fuera por capacidad** | `FUERA_POR_CAPACIDAD` | **0** | El plan lo descartó por capacidad |
| **P3 — sin acuerdo** | `SIN_ACUERDO` | **1** | Desplazado y sin renegociación cerrada (`67923`) |
| **P4 — no incluido** | `NO_INCLUIDO_EN_EL_PLAN` | **1** | Planificable, pero el plan vigente no lo coloca |

**La lectura que importa: 82 de los 84 pendientes —el 97,6 %— se desbloquean con una declaración.** No hay un solo ticket fuera por capacidad. La falta de plan no es un problema del motor: es que al motor le falta el dato de entrada.

**Un caso que conviene dejar escrito**, porque parece una contradicción y no lo es: AbraAran tiene **3 planificables y solo 2 cubiertos**. El tercero es `67923`, que el plan desplazó y cuya renegociación sigue pendiente; por eso cuenta como `SIN_ACUERDO` y no como cubierto, aunque su declaración esté completa. JoseGarc tiene **1 planificable y 0 cubiertos**: su ticket está declarado y validado, pero el plan vigente se generó antes y no lo incluye. **Planificable y cubierto no son sinónimos**, y la pantalla los muestra en columnas distintas por eso.

### 3. La prioridad operativa: a quién llamar hoy

**El impacto de una llamada se mide en tickets que desbloquea, no en tickets que la persona tiene.** Por eso el orden no es el del padrón ni el de activos: es el de `blockedByInformation` (grupo P1), con desempate por pendientes y luego por activos.

| Prioridad | Persona | Tickets que desbloquea una declaración | Por qué |
|---|---|---|---|
| 1 | **Maury Marmolejo Din** | **10** | 10 sin declaración, sin plan |
| 2 | **Cesar Giraldo Muñoz** | **9** | 9 sin declaración, sin plan |
| 3 | **Nilson Cortes** | **9** | 9 sin declaración, con plan que no coloca ninguno |
| 4 | Jose Luis Garces Gonzalez | 8 | 2 sin estimación + 6 sin declaración (el noveno es P4) |
| 5 | Alejandro Pineda Machado | 7 | 7 sin declaración |
| 6 | Jose Fabian Gonzalez Tavera | 7 | 7 sin declaración |
| 7 | Silvia Alejandra Castro Garcia | 7 | 7 sin declaración |
| 8 | Abraham Arana Aldana | 6 | 6 de información (el séptimo es P3) |
| 9 | Stella Patricia Medina O. | 6 | 6 sin declaración |
| 10 | Andres Steven Beltran Forero | 5 | 5 sin declaración |
| 11–13 | Andres Felipe Escobar, Francisco Javier Zuluaga, Analy Ruiz | 3, 3, 2 | — |

**Las tres primeras llamadas desbloquean 28 tickets: el 33 % de todo lo pendiente.** No hace falta tocar a las 18 personas para mover la aguja.

### 4. La implementación

**Un solo archivo nuevo y una pantalla que ya existía.** La capa pura es `frontend/src/lib/coverage.ts`; la pantalla es `TeamTimeline.tsx`, que ya pedía las dos lecturas y ahora las cuenta. **No hay endpoint nuevo, ni consulta nueva, ni cambio de contrato.**

| Archivo | Qué hace | Por qué ahí |
|---|---|---|
| `frontend/src/lib/coverage.ts` (nuevo) | `coverageOf`, `teamCoverage`, `coverageTotals`, `coverageByGroup`, `priorityOrder`, `formatPercent` | Es el sitio de las funciones puras de la vista; se prueba sin montar la página |
| `frontend/src/pages/TeamTimeline.tsx` | Panel «Cobertura del plan» entre la nota de fuera del equipo y la rejilla: total, causas por grupo, «Llamar hoy a» y la tabla por persona | Es la pantalla que el gestor ya usa como entrada; la respuesta tiene que estar donde está la pregunta |
| `frontend/src/lib/coverage.test.ts` (nuevo) | 8 pruebas de la capa pura | Fija el conteo, el nulo, la suma y el orden de prioridad |

**La decisión de fondo: la cobertura no reclasifica.** El backend ya dice el estado de cada ticket y `lib/pending.ts` ya dice la causa de cada pendiente. Escribir en la cobertura una segunda regla —mirar si hay estimación— crearía dos sitios que cambian cuando el validador cambie, y la pantalla podría afirmar de una persona algo que el plan después desmiente. **Esta capa solo cuenta.**

**Nulo no es cero.** Si la declaración de una persona no se pudo leer, `coverageOf` devuelve `null` y la fila desaparece de la tabla —se cuenta en «sin leer», como ya hacía la capa de pendientes—. Pintarla con ceros afirmaría que no tiene trabajo pendiente, que es exactamente lo contrario de lo que se sabe.

**«En el plan» es una resta, y es válida.** `covered = activos − pendientes`, porque las dos listas salen de la misma lectura y pasan por el mismo `isActive`. No se puede cubrir más de lo que hay: la resta se acota a cero por si una lectura llegara inconsistente.

**La pantalla dice el motivo, no solo el número.** Bajo cada nombre, la fila escribe la causa en corto («6 sin declaración»); arriba, los cuatro grupos con su conteo; y en «Llamar hoy a», las tres personas con más tickets bloqueados y un enlace directo a su declaración. El enlace es `declarationPath({ developerId, from: ROUTES.teamTimeline })`, así que al terminar se vuelve al Timeline.

### 5. Las pruebas

| Prueba | Qué fija |
|---|---|
| «separa activos, declarados, planificables, pendientes y cubiertos» | Las cinco cifras de una persona no son la misma |
| «no inventa una cobertura cuando la declaración no se leyó» | El nulo, no una fila en cero |
| «cuenta como pendiente lo planificable que no está en el plan» | Planificable ≠ cubierto |
| «deja fuera a quien no se leyó y respeta el orden del padrón» | `teamCoverage` filtra y conserva orden |
| «suma tickets y no promedia porcentajes» | 7/15 = 46,7 %, no el promedio de filas |
| «con cero activos la tasa es cero, no un cien por ciento vacío» | El caso de las cinco personas sin tickets |
| «pone primero a quien desbloquea más tickets declarando» | `priorityOrder` |
| «agrupa las causas por la pregunta del gestor» | P1/P2/P3/P4 |
| «enseña la cobertura del plan y a quién llamar primero» (en `TeamTimeline.test.tsx`) | El panel completo: total, causas, prioridad, filas con y sin plan, y el «—» de quien no tiene tickets |

**Totales, re-ejecutados después del último cambio:**

| Suite | Resultado |
|---|---|
| Frontend (`vitest run`) | **302 pruebas / 19 archivos, todas en verde** |
| TypeScript (`tsc --noEmit`) | 0 errores |
| Lint (`oxlint`) | limpio |
| Backend (`mvn -q -o test`) | **392 pruebas, 0 fallos, 0 errores, 3 omitidas** (sin cambios: no se tocó) |

### 6. La validación en la instancia real (Playwright)

Sobre el backend y el frontend locales, contra GLPI real, el 2026-10-19:

| Criterio del brief | Resultado medido |
|---|---|
| Personas con plan | **4 filas «Con plan»**: AbraAran, NilsCort, FranZulu, JoseDiaz |
| Personas sin plan | **14 filas «Sin plan»** |
| Cobertura global | «**2 de 86 tickets activos en el plan (2,3 %)**» |
| Tickets bloqueados | **84 pendientes**; 82 de información, 1 de acuerdo, 1 no incluido |
| Motivo de bloqueo | Chips «Falta información: 82 · Sin acuerdo: 1 · No incluido en el último plan: 1» y la causa bajo cada nombre |
| Priorización por impacto | «Llamar hoy a Maury Marmolejo Din (10 tickets bloqueados) · Cesar Giraldo Muñoz (9) · Nilson Cortes (9)» |
| Acceso desde el Timeline | El enlace de Maury abre `/declaraciones?tecnico=MaurMarm&volver=%2F` con **sus 10 tickets** |
| Sin inventar datos | Las 5 personas sin tickets muestran «—», no «0 %» |

Capturas: `f45-cobertura.png` (el panel completo) y `f45-acceso-desde-timeline.png` (la declaración abierta desde la prioridad).

### 7. La declaración frente al proceso real

El brief pide contrastar la declaración con el proceso que de verdad ocurre —**el desarrollador estima, el usuario negocia, el gestor registra**— y decir dónde roza. Esto es lo que hay hoy, leído del código, y lo que no cubre:

**Lo que el modelo sí hace bien.** Una fila por ticket, con clave natural (`work_item_id`); la estimación y el compromiso pueden faltar por separado; cada cambio deja su autor y su fecha en el historial; y el estado «falta estimación / falta compromiso / falta todo» se deriva al leer, no se guarda —así que no puede quedar desincronizado—.

**Donde el proceso real no cabe en el modelo:**

1. **Un solo actor firma la operación entera.** `changedBy` es un texto libre de hasta 64 caracteres y firma ambos campos; el servidor deriva `estimatedBy` y `committedBy` de «quién cambió ese campo la última vez». Si el gestor registra la fecha que el usuario aceptó, **el historial dice que el compromiso lo puso el gestor**. El modelo no puede decir «estimó Ana, comprometió Carlos con el usuario»: solo dice quién pulsó guardar.
2. **No hay negociación como objeto.** No existe propuesta, contrapropuesta, aceptación ni rechazo; solo la fecha final. La negociación ocurre fuera del sistema y entra como un dato ya cerrado. Consecuencia: no se puede responder *por qué* una fecha es esa ni *quién* la acordó, que es justo la pregunta del gestor cuando algo se desplaza.
3. **La identidad es declarativa.** `changedBy` es texto libre y no hay autenticación en la ruta de escritura: cualquiera puede declarar en nombre de cualquiera. El historial es tan fiable como la buena fe de quien llama.
4. **El `PUT` reemplaza y no tiene bloqueo optimista.** Cambiar solo la fecha obliga a leer antes y reenviar la estimación; si entre la lectura y la escritura otra persona cambió el registro, **la segunda escritura gana en silencio** —la entidad no tiene `@Version`—.
5. **No hay estado de solicitud.** «Sin estimación» se calcula al leer, pero nadie puede marcar «pedida al desarrollador» o «esperando al usuario», así que no hay forma de asignar la tarea ni de seguirla. La cobertura dice *qué* falta, no *quién lo debe*.
6. **La fecha compromiso no tiene contraparte.** Cualquier fecha puede escribirse; no hay regla de que el usuario la haya aceptado. `SIN_ACUERDO` existe en el plan (desplazamientos), pero no en la declaración.

**Ninguna de estas fricciones se corrigió en esta fase**, porque cambiar el modelo de declaración es cambiar el proceso, no la observabilidad. Quedan escritas para que la fase que lo aborde no las descubra de nuevo.

### 8. Decisiones

### 219. La cobertura cuenta lo que ya está clasificado; no clasifica otra vez

El backend decide el estado de cada ticket y la capa de pendientes decide la causa. La cobertura solo suma esas dos lecturas. **Una segunda regla en la pantalla —mirar si hay estimación o compromiso— sería un validador paralelo**: podría discrepar del que usa el motor y afirmar de una persona algo que el plan desmiente. Si el validador cambia, la cobertura cambia con él sin tocar una línea, y ese es el punto.

### 220. La prioridad se mide en lo que una llamada desbloquea

Ordenar por tickets asignados pondría arriba a quien tiene más trabajo aunque ya lo tenga declarado. El gestor no necesita saber cuánto trabajo hay: necesita saber **cuánto de ese trabajo está parado por información que él puede conseguir**. Por eso el orden es `blockedByInformation` primero y el desempate es estable —pendientes, activos, identificador—: dos gestores que miren la misma pantalla ven la misma lista, y las pruebas también.

## Riesgos identificados

| # | Riesgo | Severidad | Tratamiento |
|---|---|---|---|
| 221 | **La cobertura solo cuenta a quien se leyó** | **Medio: subestima, no sobreestima** | El lote es serial y una lectura fallida deja a esa persona fuera de la tabla y en «sin leer». La cobertura global baja sin avisar de que falta alguien. **El panel ya dice cuántos no se leyeron**; si el lote crece, paralelizar o cachear la lectura por persona |
| 222 | **«Cubierto» mide el plan vigente, no el trabajo** | **Medio: el número caduca** | Un ticket puede estar planificado y el plan tener días de antigüedad; la cobertura dice lo que el plan colocó, no lo que sigue siendo válido. **Se regenera el plan y el número cambia**; conviene enseñar la fecha del plan junto a la cobertura |
| 223 | **La declaración no distingue roles y no está autenticada** | **Alto para el proceso, fuera del alcance de esta fase** | `changedBy` es texto libre y firma ambos campos; no hay bloqueo optimista. Hoy la escritura es de confianza interna, pero el historial no prueba quién declaró. **No se tocó**: cambiar el modelo es cambiar el proceso. Cualquier auditoría futura de la declaración tiene que empezar por aquí |
