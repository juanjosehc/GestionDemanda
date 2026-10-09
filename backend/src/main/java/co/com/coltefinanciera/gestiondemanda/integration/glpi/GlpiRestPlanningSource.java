package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;

import org.springframework.core.codec.DecodingException;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriUtils;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import co.com.coltefinanciera.gestiondemanda.client.GlpiClient;
import co.com.coltefinanciera.gestiondemanda.config.GlpiProperties;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiConnectionException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiInvalidDataException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiItemNotFoundException;

/**
 * Adaptador HTTP de {@link GlpiPlanningSource}: trae los datos crudos desde el API REST de GLPI.
 *
 * <p>Es el unico sitio del sistema que sabe que GLPI se consulta por HTTP, con que rutas y con que
 * ciclo de sesion. Todo lo demas —el caso de uso, el mapeo, el motor— ve la interfaz. Ese es el
 * reparto: aqui el transporte, en {@link GlpiTicketMapper} el significado, en
 * {@link GlpiPlanningRequestFactory} la peticion del dominio.
 *
 * <p><strong>Es el segundo punto de bloqueo de la aplicacion.</strong> El primero es
 * {@code GlpiConnectivityService}, y la razon de que haya dos es la misma en los dos casos: el stack
 * servlet de Spring MVC no tiene donde devolver un {@code Mono}, asi que alguien tiene que esperar.
 * Se espera aqui, en el borde, con el mismo tiempo limite que usa el diagnostico de conectividad, y
 * no se propaga Reactor hacia arriba.
 *
 * <p><strong>Los fallos se traducen en el cliente y aqui solo se clasifican.</strong> Un usuario
 * inexistente llega como {@link GlpiItemNotFoundException} y se convierte en un {@code Optional}
 * vacio, porque "no esta" es una respuesta y no un error. Un cuerpo que no tiene la forma esperada
 * llega como error de decodificacion y se convierte en {@link GlpiInvalidDataException}, que es la
 * unica forma de que un cambio de contrato en GLPI se lea como lo que es en lugar de como un fallo
 * interno de esta aplicacion.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GlpiRestPlanningSource implements GlpiPlanningSource {

    /**
     * Version del adaptador, la que se guarda junto a la entrada extraida.
     *
     * <p>Se sube cuando cambia una traduccion: una ruta, un mapeo de estados, una unidad. Es lo que
     * permite releer un plan viejo sabiendo con que interpretacion se construyo.
     *
     * <p><strong>La version 2 es el corte de la decision 124.2.</strong> La traduccion cambio aunque
     * el API de GLPI no haya cambiado: las horas y la fecha compromiso dejaron de salir del ticket y
     * pasaron a salir de la planificacion declarada. Un plan construido con la version 1 tiene sus
     * horas en {@code actiontime} y su fecha en {@code time_to_resolve}; uno construido con la 2 las
     * tiene en {@code PlanningMetadata}, y los dos se leen igual si no se distinguen. La version es
     * justo lo que permite distinguirlos.
     */
    public static final String VERSION = "glpi-rest-2";

    private static final String PATH_USER = "/User/";

    /**
     * Rango amplio para traer los tickets de una vez.
     *
     * <p>{@code ponytail:} se piden hasta mil tickets y se filtra por asignado en memoria, en lugar de
     * dejar que GLPI filtre con {@code searchText[users_id_assign]}. La razon es que ese parametro no
     * se puede verificar sin una instancia real, y una consulta que no se ha probado no debe ser la
     * base de una integracion. El techo es real: una instancia con mas de mil tickets visibles para
     * la sesion devolveria una lista incompleta. Se cambia a la busqueda del servidor en cuanto se
     * valide contra un GLPI de verdad.
     */
    private static final String PATH_TICKETS = "/Ticket?range=0-999";

    private final GlpiClient glpiClient;
    private final GlpiProperties properties;

    @Override
    public Optional<GlpiUser> findUser(String userId) {
        String path = PATH_USER + UriUtils.encodePathSegment(userId, StandardCharsets.UTF_8);
        Duration timeout = properties.timeout();

        String sessionToken = glpiClient.initSession().block(timeout);
        try {
            GlpiUser user = reading(path, () -> glpiClient.get(path, sessionToken, GlpiUser.class)
                    .block(timeout));
            return Optional.ofNullable(user);

        } catch (GlpiItemNotFoundException ex) {
            log.info("GLPI no tiene el usuario {}: {}", userId, ex.getMessage());
            return Optional.empty();

        } finally {
            closeQuietly(sessionToken);
        }
    }

    @Override
    public List<GlpiTicket> ticketsOf(String glpiUserId) {
        Duration timeout = properties.timeout();

        String sessionToken = glpiClient.initSession().block(timeout);
        try {
            List<GlpiTicket> all = reading(PATH_TICKETS,
                    () -> glpiClient.getList(PATH_TICKETS, sessionToken, GlpiTicket.class)
                            .block(timeout));
            return assignedTo(all, glpiUserId);

        } finally {
            closeQuietly(sessionToken);
        }
    }

    /**
     * Filtra por asignado en memoria.
     *
     * <p>Se registra cuantos llegaron y cuantos quedaron porque un filtro que no encaja nunca
     * devuelve una lista vacia, y una lista vacia es indistinguible de "este desarrollador no tiene
     * trabajo". El registro es lo que permite ver la diferencia desde fuera.
     */
    private static List<GlpiTicket> assignedTo(List<GlpiTicket> tickets, String glpiUserId) {
        Integer id = parseId(glpiUserId);
        if (id == null) {
            log.warn("El identificador de usuario de GLPI '{}' no es numerico: no se puede filtrar "
                    + "por asignado y no se devuelve ningun ticket", glpiUserId);
            return List.of();
        }
        List<GlpiTicket> assigned = tickets.stream()
                .filter(ticket -> id.equals(ticket.assignedUserId()))
                .toList();
        log.info("GLPI devolvio {} tickets; {} estan asignados al usuario {}", tickets.size(),
                assigned.size(), glpiUserId);
        return assigned;
    }

    private static Integer parseId(String raw) {
        try {
            return Integer.valueOf(raw);
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    /**
     * Ejecuta una lectura y convierte el fallo de decodificacion en un fallo de datos.
     *
     * <p>Un cuerpo que no se puede leer no es un fallo de red: GLPI contesto, y contesto algo que el
     * adaptador no entiende. Distinguirlo importa porque el primero se arregla en la red y el segundo
     * revisando el contrato, y porque un error de decodificacion sin envolver saldria como error
     * interno, que es la unica clasificacion que no ayuda a nadie.
     */
    private static <T> T reading(String path, Supplier<T> call) {
        try {
            return call.get();
        } catch (DecodingException ex) {
            throw new GlpiInvalidDataException(
                    "GLPI respondio a " + path + " con un cuerpo que no se puede leer: "
                            + ex.getMessage(), ex);
        }
    }

    /** Cierra la sesion sin que un fallo de cierre invalide la lectura ya hecha. */
    private void closeQuietly(String sessionToken) {
        try {
            glpiClient.killSession(sessionToken).block(properties.timeout());
        } catch (GlpiConnectionException ex) {
            log.warn("No fue posible cerrar la sesion GLPI: {}", ex.getMessage());
        }
    }
}
