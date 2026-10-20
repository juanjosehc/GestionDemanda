
## Fase 44 — El Timeline se arma con el equipo, no con los planes

### 0. Qué cambia, en una frase

Hasta esta fase, **las filas del Timeline eran los planes**. Se abría un plan por cada técnico que tuviera uno guardado, y quien no tenía plan no existía para la pantalla. Esta fase cambia la fuente de verdad: **las filas son las personas del equipo operativo que publica `/api/team`**, y los planes solo rellenan la fila. Una persona sin plan aparece igual, con su estado dicho. **La fase no toca el motor, las reglas de capacidad, los desplazamientos, las renegociaciones, la integración con GLPI ni la persistencia: todo el cambio está en la lectura y en la pintura.**

### 1. De dónde salen hoy las filas, con la evidencia

La cadena completa, de la base a la pantalla:

| Paso | Archivo | Qué hace |
|---|---|---|
| 1 | `backend/.../repository/PlanSnapshotRepository.java` | `findLatestPerDeveloper()` devuelve **el plan más reciente de cada `developer_id`**, ordenado por fecha de creación y desempatado por identificador (`TreeMap`) |
| 2 | `backend/.../service/PlanningService.java:280-350` | `teamTimeline()` recorre exactamente esa lista (`:283`), acumula sus tramos y devuelve `new TeamTimelineResponse(from, to, teamResources(capacities), items, published, conflicts)` (`:350`) |
| 3 | `backend/.../dto/TeamTimelineResponse.java:37` | Documenta `resources` como *«una entrada por desarrollador con tramos o con plan vigente»* |
| 4 | `frontend/src/pages/TeamTimeline.tsx:140` | `developerIds = timeline.data.resources.map(r => r.developerId)` |
| 5 | `frontend/src/components/timeline/TimelineGrid.tsx:409` | `resources.map(...)` — una fila por recurso |

**En ningún paso de esa cadena se consulta el padrón para decidir quién es una fila.** `TeamTimelineResponse` ni siquiera tiene un campo de equipo; el nombre de cada persona se resuelve después, al pintar, con el padrón que la página pide por su cuenta (`useTeam()`), y solo para ponerle nombre a una fila que ya existía. El padrón llega tarde: puede nombrar una fila, no crearla ni quitarla.

El contraste con la tabla de Recursos es el que demuestra que el patrón correcto ya existía en el proyecto: `frontend/src/lib/team.ts` implementa `toTeamMembers()`, que **hace las filas con el padrón y le cuelga el plan a cada persona**, y `inOperationalTeam()` decide el filtro. Esa ruta (`/recursos`) ya muestra personas sin plan; el Timeline, que es la pantalla de entrada, no. La causa no es de datos: es **una sola decisión de lectura**, tomada en `teamTimeline()` y consumida sin filtro en `TeamTimeline.tsx`.

### 2. Las filas que hay hoy, medidas contra el padrón

Lectura en vivo (`GET /api/team` y `GET /api/planning/team/timeline`, 2026-10-19 17:31 UTC) contra la instancia real:

| Hecho | Valor |
|---|---:|
| Personas en el padrón (`/api/team`) | 42 |
| Personas operativas (`operational: true`) | **18** |
| Filas que devuelve el Timeline | **8** |
| Personas operativas con fila | **4** |
| Personas operativas sin fila | **14** |
| Tramos publicados | 17 |
| Tramos de personas operativas | **4** |

Las ocho filas, una por una, con lo que dice el padrón de cada identificador:

| Fila | ¿En el padrón? | ¿Operativa? | Persona | Plan vigente | Tramos |
|---|---|---|---|---|---:|
| `AbraAran` | Sí | **Sí** | Abraham Arana Aldana | `59668f8c…` (GLPI) | 3 |
| `160` | Sí, como `FranZulu` con `glpiId: 160` | **Sí** | Francisco Javier Zuluaga A. | `5b76e2db…` (HTTP) | 0 |
| `17` | Sí, como `NilsCort` con `glpiId: 17` | **Sí** | Nilson Cortes | `dc8fedaa…` (HTTP) | 1 |
| `296` | Sí, como `JoseDiaz` con `glpiId: 296` | **Sí** | Jose Alejandro Diaz Urrego | `44a753a3…` (GLPI) | 0 |
| `13` | **No** | No | Juan Carlos Villamizar Villamizar (usuario real de GLPI, fuera del grupo *Desarrollo N2*) | `330c0a52…` (HTTP) | 2 |
| `demo-f38` | **No** | No | — | `946a743f…` (HTTP) | 4 |
| `demo-f39` | **No** | No | — | `4fe75b16…` (HTTP) | 3 |
| `demo-f39b` | **No** | No | — | `e64e57fe…` (HTTP) | 4 |

