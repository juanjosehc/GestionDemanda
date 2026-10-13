package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * Si los desplazamientos vigentes de un requerimiento ya tienen una fecha acordada, o todavia no.
 *
 * <p><strong>No es {@link RequirementStatus#PENDIENTE_DE_RENEGOCIACION}, y por eso no se llama
 * igual.</strong> Aquel es un estado del requerimiento que el motor deduce al planificar y que nunca
 * se guarda: dice que la fecha pactada dejo de ser alcanzable. Este dice otra cosa —si alguien ya
 * registro la fecha nueva— y vive en el acuerdo, no en el requerimiento. Compartir nombre habria
 * dejado dos hechos distintos con una sola palabra, que es la clase de duplicado que se descubre el
 * dia que alguien lee uno creyendo que es el otro.
 *
 * <p><strong>Se deduce, no se guarda.</strong> Guardarlo obligaria a mantenerlo al dia cada vez que
 * el plan se recalcula y cada vez que se registra un acuerdo, y bastaria olvidar una de las dos
 * para que la tabla afirmara algo que ya no es cierto. Se calcula al leer, a partir de los dos
 * hechos que si son hechos: los desplazamientos del plan vigente y el acuerdo registrado.
 */
public enum RenegotiationStatus {

    /**
     * Hay al menos un desplazamiento que ningun acuerdo cubre.
     *
     * <p>O no se ha registrado ninguno, o el que hay es anterior al ultimo incidente que volvio a
     * mover el requerimiento. Los dos casos se ven igual desde fuera —hay que volver a acordar— y esa
     * es la razon de que sean un solo estado en lugar de dos.
     */
    PENDIENTE_DE_ACUERDO,

    /**
     * Todos los desplazamientos vigentes son anteriores al acuerdo: la fecha nueva esta registrada.
     *
     * <p>Un acuerdo posterior <strong>no</strong> cubre lo que vino despues. Es la unica regla que
     * distingue «ya se renegocio» de «se renegocio y luego volvio a moverse», y sin ella el segundo
     * caso se veria como el primero.
     */
    ACORDADA
}
