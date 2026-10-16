
# Fase 35 — De Incidentes a la declaración, sin teclear un identificador

## Qué se hizo, en una frase

`/incidentes` dejó de ser una tabla que **solo mira** y pasó a ser una tabla **desde la que se declara**: cada fila pendiente lleva un atajo que abre la declaración de ese ticket con el técnico, el ticket y la vuelta ya puestos, y el regreso deja la lista tal como estaba —filtros y modo incluidos— con la fila ya en su estado nuevo. **No se tocó ni una regla de negocio, ni el motor, ni la validación, ni el formulario, ni una línea del backend**: lo que cambió es el acceso y la navegación, que es exactamente lo que el brief acota.

## El análisis obligatorio: cómo se declara hoy, cuántos pasos cuesta y qué ya está en la tabla

El brief lo pide antes de modificar nada, y el análisis es el que decide la fase entera.

### 1. Cómo se inicia hoy una declaración

La pantalla es **`Declarations.tsx`** —no existe `Declaration.tsx`— y es **autocontenida**: no lee nada del router. Vive de tres `useState` —`draft`, `developerId` y `selected`—, el técnico entra por un `<input id="tecnico">` con `placeholder="Identificador en GLPI, p. ej. 296"` y se confirma con un botón **«Consultar»**, y el ticket se elige pulsando la acción de su fila.

**El endpoint acepta las dos formas del identificador**, y eso es lo que hace barato todo lo demás. `GlpiRestPlanningSource.findUser` resuelve primero como número y, si no lo es, como login:

```java
public Optional<GlpiUser> findUser(String userId) {
    Integer id = numericId(userId);
    return id == null ? userOfLogin(userId) : userOfId(id);
}
```

Es decir: **el login que Incidentes ya tiene en la mano sirve tal cual**, sin traducir nada y sin estrenar vocabulario.

### 2. Cuántos pasos cuesta

Nueve acciones discretas de punta a punta:

| # | Acción |
|---|---|
| 1 | Pulsar «Declaración» en el menú |
| 2-3 | Pulsar el campo «Técnico» y **teclear** el identificador |
| 4 | Pulsar «Consultar» |
| 5 | **Encontrar la fila a ojo** y pulsarla |
| 6-7 | Teclear horas y fecha compromiso |
| 8 | Teclear «Quién declara» (obligatorio, nunca viene relleno) |
| 9 | Pulsar «Guardar» |

Y los pasos 2 a 4 **se repiten en cada visita**: `developerId` es estado del componente, que se desmonta al salir de la ruta, y la tabla no tiene buscador ni orden propio. Lo que el atajo elimina son los pasos 2 a 5 —**cuatro de nueve, y justo los dos que exigen saber algo de memoria**: el identificador del técnico y dónde está la fila. Quedan cinco.

### 3. Qué información ya existe en la tabla de Incidentes

**Toda la que el atajo necesita, y ya está en el DOM.** Cada `<tr>` lleva `data-work-item` y `data-developer`, y `declarationSideOf` ya separa declarado de pendiente sin recalcular la regla. No hay que pedir ningún dato nuevo ni estrenar contrato: lo que faltaba era **una columna de acciones, un enlace de vuelta y que las dos pantallas hablaran el mismo idioma sobre de dónde viene el usuario**.

## Las decisiones

### 173. El contexto viaja en la dirección, y la dirección siembra en vez de gobernar

La fase tenía que resolver una cosa que el repositorio no había resuelto nunca: **conservar el estado de una pantalla a través de una navegación**. Hasta hoy no existía **ni un `useSearchParams` en todo `frontend/src`** —ni query strings, ni `location.state`, ni `navigate(…, { state })`—: todo el contexto viajaba por parámetro de camino, con los dos builders que ya existían.

#### 173.1 Por qué la query string y no el estado del router

Dos razones concretas, y la primera es la que decide:

