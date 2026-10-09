package co.com.coltefinanciera.gestiondemanda.domain.model;

/**
 * El estado de la planificacion declarada, contado.
 *
 * <p>Son cuatro numeros y no seis porque los otros dos se deducen de estos. {@code incomplete} y
 * {@code plannable} son algebra de conjuntos sobre las mismas cuatro filas, y contarlos aparte
 * seria pedirle a la base de datos dos veces lo que ya dijo. Aqui no se cuenta nada: esto es lo que
 * el puerto devuelve.
 *
 * <p><strong>Las cuatro situaciones, y por que hace falta la cuarta.</strong> Una fila declarada
 * puede tener estimacion y no compromiso, compromiso y no estimacion, las dos, o ninguna. Las tres
 * primeras son las que se espera ver; la cuarta —ninguna— tambien es alcanzable, porque el endpoint
 * de actualizacion puede retirar los dos valores y el estado vacio es legitimo. Sin contarla aparte,
 * {@code withoutEstimation} y {@code withoutCommitment} sumarian mas que {@code incomplete} y los
 * tres numeros se contradirian para un estado que existe.
 *
 * <p>La identidad que cierra la aritmetica, y que conviene tener escrita una vez:
 *
 * <pre>
 *   withoutEstimation + withoutCommitment == incomplete + retracted
 * </pre>
 *
 * @param total             filas declaradas. Es el denominador de todas las demas: sin el, «uno sin
 *                          estimacion» no distingue entre uno de cuatro y uno de cuatrocientos.
 * @param withoutEstimation filas sin horas estimadas. Incluye las retiradas.
 * @param withoutCommitment filas sin fecha compromiso. Incluye las retiradas.
 * @param retracted         filas sin ninguno de los dos valores.
 */
public record DeclaredPlanningMetrics(
        long total,
        long withoutEstimation,
        long withoutCommitment,
        long retracted) {

    /**
     * Filas a las que les falta algo: estimacion, compromiso o las dos.
     *
     * <p>Se deduce restando las retiradas a la suma de las dos carencias, porque una fila sin
     * ninguno de los dos valores se cuenta dos veces al sumarlas.
     */
    public long incomplete() {
        return withoutEstimation + withoutCommitment - retracted;
    }

    /**
     * Filas con las dos cosas declaradas: las que hoy entrarian al motor sin que nadie tenga que
     * hacer nada.
     */
    public long plannable() {
        return total - incomplete();
    }
}
