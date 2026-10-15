package co.com.coltefinanciera.gestiondemanda.service;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;

import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import co.com.coltefinanciera.gestiondemanda.domain.model.PlanningMetadata;
import co.com.coltefinanciera.gestiondemanda.dto.DeveloperDeclarationsResponse;
import co.com.coltefinanciera.gestiondemanda.dto.DeveloperDeclarationsResponse.DeclarationItem;
import co.com.coltefinanciera.gestiondemanda.dto.DeveloperDeclarationsResponse.DeveloperView;
import co.com.coltefinanciera.gestiondemanda.dto.DeveloperDeclarationsResponse.DiscardView;
import co.com.coltefinanciera.gestiondemanda.dto.DeveloperDeclarationsResponse.Source;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningMetadataResponse;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiDeveloperNotFoundException;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiDiscardedItem;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningRequestFactory;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningSource;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicket;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiUser;

/**
 * Caso de uso: los tickets de un tecnico, con lo que les falta para poder planificarse.
 *
 * <p><strong>Esta lectura no planifica.</strong> No ejecuta el motor, no guarda un plan y no escribe
 * nada. Trae los tickets de GLPI y los pone al lado de la planificacion declarada —las dos cosas que
 * ya existian— y dice, ticket a ticket, en cual de los cinco estados de declaracion esta. Es la
 * entrada de la pantalla de declaracion, y es de solo lectura justo para que abrir esa pantalla no
 * tenga efectos.
 *
 * <p><strong>No clasifica: pregunta.</strong> Quien decide es {@link GlpiPlanningRequestFactory}, por
 * el mismo camino con el que arma la peticion del plan, y esta clase solo recorre lo que le devuelve.
 * Escribir aqui una segunda version de las reglas —aunque fuera identica el dia que se escribio—
 * dejaria dos sitios que cambiar cuando el validador cambie, y una pantalla que ofrece declarar cosas
 * que el plan despues descarta.
 *
 * <p><strong>Sin N+1.</strong> Las declaraciones de todos los tickets se leen de una sola vez, porque
 * el identificador del ticket esta en GLPI y la declaracion aqui: preguntarla dentro del bucle
 * convertiria una consulta en una por ticket, y una agenda real tiene cientos. Lo hace la factoria,
 * que es donde vive esa lectura; esta clase no consulta la base por ningun otro camino.
 *
 * <p><strong>Devuelve {@code 404} si el tecnico no esta en GLPI</strong>, y no una lista vacia. Pedir
 * los tickets de un identificador equivocado no da «no tiene trabajo»: da que el identificador esta
 * mal, y las dos cosas se parecen demasiado como para dejarlas indistinguibles.
 *
 * <p><strong>Solo salen los tickets que siguen siendo carga.</strong> Lo que esta resuelto o cerrado
 * no se declara —no queda trabajo que repartir— asi que no aparece: esta pantalla es la lista de lo
 * que hay por declarar, y el historico de una persona no es su jornada. El corte lo hace la busqueda
 * —{@code activeTicketsOf}— y no un descarte aqui, que seria traerse lo cerrado para tirarlo.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PlanningDeclarationService {

    private final GlpiPlanningSource glpiPlanningSource;
    private final GlpiPlanningRequestFactory requestFactory;
    private final Clock clock;

    /**
     * Los tickets activos del tecnico, clasificados.
     *
     * @param developerId identificador con el que se busca al usuario en GLPI
     */
    public DeveloperDeclarationsResponse declarationsFor(String developerId) {
        GlpiUser user = glpiPlanningSource.findUser(developerId)
                .orElseThrow(() -> new GlpiDeveloperNotFoundException(
                        "GLPI no tiene un usuario con identificador " + developerId));

        // Activos y no todos: lo resuelto y lo cerrado no se declara, y contarlo convertia el historico
        // de una persona en su carga. El corte se le pide a la busqueda, no se hace aqui despues.
        List<GlpiTicket> tickets = glpiPlanningSource.activeTicketsOf(String.valueOf(user.id()));

        // El vencimiento se mide con el reloj del servidor, el mismo que fecha los planes, para que no
        // dependa de cuando se ejecute la prueba ni de la hora del navegador.
        LocalDate today = LocalDate.now(clock);

        List<DeclarationItem> items = requestFactory.verdicts(tickets).stream()
                .map(verdict -> item(verdict, today))
                .toList();

        // Se cuentan tickets, no descartes: aqui cada ticket sale una vez, con los codigos que tenga.
        // El numero util para operar es cuantos quedan por declarar, y ese se lee en los estados.
        log.info("Declaraciones de {}: {} tickets activos, {} planificables, {} sin declaracion",
                developerId, items.size(),
                items.stream().filter(item -> item.declaration() != null).count(),
                items.stream().filter(item -> item.discards().size() > 1).count());

        return new DeveloperDeclarationsResponse(
                new DeveloperView(developerId, user.displayName()), items,
                new Source(Source.GLPI, Source.DECLARATION));
    }

    /**
     * Un ticket con lo que se decidio de el, ya con la forma de la respuesta.
     *
     * <p>La declaracion se devuelve con el mismo contrato que {@code GET /{workItemId}} y no con uno
     * propio: quien vaya a modificarla desde la pantalla ya tiene delante lo que hay, sin una segunda
     * lectura ni una segunda traduccion del mismo recurso que pudieran discrepar.
     */
    private static DeclarationItem item(GlpiPlanningRequestFactory.Verdict verdict, LocalDate today) {
        GlpiTicket ticket = verdict.ticket();
        return new DeclarationItem(
                GlpiDiscardedItem.ticketIdOf(ticket),
                verdict.reading().type(),
                verdict.reading().status(),
                ticket.priority(),
                verdict.reading().createdAt(),
                ticket.name(),
                verdict.status(),
                verdict.discards().stream()
                        .map(discard -> new DiscardView(discard.code(), discard.reason()))
                        .toList(),
                declarationOf(verdict.declaration(), today));
    }

    /** La declaracion tal como se sirve en su propio endpoint, o {@code null} si no hay fila. */
    private static PlanningMetadataResponse declarationOf(PlanningMetadata metadata, LocalDate today) {
        return metadata == null ? null : PlanningMetadataResponse.of(metadata, today);
    }
}