**La trampa que esta tabla descubre, y que hay que decir antes de cambiar nada:** tres de las cuatro filas operativas **no se llaman como la persona**. El plan se guardó tecleando el número de GLPI (`160`, `17`, `296`), no el login (`FranZulu`, `NilsCort`, `JoseDiaz`), porque el sistema registra el plan con lo que se tecleó al pedirlo. Por eso, comparando la lista de filas con la lista de logins del padrón, **solo `AbraAran` coincide**: una comparación ingenua concluiría que 1 de 8 filas es del equipo y que faltan 17 personas. Cruzando por `glpiId` —lo que ya hace `namesOf` en la página y `keysOf` en `lib/team.ts`— la respuesta correcta es **4 filas operativas y 14 personas ausentes**. El cambio de esta fase tiene que cruzar por las dos claves o **se perdería el plan de tres personas al mismo tiempo que se arreglaba su fila**; es el riesgo 207 de la fase 43, ahora en el camino crítico.

### 3. Las tres preguntas de la auditoría

**1. ¿Qué personas aparecen hoy incorrectamente?**

Cuatro filas no son del equipo operativo, y son dos clases distintas:

- **Tres identificadores de demostración** (`demo-f38`, `demo-f39`, `demo-f39b`). No están en el padrón de 42 personas, GLPI no los conoce —`unknownDevelopers` de la lectura por lote devuelve exactamente esos tres— y no corresponden a nadie. Aportan **11 de los 17 tramos (64,7 %)** y **2 de los 2 conflictos**.
- **Una persona real fuera del grupo** (`13`, Juan Carlos Villamizar Villamizar). Es un usuario real de GLPI, con dos tramos de un incidente sintético (`INC-13-1`), pero **no pertenece al grupo *Desarrollo N2*** que define el equipo: `/api/team` no la publica. Es el caso que el brief llama «persona fuera del equipo» y el que hay que tratar sin inventarle una fila.

Además, y sin ser una fila incorrecta, hay **dos tramos sintéticos sobre una persona real que sí es del equipo**: `INC-13-1` no cuelga de una persona operativa, pero la fase 43 dejó documentado que los incidentes inventados han contaminado planes de personas reales (`INC-ABRA-1`, ya sustituido por el plan GLPI). No se tocan aquí: esta fase decide **quién tiene fila**, no qué plan tiene cada quien.

**2. ¿Qué personas del equipo real faltan hoy?**

Catorce personas operativas **no tienen ninguna fila** porque no tienen plan vigente:

`AlejPine` (Alejandro Pineda Machado) · `AnalRuiz` (Analy Ruiz) · `AndrBelt` (Andres Steven Beltran Forero) · `AndrEsco` (Andres Felipe Escobar Arango) · `AndrGonza` (Andres Felipe Gonzalez Gonzalez) · `CesaGira` (Cesar Giraldo Muñoz) · `DaniLope` (Daniel Felipe Lopez Rendon) · `JhonAteh` (Jhonnatan Atehortua Alvarez) · `JoseGarc` (Jose Luis Garces Gonzalez) · `JoseGonz` (Jose Fabian Gonzalez Tavera) · `MaurMarm` (Maury Marmolejo Din) · `NicoSuar` (Nicolas Alejandro Suarez Florez) · `SilvCast` (Silvia Alejandra Castro Garcia) · `StelMedi` (Stella Patricia Medina O.)

Las cinco personas que el brief nombra —Abraham Arana Aldana, Nilson Cortes, Stella Patricia Medina O., Silvia Alejandra Castro Garcia y Maury Marmolejo Din— están en esa lista salvo Abraham, que ya tiene plan: **cuatro de las cinco no aparecen hoy**, y las otras catorce comparten la misma causa. **Catorce de dieciocho operativas (77,8 %) son invisibles para la pantalla de entrada**, y el equipo se ve un 22,2 % de lo que es.

**3. ¿Qué porcentaje del Timeline pertenece realmente al equipo operativo?**

Depende del denominador, y conviene decir los tres:

- **Por filas: 4 de 8 (50 %)** son personas operativas. La otra mitad son tres demo y una persona real fuera del grupo.
- **Por tramos: 4 de 17 (23,5 %)** pertenecen a personas operativas. Trece de diecisiete (76,5 %) no.
- **Por cobertura del equipo: 4 de 18 personas (22,2 %)** tienen fila. **Catorce no aparecen por no tener plan**, que es el defecto que esta fase corrige.

**La conclusión de la auditoría, en una frase:** el Timeline no miente sobre las personas que muestra; **omite a las que no tienen plan y admite a cualquiera que tenga uno**. Las dos caras son el mismo defecto: la fila se decide por el plan y no por el equipo.
