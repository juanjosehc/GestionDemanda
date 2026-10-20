
## Fase 54 — El ticket se declara dentro del panel

La Fase 53 dejó el detalle del ticket junto al tramo, pero Declarar seguía navegando a `/declaraciones`: el Timeline desaparecía y el gestor tenía que encontrar el ticket en la lista antes de escribir una estimación y una fecha. La fase trae el formulario al panel, con el mismo componente, el mismo servicio y las mismas validaciones, y deja la pantalla completa para los lotes. No se toca motor, capacidad, GLPI, persistencia, snapshots, desplazamientos, renegociaciones ni backend: solo la pantalla del Timeline y una propiedad de presentación del formulario compartido.

### 275. Declarar abre el formulario dentro del panel, porque el formulario ya existe y lo que faltaba era el sitio

La pantalla de Declaración ya tenía la pieza difícil: `DeclarationForm` sabe leer la declaración viva antes de editar, decide entre crear y reemplazar, arma el cuerpo con los dos valores y enseña el error del backend sin reinterpretarlo. Un segundo formulario habría duplicado esas cuatro decisiones y, tarde o temprano, una de las dos copias habría quedado atrás. El panel importa el mismo componente y le pasa la fila `DeclarationItem` que ya conoce por la lectura de la agenda. `DeclarationForm` no cambió de contrato: solo ganó la propiedad `stacked`, que es CSS.

### 276. La fila de declaración sale del lote que la agenda ya cargó, no de una consulta nueva

El Timeline ya pedía las declaraciones de todas las personas para calcular la cobertura (`useTeamDeclarationsBatch`). El panel recibe de esa misma respuesta la fila del ticket —`declarationsById[developerId].items.find(...)`—, que es exactamente lo que el formulario necesita para saber si crea (`declaration: null`) o reemplaza. No se pidió una lectura más al abrir el panel ni se sintetizó el estado a partir del tramo: el estado de declaración lo clasifica el backend, y si esa lectura de la persona falló no hay fila y el panel enlaza a `/declaraciones`, que vuelve a leer antes de escribir. La única lectura nueva es la que el formulario ya hacía por su cuenta (`useDeclaration`) al editar, justo antes de pintar los campos.

### 277. Tres campos en una columna: la misma rejilla con otro punto de corte

En la pantalla los tres campos caben a lo ancho; en el panel de 448 px cada uno quedaría en 111 px y la fecha se cortaba (`19/10/202`, firmante `verificacion-fa`). La corrección no fue un formulario nuevo sino `stacked`, que cambia `sm:grid-cols-3` por una columna. Medido en el navegador: los tres campos a 350 px y enteramente dentro del viewport, sin desplazamiento para verlos ni para escribir. Copiar el formulario para cambiar una clase habría sido la duplicación más cara y la más fácil de dejar desincronizada.

### 278. Declarar es estado local del panel, anclado al tramo con `key`

El panel sigue sin estado global: `declaring` es un `useState` de `ItemDetail`, y `TeamTimeline` monta el panel con `key={item.workItemId}`. Cambiar de tramo remonta el detalle y devuelve el estado a «detalle», de forma que un formulario a medio escribir no viaja a otro ticket ni reaparece al volver al anterior. Guardar o cancelar devuelve el cuerpo del panel al detalle sin cerrarlo: la cabecera con el ticket sigue a la vista, la rejilla no se mueve y el foco y el desplazamiento no cambian.

## Riesgos identificados

| # | Riesgo | Severidad | Tratamiento |
|---|---|---|---|
| 279 | **Declarar dentro del panel depende de la lectura por persona** | **Bajo: el panel enlaza a la pantalla** | Si el lote de esa persona falló, no hay `DeclarationItem` y Declarar es el enlace de la Fase 53 a `/declaraciones?from=teamTimeline`, que vuelve a leer antes de escribir. No se inventa el estado ni se deja crear sobre una fila falsa |
| 280 | **La pantalla completa sigue siendo necesaria** | **Bajo: es el reparto** | El panel declara un ticket con el formulario; `/declaraciones` sigue siendo el lugar del trabajo por persona, por lote y de la revisión de pendientes. No se retiró nada de la pantalla |
| 281 | **Guardar en el panel no regenera el plan** | **Bajo: documentado y a un clic** | La declaración cambia el insumo; la duración del tramo la fija el plan vigente hasta que el motor vuelva a correr. El panel ofrece Generar plan en la misma fila de acciones, con el técnico ya puesto |
| 282 | **Mientras se declara, el detalle queda oculto** | **Bajo: la cabecera se mantiene** | El formulario sustituye solo el cuerpo; el identificador, el tipo, la persona y el estado siguen arriba, y Cancelar devuelve al detalle sin cerrar el panel. Un formulario encima del detalle habría tapado las cifras que se están declarando |

## Pruebas

Frontend: **354 pruebas en 22 archivos**, TypeScript sin errores, oxlint limpio. Nuevas esta fase, dos en `TeamTimeline.test.tsx`: un ticket sin declaración se declara dentro del panel —el `POST` lleva horas, fecha y firmante, el formulario se cierra, el detalle vuelve y la agenda sigue montada—, y un ticket ya declarado se edita con la lectura fresca —el `PUT` lleva los dos valores y el campo de horas trae lo que devolvió el `GET`, no lo de la lista—. Backend: **393 pruebas, 0 fallos, 3 omitidas**, sin cambios —la fase no toca backend—. Playwright sobre la app real, viewport 1360×577: clic en Incidente 68319 → panel con Declarar como botón y Generar plan a `/planificar?tecnico=AbraAran`; al pulsar Declarar, `GET /api/planning-metadata/68319` 200 y el formulario dentro del mismo diálogo con 6 h / 2026-10-19 / verificacion-fase-48, los tres campos a 350 px y enteros en el viewport, la rejilla montada en `scrollLeft 11486`; Guardar → `PUT /api/planning-metadata/68319` 200 con `{estimatedHours:6,committedDate:"2026-10-19",changedBy:"verificacion-fase-48"}`, el formulario desaparece, el detalle vuelve y el marco sigue en 11486; con el formulario abierto, clic en Requerimiento 67923 → un solo diálogo, título nuevo, cero formularios dentro y `scrollLeft` intacto; Escape → cero diálogos, foco de vuelta en el tramo y zoom Compacta sin tocar.
