# Fase 47 — ¿La declaración registra un acuerdo o solo guarda datos?

Auditoría funcional, de proceso y de cobertura. **No se implementó nada**: no se tocó `PlanningEngine`, ni capacidad, ni desplazamientos, ni renegociaciones, ni el modelo de datos, ni la integración con GLPI. La única escritura fue la validación en vivo descrita en la Parte 6, y su residuo queda anotado al final.

---

## Parte 1: cómo funciona hoy Declaration

### 1.1 El recorrido completo, con los archivos que lo sostienen

```
GLPI (tickets activos por técnico)
  └─ PlanningDeclarationService.declarationsFor(developerId)
       └─ GlpiPlanningRequestFactory.verdicts(...)   ← decide el estado
            └─ DeclarationStatus: PLANIFICABLE | SIN_ESTIMACION |
                                 SIN_COMPROMISO | SIN_DECLARACION | NO_TRADUCIBLE
       └─ PlanningMetadataRepository  ← la fila que escribió el gestor
            (estimatedHours, committedDate, estimatedBy/At, committedBy/At, source)
       └─ DeclarationItem = veredicto + declaración
  └─ GET /api/planning/declarations/{developerId}  (o ?developerId=… repetido)
  └─ Declarations.tsx → DeveloperPicker + resumen + DeclarationTable + DeclarationForm
       └─ POST /api/planning/metadata          (crear: al menos un valor)
       └─ PUT  /api/planning/metadata/{ticket} (reemplazar: puede dejar ambos nulos)
```

**La clasificación no vive en el frontend.** El backend vuelve a decidir el veredicto con cada lectura; el cliente solo pinta lo que recibe. Eso es deliberado y funciona: la pantalla no puede inventar un `PLANIFICABLE`.

### 1.2 Qué datos captura

| Dato | Quién lo escribe | Dónde vive | Observación verificada |
|---|---|---|---|
| `estimatedHours` | El desarrollo, transcrito por el gestor | `planning_metadata` | Escala 4, mínimo 0.01, máximo 999999.9999 |
| `committedDate` | El usuario, transcrito por el gestor | `planning_metadata` | Fecha pura, sin hora |
| `estimatedBy` / `estimatedAt` | Derivados de `changedBy` | `planning_metadata` | **Solo se renuevan si el valor cambia** (`declaredWith`) |
| `committedBy` / `committedAt` | Derivados del mismo `changedBy` | `planning_metadata` | **Un solo firmante para las dos mitades** |
| `changedBy` | El gestor, texto libre, máx. 64 | Solo en la petición; se usa para derivar las firmas y el historial | Se vuelve a escribir en cada ticket |
| `source` | La petición (`InputSource`) | `planning_metadata` | No se elige desde la pantalla; el frontend no lo envía |
| Historial de cambios | El servidor | Una fila por campo cambiado | **Ningún componente del frontend lo consume** |

Lo que **no** captura: quién pidió el trabajo, quién lo asignó al técnico, qué se negoció (propuesta, contrapropuesta), quién aceptó la fecha, qué día se acordó, ni si la fecha ya venció en la pantalla de Declaración (`commitmentOverdue` existe en el tipo y solo lo pinta `DeclaredGapTable`, no esta tabla).

### 1.3 La pantalla, campo por campo

| Elemento | Qué hace | Fricción observada |
|---|---|---|
| `DeveloperPicker` | Padrón agrupado «Equipo operativo» / «Resto del padrón»; muestra nombre, nunca login; `· excepción`; «no está en el padrón de hoy» | Correcto. Resuelve el problema de identidad que el resto de la app todavía no resuelve |
| Resumen de 5 figuras | Activos, declarados, pendientes, sin estimación, sin compromiso, con la advertencia de que los pendientes no son la suma de las dos causas | Correcto y honesto |
| `DeclarationTable` | Tipo, ID, Título, Estado, Prioridad cruda, Fecha de creación, veredicto + código + motivo, acción | El estado se enseña como código (`SIN_ESTIMACION`); no enseña vencimiento |
| `DeclarationForm` | Horas, fecha, «Quién declara»; guarda con POST o PUT | Un solo firmante; el campo obligatorio de HTML es solo «Quién declara» |
| «Declarar siguiente pendiente» | Salta el ticket abierto y abre el primer pendiente | Convierte la pantalla en cola de trabajo: es la mejor decisión de UX del módulo |
| Contexto desde el Timeline (`tecnico`, `ticket`, `volver`) | Se lee **una sola vez** (`useState(() => …)`) y la vuelta dice «Volver a Timeline» | Correcto: el contexto no cambia bajo los pies; el enlace de vuelta es explícito |
| Sin DELETE | No existe en el servicio ni en el backend | Una declaración errónea solo se corrige sobrescribiendo |