1. **Es lo único que sobrevive al desmontaje.** La conservación de filtros que el brief exige no puede pasar de otra forma: los filtros de Incidentes viven en `useState` y se destruyen al salir de la ruta.
2. **La infraestructura de pruebas ya lo soporta sin cambios.** `renderWithClient(ui, { route })` recibe un **string**, así que `{ route: '/declaraciones?tecnico=…&ticket=…' }` funciona hoy. El estado de router exigiría una pila de historial que `MemoryRouter` con `initialEntries={[una]}` no puede expresar.

**Los parámetros van en español y con los nombres que la interfaz ya usa** —`tecnico`, `ticket`, `volver`, `persona`, `tipo`, `estado`, `declaracion`, `modo`—, y se componen con `URLSearchParams`, que es del estándar y no añade ninguna dependencia.

#### 173.2 Por qué se siembra y no se espeja — la decisión que hace barato todo lo demás

Los parámetros se leen **una sola vez**, en el inicializador de `useState`; el estado local sigue siendo el dueño. **No hay ningún efecto que sincronice en las dos direcciones.**

No es un atajo: es lo que deja **las veinte pruebas de `Incidents.test.tsx` sin tocar una línea**, porque todas montan sin query string. Si la dirección fuera la dueña, cada `<select>` sería una navegación —`MemoryRouter` envuelve su `setState` en `React.startTransition`— y cada `chooseFilter(...)` seguido de un `orderOf(container)` en la línea siguiente quedaría a merced de eso. Y el botón «atrás» del navegador **desharía filtros en vez de salir de la pantalla**, que es lo contrario de lo que un usuario espera de un `<select>`.

**La conservación se cumple igual, y por el camino más directo**: el enlace de vuelta se compone **en el momento del clic**, con los filtros y el modo vivos en ese instante. Lo que se guarda es **a dónde volver**, no el estado de la pantalla. Se comprobó con el navegador real: pulsado el atajo con el filtro `AbraAran` puesto, la dirección resultante fue `/declaraciones?tecnico=AbraAran&ticket=68319&volver=%2Fincidentes%3Fpersona%3DAbraAran`, y al volver el `<select>` seguía en `AbraAran`.

#### 173.3 Por qué el modo de equipo viaja, y es obligatorio que viaje

Si alguien está en «Mostrar todo Desarrollo N2», declara el ticket de quien está **fuera** del equipo operativo y vuelve a la vista por defecto, **su fila no está**: el criterio «el nuevo estado se ve al volver» se incumpliría justo cuando la función servía para algo. Por eso `incidentsPath(filters, mode)` escribe los dos, y hay una prueba que lo fija —la vuelta de un ticket de alguien de fuera conserva el modo y la fila sigue visible—.

#### 173.4 Por qué el formulario se siembra una sola vez

Con el mismo inicializador, y por el mismo motivo que el resto: así **cerrar el formulario no lo reabre** —el parámetro sigue en la dirección, pero ya nadie lo lee— y no hay que sincronizar nada. Es el mismo trato que `DeclarationForm` da al valor inicial de sus campos, y por la misma razón: un valor inicial no vuelve cuando alguien lo borra.

**Y si el ticket pedido ya no está** —se cerró, o dejó de estar asignado—, se dice con una línea en vez de dejar la pantalla como si nadie hubiera pedido nada. La condición es explícita: `selected !== null && data && data.items.length > 0 && !selectedItem`. Si la lista viene vacía **no se añade el aviso**, porque la pantalla ya dice «Este técnico no tiene tickets asignados» y serían dos diagnósticos del mismo hecho.

#### 173.5 Por qué el atajo es solo para las filas pendientes

Es lo que el brief pide —«acción por fila para tickets pendientes»—, y el lado lo decide **`declarationSideOf`**, el mismo predicado que el filtro, no una comparación escrita en la tabla. Una fila ya declarada deja la celda vacía: se sigue editando desde `/declaraciones`, como hasta ahora. **El atajo de edición se anota como limitación en vez de ampliarlo por cuenta propia.**

