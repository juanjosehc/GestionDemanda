package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.enums.PlanningMetadataField;

/**
 * Lo que el negocio declara sobre un elemento de trabajo, y que GLPI no guarda.
 *
 * <p>La investigacion de GLPI dejo dos huecos que no se pueden rellenar desde el codigo: no existe
 * un esfuerzo estimado utilizable —{@code actiontime} vale cero— y la fecha compromiso esta dos
 * veces, en SLA y en OLA, contradiciendose. El negocio ya decidio quien responde por cada uno: el
 * esfuerzo lo estima el desarrollador asignado y la fecha la compromete el gestor de demanda.
 * Ninguno de los dos vive en GLPI, asi que los dos viven aqui. <strong>GLPI es la fuente del
 * trabajo; la promesa sobre el trabajo es de este sistema.</strong>
 *
 * <p><strong>{@code workItemId} es el identificador del ticket en GLPI, como texto.</strong> No hay
 * clave foranea ni comprobacion contra GLPI: el metadata sigue al ticket, no al papel que juega en
 * un plan —un mismo ticket puede entrar como incidente o como requerimiento segun la corrida— y
 * atarlo a una fila de aqui obligaria a que existiera antes, justo lo que no se quiere. Es la misma
 * decision que ya tomo {@code Incident.id}.
 *
 * <p><strong>Los dos campos son independientes y pueden faltar por separado.</strong> Un elemento
 * con estimacion y sin fecha compromiso es un estado legitimo, y tambien lo es el contrario. La
 * unica combinacion que no existe es un valor sin autor: {@code estimatedBy}/{@code estimatedAt}
 * van juntos o no van, y lo mismo {@code committedBy}/{@code committedAt}.
 *
 * <p><strong>Un autor sin valor es un estado con significado, no un descuido.</strong> Retirar una
 * estimacion deja {@code estimatedHours} en nulo y conserva {@code estimatedBy}: dice «se retiro, y
 * consta quien». Es lo que hace que el borrado sea trazable en el propio estado y no solo en el
 * historial. Por eso {@code estimatedAt} se lee como <em>cuando se fijo o se retiro</em> la
 * estimacion, nunca como «cuando hay estimacion».
 *
 * <p><strong>Las horas se normalizan a cuatro decimales al entrar</strong>, que es la escala de la
 * columna. Sin esa normalizacion, un valor que va y vuelve de la base de datos cambiaria de
 * representacion —{@code 8} en la peticion, {@code 8.0000} en la respuesta— y compararlo por
 * igualdad produciria cambios fantasma: una fila de historial y un sello nuevos por reenviar lo
 * mismo. Toda comparacion de horas en esta clase usa {@code compareTo}, nunca {@code equals}.
 */
