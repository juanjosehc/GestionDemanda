package co.com.coltefinanciera.gestiondemanda.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.domain.enums.DeclaredGap;
import co.com.coltefinanciera.gestiondemanda.dto.DeclaredGapDetailResponse;
import co.com.coltefinanciera.gestiondemanda.dto.DeveloperPlansResponse;
import co.com.coltefinanciera.gestiondemanda.dto.DisplacedRequirementsResponse;
import co.com.coltefinanciera.gestiondemanda.dto.OperationalAlertResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanSnapshotResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningContextResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningFromGlpiRequest;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningFromGlpiResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningInputResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningOperationalMetricsResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningPlanResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningSimulationRequest;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningSimulationResponse;
import co.com.coltefinanciera.gestiondemanda.dto.TimelinePlanResponse;
import co.com.coltefinanciera.gestiondemanda.service.GlpiPlanningService;
import co.com.coltefinanciera.gestiondemanda.service.OperationalAlertService;
import co.com.coltefinanciera.gestiondemanda.service.PlanningMetricsService;
import co.com.coltefinanciera.gestiondemanda.service.PlanningService;

/**
 * Superficie HTTP de la planificacion.
 *
 * <p>Sigue siendo una superficie de validacion y no el contrato definitivo: existe para ejercitar
 * las reglas de negocio antes de que GLPI alimente datos reales, y el controlador solo delega.
 *
 * <p>Los trece endpoints son tres preguntas y diez formas de responderlas. {@code simulate} pregunta
 * que pasaria; {@code plan} decide y lo deja escrito; {@code from-glpi} decide con los datos reales. Y
 * de lo escrito hay cinco lecturas de un plan —el plan entero ({@code /{planId}}), solo su agenda
 * ({@code /{planId}/blocks}), su agenda con la capacidad ya contada ({@code /{planId}/timeline}), que
 * es la que consume un timeline, solo su contexto ({@code /{planId}/context}) y solo su entrada
 * ({@code /{planId}/input})— mas cinco que no son de ningun plan: {@code /plans/{developerId}}, que
 * dice <em>cuales</em> tiene un tecnico y por eso es lo que permite nombrar su plan anterior;
 * {@code /metrics}, la fotografia del conjunto, sus dos desgloses —{@code /metrics/declared/{gap}} y
 * {@code /metrics/displaced}—, que bajan de la cifra al elemento que la produce, y {@code /alerts}, que
 * dice cuales de esas cifras exigen que alguien mire. El reparto no es casual: lo que se guarda se
 * puede volver a pedir, y lo que solo se simula no.
 *
 * <p>Los tres endpoints que cuelgan de {@code /metrics} son el mismo movimiento en dos pasos: primero
 * una cifra, luego los elementos que la producen. El desglose no es otra metrica —no recalcula nada,
 * abre lo que la fotografia ya conto— y por eso cuelga de ella en la ruta y le toma prestados el
 * {@code source} y el {@code scope}: dos numeros que dicen de donde salen y una lista que dice
 * exactamente lo mismo no pueden separarse sin que se note.
 *
 * <p>{@code /alerts} no es un tercer desglose: es la fotografia juzgada. No cuenta nada nuevo —son los
 * mismos numeros, leidos con la pregunta ya contestada— y por eso no cuelga de {@code /metrics} en la
 * ruta: no abre una cifra, dice cuales de ellas exigen actuar.
 *
 * <p>Contexto y entrada son las dos mitades de una misma respuesta. El contexto dice con que se
 * decidio —reglas, version del motor, zona, instante—; la entrada dice con que datos. Juntas
 * sostienen la afirmacion que un auditor necesita poder comprobar: con estas entradas y este contexto
 * se obtuvo este resultado.
 *
 * <p>Las rutas de lectura comparten prefijo sin ambiguedad posible, y desde que {@code /metrics}
 * existe la razon ya no es el metodo: {@code /metrics} y {@code /{planId}} son las dos {@code GET} y
 * las dos de un solo segmento. Lo que las separa es la <em>especificidad del patron</em>: un segmento
 * literal puntua por encima de una variable de captura, asi que {@code /metrics} gana siempre y en
 * cualquier orden de declaracion. No se da por sabido —una prueba lo fija—, porque el dia que dejara
 * de cumplirse lo que se rompe no es una ruta nueva, es la lectura del plan entero.
 *
 * <p>{@code /plans/{developerId}} tiene dos segmentos y por eso no compite con {@code /{planId}}, que
 * tiene uno. Si compite con las cuatro sub-rutas de dos segmentos que cuelgan de un plan
 * —{@code /{planId}/context}, {@code /{planId}/input}, {@code /{planId}/blocks} y
 * {@code /{planId}/timeline}— y <strong>gana el plan, no el listado</strong>. La expectativa era la
 * contraria —el literal {@code plans} pesa mas que la variable {@code {planId}}—, y la medida dice
 * otra cosa: {@code GET /plans/blocks} contesta {@code 400 INVALID_PARAMETER} porque lo lee la ruta de
 * bloques y {@code plans} no es un UUID. Se deja escrito tal como se midio, con una prueba que lo fija,
 * en lugar de disimulado.
 *
 * <p>El efecto es acotado y no tiene arreglo por nombres: un tecnico que se llamara exactamente
 * {@code context}, {@code input}, {@code blocks} o {@code timeline} no se podria listar, porque una
 * variable de captura no distingue un nombre de una ruta. Ningun inicio de sesion de GLPI se llama
 * asi, y el listado no depende de ellos para nada mas.
 */
