package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Optional;

import org.springframework.stereotype.Component;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;
import co.com.coltefinanciera.gestiondemanda.domain.model.Incident;
import co.com.coltefinanciera.gestiondemanda.domain.model.Requirement;

/**
 * Traduce un {@link GlpiTicket} a los objetos que el dominio entiende.
 *
 * <p>Aqui esta el cuerpo de la capa anticorrupcion: todo lo que hay que saber de GLPI para producir
 * un {@code Incident} o un {@code Requirement}, y nada mas. Lo que entra son codigos numericos y
 * fechas en texto; lo que sale son enums del dominio, horas en {@code BigDecimal} y fechas en
 * {@code Instant}. El dominio no ve el ticket.
 *
 * <p><strong>Un ticket de GLPI es una de dos cosas, y lo dice su {@code type}.</strong> {@code 1} es
 * incidencia y {@code 2} es peticion; se traducen a {@code Incident} y a {@code Requirement}
 * respectivamente. Es la traduccion menos evidente de todas y conviene dejarla escrita: en GLPI los
 * dos son la misma entidad, y en el dominio son dos tipos distintos que el motor trata de forma
 * distinta. La separacion la hace esta clase, no el motor.
 *
 * <p><strong>Los estados se traducen por su significado, no por su numero.</strong> Un ticket
 * {@code 5} (solucionado) es un incidente {@code RESUELTO} y tambien un requerimiento
 * {@code FINALIZADO}: el mismo codigo de GLPI cae en enums distintos segun de que lado este, porque
 * "solucionado" no significa lo mismo para una incidencia que para una peticion planificada. Los
 * codigos que no estan en la tabla no se traducen a nada y se devuelven vacios; quien decide que
 * hacer con ellos es el validador.
 *
 * <p>{@code PENDIENTE_DE_RENEGOCIACION} no aparece en ninguna tabla de traduccion, y es correcto: no
 * es un estado que GLPI pueda tener, es un estado que el motor deduce cuando no alcanza a planificar
 * algo. Un requerimiento no entra al motor renegociado; sale.
 */
@Component
public class GlpiTicketMapper {

    private static final BigDecimal SECONDS_PER_HOUR = BigDecimal.valueOf(3600);

    /**
     * Las horas del dominio salen de {@code actiontime}, que GLPI expresa en segundos.
     *
     * <p>La escala es la de la columna que las guarda —{@code numeric(10,4)}— para que lo que se
     * planifica y lo que se guarda sean el mismo numero. Redondear mas tarde, al persistir, haria que
     * la entrada registrada no fuera exactamente la que el motor leyo.
     */
    private static final int HOURS_SCALE = 4;

    private final ZoneId zone;
    private final GlpiContract contract;
    private final DateTimeFormatter dateTime;

    /**
     * La zona sale del reloj de la aplicacion, que es el mismo que fecha los planes.
     *
     * <p>No es un detalle: las fechas de GLPI llegan sin zona y hay que interpretarlas en alguna. Usar
     * el mismo reloj que el resto del sistema evita que la fecha de un ticket y la fecha de la
     * extraccion se lean en husos distintos.
     *
     * <p>El contrato entra por constructor y no se lee de la constante: es lo que permite que otra
     * variante de GLPI —otros codigos de estado, otra escala de prioridad, otro formato de fecha— se
     * adapte cambiando el bean, sin tocar esta clase ni el dominio.
     */
    public GlpiTicketMapper(Clock clock, GlpiContract contract) {
        this.zone = clock.getZone();
        this.contract = contract;
        this.dateTime = DateTimeFormatter.ofPattern(contract.datePattern());
    }

    /** Si el ticket es una incidencia para el dominio. */
    boolean isIncident(GlpiTicket ticket) {
        return contract.isIncident(ticket.type());
    }

    /** Si el ticket es una peticion planificable para el dominio. */
    boolean isRequirement(GlpiTicket ticket) {
        return contract.isRequirement(ticket.type());
    }

    /**
     * El estado del dominio para una incidencia, vacio si el codigo de GLPI no es conocido.
     *
     * <p>{@code 1} nuevo, {@code 2} asignado, {@code 3} planificado y {@code 4} pendiente son todos
     * {@code EN_ATENCION}: en GLPI son matices del mismo tramo —el ticket esta vivo y en manos de
     * alguien— y el motor no los distingue para calcular. Aplanarlos aqui evita que el dominio tenga
     * que aprender cuatro estados que solo se diferencian en como se gestionan, no en cuanto ocupan.
     */
    Optional<IncidentStatus> incidentStatus(Integer status) {
        return contract.incidentStatus(status);
    }

    /**
     * El estado del dominio para un requerimiento, vacio si el codigo de GLPI no es conocido.
     *
     * <p>Aqui {@code 1} es {@code PLANIFICADO} y no {@code EN_EJECUCION}: una peticion recien creada
     * esta por hacer, y el motor solo planifica lo que esta {@code PLANIFICADO} o
     * {@code EN_EJECUCION}. Traducirla a un estado no planificable la sacaria del calculo por un
     * tecnicismo de traduccion, que es justo lo que una capa anticorrupcion no debe hacer.
     */
    Optional<RequirementStatus> requirementStatus(Integer status) {
        return contract.requirementStatus(status);
    }

