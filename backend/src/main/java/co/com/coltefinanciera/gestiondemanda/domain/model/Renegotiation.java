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
 * <p><strong>El sello solo se renueva si la fecha cambia.</strong> Reenviar la misma fecha no mueve
 * {@code agreedAt} ni cambia de autor: si no hubo cambio, no hay cambio que atribuir. Es la misma
 * regla que sigue {@code PlanningMetadata.declaredWith}, y por la misma razon.
 */
public record Renegotiation(
        String workItemId,
        LocalDate agreedDate,
        String agreedBy,
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
     * El acuerdo que resulta de acordar esta fecha sobre el actual.
     *
     * <p>El sello de un acuerdo es su fecha: si la fecha nueva es la misma, no hubo renegociacion que
     * registrar y el acuerdo conserva autor y sello. Cambiarla renueva los dos, porque el acuerdo
     * vigente es otro y de otro.
     */
    public Renegotiation agreedWith(LocalDate nuevaFecha, String changedBy, Instant changedAt) {
        DomainPreconditions.requireText(changedBy, "changedBy");
        Objects.requireNonNull(changedAt, "changedAt es obligatorio");
        Objects.requireNonNull(nuevaFecha, "nuevaFecha es obligatoria");

        boolean cambiaLaFecha = !Objects.equals(agreedDate, nuevaFecha);

        return new Renegotiation(
                workItemId,
                nuevaFecha,
                cambiaLaFecha ? changedBy : agreedBy,
                cambiaLaFecha ? changedAt : agreedAt,
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
     * <p>Reenviar la misma fecha devuelve lista vacia, que es lo que permite registrar dos veces lo
     * mismo sin ensuciar la auditoria con un cambio que no ocurrio.
     */
    public List<RenegotiationChange> changesFrom(
            Renegotiation previous, String changedBy, Instant changedAt) {

        DomainPreconditions.requireText(changedBy, "changedBy");
        Objects.requireNonNull(changedAt, "changedAt es obligatorio");

        LocalDate fechaAnterior = previous == null ? null : previous.agreedDate();
        if (Objects.equals(fechaAnterior, agreedDate)) {
            return List.of();
        }
        return List.of(new RenegotiationChange(
                workItemId, fechaAnterior, agreedDate, changedBy, changedAt));
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