@RestController
@RequestMapping("/api/planning")
@RequiredArgsConstructor
public class PlanningController {

    private final PlanningService planningService;
    private final PlanningMetricsService planningMetricsService;
    private final OperationalAlertService operationalAlertService;
    private final GlpiPlanningService glpiPlanningService;

    /**
     * {@code POST /api/planning/simulate}
     *
     * <p>Recibe un escenario y devuelve la agenda resultante, los requerimientos desplazados con
     * sus nuevas fechas y los eventos de auditoria generados. No guarda nada.
     *
     * <p>Es idempotente por pareja (incidente, requerimiento): repetir la misma peticion devuelve
     * el mismo plan sin volver a auditar los desplazamientos ya registrados.
     */
    @PostMapping("/simulate")
    public PlanningSimulationResponse simulate(@Valid @RequestBody PlanningSimulationRequest request) {
        return planningService.simulate(request);
    }

    /**
     * {@code POST /api/planning/plan}
     *
     * <p>Planifica y guarda. Devuelve {@code 201} con el identificador del plan y el resultado
     * completo, de modo que quien lo pidio no tenga que volver a pedirlo para verlo.
     *
     * <p>El registro de idempotencia es el mismo que usa la simulacion, y ahora vive en la base de
     * datos: volver a enviar el mismo escenario despues de un reinicio devuelve el mismo plan sin
     * duplicar la auditoria, que es lo que la simulacion solo podia prometer dentro de una misma
     * ejecucion.
     */
    @PostMapping("/plan")
    @ResponseStatus(HttpStatus.CREATED)
    public PlanningPlanResponse plan(@Valid @RequestBody PlanningSimulationRequest request) {
        return planningService.plan(request);
    }