### 1.4 Quién es el actor principal, según lo que el sistema permite

**El gestor de demanda, escribiendo por los demás.** No hay sesión, no hay roles, no hay developer autenticado: el técnico se elige de una lista y el firmante se teclea. El sistema, tal como está, **no puede distinguir** si la estimación la dijo el desarrollo o el gestor, ni si la fecha la aceptó el usuario o la impuso el gestor. `estimatedBy` y `committedBy` son etiquetas que el gestor se pone a sí mismo.

---

## Parte 2: proceso real frente a lo que el sistema registra

| Paso real | Qué hace el sistema hoy | ¿Está representado? |
|---|---|---|
| 1. Llega el ticket y se asigna a un técnico | GLPI lo trae ya asignado; el sistema lo lee | **Sí**, como dato de entrada, no como acción |
| 2. El desarrollo estima el esfuerzo | El gestor transcribe las horas; `estimatedBy` = quien tecleó | **Parcial**: el valor existe, el actor real no |
| 3. El usuario negocia la fecha | El gestor transcribe la fecha; no hay estado de negociación | **Parcial**: el resultado existe, el proceso no |
| 4. El gestor registra el acuerdo | `POST/PUT` con un solo `changedBy` | **Parcial**: se registra el dato, no el acuerdo (dos partes, dos firmas) |
| 5. El motor planifica | `POST /api/planning/from-glpi` en otra pantalla, pidiendo el **login GLPI en texto libre** | **Sí**, pero en un salto manual sin enlace prellenado |
| 6. El Timeline ejecuta | Coloca el ticket o lo desplaza; si lo desplaza exige un acuerdo en **otra** pantalla | **Sí**, pero el ciclo queda partido en tres pantallas |

**Conclusión de la Parte 2:** el sistema representa el **resultado** del acuerdo (dos valores y dos etiquetas), no el **acuerdo** (dos partes que aceptan, cada una con su firma y su fecha). Un formulario que guarda el resultado de una conversación no es lo mismo que un registro del acuerdo, y la diferencia no es cosmética: es la diferencia entre poder decir «el usuario aceptó el 24» y «alguien escribió 24».

### Fricciones concretas, en orden de coste operativo

1. **Una firma para dos actores.** `changedBy` firma estimación y compromiso. Si el gestor registra la fecha que el usuario aceptó, el historial afirma que el compromiso lo puso el gestor. Es el defecto más grave del modelo actual.
2. **El firmante se teclea en cada ticket.** Con 81 pendientes, eso son 81 escrituras a mano de un dato que no cambia en toda la sesión.
3. **La negociación no es un objeto.** No hay «pedida», «en espera», «aceptada», «rechazada», ni a quién se le pidió. La cobertura puede decir *qué* falta, nunca *quién lo debe*.
4. **No hay asignación ni recordatorio.** Nadie puede tomar un pendiente y decir «yo lo cierro». La lista de llamadas ordena, pero no compromete.
5. **Declarar no cierra el ciclo.** Verificado en vivo: declarar convierte P1 en P4; hay que ir a Planificación, generar el plan, y si hay desplazamiento, ir a Renegociaciones. **Tres pantallas por un ticket.**
6. **La validación «al menos un valor» solo existe en el backend.** El formulario marca como obligatorio únicamente «Quién declara»; enviar sin horas ni fecha produce un 400, no un mensaje junto al campo.
7. **`/planificar` sigue pidiendo el login GLPI escrito a mano** («Identificador en GLPI, p. ej. 296»), aunque el resto de la app ya usa nombres y el padrón.
8. **El vencimiento del compromiso no se ve donde se edita.** `commitmentOverdue` se calcula y se transporta, pero Declaración no lo pinta: una fecha vencida se ve igual que una futura.
9. **El `PUT` reemplaza y no tiene bloqueo optimista.** Editar solo la fecha exige releer y reenviar las horas; dos escrituras concurrentes, la segunda gana en silencio.

---

## Parte 3: ¿por qué 84 tickets siguen bloqueados?

La respuesta medida no está en Declaration: está en **lo que Declaration no puede hacer sola**.