**El nombre accesible lleva el ticket y la persona** —`Declarar el ticket 68319 de Abraham Arana Aldana`— y no es adorno: un ticket asignado a dos personas produce dos enlaces con **el mismo texto y destinos distintos**, y sin él la pantalla tendría dos enlaces indistinguibles. Hoy hay uno así entre los 83 activos.

**El enlace se pinta con el idioma que el repo ya usa para navegar con aspecto de acción** —`<Button asChild variant="outline" size="sm"><Link …>`—, y al usar `asChild` el rol que expone es `link`, no `button`: **no colisiona** con el botón «Declarar» de `DeclarationTable`, que nunca está montado a la vez, ni con ningún `getByRole('button', …)` de las pruebas que ya existían.

#### 173.6 Por qué `volver` se valida y navega con `replace`

`volver` es **la única entrada de esta fase que viene de fuera y acaba en un `<Link to>`**, así que se valida antes de usarla: `value !== null && value.startsWith('/') && !value.startsWith('//')`. Lo segundo no es paranoia: **`//evil.com` es una URL protocolo-relativa y pasa el primer filtro**.

El enlace navega con **`replace`**, y la diferencia importa: con `push`, el botón «atrás» devolvería a `/declaraciones?ticket=…` y **reabriría el formulario** que se acaba de cerrar; con `replace`, sale del flujo —que es el «retorno sencillo» que el brief pide—.

#### 173.7 Por qué «Quién declara» no se prerrellena

Es el campo que más tienta a rellenar con el técnico, y sería un error: **el autor de la estimación y el autor del compromiso son dos personas distintas** —así lo declara el contrato, con `estimatedBy` y `committedBy` separados y con su propio sello cada uno— y **ninguno es necesariamente el técnico**. Rellenarlo con el técnico convertiría la trazabilidad en un dato falso la mitad de las veces, y la trazabilidad es justamente lo que ese campo existe para dar. **Se sigue tecleando, y se anota como limitación.**

#### 173.8 El desglose cuenta sobre lo que se ve, y sus cuentas se solapan

La observabilidad que el brief pide —cuántos declarados, pendientes, sin estimación y sin compromiso— **se calcula sobre las filas que están en pantalla**, así que las cifras cuadran con la tabla de debajo y nadie puede contar otra cosa mirándola. Reutiliza lo que ya existe: `declarationSideOf` para el lado y el `declarationStatus` que el backend publicó.

**Las cuentas se solapan, y la interfaz lo dice en la misma frase.** `pendiente` **contiene** a `sin estimación` y a `sin compromiso`: un ticket sin estimación también está pendiente. Presentarlas como cuatro cajones sería un error de lectura que la propia pantalla provocaría, así que el texto lo declara —«las cuentas se solapan: es un desglose, no un reparto»— y hay una prueba que fija la frase entera.

**Y el estado se lee, no se recalcula**, que es la misma regla que fijan las decisiones 172 y 161.3. Mirar `estimatedHours` o `committedDate` para deducir qué falta sería la segunda versión de la regla que el backend ya aplicó. Por eso «sin estimación» cuenta **las filas que existen y les falta el valor**, y no los tickets que no tienen fila: un ticket `SIN_DECLARACION` no engrosa ese parcial, y por eso los parciales pueden sumar menos que los pendientes sin que nada esté mal.

## Las pruebas

**Backend: sin cambios.** **370 pruebas, 0 fallos, 3 omitidas.** No se tocó ni un fichero, y se ejecutaron igualmente para confirmarlo.

**Frontend: de 157 a 166, en 12 archivos, 0 fallos.** Nueve nuevas, y ninguna existente se editó, se borró ni se debilitó.

**Cuatro en `Incidents.test.tsx`** —de veinte a veinticuatro—, las tres primeras traduciendo el brief a una afirmación sobre el DOM:

- **La fila pendiente ofrece el atajo, con su destino exacto**: `/declaraciones?tecnico=dev-001&ticket=908&volver=%2Fincidentes`. El destino se afirma entero y no por partes, porque es el contrato entre las dos pantallas.
- **La vuelta lleva el filtro y el modo puestos**, que es el punto 173.3 fijado por una prueba: sin el modo, la fila de alguien de fuera del equipo operativo desaparecería justo al volver.
- **La fila ya declarada no ofrece atajo**, y se afirma además que **la celda existe y está vacía**: lo que falta es el enlace, no la columna.
- **El desglose, con su frase entera.** Cuatro tickets montados para que los parciales **no** coincidan con los pendientes —uno planificable, uno sin fila, uno `SIN_ESTIMACION` y uno `SIN_COMPROMISO`—, y la frase esperada es la que se lee: «1 en estado declarado … y 3 con algo pendiente. De estos últimos, 1 con su fila ya creada y la estimación sin declarar, y 1 con su fila creada y el compromiso sin declarar». Si los parciales contaran los tickets sin fila, la prueba se caería.

**Cinco en el fichero nuevo `pages/DeclarationFlow.test.tsx`**, para los casos que **cruzan las dos pantallas**. Vive aparte por un motivo concreto: el `serve` de `Incidents.test.tsx` **lanza** ante cualquier dirección que no sea una de las dos suyas, y aflojarlo para que sirviera también la escritura debilitaría lo que ese fichero fija —que Incidentes no pide nada más—. Monta las dos rutas bajo **un solo `renderWithClient`**, y por tanto un solo `QueryClient`, que es lo que hace que compartan caché y que el flujo se pueda medir de verdad. **No se monta `AppRoutes`**: `MainLayout` llama a `window.matchMedia`, que el arnés no polyfillea.

1. **El atajo abre la declaración sin teclear nada**, con el técnico ya consultado y el formulario ya abierto, y **sin añadir ni una petición**: la prueba toma el orden de las peticiones antes del clic y afirma que después es el mismo.
2. **Se vuelve por el enlace**, sin pasar por el menú.
3. **La vuelta conserva el filtro**, y la tabla sigue filtrada.
4. **La vuelta conserva el modo**, con el ticket de alguien de fuera del equipo operativo todavía visible.
5. **Al volver, la fila ya está declarada.**

### La prueba que podía mentir, y cómo se impidió que mintiera

El arnés de pruebas usa `staleTime: 0`, y `App.tsx` usa **`30_000`**. Con `staleTime: 0` **cualquier remontaje relee**, así que la quinta prueba habría pasado igual **si alguien borrara el `invalidateQueries` de `useSaveDeclaration`**: lo que probaría es que hay una pantalla al final del enlace que lee del servidor, que no es lo que el brief pide. En producción la invalidación es justamente lo que hace funcionar el flujo: sin ella, volver dentro de los treinta segundos serviría caché fresca y la fila seguiría en `SIN_DECLARACION`.

Tres cosas la hacen discriminante, y las tres se escribieron a propósito:

1. **La prueba declara la política de caché de producción** —`staleTime: 30_000` y `gcTime: 300_000`—, que es **más fiel a producción, no menos**: `App.tsx` fija el `staleTime` y deja el `gcTime` en el valor por defecto de React Query, que son cinco minutos. Por eso `renderWithClient` ganó dos opciones opcionales, con los valores por defecto **como estaban**: hay más de veinticinco pruebas que dependen de que cada caso parta de cero.
2. **El servidor de la prueba tiene estado, no una cola posicional.** Lo declarado lo lleva **el hecho** —se escribió o no— y no el número de llamada. Una cola posicional probaría que la respuesta cambia en la segunda petición, que no es lo mismo que probar que cambia porque se guardó: si el guardado se rompiera, la cola seguiría devolviendo la respuesta buena y la prueba pasaría afirmando lo contrario de lo que dice.
3. **Afirma la secuencia exacta de peticiones**, que es lo que atribuye la causa. Con un solo técnico en el padrón la secuencia es determinista y mínima:

```
GET  /api/team
GET  /api/planning-metadata/declarations/dev-001   ← montaje de Incidentes
POST /api/planning-metadata                        ← Guardar (crea: el ticket no tenía fila)
GET  /api/planning-metadata/declarations/dev-001   ← la invalidación, con la lista aún montada
```

**Ninguna petición al pulsar el atajo** —misma clave de caché que Incidentes, entrada fresca— y **ninguna al volver**. Eso último es lo que fija el docstring de `Incidents.tsx` —«visitar las dos pantallas no repite ninguna lectura»—, y hasta ahora no lo probaba nadie. **Y se comprobó que discrimina: comentada la invalidación, la prueba se pone en rojo** —`PLANIFICABLE` esperado contra `SIN_DECLARACION` recibido— **y solo esa**, y después se restauró el fichero, con `git diff` vacío. Sin ese paso no se sabría si prueba algo.

**Un riesgo abierto que la ejecución resolvió, y se deja escrito**: cabía que, tras el `POST`, la relectura de la invalidación llegara antes de que el formulario se cerrara, y que el formulario —todavía montado y ya con `hasDeclaration` en verdadero— disparara una quinta petición. **No ocurre**: la secuencia medida es exactamente la de cuatro pasos de arriba. No es una suposición, es lo que la prueba afirma en cada ejecución.

## Riesgos identificados

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 150 | **La barra de direcciones no refleja los filtros mientras se está en Incidentes** | **Bajo, y es el precio de 173.2** | Lo que el brief exige —que la vuelta los conserve— se cumple porque **el enlace los lleva**. El día que se quiera la dirección viva, el vocabulario ya está en `lib/incidents.ts` y solo falta pasar el estado local a `setSearchParams` con `replace` |
| 151 | **La quinta prueba solo vale con la política de caché de producción**, así que es la única del repositorio que no corre con los valores por defecto del arnés | **Bajo: dos opciones opcionales, y por defecto nada se mueve** | La alternativa —dejarla con `staleTime: 0`— es una prueba que pasa por casualidad y que seguiría pasando si alguien rompiera el flujo. Se eligió la prueba que puede fallar |
| 152 | **Un filtro o un modo sembrados que ya no existen** —enlace viejo o manipulado— dejan el `<select>` sin opción que case y la tabla vacía | **Bajo: falla cerrado y no miente** | Se lee «Ningún ticket coincide con los filtros», que es exactamente lo que significa. No se añadió una validación que «arreglara» el enlace: inventar un filtro que no se pidió sería peor que decir que no hay coincidencias |
| 153 | **Solo las filas pendientes ofrecen el atajo** | **Bajo: es lo que el brief pide** | Una fila ya declarada se sigue editando desde `/declaraciones`, como hoy. Añadir «Editar» es un ternario el día que se quiera |
| 154 | **«Quién declara» se sigue tecleando**, aunque el atajo ahorre todo lo demás | **Bajo, y es deliberado** | No se prerrellena porque convertiría la autoría en un dato falso la mitad de las veces (173.7). Un desplegable de autores sería vocabulario nuevo para un campo que el backend acepta como texto libre |
| 155 | **Un ticket `NO_TRADUCIBLE` cuenta como pendiente y ofrecerá el atajo**; uno compartido por dos personas dará **dos atajos con dos `tecnico` distintos** | **Bajo: los dos son correctos** | El primero es el mismo criterio que el filtro que ya existe —y es el lado por el que conviene equivocarse: ofrecer de más antes que esconder trabajo real—. El segundo también: **la declaración es de la persona**, y el mismo ticket puede estar declarado por dos personas distintas. El nombre accesible los distingue (173.5) |
| 156 | **La invalidación es por prefijo y relee a todo el equipo al guardar** | **Bajo: es comportamiento de hoy, no de esta fase** | `useSaveDeclaration` es lógica de declaración y el brief prohíbe tocarla. La prueba con secuencia exacta lo deja clavado, así que quien algún día lo «arregle» tendrá que mirar esa prueba y decidir a conciencia |
| 157 | **Hallazgo preexistente, no introducido aquí:** un ticket sin identificador recibe el `workItemId` centinela `"(sin id)"` y un `POST` con él crearía una fila real bajo esa clave | **Bajo, y ya era alcanzable** | Hoy ya se llega desde `/declaraciones`, que ofrece el mismo botón. La guarda pertenece a donde vive la regla —el backend—, que este brief prohíbe tocar. Se anota para la fase que abra el backend |
| 158 | **La verificación sobre la instancia real deja rastro en la base de datos.** El ticket que se declaró y se retiró conserva **su fila en `planning_metadata`** —con los dos valores en nulo— y sus entradas en `planning_metadata_history` | **Bajo, pero se dice con precisión** | Es el diseño: la fila sobrevive a la retirada, que es lo que permite distinguir «nunca se declaró» de «se declaró y se retiró». **No hay endpoint `DELETE`** —comprobado— y borrarla por SQL sería escribir en la base por detrás de la aplicación. El efecto visible está medido y se detalla en la verificación |