    /**
     * {@code POST /api/planning/from-glpi}
     *
     * <p>Planifica y guarda, con los datos que GLPI tenga del desarrollador en este momento. Es la
     * tercera pregunta de la superficie: {@code simulate} dice que pasaria con un escenario escrito a
     * mano, {@code plan} lo decide con ese escenario, y esto lo decide con el escenario real.
     *
     * <p>El plan que sale es un plan de los de siempre —mismo motor, mismas tablas, mismos endpoints
     * de consulta despues— y lo unico distinto es de donde vinieron los datos. Eso se lee en
     * {@code /{planId}/input}, donde la procedencia queda registrada con la fecha de extraccion y la
     * version del adaptador que tradujo.
     *
     * <p>Devuelve {@code 201} con el identificador del plan, el resultado completo y la lista de
     * tickets que GLPI devolvio y no se pudieron traducir. Esa lista es parte de la respuesta y no un
     * detalle de registro: un plan con menos trabajo del que hay, sin decirlo, es peor que un error.
     *
     * <p>Los fallos se distinguen por codigo. {@code 404 DEVELOPER_NOT_FOUND} si el usuario no esta
     * en GLPI; {@code 503 GLPI_UNAVAILABLE} si no se pudo hablar con el —incluido el vencimiento del
     * tiempo de espera—; {@code 502 GLPI_AUTHENTICATION_FAILED} si rechazo las credenciales; y
     * {@code 502 GLPI_INVALID_DATA} si respondio algo que no se puede traducir.
     */
    @PostMapping("/from-glpi")
    @ResponseStatus(HttpStatus.CREATED)
    public PlanningFromGlpiResponse fromGlpi(@Valid @RequestBody PlanningFromGlpiRequest request) {
        return glpiPlanningService.plan(request.developerId());
    }

    /**
     * {@code GET /api/planning/metrics}
     *
     * <p>La fotografia operativa de la planificacion: que puede planificarse, que no, donde estan los
     * cuellos de botella y cuanta capacidad queda. Es la primera lectura que no es de un plan —todas
     * las anteriores exigen un identificador— y por eso vive en la raiz del prefijo y no colgando de
     * uno.
     *
     * <p><strong>No recalcula nada.</strong> No ejecuta el motor, no genera planes y no consulta GLPI:
     * lee lo ya persistido. La capacidad sale ademas por el mismo camino que pinta la interfaz —la
     * proyeccion del timeline de cada plan vigente—, de modo que las dos no pueden discrepar.
     *
     * <p><strong>Los tres bloques de la respuesta son tres regimenes de dato distintos</strong> y cada
     * uno declara su fuente y su ambito dentro del propio JSON. {@code declared} es el estado de hoy,
     * que cambia en cuanto alguien declare algo; {@code plans} solo crece; {@code current} es el plan
     * vigente de cada desarrollador, congelado. Los dos primeros numeros no son comparables entre si y
     * la respuesta lo dice, porque un contador sin su procedencia es un numero ambiguo.
     *
     * <p><strong>Lo que no es.</strong> No es el historial de descartes de la capa anticorrupcion:
     * aquellos no se persisten, asi que «sin estimacion» cuenta el estado declarado de hoy y no los
     * tickets que una ejecucion anterior descarto. Es la limitacion que la fase documenta, y esta
     * dicha tambien en el {@code scope} del bloque.
     *
     * <p><strong>La ruta convive con {@code /{planId}} por especificidad de patron</strong>, no por
     * casualidad ni por el orden en que estan escritos los metodos: un segmento literal gana a una
     * variable de captura. {@code GET /api/planning/no-es-un-uuid} sigue siendo un {@code 400}.
     *
     * <p>Devuelve {@code 404} con codigo {@code PLAN_NOT_FOUND} si el plan vigente de algun
     * desarrollador perdio su contexto o su entrada. Es deliberado: saltarse a ese desarrollador daria
     * un total incompleto en silencio.
     */
    @GetMapping("/metrics")
    public PlanningOperationalMetricsResponse metrics() {
        return planningMetricsService.metrics();
    }

