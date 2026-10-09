package co.com.coltefinanciera.gestiondemanda.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiDiscardReason;

/**
 * Salida de {@code GET /api/planning/metrics}: una fotografia operativa de la planificacion.
 *
 * <p><strong>No recalcula nada.</strong> No se ejecuta el motor, no se genera ningun plan y no se
 * habla con GLPI. Todo sale de lo ya persistido, y la capacidad sale ademas por el mismo camino que
 * pinta la interfaz —la proyeccion del timeline—, de modo que las dos no pueden discrepar.
 *
 * <p><strong>Que responde que no respondia ninguna lectura anterior.</strong> Hasta aqui todas las
 * lecturas eran de un plan: dado un identificador, que tiene dentro. Nadie podia preguntar por el
 * conjunto —cuanto trabajo esta listo, cuanto no, donde esta el cuello de botella, cuanto queda
 * libre—. Eso es lo que se sirve aqui.
 *
 * <p><strong>Los tres bloques son tres regimenes de dato distintos, y por eso van separados.</strong>
 * {@code declared} cambia con cada declaracion; {@code plans} solo crece; {@code current} es un plan
 * congelado por desarrollador. Mezclarlos en una lista plana de numeros daria a entender que se
 * mueven juntos, y no se mueven juntos.
 *
 * <p><strong>Cada bloque declara su fuente y su ambito dentro del propio JSON.</strong> No es
 * decoracion: un contador sin su procedencia es un numero ambiguo, y quien lo lea dentro de seis
 * meses no va a venir a leer este comentario. {@code source} dice de que tabla sale y {@code scope}
 * dice sobre que se conto. Las dos constantes viven junto al contrato para que renombrarlas sea un
 * solo sitio y para que la prueba pueda afirmarlas tal como salen.
 *
 * <p><strong>La consecuencia que hay que decir en voz alta.</strong> {@code declared} es de ahora y
 * {@code current} es del ultimo plan de cada uno, que puede ser de ayer. Los dos numeros conviven en
 * la misma respuesta sin ser comparables: {@code plannable} no es el trabajo que cabe en
 * {@code capacity}. Por eso no se expone ninguna tasa de ocupacion —dividirlos daria un indicador
 * que no mide nada— y por eso {@code generatedAt} fecha la mezcla.
 *
 * <p><strong>La reproducibilidad que el timeline promete, aqui no aplica.</strong> El timeline lee
 * un plan congelado y devuelve siempre lo mismo; esto es una fotografia y su bloque {@code declared}
 * cambia en cuanto alguien declare algo. {@code generatedAt} no es un adorno que se pueda quitar:
 * sin el, dos fotografias distintas serian indistinguibles.
 *
 * <p>Los nombres de los campos van en ingles, como {@link TimelinePlanResponse}: un consumidor lee
 * los dos contratos juntos y no tiene por que saber cual de los dos se escribio primero.
 *
 * @param generatedAt cuando se armo esta fotografia. Es lo unico de la respuesta que depende del
 *                    reloj.
 * @param declared    lo que el negocio ha declarado, contado.
 * @param plans       cuantos planes se han guardado.
 * @param current     el plan vigente de cada desarrollador, con su capacidad contada.
 */