public record PlanningMetadata(
        String workItemId,
        BigDecimal estimatedHours,
        LocalDate committedDate,
        String estimatedBy,
        String committedBy,
        Instant estimatedAt,
        Instant committedAt,
        InputSource source) {

    /** La escala de {@code estimated_hours} en la base de datos. */
    private static final int HOURS_SCALE = 4;

    public PlanningMetadata {
        DomainPreconditions.requireText(workItemId, "workItemId");
        Objects.requireNonNull(source, "source es obligatorio");
        estimatedHours = normalizar(estimatedHours);
        vanJuntos(estimatedBy, estimatedAt, "estimated");
        vanJuntos(committedBy, committedAt, "committed");
        if (estimatedHours != null) {
            DomainPreconditions.requirePositive(estimatedHours, "estimatedHours");
            DomainPreconditions.requireText(estimatedBy, "estimatedBy");
        }
        if (committedDate != null) {
            DomainPreconditions.requireText(committedBy, "committedBy");
        }
    }

    /** El estado de un elemento de trabajo sobre el que todavia nadie ha declarado nada. */
    public static PlanningMetadata undeclared(String workItemId, InputSource source) {
        return new PlanningMetadata(workItemId, null, null, null, null, null, null, source);
    }

    /**
     * La primera declaracion de un elemento de trabajo, que tiene que declarar algo.
     *
     * <p>Un elemento del que no se afirma ni el esfuerzo ni la fecha no es una planificacion vacia:
     * es la ausencia de planificacion, y se representa no teniendo fila. Admitirla dejaria un
     * recurso que no dice nada y, sobre todo, un historial vacio —que es el unico estado del que
     * esta tabla no puede explicarse—. La guarda vive aqui y no solo en la validacion de la capa web
     * porque el dominio no delega sus invariantes: que el endpoint lo compruebe antes solo sirve
     * para responder mejor, no para que esto deje de ser cierto.
     */
    public static PlanningMetadata declared(
            String workItemId,
            BigDecimal estimatedHours,
            LocalDate committedDate,
            String changedBy,
            Instant declaredAt,
            InputSource source) {

        if (estimatedHours == null && committedDate == null) {
            throw new IllegalArgumentException(
                    "hay que declarar al menos la estimacion o la fecha compromiso");
        }
        return undeclared(workItemId, source)
                .declaredWith(estimatedHours, committedDate, changedBy, declaredAt);
    }

    /**
     * El estado que resulta de declarar estos valores sobre el actual.
     *
     * <p>El sello de un campo <strong>solo se renueva si su valor cambia</strong>. Reenviar lo mismo
     * no mueve la fecha ni cambia de autor: si no hubo cambio, no hay cambio que atribuir. Un campo
     * que no se declara en esta operacion conserva autor y fecha de la vez que si se declaro.
     *
     * <p>Es tambien el camino de la primera declaracion: sobre {@link #undeclared} deja cada valor
     * con su autor y su sello, sin ninguna rama aparte.
     */
    public PlanningMetadata declaredWith(
            BigDecimal nuevasHoras, LocalDate nuevaFecha, String changedBy, Instant declaredAt) {

        DomainPreconditions.requireText(changedBy, "changedBy");
        Objects.requireNonNull(declaredAt, "declaredAt es obligatorio");

        BigDecimal horas = normalizar(nuevasHoras);
        boolean cambianLasHoras = distintas(estimatedHours, horas);
        boolean cambiaLaFecha = !Objects.equals(committedDate, nuevaFecha);

        return new PlanningMetadata(
                workItemId,
                horas,
                nuevaFecha,
                cambianLasHoras ? changedBy : estimatedBy,
                cambiaLaFecha ? changedBy : committedBy,
                cambianLasHoras ? declaredAt : estimatedAt,
                cambiaLaFecha ? declaredAt : committedAt,
                source);
    }

    /**
     * Las filas de historial que separan este estado del anterior: una por campo cuyo valor cambio.
     *
     * <p>Un valor que pasa a nulo produce fila, porque retirar tambien es cambiar; uno que se
     * reenvia igual no la produce, porque no cambio nada. Devuelve lista vacia cuando los dos
     * estados son el mismo, que es lo que permite reenviar una declaracion sin ensuciar la
     * auditoria.
     */
    public List<PlanningMetadataChange> changesFrom(
            PlanningMetadata previous, String changedBy, Instant changedAt) {

        Objects.requireNonNull(previous, "previous es obligatorio");
        DomainPreconditions.requireText(changedBy, "changedBy");
        Objects.requireNonNull(changedAt, "changedAt es obligatorio");

        List<PlanningMetadataChange> changes = new ArrayList<>();
        if (distintas(previous.estimatedHours(), estimatedHours)) {
            changes.add(new PlanningMetadataChange(workItemId, PlanningMetadataField.ESTIMATED_HOURS,
                    textoDe(previous.estimatedHours()), textoDe(estimatedHours), changedBy, changedAt));
        }
        if (!Objects.equals(previous.committedDate(), committedDate)) {
            changes.add(new PlanningMetadataChange(workItemId, PlanningMetadataField.COMMITTED_DATE,
                    textoDe(previous.committedDate()), textoDe(committedDate), changedBy, changedAt));
        }
        return changes;
    }

    /**
     * Si el compromiso ya paso, medido contra la fecha de hoy.
     *
     * <p>Un compromiso de hoy <strong>no</strong> esta vencido: el dia en que se prometio entregar
     * todavia no ha terminado.
     */
    public boolean commitmentOverdue(LocalDate today) {
        Objects.requireNonNull(today, "today es obligatorio");
        return committedDate != null && committedDate.isBefore(today);
    }

    private static void vanJuntos(String by, Instant at, String campo) {
        if ((by == null) != (at == null)) {
            throw new IllegalArgumentException(campo + "By y " + campo + "At van juntos o ninguno");
        }
    }

    private static BigDecimal normalizar(BigDecimal horas) {
        return horas == null ? null : horas.setScale(HOURS_SCALE, RoundingMode.HALF_UP);
    }

    private static boolean distintas(BigDecimal una, BigDecimal otra) {
        if (una == null || otra == null) {
            return una != null || otra != null;
        }
        return una.compareTo(otra) != 0;
    }

    private static String textoDe(BigDecimal horas) {
        return horas == null ? null : horas.toPlainString();
    }

    private static String textoDe(LocalDate fecha) {
        return fecha == null ? null : fecha.toString();
    }
}
