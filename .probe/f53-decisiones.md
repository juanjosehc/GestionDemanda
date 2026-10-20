
## Fase 53 — El detalle del ticket vive donde se trabaja

El Timeline seleccionaba un tramo y pintaba su detalle en una caja del flujo, debajo de la rejilla y de los paneles de cobertura y conflictos. El gestor tenía que bajar hasta ella para leer el ticket y ejecutar sus acciones, y volver a subir para elegir el siguiente. La fase convierte ese detalle en un panel lateral fijo que no mueve la agenda, deja las acciones a la vista y no exige un solo desplazamiento para operar un ticket. No se toca backend, motor, capacidad, GLPI, persistencia, snapshots, desplazamientos ni renegociaciones: solo la pantalla del Timeline.

### 267. Panel lateral y no modal, porque el gestor tiene que seguir viendo la agenda

Un modal habría resuelto el desplazamiento, pero al abrirse habría tapado la rejilla y bloqueado justo la interacción con la que se elige el siguiente ticket: para cambiar de tramo habría que cerrar y volver a pulsar. El panel lateral —`fixed inset-y-0 right-0`, `max-w-md`, `z-50`, por encima de la barra lateral `z-40`— deja la agenda visible a la izquierda y deja viva la rejilla, de modo que un clic en otro tramo cambia el contenido del mismo panel. Es un `role="dialog"` no modal: no hay trampa de foco ni fondo oscurecido, porque el detalle acompaña a la agenda en vez de suspenderla. La elección se mide: con el panel abierto, los 71 tramos siguen en el DOM y el marco conserva su `scrollLeft` (`11493`), de modo que lo que se estaba mirando sigue debajo.

### 268. El panel pinta lo que la lectura ya trajo; no calcula ni consulta

El contenido del detalle —identificador, tipo, persona, estado, duración y estimación, compromiso, plan de origen, desplazamiento auditado, renegociación, conflicto y cobertura— sale de tres fuentes que la pantalla ya tenía en memoria: el `TimelineItem` de la respuesta, el `RenegotiationItem` indexado por ticket y la fila de `DeveloperCoverage` que la tabla del Timeline ya calculó para esa persona. La cobertura se recibió como prop nueva —`coverage={coverageRows.find(...)}`— en vez de recalcularse: la frase «4 de 9 tickets activos en el plan · 5 pendientes · 5 recuperables declarando» es exactamente la fila que la cabecera de cobertura muestra, no una segunda cuenta que podría divergir. No hay endpoint nuevo, ni consulta a GLPI, ni una llamada al motor.

### 269. Las acciones son las de siempre, y cada una aparece solo si el dato la sostiene

Las cuatro acciones son enlaces a pantallas existentes con los parámetros que esas pantallas ya aceptaban: Declarar lleva a la declaración con `from=ROUTES.teamTimeline`, Abrir detalle al calendario del plan de origen, Comparar a la comparación del mismo plan y Renegociar a la ruta de renegociación del ticket. No se duplicó ningún formulario ni se añadió lógica de negocio: cambia el lugar desde el que se llega, que es lo que convierte esas pantallas en modos del Timeline. Renegociar solo se pinta cuando el tramo se desplazó o tiene renegociación asociada; una acción que llevara a una lista vacía enseñaría a desconfiar de la pantalla entera.

### 270. Cerrar y cambiar de ticket se resuelven sin estado global

La selección sigue siendo un `useState` de la pantalla —el mismo que ya existía—, así que no hubo que añadir contexto, store ni parámetros de dirección. Para devolver el foco al tramo, `TeamTimeline` guarda en un `useRef` el elemento activo en el momento de abrir y lo enfoca al cerrar; el panel atiende Escape con un listener de ventana y enfoca su contenedor al montarse. El desplazamiento del marco no se toca en ningún momento: no hay que guardarlo ni restaurarlo porque abrir y cerrar un `fixed` no lo altera. Comprobado en el navegador: tras cerrar con el botón y con Escape, `document.activeElement` es el botón del tramo y el marco conserva `scrollTop` y `scrollLeft`.

## Riesgos identificados

| # | Riesgo | Severidad | Tratamiento |
|---|---|---|---|
| 271 | **En escritorio el panel tapa 448 px de agenda** | **Bajo: se cierra y la rejilla no se mueve** | El ancho es una clase (`max-w-md`) y el panel no altera el desplazamiento del marco. En móvil ocupa la pantalla entera, que es la única forma de que el detalle sea legible |
| 272 | **La selección no viaja en la dirección** | **Bajo: documentado** | Al salir a Declarar o Comparar y volver, el Timeline abre sin tramo elegido. Llevar la selección a la URL añadiría un parámetro y una ruta de retorno; el encargo pedía volver al mismo punto al cerrar, no tras navegar |
| 273 | **El panel no atrapa el foco** | **Bajo: es deliberado** | Es un diálogo no modal: Tab puede salir hacia la agenda. Atrapar el foco impediría el cambio de ticket con el teclado, que es lo que el panel existe para permitir |
| 274 | **La cobertura depende de la lectura de declaraciones** | **Bajo: el panel omite la línea si falta** | Si la lectura de esa persona falló, `coverage` llega `undefined` y la línea no se pinta; el resto del detalle —tramo, desplazamiento, renegociación— sigue disponible porque viene de otra fuente |

## Pruebas

Frontend: **352 pruebas en 22 archivos**, TypeScript sin errores, oxlint limpio. Nuevas esta fase, cuatro en `TeamTimeline.test.tsx`: el detalle abre como panel `fixed` y la rejilla sigue en pantalla; elegir otro tramo cambia el contenido sin cerrar el panel y sin duplicarlo; el cierre con botón y con Escape devuelve el foco al tramo; y la línea de cobertura de la persona aparece dentro del detalle. Las dos consultas del detalle que usaban `role="region"` pasaron a `role="dialog"`. Backend: **393 pruebas, 0 fallos, 3 omitidas**, sin cambios —la fase no toca backend—. Playwright sobre la app real, viewport 1360×577: clic en Incidente 68319 → panel `role=dialog`, `position: fixed`, `z-index: 50`, rect `{x: 897, w: 448}`, con Declarar, Abrir detalle y Comparar a `y=124` dentro del viewport y la agenda visible a la izquierda; cambio a Requerimiento 66222 → un solo diálogo, título nuevo, mismo `scrollLeft`; clic en el desplazado Requerimiento 64007 → aparece Renegociar junto a la fecha original, la nueva, la regla, el incidente y la renegociación acordada; cierre con el botón «Cerrar detalle» y con Escape → cero diálogos, marco en `{top: 0, left: 11493}` y `activeElement` de vuelta en el tramo.