- **Los 84 bloqueados son todos P1 (falta información).** Cero por capacidad. Nada en el sistema impide declararlos; lo que falta es que alguien, con nombre, tenga la llamada asignada.
- **El bloqueo es de adquisición, no de registro.** El módulo es un formulario correcto para el momento en que ya se tienen los dos datos. No hay nada en él —ni en el resto de la app— que diga *a quién* se le pidió el dato, *cuándo* se pidió, ni *qué pasa si no llega*.
- **Declarar mueve el ticket de P1 a P4, no a cubierto.** Medido: 33219 declarado → P4, cobertura sin cambios. Solo pasó a cubierto tras generar plan y registrar acuerdo.
- **La métrica castiga el acto que quiere premiar.** `potential = covered + P1` no suma P4, así que declarar un ticket **baja** la cobertura potencial hasta que el plan lo coloque. Medido: 85 → 83 → 84.

---

## Parte 4: medición en vivo del ciclo completo (Playwright)

Instancia local, backend real, GLPI real, 2026-10-19. Horas UTC (la pantalla muestra UTC-5).

| Momento | Acción | Cobertura | Causas | Maury |
|---|---|---|---|---|
| 20:01 | Línea base | **2 de 87 (2,3 %)** · 83 recuperables · potencial **85 de 87 (97,7 %)** | P1 83 · P3 1 · P4 1 | 0 de 10 |
| 20:02 | Declarar 33219: 8 h, 2026-10-24, «verificacion-fase-47» | fila **PLANIFICABLE**; el formulario se cierra | — | 10 activos · 1 declarado · 9 pendientes |
| 20:03 | Timeline, sin regenerar plan | **2 de 86 (2,3 %)** · 81 recuperables · potencial **83 de 86 (96,5 %)** | P1 81 · P3 1 · **P4 2** | 0 de 10 · «1 no incluido en el último plan» |
| 20:04 | Generar plan de MaurMarm | plan `d5e66ce6…`: 1 asignación (33219, **2026-10-26**, 8 h), 1 desplazamiento `CAPACIDAD_DIARIA_EXCEDIDA`, 0 conflictos, 64 descartes | — | — |
| 20:05 | Timeline tras el plan | **2 de 86 (2,3 %)** · potencial 83 de 86 | P1 81 · **P3 2** · P4 1 | 0 de 10 |
| 20:08 | Registrar acuerdo 33219 → 2026-10-26 | ACORDADA; pendientes 3 · acordadas 2 | — | — |
| 20:09 | Timeline tras el acuerdo | **3 de 86 (3,5 %)** · 81 recuperables · potencial **84 de 86 (97,7 %)** | P1 81 · P3 1 · P4 1 | **1 de 10 (10 %)** |

**Lectura de la tabla:**

- El activo bajó de 87 a 86 entre 20:01 y 20:03 **por GLPI**, no por la declaración (riesgo 228 ya documentado).
- **Declarar no subió la cobertura.** La bajó temporalmente (P1→P4). Es el hallazgo central de la fase.
- El motor respetó la fecha pedida solo parcialmente: la movió del 24 al 26 por jornada ocupada. Eso convirtió el ticket en P3.
- Solo el acuerdo de renegociación lo volvió cubierto. **Una declaración real es un ciclo de tres pantallas, no un formulario.**
- La cobertura potencial a las 20:09 era 84 de 86, pero había 1 P4 planificable fuera del cálculo: el techo real medido era **85 de 86**, no 84.

Capturas: `.probe/f47-cobertura-despues.png`, `.probe/f47-declaracion-guardada.png`, `.probe/f47-renegociacion-acordada.png`. Datos crudos: `.probe/f47-flujo.json`.

---

## Parte 5: recomendaciones priorizadas (operativas, no cosméticas)

### Las tres que más cobertura mueven

1. **Declaración en lote por persona, desde el Timeline.** Un drawer sobre la fila que permita escribir horas y fecha de varios tickets de esa persona sin salir de la cobertura, reutilizando los mismos endpoints. Impacto: las 81 llamadas P1 están concentradas en 15 personas; Maury solo tiene 10. Hoy cada ticket cuesta un viaje de pantalla. *Esto no cambia el modelo: usa `POST`/`PUT` existentes.*
2. **Cerrar el ciclo en el mismo flujo.** Tras guardar, no volver a la tabla: ofrecer «Generar plan de esta persona» (prellenando `developerId`) y, si hay desplazamiento, «Registrar acuerdo» (prellenando el ticket). Impacto directo medido: sin esos dos pasos la declaración no eleva la cobertura; con ellos sube en la misma sesión.
3. **Prellenar y recordar «Quién declara», y prellenar el técnico en `/planificar`.** El firmante es constante en una sesión y hoy se teclea 81 veces; la pantalla de planificación pide el login GLPI a mano cuando el resto de la app ya usa el padrón. Impacto: elimina la fricción mecánica de cada ticket.