    /**
     * {@code GET /api/planning/metrics/declared/{gap}}
     *
     * <p>Las filas declaradas que producen una de las tarjetas de carencia. No recalcula la metrica:
     * la desglosa. El contador y la lista salen del mismo predicado sobre la misma tabla, asi que el
     * numero de elementos es el numero de la tarjeta por construccion y no por coincidencia.
     *
     * <p>{@code gap} es el nombre de una de las tres constantes: {@code SIN_ESTIMACION},
     * {@code SIN_COMPROMISO} o {@code METADATA_INCOMPLETA}, tal cual —es el mismo valor que viaja de
     * vuelta en el campo {@code gap}—. Un valor que no sea ninguno de los tres responde
     * <strong>{@code 400 INVALID_PARAMETER}</strong> sin que este endpoint lo maneje: es el mismo
     * camino que ya recorre cualquier parametro mal formado.
     *
     * <p><strong>Lo que no puede decir.</strong> La tabla guarda quien declara, no quien planifica: el
     * desarrollador asignado no esta aqui y nombrarlo exigiria consultar GLPI, que esta fase no toca.
     * Las columnas se rotulan por lo que son. En {@code metadata-incompleta} si aparece, porque es una
     * lista de filas declaradas y no una lista de personas.
     */
    @GetMapping("/metrics/declared/{gap}")
    public DeclaredGapDetailResponse declaredGap(@PathVariable DeclaredGap gap) {
        return planningMetricsService.declaredGap(gap);
    }

    /**
     * {@code GET /api/planning/metrics/displaced}
     *
     * <p>Los requerimientos que la tarjeta de desplazados esta contando, uno a uno, con su
     * desarrollador, su plan y la causa. Es el otro desglose de la fotografia.
     *
     * <p><strong>Las filas salen del timeline y la causa del plan.</strong> Es la misma proyeccion que
     * usa {@code /metrics} para contar —no una consulta paralela que pudiera discrepar—, y el motivo
     * viaja con el texto que ya publica {@code /{planId}}, derivado de la regla aplicada. Asi el enlace
     * de la tarjeta no puede llevar a una lista mas larga que la cifra.
     *
     * <p><strong>Cuesta una lectura por plan vigente</strong> —el timeline, mas el plan solo para quien
     * tiene algo desplazado—, del mismo orden que {@code /metrics}. Es el precio de que la cifra y su
     * desglose no puedan separarse.
     */
    @GetMapping("/metrics/displaced")
    public DisplacedRequirementsResponse displaced() {
        return planningMetricsService.displaced();
    }

    /**
     * {@code GET /api/planning/alerts}
     *
     * <p>Lo que hoy exige que alguien mire: las condiciones que se cumplen, con su gravedad, de donde
     * sale cada numero, cuantos elementos lo producen y a donde ir a verlos.
     *
     * <p>Es la cuarta lectura que no es de un plan, y la ultima pieza de la observabilidad. Las otras
     * describen un estado; esta lo juzga. Nueve contadores hay que leerlos y decidir cual importa; una
     * alerta llega con la decision tomada —trae severidad— y con el destino donde se ve el problema.
     *
     * <p><strong>Es una proyeccion de {@code /metrics}: no recalcula nada.</strong> No ejecuta el motor,
     * no consulta GLPI y no lee la base por un camino distinto. Son los mismos numeros, leidos con la
     * pregunta ya contestada. La consecuencia es la que importa: la alerta y la metrica no pueden
     * discrepar, porque no hay un segundo camino que pudiera separarse.
     *
     * <p><strong>Solo se listan las condiciones que hoy se cumplen</strong>, de mas grave a menos. Si no
     * se cumple ninguna, {@code alerts} viaja vacio y {@code generatedAt} fecha igualmente la respuesta,
     * que es lo que permite distinguir «no hay nada que mirar» de «no se ha mirado». El catalogo entero
     * no se repite aqui: vive en el enum de tipos de alerta, que es el único sitio donde esta escrito.
     *
     * <p><strong>Dos de las seis alertas no tienen listado propio</strong> —capacidad agotada y
     * capacidad negativa— y viajan con {@code detailUrl} nulo. No es un olvido: su detalle es el
     * calendario del plan, que ya existe, y esta fase no construye listados nuevos. Las otras cuatro
     * apuntan al desglose de {@code /metrics}, y una prueba recorre cada uno para exigir que responda y
     * que su numero de elementos cuadre con el {@code count} de la alerta.
     *
     * <p><strong>Las alertas clasifican, no particionan.</strong> Un mismo elemento puede producir tres
     * alertas a la vez, asi que sumar los {@code count} no mide nada y no se publica ningun total.
     *
     * <p><strong>La ruta convive con {@code /{planId}} por especificidad de patron</strong>, igual que
     * {@code /metrics}: un segmento literal gana a una variable de captura en cualquier orden de
     * declaracion. Se prueba en vez de darse por sabido, porque el dia que dejara de cumplirse lo que se
     * rompe no es una ruta nueva: es la lectura del plan entero.
     *
     * <p>Devuelve {@code 404} con codigo {@code PLAN_NOT_FOUND} en el mismo caso que {@code /metrics}
     * —un plan vigente al que le falta su contexto o su entrada—, y por el mismo motivo: una lista de
     * alertas calculada sobre una fotografia incompleta diria que no hay problemas donde no se ha
     * mirado, que es la peor forma de fallar que tiene una alerta.
     */
    @GetMapping("/alerts")
    public OperationalAlertResponse alerts() {
        return operationalAlertService.alerts();
    }

