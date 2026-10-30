package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * El catalogo de alertas operativas, entero, en un solo sitio.
 *
 * <p><strong>Una alerta es una condicion, no un elemento.</strong> Cada constante dice <em>que</em>
 * esta pasando; cuantos elementos lo producen es el dato que acompaña a la alerta, no la alerta. Un
 * equipo de veinte desarrolladores con la jornada agotada produce una alerta con
 * {@code count: 20}, no veinte alertas.
 *
 * <p><strong>Aqui no hay codigo, hay catalogo.</strong> La severidad, la condicion y el destino de
 * cada alerta se declaran aqui y en ningun otro sitio: el servicio solo aporta el numero. Añadir una
 * alerta sin decir cuanto urge no compila, que es exactamente lo que se quiere de un catalogo.
 *
 * <p><strong>Las alertas no son una fuente de verdad.</strong> Son una proyeccion de la fotografia
 * operativa: cada una nombra el bloque del que sale su numero —{@code declared} o {@code current}— y
 * la condicion con la que se cuenta. Ni se recalcula el plan, ni se consulta GLPI, ni se lee la base
 * por un camino distinto al de {@code /metrics}.
 *
 * <p><strong>El orden de declaracion es el orden de salida</strong>, y va de mas grave a menos. La
 * salida se ordena igualmente por severidad y luego por este orden, para no depender de donde acabe
 * declarando alguien la proxima alerta.
 *
 * <p><strong>Cuatro de las seis enlazan a un desglose que ya existe.</strong> {@code detailUrl} nombra
 * el endpoint de la Fase 18 que enseña los elementos, no una pantalla: es una ruta que esta API sirve,
 * asi que se puede pedir y comprobar. Las dos de capacidad van con {@code null}, porque su detalle es
 * el calendario del plan y esta fase no construye listados nuevos.
 */
public enum OperationalAlertType {

    /**
     * El plan vigente de un desarrollador ocupa mas horas de las que su jornada permite.
     *
     * <p>Es la unica condicion que el contrato ya declara imposible, y por eso es la unica
     * {@code CRITICAL}: no hay ninguna configuracion legitima que la explique. {@code Capacity} no
     * recorta el restante a cero justamente para que se vea.
     *
     * <p><strong>El numero cuenta planes vigentes</strong> —uno por desarrollador—, no dias ni horas.
     * {@code count: 3} se lee «tres desarrolladores con su plan vigente pasado de jornada».
     *
     * <p><strong>Mide el plan, no el dia.</strong> El restante que se mira es el del plan vigente
     * entero —la suma de sus jornadas—, que es el que la fotografia publica y el que el tablero ya
     * colorea fila a fila; el detalle dia a dia sigue donde estaba, en el calendario del plan. Contar
     * por dia daria ademas un falso positivo por cada sabado y domingo de la ventana: una jornada no
     * laborable tiene cero disponible y cero ocupado, asi que su restante es cero.
     *
     * <p><strong>Hoy no puede dispararse.</strong> El motor nunca sobrepasa la jornada, asi que un
     * restante negativo no deberia ocurrir por el camino real; existe como canario. Se implementa
     * igual, y la imposibilidad de dispararla se documenta en vez de disimularse.
     */
    CAPACIDAD_NEGATIVA(
            AlertSeverity.CRITICAL,
            null,
            "planes vigentes cuya capacidad restante es negativa"),

    /**
     * Trabajo comprometido que no llego a su fecha y hubo que mover.
     *
     * <p><strong>El numero cuenta elementos</strong>, no desarrolladores ni tramos: un requerimiento
     * que ocupa dos dias se movio una vez y cuenta una. Se suma sobre los planes vigentes, que es
     * exactamente lo que hace el contador de la fotografia.
     */
    REQUERIMIENTOS_DESPLAZADOS(
            AlertSeverity.WARNING,
            "/api/planning/metrics/displaced",
            "elementos desplazados en los planes vigentes, sumados y contados una vez cada uno"),

    /**
     * El plan vigente de un desarrollador ocupa exactamente lo que su jornada permite.
     *
     * <p>No es un estado roto: es el estado en el que el siguiente requerimiento desplaza a otro. Por
     * eso es un aviso y no una critica —nada contradice al plan; el plan esta lleno.
     *
     * <p><strong>Mide el plan, no el dia</strong>, por el mismo motivo que {@link #CAPACIDAD_NEGATIVA}:
     * un plan con un lunes exactamente lleno y holgura el resto de la semana tiene restante positivo y
     * no dispara esta alerta. El dia lleno se ve en el calendario del plan, no aqui. El numero cuenta
     * planes vigentes, uno por desarrollador.
     */
    CAPACIDAD_AGOTADA(
            AlertSeverity.WARNING,
            null,
            "planes vigentes cuya capacidad restante es exactamente cero"),

    /**
     * Hay tickets declarados sin horas estimadas.
     *
     * <p>Es la unica carencia que la declaracion puede tener desde la Fase 77 —la fecha de
     * compromiso la publica GLPI y no se declara—, y nombra a una persona concreta: el desarrollador
     * que tiene que estimarlo.
     */
    SIN_ESTIMACION(
            AlertSeverity.WARNING,
            "/api/planning/metrics/declared/SIN_ESTIMACION",
            "filas de planning_metadata con estimated_hours nulo");

    private final AlertSeverity severity;
    private final String detailUrl;
    private final String condition;

    OperationalAlertType(AlertSeverity severity, String detailUrl, String condition) {
        this.severity = severity;
        this.detailUrl = detailUrl;
        this.condition = condition;
    }

    /** Cuanto urge. */
    public AlertSeverity severity() {
        return severity;
    }

    /**
     * El desglose que enseña los elementos que producen esta alerta, o {@code null} si no hay tal
     * listado.
     *
     * <p><strong>Es una ruta de esta API, no de la interfaz.</strong> Apunta al mismo recurso que el
     * endpoint sirve, en el namespace que este controlador ya escribe. Publicar la ruta de la pantalla
     * habria sido la tercera copia de un hecho que ya tiene dos dueños en el frontend —el token de la
     * traduccion y la plantilla de la ruta—, y ademas el backend no puede construirla bien: no conoce
     * el prefijo con el que se sirve la aplicacion ni si va detras de un proxy.
     *
     * <p>La consecuencia practica es la que importa: <em>una ruta de esta API se puede recorrer</em>.
     * Una prueba pide cada {@code detailUrl} publicado y exige que responda y que el numero de
     * elementos cuadre con el {@code count} de la alerta, asi que el literal deja de ser una promesa y
     * pasa a ser un hecho verificado. Traducirlo a una pantalla, el dia que haga falta, es del lado que
     * ya sabe traducirlo.
     *
     * <p>Cuando no hay listado propio el campo sigue viajando, con {@code null}, para que el esquema
     * sea el mismo en las seis.
     */
    public String detailUrl() {
        return detailUrl;
    }

    /**
     * La condicion que se cuenta, en palabras.
     *
     * <p>Es lo que permite responder «que consulta la genera» sin abrir la documentacion.
     */
    public String condition() {
        return condition;
    }
}