public record PlanningOperationalMetricsResponse(
        Instant generatedAt,
        Declared declared,
        Plans plans,
        Current current) {

    /**
     * La planificacion declarada, contada sobre el estado de hoy.
     *
     * <p><strong>Que se cuenta, exactamente.</strong> Una fila por elemento de trabajo declarado en
     * {@code planning_metadata}, que es una fila por elemento <em>declarado</em> y no por elemento
     * conocido: un ticket que nadie declaro no tiene fila, y por eso esta tabla no puede decir
     * cuantos tickets hay, solo cuantos se han declarado.
     *
     * <p><strong>Lo que este bloque no es.</strong> No es el historial de descartes de la capa
     * anticorrupcion. Aquellos descartes no se persisten —viajan en la respuesta de
     * {@code POST /from-glpi} y mueren ahi—, asi que reconstruirlos exigiria persistencia nueva, que
     * esta fase no introduce. Los dos codigos que viajan aqui dicen otra cosa, y la dicen exacta:
     * <em>cuantas filas declaradas producirian hoy este descarte si se planificaran ahora</em>. Es
     * la lectura que sirve para decidir a quien hay que ir a pedirle algo.
     *
     * @param total             filas declaradas. El denominador.
     * @param plannable         filas con estimacion y compromiso: las que hoy entrarian al motor.
     * @param withoutEstimation filas sin estimacion, con el codigo con el que la capa anticorrupcion
     *                          las descartaria.
     * @param withoutCommitment filas sin compromiso, con su codigo.
     * @param incomplete        filas a las que les falta algo.
     * @param retracted         filas sin ninguno de los dos valores. Se expone porque sin el la
     *                          aritmetica de este bloque no cierra para el consumidor.
     */
    public record Declared(
            String source,
            String scope,
            long total,
            long plannable,
            DeclaredGap withoutEstimation,
            DeclaredGap withoutCommitment,
            long incomplete,
            long retracted) {

        /** La tabla de la que sale todo este bloque. */
        public static final String SOURCE = "planning_metadata";

        /** Sobre que se conto: el estado de hoy, sin ventana temporal. */
        public static final String SCOPE = "estado declarado hoy, sin ventana temporal";
    }

    /**
     * Cuantas filas declaradas faltan por un motivo, con el codigo ya definido de ese motivo.
     *
     * <p>El codigo viaja como valor de {@link GlpiDiscardReason} y no como texto copiado: un codigo
     * escrito a mano en un sitio lejano solo se descubre el dia que alguien lo lee en un informe y
     * no coincide con el que usa el descarte.
     */
    public record DeclaredGap(GlpiDiscardReason code, long count) {
    }

    /**
     * Cuantos planes se han guardado.
     *
     * <p><strong>Cuenta ejecuciones, no planes distintos.</strong> Guardar un plan no es idempotente
     * —cada peticion inserta un identificador nuevo—, asi que dos peticiones iguales dejan dos filas.
     * El numero dice cuanto se ha planificado, que es informacion util, y no cuantos planes
     * distintos hay, que es lo que su nombre sugeriria si se leyera deprisa. Por eso no se usa como
     * denominador de nada.
     */
    public record Plans(String source, String scope, long generated) {

        /** La tabla de la que sale este bloque. */
        public static final String SOURCE = "plan_snapshot";

        /** Sobre que se conto: el historico entero. */
        public static final String SCOPE = "historico completo: una fila por ejecucion guardada";
    }

    /**
     * El plan vigente de cada desarrollador, con su capacidad contada.
     *
     * <p><strong>Vigente quiere decir el mas reciente.</strong> Un desarrollador acumula planes
     * —cada vez que se planifica se guarda uno— y sumarlos todos contaria la misma jornada varias
     * veces. Se toma el ultimo por {@code createdAt}, y los planes anteriores siguen existiendo para
     * auditoria y para reproducibilidad, pero no entran en la fotografia operativa.
     *
     * <p>La ventana de arriba es la union de las ventanas de todos: el primer y el ultimo dia que
     * algun plan vigente abarca. Cada desarrollador trae ademas la suya.
     *
     * @param from                  primer dia abarcado por algun plan vigente, o {@code null} si
     *                              ninguno tiene agenda.
     * @param to                    ultimo dia abarcado, o {@code null} si ninguno tiene agenda.
     * @param capacity              la suma de la capacidad de todos los planes vigentes.
     * @param displacedRequirements cuantos requerimientos distintos quedaron desplazados, sumando
     *                              los planes vigentes. Se cuentan elementos, no tramos: un
     *                              requerimiento que ocupa dos dias se movio una vez.
     * @param byDeveloper           el detalle por desarrollador, ordenado por identificador.
     */
    public record Current(
            String source,
            String scope,
            LocalDate from,
            LocalDate to,
            Capacity capacity,
            long displacedRequirements,
            List<DeveloperCurrent> byDeveloper) {

        /** De donde sale cada parte: la fila del plan, su agenda y su contexto congelado. */
        public static final String SOURCE = "plan_snapshot.created_at + work_block + planning_context";

        /** Sobre que se conto: un plan por desarrollador, el mas reciente. */
        public static final String SCOPE =
                "el plan vigente de cada desarrollador: el mas reciente por created_at";
    }

    /**
     * El plan vigente de un desarrollador, con lo que hay que saber para juzgarlo.
     *
     * <p>Lleva el identificador del plan y su sello de calculo porque son lo que hace comprobable el
     * criterio de vigencia: quien lea la respuesta puede pedir ese plan por su ruta y ver que es el
     * que se conto, en vez de tener que creerse la palabra «vigente».
     */
    public record DeveloperCurrent(
            String developerId,
            UUID planId,
            Instant calculatedAt,
            LocalDate from,
            LocalDate to,
            Capacity capacity,
            long displacedRequirements) {
    }

    /**
     * Cuanto cabe, cuanto esta ocupado y cuanto queda, sumado sobre la ventana.
     *
     * <p>Es la misma aritmetica del timeline —lo disponible de la jornada del calendario congelado,
     * lo ocupado de los tramos— sumada en vez de dia a dia. El restante no se recorta a cero, por el
     * mismo motivo que alli: un negativo significaria que el plan contradice su propio contexto, y es
     * mejor que se vea.
     *
     * <p>Los tres salen del plan, no de la configuracion vigente: si la jornada cambio despues de
     * calcular, la capacidad que se ve es la que se uso.
     */
    public record Capacity(
            BigDecimal availableHours,
            BigDecimal occupiedHours,
            BigDecimal remainingHours) {
    }
}
