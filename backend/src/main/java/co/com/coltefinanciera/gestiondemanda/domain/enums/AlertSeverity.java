package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * Cuanto urge una alerta.
 *
 * <p><strong>Los tres niveles no son un umbral: son tres clases de estado distintas.</strong> Cada uno
 * se apoya en una condicion que el backend ya distingue en otro sitio, y por eso la clasificacion no
 * hay que defenderla: hay que leerla.
 *
 * <ul>
 *   <li><strong>{@code CRITICAL}: el estado se contradice a si mismo.</strong> No existe ninguna
 *       configuracion legitima que lo explique. {@code TimelineCapacity} ya lo declara —un restante
 *       negativo «significaria que el plan contradice su propio contexto»— y {@code Capacity} se niega
 *       a recortarlo a cero precisamente para que se vea.
 *   <li><strong>{@code WARNING}: es un estado legal y alguien tiene que actuar.</strong> No hay nada
 *       roto, pero el siguiente movimiento lo rompe, o ya se movio algo que estaba comprometido, o hay
 *       trabajo que no entrara al motor hasta que alguien declare lo que falta.
 *   <li><strong>{@code INFO}: es un agregado sin dueño unico.</strong> Dice cuanto hay, no reclama
 *       nada: no nombra a una persona que tenga que hacer algo, y por eso no puede ser un aviso.
 * </ul>
 *
 * <p>El orden de declaracion es el orden de gravedad, y no es casual: {@code compareTo} de un enum
 * compara por ordinal, asi que ordenar por este tipo ordena por gravedad sin escribir un comparador.
 */
public enum AlertSeverity {

    /** El estado se contradice a si mismo. */
    CRITICAL,

    /** Es legal, pero alguien tiene que actuar. */
    WARNING,

    /** Cuanto hay. No reclama nada. */
    INFO
}
