package co.com.coltefinanciera.gestiondemanda.service;

import java.time.Clock;
import java.time.Instant;
import java.util.List;

import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import co.com.coltefinanciera.gestiondemanda.config.PlanningProperties;
import co.com.coltefinanciera.gestiondemanda.domain.model.InputProvenance;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningFromGlpiResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningPlanResponse;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiDeveloperNotFoundException;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningRequestFactory;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningSource;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiRestPlanningSource;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiTicket;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiUser;

/**
 * Caso de uso: planificar a un desarrollador con el trabajo que tiene en GLPI.
 *
 * <p>Es el flujo completo de la integracion, y son cinco pasos en este orden: buscar al
 * desarrollador, traer sus tickets, traducirlos a la peticion del dominio, calcular y guardar. Cada
 * paso lo hace otro objeto; aqui solo se encadenan. Esa es la razon de que esta clase sea corta: si
 * tuviera logica propia, esa logica estaria en el sitio equivocado.
 *
 * <p><strong>Falla antes de traer tickets si el desarrollador no existe.</strong> Pedir los tickets
 * de alguien que no esta seria trabajo tirado, y ademas devolveria una lista vacia que se leeria
 * como "no tiene trabajo" cuando lo que pasa es que el identificador esta mal. El 404 dice la verdad.
 *
 * <p><strong>Las reglas son las configuradas, y no se pueden sobrescribir por peticion.</strong> El
 * cuerpo de la peticion solo trae el desarrollador. Dejar que quien llama cambie el umbral o el
 * horizonte en esta via haria que el plan guardado no correspondiera a la configuracion vigente, y
 * la trazabilidad —que dice con que reglas se decidio— quedaria registrando algo que nadie eligio.
 *
 * <p>No implementa sincronizacion: no hay trabajos programados, ni colas, ni reintentos. Se ejecuta
 * cuando alguien llama al endpoint, y solo entonces. Es el alcance de esta fase y conviene que se
 * lea asi.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GlpiPlanningService {

    private final GlpiPlanningSource glpiPlanningSource;
    private final GlpiPlanningRequestFactory requestFactory;
    private final PlanningService planningService;
    private final PlanningProperties planningProperties;
    private final Clock clock;

    /**
     * Planifica a un desarrollador con los datos que GLPI tenga de el ahora mismo.
     *
     * @param developerId identificador con el que se busca al usuario en GLPI
     */
    public PlanningFromGlpiResponse plan(String developerId) {
        GlpiUser user = glpiPlanningSource.findUser(developerId)
                .orElseThrow(() -> new GlpiDeveloperNotFoundException(
                        "GLPI no tiene un usuario con identificador " + developerId));

        List<GlpiTicket> tickets = glpiPlanningSource.ticketsOf(String.valueOf(user.id()));

        InputProvenance provenance = InputProvenance.glpi(
                Instant.now(clock), GlpiRestPlanningSource.VERSION);

        GlpiPlanningRequestFactory.Result built = requestFactory.build(
                developerId, user, tickets, planningProperties.toRules());

        PlanningPlanResponse plan = planningService.plan(built.request(), provenance);

        // Descartes, no tickets: un elemento sin planificacion declarada produce dos, uno por cada
        // persona que tiene que actuar. El detalle de a cuantos tickets corresponden lo deja el
        // registro de la traduccion.
        log.info("Plan {} calculado desde GLPI para {}: {} tickets, {} descartes",
                plan.planId(), developerId, tickets.size(), built.discarded().size());

        return new PlanningFromGlpiResponse(
                plan.planId(), plan.createdAt(), plan.plan(), discards(built));
    }

    private static List<PlanningFromGlpiResponse.DiscardedView> discards(
            GlpiPlanningRequestFactory.Result built) {

        return built.discarded().stream()
                .map(item -> new PlanningFromGlpiResponse.DiscardedView(
                        item.ticketId(), item.code(), item.reason()))
                .toList();
    }
}