### Cambios de modelo que la auditoría recomienda, pero que esta fase no implementa

4. **Dos firmas explícitas** (`estimatedBy` y `committedBy` por separado en la petición). Es el cambio que convierte «guardar datos» en «registrar un acuerdo». Requiere decisión de negocio y migración.
5. **Estado de negociación por ticket** (pedida / en espera / aceptada / rechazada, con responsable). Es lo que permitiría asignar las 81 llamadas y medir tiempo de respuesta.
6. **Enseñar `commitmentOverdue` en la tabla** y validar «al menos un valor» en el cliente.

Orden recomendado: 3 → 1 → 2 (solo frontend, sin tocar el motor), después 4 y 5 (modelo), 6 como higiene.

---

## Parte 6: ¿pantalla independiente o acción del Timeline?

**Las dos cosas, con una separación clara:**

- **La pantalla se queda** como *espacio de trabajo de una persona*: es la única superficie donde se ve el padrón completo, el resumen activos/declarados/pendientes y la cola «Declarar siguiente pendiente». Para cerrar a alguien con 10 tickets, una pantalla dedicada es mejor que diez drawers.
- **El Timeline gana una acción contextual de una sola pieza** («Declarar» en la fila/ticket) para el caso más frecuente del gestor: abrir el panel de cobertura, ver qué falta y escribir el dato sin perder la vista de cobertura. Es el caso medido: 81 P1 repartidos en 15 personas, con llamadas cortas de uno o dos datos.

**Justificación con evidencia, no con preferencia:** la pantalla ya se comporta como cola (contexto `tecnico`/`ticket`/`volver`, `declareNext`, enlaces desde la tabla y la rejilla); lo que no puede hacer es mantener visible el efecto en la cobertura, que es justo la pregunta del gestor. La acción contextual no reemplaza la pantalla: evita el viaje cuando el objetivo es *mover la cifra*, no *trabajar a una persona*.

**No recomendado:** eliminar la pantalla o mover todo al Timeline. El 10-de-10 de Maury se trabaja mejor en una lista que en diez clics sobre una rejilla.

---

## Parte 7: la jornada del gestor con los datos de hoy

1. **08:00 — Timeline.** Lee «2 de 86 · 81 recuperables · potencial 84 de 86». Ve la lista de llamadas: Maury 9, Cesar 9, Nilson 9, JoseGarc 8, Abraham 7.
2. **08:10 — Declaración de Maury** (`/declaraciones?tecnico=MaurMarm`). 9 pendientes, todos «Sin declaración». Abre el primero con «Declarar siguiente pendiente».
3. **08:10–09:30 — La llamada.** Por cada ticket: pide horas al desarrollo y fecha al usuario, teclea su nombre otra vez, guarda. La pantalla se refresca y ofrece el siguiente. **No hay forma de registrar que la llamada se hizo o que quedó pendiente de respuesta.**
4. **09:30 — Vuelve al Timeline.** La cobertura no cambió (P1→P4). Tiene que recordar que debe generar el plan.
5. **09:35 — Planificación** (`/planificar`): escribe el login GLPI de Maury a mano, genera el plan. Algunos tickets se desplazan.
6. **09:40 — Renegociaciones:** registra cada desplazamiento. Ahora sí sube la cobertura, ticket a ticket.
7. **Resto del día:** repite con Cesar, Nilson, JoseGarc, Abraham. **Cada persona es un ciclo de tres pantallas; cada ticket, una escritura manual del firmante.**

Lo que la jornada demuestra: el gestor no tiene un sistema que le ayude a *conseguir* la información; tiene un sistema que *registra* la información una vez conseguida. La parte cara —conseguirla— sigue siendo teléfono y memoria.

---

## Parte 8: respuestas explícitas

**¿La declaración representa realmente el acuerdo entre desarrollador, usuario y gestor?**
**No.** Representa su resultado: dos valores y una firma. El desarrollo y el usuario no aparecen como actores; el gestor firma las dos mitades y el historial no puede distinguir quién dijo qué. La pantalla *dice* que es el acuerdo, pero el modelo solo guarda datos. Es un formulario de transcripción, no un registro de acuerdo.

