### La Fase 54: el ticket se declara dentro del panel, sin abandonar el Timeline

**El recorrido era la fricción.** El panel lateral de la Fase 53 ya ponía el detalle junto al tramo, pero Declarar seguía siendo un enlace: al pulsarlo el Timeline desaparecía y el gestor aterrizaba en la pantalla de Declaración, donde tenía que encontrar el ticket entre decenas de filas antes de escribir una estimación y una fecha. Para un solo ticket, el viaje duraba más que el trabajo.

**La declaración es la misma y se abre donde está el ticket.** Pulsar Declarar ya no navega: sustituye el cuerpo del panel por el formulario de declaración —el mismo `DeclarationForm` de la pantalla de Declaración, importado, no copiado—. El formulario decide solo entre `POST` y `PUT` con la fila `declaration` del ticket, lee la declaración viva antes de editar (`useDeclaration`) y valida contra el backend. No hay una segunda lógica de declaración ni un segundo servicio: hay un segundo sitio donde se enseña.

**El panel sabe si el ticket ya estaba declarado sin pedir nada de más.** La fila `DeclarationItem` sale del lote que el Timeline ya cargó para calcular la cobertura (`useTeamDeclarationsBatch`), indexada por persona. Con ella el formulario sabe si crea o reemplaza y enseña el título y el último cambio ya clasificados por el backend. Cuando la lectura de esa persona falló y la fila no existe, Declarar vuelve a ser el enlace de siempre a `/declaraciones` con `from=teamTimeline`: es el único caso en que no se declara sin salir, y no se inventa el estado para evitarlo.

**Tres campos que caben en 448 px.** En la pantalla caben tres columnas; en el panel cada una quedaría en 111 px y la fecha se cortaba —`19/10/202`, firmante `verificacion-fa`—. El formulario compartido acepta `stacked`, que cambia la rejilla a una columna y nada más; medido en el navegador, los tres campos van a 350 px, enteros dentro del viewport y sin girar la rueda: el formulario aparece en la cabecera del panel, a la vista. No se duplicó el formulario para cambiar una clase.

**Al guardar, el panel vuelve al detalle.** El `POST` o el `PUT` pasan por el servicio existente, que invalida el lote de declaraciones; el formulario se cierra y el detalle reaparece con la cobertura refrescada. El panel no se cierra entero: la rejilla no se ha movido y el gestor puede seguir con el siguiente ticket o con **Generar plan**, que ahora está en la misma fila de acciones y lleva a `/planificar?tecnico=<login>`.

**Cambiar de ticket no arrastra un formulario a medio escribir.** `ItemDetail` se monta con `key={workItemId}`: al seleccionar otro tramo el panel se remonta y vuelve al detalle; volver al anterior tampoco reabre el formulario. Igual que en la Fase 53, cerrar con el botón o con Escape devuelve el foco al tramo y conserva `scrollLeft`, `scrollTop` y el zoom.

**La pantalla de Declaración sigue siendo la de los lotes.** `/declaraciones` no cambió: sigue siendo el sitio para declarar por persona, revisar lo pendiente, operar varias filas y para la entrada directa por `?ticket=`. El panel es el modo de operar un ticket; la pantalla, el de trabajar un lote.

**Limitaciones.** Si la lectura por persona no trae la fila del ticket —porque esa persona falló—, el panel enlaza a la pantalla en vez de declarar dentro. Y la declaración no regenera el plan: el tramo conserva la duración del plan vigente hasta que se genere uno nuevo, que es exactamente lo que el motor ya hacía; por eso Generar plan está a un clic en la misma fila de acciones.

---
