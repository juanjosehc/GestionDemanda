package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import lombok.extern.slf4j.Slf4j;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;

/**
 * Traduce la priorizacion de GLPI a la severidad del dominio.
 *
 * <p>Es la pieza que el documento de decisiones llevaba desde la primera fase marcada como
 * <em>falta</em>: la correspondencia entre los dos vocabularios. Vive aqui, en la frontera, porque es
 * una traduccion y no una regla de negocio; {@code IncidentSeverity} no sabe que GLPI existe y
 * {@link GlpiTicket} no sabe que existe la severidad.
 *
 * <p><strong>La escala de GLPI es 1 a 5; la del dominio, tres valores.</strong> El agrupamiento
 * elegido es {@code 5,4 → ALTO}, {@code 3 → MEDIO}, {@code 2,1 → BAJO}. La razon de agrupar de a dos
 * en los extremos y no de a uno en el centro es que el dominio tiene una categoria de mas arriba y
 * una de mas abajo, y las dos tienen que significar algo: si {@code 4} cayera en {@code MEDIO}, la
 * severidad alta solo la produciria el valor mas extremo de GLPI y el dominio perderia la capacidad
 * de expresar "importante pero no critico".
 *
 * <p><strong>Cuando GLPI no da prioridad, se deduce del impacto y la urgencia.</strong> GLPI calcula
 * la prioridad a partir de esos dos campos con una matriz configurable; si el ticket no trae
 * prioridad pero si impacto o urgencia, se toma el mayor de los dos como aproximacion. Es una
 * aproximacion declarada, no una copia de la matriz: la matriz real es configurable por instancia y
 * no se puede replicar sin leerla.
 *
 * <p><strong>Cuando no hay nada que traducir, la severidad es nula.</strong> Un ticket sin prioridad
 * ni impacto ni urgencia no es un ticket invalido —GLPI lo acepta— y descartarlo perderia trabajo
 * real. El dominio ya sabe leer una severidad nula: es el camino anterior a la priorizacion por
 * severidad, donde decide el umbral de horas. Degradar a ese camino conserva el incidente y conserva
 * la informacion: la respuesta dice {@code severity: null}, que es la verdad.
 *
 * <p>Un valor fuera de la escala 1-5 no se interpreta ni se recorta. Se trata como ausente, con
 * aviso, porque un {@code 9} significa que la suposicion sobre el contrato de GLPI es falsa, y
 * adivinar que quiso decir seria peor que declarar que no se sabe.
 */
@Slf4j
public final class GlpiPriorityMapper {

    /** Desde que valor de la escala de GLPI el dominio considera la severidad alta. */
    private static final int HIGH_FROM = 4;

    /** El valor de la escala de GLPI que el dominio considera medio. */
    private static final int MEDIUM = 3;

    private GlpiPriorityMapper() {
    }

    /**
     * La severidad del dominio para un ticket de GLPI, o {@code null} si no hay de donde deducirla.
     *
     * <p>La prioridad manda; impacto y urgencia solo entran cuando falta. La escala contra la que se
     * comprueba sale del contrato, no de una constante: es el dato que cambia entre instancias de GLPI
     * y el que hay que poder declarar distinto sin tocar esta clase.
     */
    static IncidentSeverity severityOf(GlpiTicket ticket, GlpiContract contract) {
        Integer raw = contract.inScale(ticket.priority()) ? ticket.priority() : null;
        String origin = "priority";

        if (raw == null && ticket.priority() != null) {
            log.warn("Ticket GLPI {}: priority={} esta fuera de la escala {}..{} del contrato {}; se "
                    + "interpreta como ausente. Si GLPI cambio de escala, el contrato esta desactualizado",
                    ticket.id(), ticket.priority(), contract.minPriority(), contract.maxPriority(),
                    contract.version());
        }
        if (raw == null) {
            raw = highestInScale(contract, ticket.impact(), ticket.urgency());
            origin = "impact/urgency";
        }
        if (raw == null) {
            log.warn("Ticket GLPI {} sin prioridad, impacto ni urgencia utilizables: se planifica sin "
                    + "severidad y decidira el umbral de horas", ticket.id());
            return null;
        }

        IncidentSeverity severity = raw >= HIGH_FROM ? IncidentSeverity.ALTO
                : raw == MEDIUM ? IncidentSeverity.MEDIO
                : IncidentSeverity.BAJO;
        log.debug("Ticket GLPI {}: {}={} traducido a severidad {}", ticket.id(), origin, raw, severity);
        return severity;
    }

    /** El mayor de los dos que este en la escala del contrato; {@code null} si ninguno lo esta. */
    private static Integer highestInScale(GlpiContract contract, Integer first, Integer second) {
        Integer a = contract.inScale(first) ? first : null;
        Integer b = contract.inScale(second) ? second : null;
        if (a == null) {
            return b;
        }
        if (b == null) {
            return a;
        }
        return Math.max(a, b);
    }
}
