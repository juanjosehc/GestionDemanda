package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;

/**
 * La fecha nueva que se acordo tras un desplazamiento, y quien la registro.
 *
 * <p><strong>La renegociacion es una consecuencia humana de un desplazamiento ya detectado.</strong>
 * El motor mueve el requerimiento y deja constancia del hecho —{@code RescheduleEvent}—; lo que no
 * puede saber es a que fecha se llego a acordar con quien lo pidio, porque eso se habla. Este
 * agregado es ese acuerdo y nada mas: no mueve nada, no recalcula nada, no borra nada. Se <em>añade</em>
 * al hecho que ya estaba auditado.
 *
 * <p><strong>No hay clave foranea al desplazamiento ni al plan.</strong> {@code workItemId} es el
 * identificador del ticket en GLPI, como texto, igual que en {@link PlanningMetadata} y por el mismo
 * motivo: un acuerdo es sobre el requerimiento, no sobre una fila de un plan concreto. Un
 * requerimiento desplazado dos veces —por dos incidentes distintos— tiene un solo acuerdo, y atarlo a
 * un evento obligaria a elegir cual de los dos.
 *
 * <p><strong>La fila existe solo si hay acuerdo, asi que {@code agreedDate} no admite nulo.</strong>
 * No hay un estado «acuerdo vacio» que representar: mientras nadie acuerde nada, no hay fila. Esa es
 * la diferencia con {@code PlanningMetadata}, donde los dos valores son independientes y cualquiera
 * de los dos puede faltar. Aqui hay uno solo y es obligatorio, de modo que la ausencia de fila y la
 * ausencia de acuerdo son la misma cosa.
 *
 * <p><strong>El sello solo se renueva si algo cambia.</strong> Reenviar la misma fecha con el mismo
 * motivo no mueve {@code agreedAt} ni cambia de autor: si no hubo cambio, no hay cambio que atribuir.
 * Es la misma regla que sigue {@code PlanningMetadata.declaredWith}, y por la misma razon.
 *
 * <p><strong>{@code agreedReason} es el motivo del acuerdo, no el del desplazamiento.</strong> Son
 * dos hechos distintos y viven en sitios distintos: por que se movio el requerimiento lo audita el
 * motor en el {@code RescheduleEvent} —una regla aplicada sobre una capacidad comprometida—, y por que
 * se llego a esa fecha lo dice la persona que la acuerda, aqui. El primero se deduce de los datos; el
 * segundo no se deduce de nada, y es justo lo que convierte «se acordo el 30» en «se acordo el 30
 * porque el cliente aplazo la instalacion». Los dos viajan juntos en la lectura consolidada y no se
 * confunden: el del desplazamiento es un campo del evento, el del acuerdo es un campo de este
 * agregado.
 *
 * <p><strong>El motivo admite nulo, y solo por los acuerdos que ya existian.</strong> Los registrados
 * antes de que este campo existiera no tienen uno, y rellenarlos con un texto cualquiera seria
 * inventar una explicacion que nadie dio. La escritura, en cambio, siempre trae uno —lo exigen
 * {@code RenegotiationRequest} y {@code RenegotiationUpdateRequest}—, asi que aqui no hay ninguna
 * comprobacion que hacer: la unica via por la que un nulo entra es la lectura de una fila vieja. Nulo
 * significa, siempre, «anterior a que el motivo se registrara».
 */
