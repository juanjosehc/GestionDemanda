package co.com.coltefinanciera.gestiondemanda.integration.glpi;

/**
 * En que estado deja la capa anticorrupcion a un ticket de GLPI, de cara a declararlo.
 *
 * <p><strong>No es una segunda clasificacion: es el nombre del resultado de la que ya existe.</strong>
 * Quien decide si un ticket entra al plan es {@link GlpiTicketValidator} —primero
 * {@code rejection}, despues {@code missingDeclaration}— y {@link GlpiTicketMapper} al traducirlo.
 * Este enum no vuelve a preguntar por los nulos ni por los codigos de estado: se deriva de los
 * {@link GlpiDiscardedItem} que esas mismas llamadas produjeron. La consecuencia es la que importa
 * para quien va a construir una pantalla encima: un ticket no puede salir planificable en la lectura
 * y descartado en el plan, porque las dos cosas salen del mismo sitio.
 *
 * <p>Por eso vive aqui y no en {@code domain}: es vocabulario de la frontera, como
 * {@link GlpiDiscardReason}, y se lee con el. El dia que el validador cambie una regla, esto cambia
 * solo —no hay una copia que actualizar en otro paquete—.
 *
 * <p><strong>Los cinco valores responden a una pregunta distinta cada uno y por eso son cinco.</strong>
 * Los cuatro ultimos se confundirian facilmente en dos —«falta algo» y «no se puede»—, y juntarlos
 * borraria lo unico que hace util la lectura: a quien hay que ir a pedirle algo. Al desarrollador, la
 * estimacion; al gestor de demanda, el compromiso; a quien opera GLPI, un ticket mal formado.
 */
public enum DeclarationStatus {

    /** Tiene todo lo que el motor necesita. Entraria al plan si se planificara ahora. */
    PLANIFICABLE,

    /**
     * Tiene declaracion y compromiso, y le faltan las horas.
     *
     * <p>Le corresponde al desarrollador asignado.
     */
    SIN_ESTIMACION,

    /** Tiene declaracion y estimacion, y le falta la fecha compromiso. Le corresponde al gestor. */
    SIN_COMPROMISO,

    /**
     * Le faltan las dos cosas a la vez.
     *
     * <p><strong>Cubre los dos casos que el validador junta</strong>, y esto hay que leerlo despacio
     * porque el nombre solo nombra uno: que nadie haya declarado nada —no hay fila— y que haya fila
     * sin ninguno de los dos valores, que es alcanzable porque el {@code PUT} de la declaracion
     * permite retirar los dos. La accion a tomar es la misma en los dos —declarar estimacion y
     * compromiso— y por eso el codigo no los separa; quien necesite distinguirlos tiene el texto del
     * descarte, que dice «no hay planificacion declarada» o «la planificacion declarada no tiene
     * estimacion». Es el mismo reparto que hace {@link GlpiDiscardReason} entre codigo y texto.
     */
    SIN_DECLARACION,

    /**
     * No se puede traducir al dominio, y la causa es de GLPI, no de una persona.
     *
     * <p>Agrupa las cinco causas que no se arreglan declarando: sin identificador, tipo desconocido,
     * estado desconocido, fecha ilegible y traduccion fallida. Cual de ellas es viaja en el codigo del
     * descarte, que es lo que hay que mirar para saber si esto se arregla en GLPI o en el contrato.
     */
    NO_TRADUCIBLE
}