## Limitaciones

**La dirección no gobierna la pantalla, solo la siembra.** Recargar `/incidentes` sin parámetros devuelve a la vista por defecto, y cambiar un filtro no cambia la dirección. Es el precio declarado en 173.2 y el riesgo 150.

**El atajo no edita.** Una fila ya declarada no ofrece nada desde Incidentes: para cambiar una estimación hay que ir a `/declaraciones`. Es el alcance que el brief fija.

**«Quién declara» se sigue escribiendo a mano** en cada declaración, y no hay forma de que el sistema lo sepa.

**El atajo no comprueba que el ticket siga existiendo.** Si GLPI lo cerró entre el pintado de la tabla y el clic, la pantalla de declaración lo dice con una línea —el ticket no está entre los asignados—, pero **se llega igual**: la comprobación ocurre donde está el dato, no antes de navegar.

**Un ticket sin identificador sigue siendo declarable** bajo la clave centinela `"(sin id)"`. Es el riesgo 157, preexistente y fuera del alcance de esta fase.

## La verificación explícita: «¿Se puede declarar un ticket pendiente desde Incidentes?»

**Sí, y se hizo con la instancia real delante, con navegador real y sobre datos de producción.**

**El punto de partida, medido contra el backend y no contra la pantalla**: el padrón trae **42 personas, 18 operativas**, y entre las 18 suman **83 filas de trabajo activo sobre 82 tickets distintos, las 83 en `SIN_DECLARACION`**. Es el mismo hallazgo que dejó escrito la Fase 34 —el equipo no ha declarado nada— y es lo que hace que el atajo no sea un adorno: **hoy es la única forma de declarar que tiene el equipo**. Y **uno de esos tickets está asignado a dos personas** —el 66913, entre `AbraAran` y `JoseGarc`—, que es exactamente el caso que obliga al nombre accesible distinto de 173.5: sin él, esa pantalla tendría dos enlaces con el mismo texto y destinos distintos.

**El recorrido, paso a paso, sobre `http://localhost:5173`** —backend en el 8080 y frontend en el 5173—, con el ticket **68319** de **Abraham Arana Aldana**:

| Lo que se hizo | Lo que salió |
|---|---|
| Filtro `Persona = Abraham Arana Aldana` | **8 filas**, las 8 en `SIN_DECLARACION`, cada una con su acción **«Declarar»** en la columna de acciones |
| El desglose, con el filtro puesto | «De esos 8 tickets: **0** en estado declarado … y **8** con algo pendiente» |
| Clic en «Declarar» de la fila 68319 | La dirección pasa a `/declaraciones?tecnico=AbraAran&ticket=68319&volver=%2Fincidentes%3Fpersona%3DAbraAran` — **las tres cosas viajan, y el filtro también** |
| La pantalla de declaración | **Técnico `AbraAran` ya puesto**, **8 tickets ya listados** y **el formulario del 68319 ya abierto**: cero teclas y cero clics de búsqueda |
| Horas `8`, fecha `2026-10-31`, quién `juan.hernandez`, «Guardar» | La fila del 68319 pasa a **`PLANIFICABLE`** con «8 h · 2026-10-31» y **su celda de acciones queda vacía**; el formulario se cierra solo |
| Clic en «Volver a Incidentes» | Vuelve a `/incidentes?persona=AbraAran` |
| La lista, ya de vuelta | La fila 68319 lee **`PLANIFICABLE`**, **su celda de acciones está vacía** y **el filtro sigue en `AbraAran`**; el desglose pasó de «0 declarados y 8 pendientes» a «**1** en estado declarado y **7** con algo pendiente» |

**El cambio de estado se ve al volver, sin recargar nada**, que es el criterio de experiencia que el brief pedía: el dato nuevo entró por la relectura que la escritura dispara, no por una consulta de la pantalla al montarse —y eso es lo que la quinta prueba fija con la secuencia exacta de peticiones—.

**La retirada, y lo que dejó.** El ticket se retiró después con un `PUT` de los dos valores en nulo, y el estado volvió al de partida: **68319 lee `SIN_DECLARACION` otra vez** y el desglose de AbraAran vuelve a «8 pendientes, 0 declarados». **Pero los datos no quedan idénticos, y se dice en vez de maquillarse**: la fila de `planning_metadata` **sobrevive** a la retirada —es el diseño, y es lo que distingue «nunca se declaró» de «se declaró y se retiró»— y el historial es *append-only*, así que las dos operaciones quedan registradas con su autor. **El efecto visible está medido**: la celda de declaración del 68319 ahora añade «sin estimación · sin compromiso» bajo la insignia, porque hay fila con los dos valores en nulo, cosa que sus siete hermanos —que no tienen fila— no hacen. **No existe endpoint `DELETE`** —comprobado con `grep` en el backend—, así que revertirlo exigiría escribir en la base por detrás de la aplicación; se deja dicho en vez de hacerlo. Es el riesgo 158.

**Las tres evidencias visuales.** `f35-1-incidentes-pendiente.png` —la columna de acciones con el atajo en cada fila pendiente y el desglose—, `f35-2-declaracion-abierta.png` —el técnico, el ticket y el formulario ya puestos, con «Volver a Incidentes»— y `f35-3-vuelta-estado-cambiado.png` —la fila en `PLANIFICABLE` con su resumen, el atajo ya ausente y el filtro conservado—. Viven en `.playwright-mcp/`, que está en el `.gitignore`, y **no se commitean**: el repositorio no tiene ni un PNG versionado y esta fase no cambia esa convención.

**Los cinco criterios de aceptación del brief se cumplen**: no cambia ninguna regla de negocio (1) —ni el motor, ni la validación, ni el formulario, ni el protocolo de escritura, ni una línea del backend—; no cambia `PlanningEngine` (2); **el número de pasos baja de nueve a cinco** (3), y los cuatro que se ahorran son justo los que exigían recordar el identificador del técnico y encontrar la fila a ojo; el flujo Incidentes → Declaración → Incidentes queda completo (4), con vuelta por enlace propio y sin pasar por el menú; y **las 370 pruebas del backend y las 166 del frontend pasan** (5).

**Y lo que esta fase no tocó, dicho explícitamente**: ni `PlanningEngine`, ni los desplazamientos, ni las renegociaciones, ni una regla de negocio, ni la integración con GLPI, ni la lógica de declaración —`useDeclarations.ts`, `DeclarationForm.tsx` y `declarationsService.ts` están **sin una línea de diferencia**—, ni el backend. **La fase solo mejoró el acceso y la navegación**, que es exactamente lo que el brief acota.
