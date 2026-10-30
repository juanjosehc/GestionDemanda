package co.com.coltefinanciera.gestiondemanda.domain.model;

/**
 * El estado de la planificacion declarada, contado.
 *
 * <p><strong>Desde la Fase 77 la declaracion solo aporta horas.</strong> La fecha de compromiso la
 * publica GLPI —su Internal TTR— y es la unica del sistema, asi que una fila declarada ya no puede
 * estar «sin compromiso»: o tiene estimacion o no la tiene, y esa es toda la carencia que le queda.
 * Los dos numeros que antes contaban cada mitad de la ausencia —{@code withoutCommitment} y la union
 * {@code incomplete}— se retiraron con la captura que los producia: seguir publicandolos diria que
 * todo lo declarado desde ahora esta incompleto, y seria cierto solo porque la columna ya no se
 * escribe.
 *
 * <p>Son dos numeros y no mas porque el tercero se deduce: {@code plannable} son las filas que si
 * tienen horas. Contarlo aparte seria pedirle a la base de datos lo que ya dijo.
 *
 * <p><strong>Lo que queda en la columna {@code committed_date} es historia.</strong> Las filas
 * anteriores a la fase conservan la fecha que alguien tecleo y ningun calculo de este bloque la
 * mira. No se borra: es el rastro de una decision que existio, y el historial de cambios la
 * conserva igual.
 *
 * @param total             filas declaradas. Es el denominador de todo lo demas: sin el, «una sin
 *                          estimacion» no distingue entre una de cuatro y una de cuatrocientos.
 * @param withoutEstimation filas sin horas estimadas. Las retiradas —sin ningun valor— siguen
 *                          contando aqui, porque retirar la estimacion es exactamente esto.
 */
public record DeclaredPlanningMetrics(long total, long withoutEstimation) {

    /** Filas con horas declaradas: las que aportan algo al motor. */
    public long plannable() {
        return total - withoutEstimation;
    }
}