**¿Qué tres cambios concretos aumentarían más rápido la cobertura?**
1. Declaración en lote por persona desde el Timeline (mismos endpoints).
2. Cerrar el ciclo tras guardar: generar plan y registrar acuerdo en el mismo flujo, prellenados.
3. Prellenar/recordar «Quién declara» y prellenar el técnico en `/planificar`.

**¿Debe Declaración seguir siendo una pantalla o convertirse en una acción del Timeline?**
Ambas: la pantalla se queda como espacio de trabajo por persona (el caso de 10 tickets lo exige); el Timeline gana una acción contextual de una pieza para el caso frecuente de mover la cifra sin perder la cobertura a la vista.

---

## Parte 9: decisiones (230–232) y riesgos (233–236)

### 230. La auditoría no cambia el modelo: el modelo se propone

El hallazgo de esta fase es que el problema no es de pantalla sino de actores: `changedBy` firma estimación y compromiso. Cambiar eso es cambiar el contrato y el historial, con migración y decisión de negocio. Se documenta como propuesta (dos firmas, estado de negociación) y **no se implementa** en una fase que nació como auditoría. Fingir que un botón más arregla el acuerdo habría sido el error caro.

### 231. Declarar no es cubrir: el ciclo mínimo son tres pasos

Medido en vivo: declarar convierte P1 en P4; el plan puede desplazar; el acuerdo convierte el desplazamiento en cobertura. Cualquier métrica o texto que presente «declarar» como sinónimo de «cubrir» miente sobre el proceso. La cobertura debe seguir contando solo lo que el plan colocó y la fecha se acordó.

### 232. La acción contextual del Timeline convive con la pantalla, no la reemplaza

La pantalla es mejor para trabajar a una persona con volumen; el Timeline es mejor para mover la cifra sin perder el contexto. La regla es el tamaño de la unidad de trabajo: 10 tickets → pantalla; 1 ticket mientras se mira la cobertura → drawer. Eliminar una de las dos obliga a la otra a hacer un trabajo para el que no está hecha.

## Riesgos identificados

| # | Riesgo | Severidad | Tratamiento |
|---|---|---|---|
| 233 | **La cobertura potencial excluye P4 y por eso castiga declarar** | **Alto para la lectura operativa** | `potential = covered + P1`. Un ticket recién declarado sale de P1 y entra en P4: la cifra baja aunque el trabajo esté hecho. Medido 85 → 83. **Tratamiento propuesto:** sumar P4 planificable al techo, o enseñar el potencial como rango («hoy 84; con el plan regenerado, 85»). No se cambió: altera la definición de la métrica de la fase 46 |
| 234 | **Una declaración real ocupa tres pantallas** | **Alto: coste por ticket** | Declaración → Planificación → Renegociación. Medido con 33219. **Tratamiento propuesto:** encadenar las tres desde el resultado de guardar (recomendación 2). No se implementó: es flujo nuevo, no observabilidad |
| 235 | **Un solo firmante para dos actores** | **Alto: el dato no prueba el acuerdo** | `changedBy` deriva `estimatedBy` y `committedBy`. El historial no puede distinguir quién dijo qué. **Tratamiento propuesto:** dos firmas en la petición y en el historial; decisión de negocio pendiente |
| 236 | **La validación del cliente no replica la regla del servidor, y `/planificar` pide el login** | **Bajo: fricción y 400 evitables** | El formulario exige solo «Quién declara»; sin horas ni fecha el usuario ve un 400. `/planificar` escribe el login GLPI a mano. **Tratamiento propuesto:** mismo `@AssertTrue` en el cliente y selector de padrón en planificación |

## Residuo de la validación (declarado, no oculto)

La validación escribió datos reales porque el flujo lo exige: metadata de `33219` (8 h, 2026-10-24, firmada «verificacion-fase-47»), plan `d5e66ce6-7e1b-4bb8-abab-72fb27ef3f7b` y un acuerdo de renegociación para `33219` el 2026-10-26. **No existe endpoint DELETE** (riesgo 158), así que queda en la base y es coherente con lo medido. Los archivos `f47-*.png` y `.probe/f47-flujo.json` son la evidencia.

## Pruebas

**No se modificó código.** Últimas suites conocidas: frontend 306/306 en 19 archivos, TypeScript sin errores, oxlint limpio; backend 392 pruebas, 0 fallos, 3 omitidas (sin cambios desde la fase 46). Esta fase no añade ni cambia pruebas.
