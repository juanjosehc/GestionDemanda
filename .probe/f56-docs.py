from pathlib import Path

p = Path('docs/decisiones-arquitectonicas.md')
s = p.read_text(encoding='utf-8')
assert '## Fase 56' not in s

texto = """

## Fase 56 — La renegociación se opera en un modal y la demo enseña la cadena entera

La Fase 25 publicó la renegociación y la Fase 52 el simulador, pero cada uno arrastraba su propia fricción: la acción individual añadía una tarjeta debajo de la tabla —clic → desplazamiento → formulario, otra vez— y la demo de incidente, en su primer clic, contestaba que no desplazaba nada. Esta fase no toca backend, motor, capacidad, GLPI, persistencia, snapshots, desplazamientos ni renegociaciones reales: trabaja entero en el frontend y en la simulación de demostración.

### 291. La acción individual deja de ser una tarjeta y pasa a un modal sobre la fila

`RenegotiationForm` ya resolvía las decisiones que importan —leer el recurso antes de reemplazarlo, decidir `POST`/`PUT` por la existencia del acuerdo y enseñar el error del backend sin reinterpretarlo—, así que el modal lo importa tal cual con `bare`: el mismo cuerpo, sin su tarjeta ni su cabecera, porque el diálogo ya trae ambas. `Modal` es un contenedor nuevo (`components/ui/modal.tsx`) y **sí es modal**, a diferencia del `SidePanel` de la Fase 55: la escritura suspende la lista, oscurece lo de debajo, atrapa el Tab y cierra con Escape o con un clic que empieza en el fondo. La cabecera lleva el contexto completo —acción («Registrar el acuerdo» o «Reemplazar la fecha acordada»), estado, ticket, persona y plan—, y por eso el formulario no lo repite. El botón de la fila entrega `(workItemId, event.currentTarget)` y la pantalla lo guarda para devolver el foco ahí al cerrar; verificado en vivo: cancelar deja el foco en el botón «Registrar acuerdo» de la fila REQ-F38E-2, con `aria-expanded="true"`, y Escape en el de la fila 64007. `window.scrollY` no cambia al abrir ni al cerrar, y el diálogo cabe en el viewport.

### 292. El simulador elige un día que demuestre la cadena, no el primero de la ventana

El día por defecto era `days[0]` —julio, el extremo más antiguo del plan, sin trabajo— y un incidente de 4 h cabía de sobra: `needed = hours - remainingBefore` era negativo y `simulateIncident` devolvía «no desplaza ningún tramo». La demostración fallaba en el primer clic, que es el único que muchos van a hacer. El simulador ahora recorre la agenda de la persona con la propia función de simulación y elige el primer día cuyo desplazamiento incluya un **requerimiento**: es la única cadena que la demo tiene que enseñar completa —incidente, tramo movido y acuerdo pendiente—; desplazar solo incidentes no produce ninguna renegociación. Si no existe, cae al primer día donde el incidente no quepa y, en último término, al primero de la ventana, que es el comportamiento anterior. El cálculo se repite al cambiar de persona, porque el día demostrable de una puede ser un día vacío para otra. En vivo, con los datos reales, el primer clic sobre Abraham Arana Aldana (2026-10-20, 4 h) desplaza un incidente y dos requerimientos y deja la jornada en 0,5 h libres de 8.

### 293. La celda simulada se centra en su scroller y la simulación publica sus renegociaciones

Cuando el incidente sí desplazaba, la celda DEMO se pintaba en su columna cronológica —medida en unos 13.401 px desde el origen de la rejilla— y nada movía el scroller hasta ella: el resultado existía, pero fuera de la pantalla. `TimelineGrid` centra ahora el día simulado dentro de su propio contenedor (`[data-slot="timeline-scroll"]`), no la página, en un `requestAnimationFrame` tras cada simulación o cambio de zoom. Además, `simulateIncident` ya calculaba qué tramos eran renegociables pero **ningún componente leía `renegotiable`**: la cadena se cortaba en el tramo movido. El panel lista ahora una renegociación simulada por requerimiento desplazado, con la fecha original, la nueva, la causa («incidente DEMO 4 h · ALTO») y el estado «Pendiente de acuerdo · DEMO». La celda del incidente muestra la capacidad resultante —«quedan 0,5 h de 8» o «no cabe ni vaciando el día»— en lugar de esconderla, y la fila de la persona lleva un `DEMO` propio para que la simulación siga siendo visible aunque el día se salga de la vista. Todo lo pintado por la capa está marcado `DEMO` o `SIMULADO`.

### 294. La simulación sigue siendo una capa de cliente y no escribe nada

El simulador no llama al motor, ni a GLPI, ni a la base de datos: recalcula sobre los recursos e ítems que el Timeline ya cargó y guarda el resultado en un `useState` de la pantalla. Un incidente real llega por GLPI, lo planifica `PlanningEngine`, consume `CapacityBook`, deja un `reschedule_event` auditado y aparece como `PENDIENTE_DE_ACUERDO` con su renegociación asociada; la demo no reproduce ese recorrido —no puede, sin tocar lo que la fase prohíbe— y solo superpone marcas en memoria. Por eso desaparece entera al recargar, y por eso las renegociaciones DEMO no aparecen en `/renegociaciones`, que sigue leyendo el backend. La demostración es honesta en lo que promete: enseña el efecto de un incidente sobre la agenda cargada y dice, en el propio panel, que no toca el plan.

## Riesgos identificados

| # | Riesgo | Severidad | Tratamiento |
|---|---|---|---|
| 295 | **Las renegociaciones DEMO no aparecen en `/renegociaciones`** | **Bajo: documentado** | Esa pantalla lee el backend y la fase no lo toca. La cadena se ve entera dentro del Timeline y del simulador, que es donde la demo vive |
| 296 | **El simulador no reproduce el motor real** | **Bajo: es una demostración** | Usa `simulateIncident` sobre la agenda cargada, no `PlanningEngine` ni `CapacityBook`, y modela un solo incidente a la vez. Sirve para enseñar el desplazamiento, no para predecir un plan |
| 297 | **El día por defecto depende de que exista un día demostrable** | **Bajo: el panel lo dice** | Si nadie tiene un día donde el incidente por defecto desplace un requerimiento, el simulador cae al primer día donde no quepa y, si tampoco, al primero de la ventana; en ese caso el resultado puede decir «Cabe en la capacidad restante» y la persona puede cambiar fecha o duración |
| 298 | **El auto-centrado mueve el scroller al simular** | **Bajo: una vez por acción** | Se centra el día simulado dentro de la rejilla —no la página— tras cada simulación o cambio de zoom. La fila DEMO y el panel siguen visibles aunque el usuario desplace la rejilla a mano |

## Pruebas

Frontend: **363 pruebas en 22 archivos**, TypeScript sin errores, oxlint limpio. Nuevas esta fase: cuatro en `Renegotiations.test.tsx` —el diálogo abre con ticket, persona, plan y estado y el foco dentro; «Reemplazar» abre el mismo diálogo con la fecha anterior y Cancelar devuelve el foco al botón de la fila; Escape y el fondo cierran y devuelven el foco; guardar cierra el diálogo y deja la fila refrescada— y la prueba del simulador de `TeamTimeline.test.tsx` se amplió con la capacidad resultante, el `DEMO` de la fila, la renegociación simulada de REQ-1 con su causa, y la recarga que deja a cero el incidente, la lista y la fila. Backend: **393 pruebas, 0 fallos, 3 omitidas**, sin cambios —la fase no toca backend—. Playwright sobre la app real, viewport 1360×577: en `/renegociaciones`, «Registrar acuerdo» abre `role=dialog` con el ticket REQ-F38E-2, foco en la fecha, `window.scrollY` 0 antes y después y duración dentro del viewport; Cancelar devuelve el foco a la misma fila; «Editar acuerdo» abre «Reemplazar la fecha acordada» con la fecha anterior «mar, 3 de nov» y Escape lo cierra devolviendo el foco a la fila 64007. En el Timeline, el primer clic sobre los valores por defecto —Abraham Arana Aldana, 2026-10-20, 4 h, ALTO— deja «quedan 0,5 h de 8», desplaza 68831 (incidente) y los requerimientos 44221 y 62110 al 21 de octubre, pinta dos renegociaciones simuladas con causa y «Pendiente de acuerdo · DEMO», marca la fila con `DEMO` y centra la celda en la rejilla; recargar elimina el incidente, el resultado, las renegociaciones, la fila DEMO y los bloques con `data-demo`.
"""

p.write_text(s.rstrip() + texto + "\n", encoding='utf-8')
print('docs ok')