    /**
     * La incidencia del dominio, vacia si el ticket no es una incidencia o le falta algo.
     *
     * <p><strong>Las horas entran como parametro, no se deducen del ticket.</strong> Desde la decision
     * 124.2 la duracion la declara el desarrollador y vive en {@code PlanningMetadata}; quien la trae
     * hasta aqui es la factoria. El mapeador sigue sabiendo traducir un ticket; lo que dejo de hacer
     * es decidir cuanto dura, que nunca fue una pregunta sobre GLPI.
     */
    public Optional<Incident> toIncident(GlpiTicket ticket, BigDecimal estimatedHours) {
        if (!isIncident(ticket)) {
            return Optional.empty();
        }
        Optional<IncidentStatus> status = incidentStatus(ticket.status());
        Optional<Instant> reportedAt = reportedAt(ticket);
        if (status.isEmpty() || reportedAt.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(new Incident(
                String.valueOf(ticket.id()),
                ticket.name(),
                estimatedHours,
                reportedAt.get(),
                status.get(),
                GlpiPriorityMapper.severityOf(ticket, contract)));
    }

    /**
     * El requerimiento del dominio, vacio si el ticket no es una peticion o le falta algo.
     *
     * <p>Las horas y la fecha compromiso entran como parametros por el mismo motivo que en
     * {@link #toIncident}: las dos las declara el negocio. {@code time_to_resolve} dejo de ser la
     * fecha comprometida del dominio, y {@code internal_time_to_resolve} nunca lo fue.
     */
    public Optional<Requirement> toRequirement(GlpiTicket ticket, BigDecimal estimatedHours,
            LocalDate committedDate) {
        if (!isRequirement(ticket)) {
            return Optional.empty();
        }
        Optional<RequirementStatus> status = requirementStatus(ticket.status());
        if (status.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(new Requirement(
                String.valueOf(ticket.id()),
                ticket.name(),
                estimatedHours,
                committedDate,
                status.get()));
    }

    /**
     * {@code actiontime}, en segundos, pasado a horas.
     *
     * <p><strong>Ya no alimenta la peticion.</strong> Se conserva por decision explicita —diagnostico
     * si, planificacion no— y sirve para una sola cosa: contrastar lo que GLPI registra con lo que el
     * negocio declaro, que es como se mide la calidad del dato durante la transicion. Nadie la llama
     * desde el camino de la planificacion, y no debe volver a llamarse: reconectarla seria devolverle
     * al motor un valor que la decision 124.2 le quito. Si se borra por parecer muerta, se pierde la
     * unica forma de ver la discrepancia sin abrir GLPI a mano.
     */
    static Optional<BigDecimal> estimatedHours(GlpiTicket ticket) {
        if (ticket.actiontime() == null || ticket.actiontime() <= 0) {
            return Optional.empty();
        }
        return Optional.of(BigDecimal.valueOf(ticket.actiontime())
                .divide(SECONDS_PER_HOUR, HOURS_SCALE, RoundingMode.HALF_UP));
    }

    /** {@code date}, la fecha de creacion del ticket. */
    Optional<Instant> reportedAt(GlpiTicket ticket) {
        return parseDateTime(ticket.date()).map(at -> at.atZone(zone).toInstant());
    }

    /**
     * {@code time_to_resolve}, la fecha de SLA, reducida a su dia.
     *
     * <p><strong>Ya no alimenta la peticion</strong>, por el mismo motivo y con la misma salvedad que
     * {@link #estimatedHours}: se conserva para poder contrastar, y reconectarla seria deshacer la
     * decision 124.2. Queda dicho tambien aqui, y no solo alli, porque este metodo se llamaba
     * {@code plannedDate} y el nombre invita a creer que sigue siendo la fecha comprometida del
     * dominio. Ya no lo es: la del dominio es la que declara el gestor de demanda.
     */
    Optional<LocalDate> plannedDate(GlpiTicket ticket) {
        return parseDateTime(ticket.timeToResolve()).map(LocalDateTime::toLocalDate);
    }

    /**
     * Lee una fecha de GLPI, que llega sin zona horaria.
     *
     * <p>La ausencia de zona es real y hay que resolverla de alguna manera. Se interpreta en la zona
     * del reloj de la aplicacion, que es la de la instancia de GLPI con la que se habla; es la unica
     * eleccion que no desplaza las fechas. Queda anotado como suposicion porque no se puede verificar
     * sin una instancia real: si GLPI estuviera en otra zona, las horas de un ticket cambiarian de
     * dia.
     */
    private Optional<LocalDateTime> parseDateTime(String raw) {
        if (raw == null || raw.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(LocalDateTime.parse(raw.trim(), dateTime));
        } catch (DateTimeParseException ex) {
            return Optional.empty();
        }
    }
}
