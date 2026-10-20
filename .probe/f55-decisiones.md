
## Fase 55 — El formulario de declaración aparece donde está la fila

La Fase 54 llevó la declaración al panel del Timeline, pero la pantalla de Declaración seguía con el patrón antiguo: pulsar «Declarar» o «Editar» añadía el formulario como una tarjeta dentro del flujo, debajo de la tabla y del panel de cierre de ciclo, y el gestor tenía que bajar a buscarlo. La fase sustituye clic → desplazamiento → formulario por clic → panel → formulario. No se toca backend, motor, capacidad, GLPI, persistencia, snapshots, desplazamientos, renegociaciones ni el lote: solo la pantalla de Declaración, su tabla, el formulario compartido y un contenedor nuevo.

### 283. El formulario sale del flujo y pasa a un panel lateral fijo, y no se copia: se reutiliza

`DeclarationForm` ya resolvía las cuatro decisiones que importan —crear o reemplazar con la fila `declaration`, leer la declaración viva antes de editar, enviar siempre los dos valores y enseñar el error del backend sin reinterpretarlo—. Montar un segundo formulario dentro del panel habría duplicado esas cuatro y, tarde o temprano, una copia habría quedado atrás. El panel importa el componente tal cual y solo le pasa la fila `DeclarationItem` que la tabla ya recibió; las validaciones, las mutaciones y la invalidación del lote de declaraciones siguen viviendo en `useDeclarations`. El cambio de sitio es un contenedor `fixed inset-y-0 right-0 z-50`, fuera del flujo: la tabla no se redimensiona y `main.scrollTop` no se mueve al abrirlo —700 → 700 en la fila 44221, 876 → 876 en la 62110—.

### 284. El panel se extrae a `SidePanel` para que Declaración y Timeline no sean dos dibujos parecidos

La Fase 53 ya tenía el contenedor exacto que esta pantalla necesitaba —`fixed`, `max-w-md`, `z-50`, cabecera fija, cuerpo con scroll propio, `role="dialog"` no modal, Escape y botón de cerrar—. Copiarlo en `Declarations.tsx` habría producido dos paneles que se ven iguales hoy y divergen al primer retoque de uno de ellos. `components/ui/side-panel.tsx` guarda ese contenedor y lo usan las dos pantallas; el Timeline perdió sus dos efectos y su marcado, y la cabecera y el cuerpo se pasan como nodos. La igualdad visual con la Fase 54 deja de ser una coincidencia comprobada a ojo y pasa a ser la misma clase.

### 285. El foco vuelve al botón que se pulsó, no a `document.activeElement`

`DeclarationTable` entrega `(workItemId, event.currentTarget)` y la pantalla guarda ese botón en un `useRef` al abrir. `document.activeElement` habría funcionado con el ratón, pero no con un clic disparado desde código ni con los eventos de prueba —`fireEvent.click` no enfoca—, y habría devuelto el foco a donde estuviera antes del clic en vez de a la fila que lo abrió. Con el botón explícito, cerrar con Cancelar, con la X o con Escape devuelve el foco a la misma fila en el navegador y en las pruebas; verificado en vivo tras Cancelar: cero diálogos, `document.activeElement` en el botón «Declarar» de la fila 62110 y `main.scrollTop` todavía en 876.

### 286. El primer campo recibe el foco, y el panel no se lo quita

El campo de horas lleva `autoFocus`: al abrir el panel el cursor está donde se empieza a escribir, sin Tab. Como React aplica `autoFocus` en el commit y el panel enfoca su contenedor en un efecto, el panel comprueba antes `panel.contains(document.activeElement)`: si un campo ya tomó el foco, no lo roba. El `autoFocus` solo se dispara cuando el formulario se monta a la vista —al pulsar una fila o cuando llega la lectura previa—, así que no desplaza la pantalla al cargar. El panel se monta con `key={workItemId}`: cambiar de fila lo remonta en el ticket nuevo, vuelve a dejar el foco en el primer campo y no arrastra lo escrito para el anterior.

## Riesgos identificados

| # | Riesgo | Severidad | Tratamiento |
|---|---|---|---|
| 287 | **En escritorio el panel tapa 448 px de tabla** | **Bajo: la tabla no se mueve** | Es `fixed`, así que la tabla conserva su anchura y su desplazamiento; se cierra para volver a ella. En móvil ocupa la pantalla entera, que es lo único que cabe |
| 288 | **El panel no es modal y no atrapa el foco** | **Bajo: es deliberado** | Pulsar otra fila cambia el contenido del mismo panel sin cerrarlo, que es el recorrido que la fase quería; atrapar el foco lo impediría con el teclado. Tab puede salir hacia la tabla |
| 289 | **Al guardar, el foco vuelve a la fila y el navegador puede desplazarla a la vista** | **Bajo: posterior al guardado, nunca al abrir** | El panel de cierre de ciclo aparece encima de la tabla y la página crece; enfocar el botón de la fila lo deja a la vista. Ocurre al guardar —cuando el gestor quiere ver el resultado—, no para llegar al formulario, que es lo que la fase elimina |
| 290 | **El panel depende de la fila que trajo la tabla** | **Bajo: la pantalla ya tiene su estado de error** | Si la lectura no llegó, no hay fila y no hay panel; la pantalla muestra el error o el vacío existentes. No se abre un panel sin ticket ni se inventa un estado de declaración |

## Pruebas

Frontend: **359 pruebas en 22 archivos**, TypeScript sin errores, oxlint limpio. Nuevas esta fase, cinco en `Declarations.test.tsx`: Declarar abre un panel fijo con el formulario dentro y la tabla detrás; el foco entra en el primer campo al abrir y vuelve al botón de la fila al cerrar; Escape cierra el panel y devuelve el foco; pulsar otra fila cambia el contenido del mismo panel sin duplicarlo; y el atajo abre el pendiente en el mismo panel. Backend: **393 pruebas, 0 fallos, 3 omitidas**, sin cambios —la fase no toca backend—. Playwright sobre la app real, viewport 1360×577: clic en Editar de Requerimiento 44221 → panel `role=dialog`, `position: fixed`, rect `{x: 912, w: 448}`, foco en «Horas estimadas» con el valor leído `2`, `main.scrollTop` en 700 sin cambiar y `window.scrollY` en 0; Guardar → `PUT /api/planning-metadata/44221` 200, el panel se cierra y el foco vuelve al botón Editar de la fila; clic en Declarar de 62110 → desplazamiento 876 → 876 y foco en «Horas estimadas» vacío; Cancelar → cero diálogos, foco en el botón «Declarar» de la fila 62110 y desplazamiento todavía en 876. Lote intacto en `/declaraciones?tecnico=AbraAran&lote=1`: 2 filas pendientes, firmante único y, al escribir 3 h y 2026-11-15 en la fila 62110, «Guardar 1 declaración» con «1 de 2 filas con cambios».