public record Renegotiation(
        String workItemId,
        LocalDate agreedDate,
        String agreedBy,
        String agreedReason,
        Instant agreedAt,
        InputSource source) {

    public Renegotiation {
        DomainPreconditions.requireText(workItemId, "workItemId");
        Objects.requireNonNull(agreedDate, "agreedDate es obligatorio");
        DomainPreconditions.requireText(agreedBy, "agreedBy");
        Objects.requireNonNull(agreedAt, "agreedAt es obligatorio");
        Objects.requireNonNull(source, "source es obligatorio");
    }

    /**
     * El acuerdo que resulta de acordar esta fecha y este motivo sobre el actual.
     *
     * <p>El sello de un acuerdo es su contenido: si ni la fecha ni el motivo cambian, no hubo
     * renegociacion que registrar y el acuerdo conserva autor y sello. Cambiar cualquiera de los dos
     * renueva los dos, porque el acuerdo vigente es otro y de otro.
     *
     * <p><strong>El motivo cuenta como cambio, y no es un detalle.</strong> Una explicacion corregida
     * es una decision nueva: si solo se comparara la fecha, cambiar el motivo de un acuerdo ya
     * registrado no dejaria rastro —el historial no tendria fila, porque su fecha anterior y su fecha
     * nueva serian la misma— y la auditoria afirmaria que el motivo vigente es el que siempre estuvo.
     * Que la fecha no se mueva y el motivo si queda registrado como lo que es: una fila con las dos
     * fechas iguales y el motivo nuevo.
     */
    public Renegotiation agreedWith(
            LocalDate nuevaFecha, String nuevaRazon, String changedBy, Instant changedAt) {

        DomainPreconditions.requireText(changedBy, "changedBy");
        Objects.requireNonNull(changedAt, "changedAt es obligatorio");
        Objects.requireNonNull(nuevaFecha, "nuevaFecha es obligatoria");

        boolean cambia = !Objects.equals(agreedDate, nuevaFecha)
                || !Objects.equals(agreedReason, nuevaRazon);

        return new Renegotiation(
                workItemId,
                nuevaFecha,
                cambia ? changedBy : agreedBy,
                cambia ? nuevaRazon : agreedReason,
                cambia ? changedAt : agreedAt,
                source);
    }

    /**
     * Las filas de historial que separan este acuerdo del anterior: una, o ninguna.
     *
     * <p><strong>Un {@code previous} nulo es la primera vez que se acuerda algo</strong> sobre este
     * requerimiento, y produce la fila con la fecha anterior en nulo —el dato que dice que el acuerdo
     * nacio ahi y quien lo trajo—. Es tambien el camino de la primera vez, sin ninguna rama aparte
     * para ella.
     *
     * <p>Reenviar la misma fecha con el mismo motivo devuelve lista vacia, que es lo que permite
     * registrar dos veces lo mismo sin ensuciar la auditoria con un cambio que no ocurrio.
     *
     * <p><strong>La comparacion es del par completo —fecha y motivo— y vive aqui, no en
     * {@link RenegotiationChange}.</strong> Es el unico sitio donde estan los dos valores: el cambio
     * solo conoce el motivo nuevo, asi que alli no hay con que compararlo. Una fila con la fecha
     * anterior igual a la nueva es, por tanto, un cambio de motivo, y no un cambio que no cambio nada.
     */
    public List<RenegotiationChange> changesFrom(
            Renegotiation previous, String changedBy, Instant changedAt) {

        DomainPreconditions.requireText(changedBy, "changedBy");
        Objects.requireNonNull(changedAt, "changedAt es obligatorio");

        LocalDate fechaAnterior = previous == null ? null : previous.agreedDate();
        String motivoAnterior = previous == null ? null : previous.agreedReason();

        if (Objects.equals(fechaAnterior, agreedDate) && Objects.equals(motivoAnterior, agreedReason)) {
            return List.of();
        }
        return List.of(new RenegotiationChange(
                workItemId, fechaAnterior, agreedDate, agreedReason, changedBy, changedAt));
    }

    /**
     * Si este acuerdo cubre un desplazamiento ocurrido en ese instante.
     *
     * <p><strong>Un acuerdo cubre los desplazamientos que ya existian cuando se registro, y solo
     * esos.</strong> Es la unica comparacion posible: lo que se sabe de un desplazamiento es cuando
     * se audito, y lo que se sabe de un acuerdo es cuando se registro. Un incidente posterior mueve el
     * requerimiento otra vez y el acuerdo viejo deja de cubrirlo —el estado vuelve a
     * {@code PENDIENTE_DE_ACUERDO}—, que es exactamente lo que hay que poder ver.
     *
     * <p>Un desplazamiento en el mismo instante que el acuerdo <strong>si</strong> queda cubierto: el
     * orden entre dos hechos del mismo sello no es deducible, y suponer que el incidente llego
     * despues inventaria una renegociacion pendiente que nadie pidio.
     */
    public boolean covers(Instant displacementAt) {
        Objects.requireNonNull(displacementAt, "displacementAt es obligatorio");
        return !displacementAt.isAfter(agreedAt);
    }
}