    /**
     * {@code GET /api/planning/plans/{developerId}}
     *
     * <p>El historial de planes de un tecnico, del mas antiguo al mas reciente. Es la lectura que
     * permite nombrar su plan anterior, y por tanto la que hace posible comparar dos planes.
     *
     * <p><strong>Es de solo lectura y no planifica.</strong> No es una forma de crear un plan —quien
     * quiera uno sigue llamando a {@code POST /api/planning/from-glpi}— y no ejecuta el motor: lee las
     * filas que ya existen. Devolver el listado es justo lo que no se le puede pedir a un endpoint de
     * escritura, porque pedirlo crearia un plan guardado por cada vez que alguien abre la pantalla.
     *
     * <p>El nombre del tecnico va en la ruta y no en un parametro de consulta siguiendo el precedente
     * de {@code /api/planning-metadata/declarations/{developerId}}, que es el mismo caso: el listado de
     * lo que tiene un tecnico concreto.
     *
     * <p>Devuelve {@code 200} con lista vacia si el tecnico no tiene planes, y no {@code 404}: esta
     * capa no tiene padron propio de tecnicos, asi que no puede distinguir «no existe» de «no tiene
     * ninguno», y afirmar lo primero seria afirmar mas de lo que sabe.
     */
    @GetMapping("/plans/{developerId}")
    public DeveloperPlansResponse plans(@PathVariable String developerId) {
        return planningService.plans(developerId);
    }

    /**
     * {@code GET /api/planning/{planId}}
     *
     * <p>Un plan guardado, tal como quedo. Devuelve {@code 404} con codigo {@code PLAN_NOT_FOUND} si
     * el identificador no corresponde a ningun plan.
     *
     * <p>Lo que devuelve no es identico a lo que devolvio {@code POST /plan}: falta la OLA, falta el
     * calendario y faltan los vencimientos. Desde la Fase 7 la OLA y el calendario si se guardan, y
     * se leen por {@code /{planId}/context}; esta respuesta sigue siendo el plan y nada mas, porque
     * quien relee un plan no siempre quiere su configuracion. Los vencimientos no se guardan: se
     * derivan de los incidentes, que son de GLPI.
     */
    @GetMapping("/{planId}")
    public PlanSnapshotResponse findPlan(@PathVariable UUID planId) {
        return planningService.findPlan(planId);
    }

