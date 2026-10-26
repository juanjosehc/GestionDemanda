package co.com.coltefinanciera.gestiondemanda.service;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.model.Renegotiation;
import co.com.coltefinanciera.gestiondemanda.domain.repository.RenegotiationRepository;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningSimulationResponse.RescheduleEventView;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicket;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicketMapper;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Concilia con GLPI los acuerdos que el gestor ya renegocio alla.
 *
 * <p><strong>El problema que resuelve es el doble trabajo.</strong> Cuando un requerimiento se
 * desplaza, el gestor habla con quien lo pidio y cambia la fecha. Esa fecha se escribe en GLPI como
 * GLPI —desde la Fase 66b, {@code internal_time_to_resolve} y, si no lo hay, {@code time_to_resolve}—
 * y hoy habria que volver a teclearla aqui. Desde la Fase 64, si GLPI publica una fecha nueva que es
 * una renegociacion de verdad, el acuerdo se registra solo.
 *
 * <p><strong>El TTO no participa.</strong> {@code time_to_own} es el tiempo de atencion inicial y no
 * es una fecha que se negocie con el usuario; la fecha de resolucion si.
 *
 * <p><strong>Se lee la misma fecha que planifica.</strong> Si aqui se comparara el TTR mientras el
 * motor ubica el requerimiento por su Internal TTR, el acuerdo se cerraria contra una fecha y el
 * desplazamiento contra otra, y el pendiente no se resolveria nunca.
 *
 * <p><strong>No toda fecha de GLPI es un acuerdo.</strong> GLPI publica un vencimiento por defecto en
 * casi todos los tickets —el del SLA o el de la OLA—, y tratarlo como renegociacion convertiria cada
 * ticket en un acuerdo inventado. La conciliacion exige las cinco condiciones del brief, en este orden:
 *
 * <ol>
 *   <li><strong>Existe un desplazamiento activo</strong>: hay un {@link RescheduleEventView} en el
 *       plan que se acaba de calcular. Sin desplazamiento no hay nada que renegociar.</li>
 *   <li><strong>Existe una renegociacion pendiente</strong>: el acuerdo vigente, si lo hay, no cubre
 *       ese desplazamiento. Se reutiliza {@link RenegotiationService#cubre} para que la definicion de
 *       «pendiente» sea una sola en todo el sistema.</li>
 *   <li><strong>GLPI publica una fecha operativa</strong> para el ticket.</li>
 *   <li><strong>Esa fecha es posterior a la fecha original del desplazamiento.</strong> Es lo que
 *       distingue una renegociacion de un vencimiento historico: si la fecha ya estaba antes de que el
 *       requerimiento se moviera, no es una fecha nueva que alguien acordara, es el vencimiento que
 *       siempre tuvo.</li>
 *   <li><strong>No existe un acuerdo manual.</strong> Un acuerdo registrado por una persona manda
 *       siempre, aunque un desplazamiento posterior lo haya dejado pendiente: sobrescribirlo desde
 *       GLPI borraria una decision humana. La regla del brief habla de acuerdos manuales
 *       «posteriores»; en la practica cualquier acuerdo manual bloquea la conciliacion, que es la
 *       lectura conservadora y la unica que no destruye informacion.</li>
 * </ol>
 *
 * <p><strong>Es idempotente.</strong> Si el acuerdo ya es de GLPI y tiene la misma fecha, no se
 * escribe nada. Si el mismo TTR se detecta en dos generaciones de plan, la segunda no crea filas ni
 * historial. Si dos peticiones concilian el mismo ticket a la vez, la clave primaria decide y la
 * segunda se descarta sin romper la respuesta.
 *
 * <p><strong>Se ejecuta al planificar desde GLPI, y solo entonces.</strong> Es el unico punto donde
 * coinciden en memoria el TTR del ticket y los desplazamientos que el motor acaba de calcular, asi
 * que no hace falta una llamada extra a GLPI ni una lectura con efectos secundarios. El precio esta
 * dicho en la documentacion: un cambio de fecha se detecta en la siguiente generacion del plan de ese
 * tecnico, no en el instante en que alguien lo escribe en GLPI.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SlaReconciliationService {

    /** Quien queda como autor de un acuerdo conciliado. Se lee tal cual en la trazabilidad. */
    public static final String ACTOR = "GLPI";

    /** El motivo con el que se registra un acuerdo automatico. */
    public static final String REASON =
            "Conciliado automaticamente desde la fecha operativa de GLPI";

    private final RenegotiationRepository repository;
    private final GlpiTicketMapper mapper;
    private final Clock clock;

    /**
     * Registra los acuerdos que GLPI ya tiene y la aplicacion todavia no.
     *
     * @param tickets los tickets activos del tecnico, tal como los devolvio GLPI. Los cerrados no
     *                llegan aqui: {@code activeTicketsOf} ya los excluye, y un ticket cerrado no es
     *                una renegociacion en curso.
     * @param events  los desplazamientos del plan que se acaba de calcular
     * @return los identificadores conciliados, en el orden en que se encontraron
     */
    public List<String> reconcile(List<GlpiTicket> tickets, List<RescheduleEventView> events) {
        if (tickets.isEmpty() || events.isEmpty()) {
            return List.of();
        }

        Map<String, LocalDate> fechas = operationalDates(tickets);
        if (fechas.isEmpty()) {
            return List.of();
        }

        // Un requerimiento puede traer varios eventos si lo movieron dos incidentes. El que manda
        // para la condicion 4 es el ultimo: su fecha original es la que el requerimiento tenia
        // cuando se movio por ultima vez, y la fecha nueva tiene que superarla para ser un acuerdo.
        Map<String, RescheduleEventView> latest = new HashMap<>();
        for (RescheduleEventView event : events) {
            latest.merge(event.requirementId(), event,
                    (actual, candidato) -> candidato.timestamp().isAfter(actual.timestamp())
                            ? candidato
                            : actual);
        }

        Map<String, Renegotiation> existing = repository
                .findByWorkItemIdIn(latest.keySet())
                .stream()
                .collect(Collectors.toMap(Renegotiation::workItemId, Function.identity()));

        List<String> reconciled = new ArrayList<>();

        for (Map.Entry<String, RescheduleEventView> entry : latest.entrySet()) {
            String workItemId = entry.getKey();
            LocalDate fecha = fechas.get(workItemId);

            if (fecha == null || !fecha.isAfter(entry.getValue().originalDate())) {
                continue;
            }

            Renegotiation agreement = existing.get(workItemId);

            // Condicion 5: un acuerdo manual manda. No se actualiza ni se reemplaza desde GLPI.
            if (agreement != null && agreement.source() != InputSource.GLPI) {
                continue;
            }

            // Condicion 2: si el acuerdo de GLPI ya cubre el desplazamiento, no hay nada pendiente.
            if (agreement != null
                    && RenegotiationService.cubre(agreement, List.of(entry.getValue()))) {
                continue;
            }

            // Idempotencia: la misma fecha ya registrada no vuelve a escribirse.
            if (agreement != null && agreement.agreedDate().equals(fecha)) {
                continue;
            }

            Instant now = clock.instant();

            if (agreement == null) {
                Renegotiation created = new Renegotiation(
                        workItemId, fecha, ACTOR, REASON, now, InputSource.GLPI);
                try {
                    repository.create(created, created.changesFrom(null, ACTOR, now));
                    reconciled.add(workItemId);
                } catch (DataIntegrityViolationException raced) {
                    // Otra peticion concilio el mismo ticket entre la lectura y la escritura. La
                    // clave primaria ya hizo su trabajo: no hay nada que corregir.
                    log.info("El acuerdo de {} ya existia al conciliar; se conserva el primero",
                            workItemId);
                }
            } else {
                // Una fecha nueva despues de un desplazamiento nuevo: el acuerdo automatico se
                // actualiza y el historial guarda el cambio. El origen sigue siendo GLPI.
                Renegotiation updated = agreement.agreedWith(fecha, REASON, ACTOR, now);
                repository.update(updated, updated.changesFrom(agreement, ACTOR, now));
                reconciled.add(workItemId);
            }
        }

        if (!reconciled.isEmpty()) {
            log.info("Conciliados desde GLPI {} acuerdos: {}", reconciled.size(), reconciled);
        }
        return reconciled;
    }

    /**
     * La fecha operativa de cada ticket, reducida a su dia.
     *
     * <p><strong>Es la misma que ubica el requerimiento en el plan</strong> —Internal TTR y, si no hay,
     * el TTR—. La conciliacion compara la fecha original del desplazamiento con la fecha que GLPI
     * publica hoy, y desde la Fase 66b esa fecha es la operativa: leer aqui el TTR mientras el motor
     * planifica con el Internal TTR haria que un requerimiento se moviera a una fecha con la que
     * despues nunca se concilia, y el acuerdo pendiente no se cerraria nunca.
     *
     * <p>Un ticket sin ninguna de las dos fechas no entra al mapa.
     */
    private Map<String, LocalDate> operationalDates(List<GlpiTicket> tickets) {
        Map<String, LocalDate> fechas = new HashMap<>();

        for (GlpiTicket ticket : tickets) {
            if (ticket.id() == null) {
                continue;
            }
            mapper.operationalDate(ticket)
                    .ifPresent(fecha -> fechas.put(String.valueOf(ticket.id()), fecha.date()));
        }
        return fechas;
    }
}
