package co.com.coltefinanciera.gestiondemanda.integration.glpi;

/**
 * Un ticket de GLPI que no llego al motor, y por que.
 *
 * <p>Existe porque descartar en silencio es la peor forma de integrarse con un sistema ajeno: un plan
 * que sale con menos incidentes de los que hay no se distingue de un plan correcto, y quien lo lee no
 * tiene como saber que faltaba trabajo. Con esto, la respuesta del endpoint dice exactamente que
 * quedo fuera y por que, y el descarte deja de ser un efecto invisible para volverse un dato.
 *
 * <p><strong>El motivo son dos campos y no uno.</strong> {@code code} es el que se cuenta, el que
 * permite agrupar y el que no cambia aunque alguien reescriba el texto; {@code reason} es el que se
 * lee, y nombra el campo concreto que hay que corregir. Juntarlos en una cadena dejaria el descarte
 * sin poder contarse; dejar solo el codigo perderia el detalle que hoy tiene —que {@code actiontime}
 * valia cero, que fecha era ilegible— y el brief prohibe perderlo.
 *
 * <p><strong>Un ticket puede aparecer mas de una vez.</strong> El descarte dice causas, no tickets:
 * un elemento sin planificacion declarada falta la estimacion <em>y</em> el compromiso, y las dos
 * cosas se informan. Contar descartes y contar tickets descartados son entonces dos numeros
 * distintos, y quien los use tiene que saber cual esta pidiendo.
 *
 * <p>No lleva el titulo. El identificador basta para ir a GLPI a mirarlo, y un texto que no se usa
 * para nada mas no se copia.
 */
public record GlpiDiscardedItem(String ticketId, GlpiDiscardReason code, String reason) {

    /**
     * El descarte de un ticket, con su identificador tal como lo devolvio GLPI.
     *
     * <p>Un ticket sin {@code id} no tiene como nombrarse, y ese hueco se escribe en vez de dejarlo
     * nulo: es el mismo caso que el propio descarte {@code SIN_IDENTIFICADOR_TICKET} denuncia, y una
     * respuesta con el campo vacio se leeria como un fallo de la respuesta.
     */
    static GlpiDiscardedItem of(GlpiTicket ticket, GlpiDiscardReason code, String reason) {
        return new GlpiDiscardedItem(
                ticket.id() == null ? "(sin id)" : String.valueOf(ticket.id()), code, reason);
    }
}