    /**
     * {@code GET /api/planning/{planId}/context}
     *
     * <p>Con que se calculo un plan guardado: version del motor, instante y zona del calculo,
     * severidades que participaron, y las reglas vigentes —umbral, horizonte, OLA por severidad y
     * calendario laboral— tal como estaban cuando se decidio.
     *
     * <p>Es lo que permite responder "por que" y no solo "que ocurrio". Un evento de auditoria dice
     * que un requerimiento se movio bajo la regla {@code CAPACIDAD_COMPROMETIDA}; este endpoint dice
     * que severidad tenia declarado ese comportamiento y con que jornada se midio, que es lo que
     * hace comprobable la decision.
     *
     * <p>Devuelve {@code 404} con codigo {@code PLAN_NOT_FOUND} si no hay plan o no hay contexto.
     */
    @GetMapping("/{planId}/context")
    public PlanningContextResponse context(@PathVariable UUID planId) {
        return planningService.context(planId);
    }

    /**
     * {@code GET /api/planning/{planId}/input}
     *
     * <p>Con que datos se calculo un plan guardado: el desarrollador y los incidentes y
     * requerimientos que el motor recibio, con los atributos que lee y nada mas.
     *
     * <p>Es la otra mitad de {@code /{planId}/context}. Aquel responde "con que reglas"; este responde
     * "con que datos". Con los dos, el plan deja de ser un resultado y pasa a ser un calculo
     * reproducible: se puede rearmar el escenario tal como entro y volver a correrlo.
     *
     * <p>No devuelve titulos ni el nombre del desarrollador, y no es un olvido: el motor no los lee,
     * asi que no se guardan ni se devuelven. Se devuelven tambien los elementos que el motor descarto
     * —incidentes resueltos, requerimientos finalizados— porque la foto es de la entrada.
     *
     * <p>Devuelve {@code 404} con codigo {@code PLAN_NOT_FOUND} si no hay plan o no hay entrada
     * registrada.
     */
    @GetMapping("/{planId}/input")
    public PlanningInputResponse input(@PathVariable UUID planId) {
        return planningService.input(planId);
    }

    /**
     * {@code GET /api/planning/{planId}/blocks}
     *
     * <p>Solo los tramos de agenda, en el orden en que el motor los produjo. Es la lectura que
     * necesita un timeline: cada tramo trae cuando empieza, cuando acaba y cuantas horas consume.
     */
    @GetMapping("/{planId}/blocks")
    public List<PlanningSimulationResponse.Block> blocks(@PathVariable UUID planId) {
        return planningService.blocks(planId);
    }

    /**
     * {@code GET /api/planning/{planId}/timeline}
     *
     * <p>La agenda de un plan guardado, con la capacidad del desarrollador dia a dia: los tramos con
     * sus horas y su fecha compromiso, cuanto cabe y cuanto queda libre en cada fecha, y las
     * referencias para volver al origen.
     *
     * <p>Es la lectura que necesita una interfaz de linea de tiempo, y responde dos preguntas de una
     * vez. {@code /{planId}/blocks} da los tramos pero no la capacidad; contestar «que ocupa esta
     * franja y cuanto queda libre ese dia» obligaba a pedir tambien {@code /{planId}/context}, sacar
     * de el la jornada y hacer la cuenta en el navegador.
     *
     * <p><strong>No recalcula el plan.</strong> Lee los bloques guardados, la foto de la entrada y el
     * contexto congelado, y suma. No se ejecuta el motor en ningun punto, asi que el timeline no puede
     * discrepar del plan que pinta: los dos salen de las mismas filas. Y las horas y el compromiso son
     * los de la foto, no los de la declaracion de hoy — el mismo {@code planId} devuelve siempre la
     * misma representacion.
     *
     * <p>Devuelve {@code 404} con codigo {@code PLAN_NOT_FOUND} si no hay plan, o si le falta el
     * contexto o la entrada con los que se decidio.
     */
    @GetMapping("/{planId}/timeline")
    public TimelinePlanResponse timeline(@PathVariable UUID planId) {
        return planningService.timeline(planId);
    }
}
