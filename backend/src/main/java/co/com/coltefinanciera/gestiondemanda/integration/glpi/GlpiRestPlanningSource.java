package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.IntFunction;
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
 * <p><strong>Los tickets asignados se piden a {@code /search/Ticket}, no a {@code /Ticket}.</strong> La
 * razon es que quien tiene asignado un ticket no es un campo del ticket: es una fila de
 * {@code Ticket_User}, y {@code /Ticket} no la proyecta. Filtrar en memoria obligaba a traerse la
 * instancia entera —hasta mil tickets, y con mas se perdian— para despues descartar casi todos. La
 * busqueda trae exactamente los del tecnico, los traiga de a uno o de a dos mil, y el filtro lo hace el
 * servidor. Queda documentado en la decision 159, con la medicion que la respalda.
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
     *
     * <p><strong>La version 3 es el corte de la decision 159, y es el caso de "cambio una ruta".</strong>
     * Los tickets dejaron de pedirse a {@code /Ticket?range=0-999} y se piden a {@code /search/Ticket};
     * el filtro por tecnico dejo de hacerse en memoria y lo hace el servidor. El contenido de un plan no
     * cambia —los mismos campos, el mismo significado—, pero un plan de la version 2 con cero elementos
     * puede ser "no tiene trabajo" o "la recuperacion estaba rota", y son dos cosas distintas que hay
     * que poder separar al releerlo.
     */
    public static final String VERSION = "glpi-rest-3";

    private static final String PATH_USER = "/User/";

    /**
     * La busqueda de tickets, que es la unica ruta del API que filtra por tecnico asignado.
     *
     * <p>No se usa {@code /Ticket} para esto porque el tecnico no es un campo del ticket: es una fila de
     * {@code Ticket_User}, y {@code /Ticket} no la proyecta. Cualquier filtro en memoria sobre esa
     * respuesta empieza por traerse la instancia entera, que es lo que la decision 159 retira.
     */
    private static final String PATH_SEARCH_TICKETS = "/search/Ticket";

    /**
     * La busqueda de usuarios, que es la unica ruta del API que filtra por grupo.
     *
     * <p>No se usa {@code /Group/{id}/User} para esto: no existe. {@code User} no es un tipo de
     * relacion valido para {@code Group} —la ruta responde cero filas y no un error, que es la peor
     * forma de decir que no—, y de las dos que si funcionan, {@code /Group/{id}/Group_User} devuelve
     * filas de relacion sin perfil y esta devuelve el usuario entero, que es lo que el catalogo
     * necesita.
     */
    private static final String PATH_SEARCH_USERS = "/search/User";

    /**
     * Opcion de busqueda 5 = «Technician».
     *
     * <p>El numero no se adivino: {@code /listSearchOptions/Ticket} publica que la opcion 5 se llama
     * «Technician», apunta a {@code glpi_users.name} y cuelga de {@code Ticket.Ticket_User.User.name},
     * que es exactamente la relacion que se quiere preguntar. Queda como constante con nombre porque un
     * {@code 5} suelto en la ruta no dice nada.
     */
    private static final int FIELD_TECHNICIAN = 5;

    /**
     * Cuantas filas se piden por pagina.
     *
     * <p>Mil es lo que la instancia real sirve de una vez sin que el cuerpo se vuelva un problema de
     * memoria, y es el mismo tamano que ya usaba la ruta anterior: no se gana nada pidiendo mas de
     * golpe, porque el recorrido de paginas es el mismo codigo para uno que para diez.
     */
    private static final int PAGE_SIZE = 1000;

    /**
     * Tope de paginas, como guarda contra un recorrido sin fin.
     *
     * <p>No es un limite de negocio: veinte paginas son veinte mil tickets para un solo desarrollador,
     * y la instancia entera tiene decenas de miles. Si alguna vez se alcanza, la lectura sale como
     * incompleta en lugar de devolver en silencio lo que alcanzo, que es justo el fallo que la decision
     * 159 corrige.
     */
    private static final int MAX_PAGES = 20;

    /** Opcion de busqueda 1: el titulo del ticket. */
    private static final int FIELD_TITLE = 1;

    /** Opcion de busqueda 2: el identificador del ticket. */
    private static final int FIELD_ID = 2;

    /** Opcion de busqueda 3: la prioridad. */
    private static final int FIELD_PRIORITY = 3;

    /** Opcion de busqueda 10: la urgencia. */
    private static final int FIELD_URGENCY = 10;

    /** Opcion de busqueda 11: el impacto. */
    private static final int FIELD_IMPACT = 11;

    /** Opcion de busqueda 12: el estado. */
    private static final int FIELD_STATUS = 12;

    /** Opcion de busqueda 14: el tipo, que separa incidencia de peticion. */
    private static final int FIELD_TYPE = 14;

    /** Opcion de busqueda 15: la fecha de apertura, que para una incidencia es su fecha de creacion. */
    private static final int FIELD_DATE = 15;

    /** Opcion de busqueda 18: la fecha de SLA. No alimenta la planificacion desde la decision 124.2. */
    private static final int FIELD_TIME_TO_RESOLVE = 18;

    /** Opcion de busqueda 45: el tiempo de accion, en segundos. Diagnostico, no planificacion. */
    private static final int FIELD_ACTION_TIME = 45;

    /**
     * Lo que se le pide a la busqueda, que es la proyeccion de un ticket que el adaptador sabe leer.
     *
     * <p>Sin {@code forcedisplay} GLPI devuelve las columnas que quiere, y la lista de arriba es la
     * misma que declara {@link GlpiContract#ticketFields()}: si una se amplia y la otra no, el DTO
     * llega con un valor nulo que parece un dato ausente de GLPI y es una columna que nadie pidio.
     *
     * <p><strong>Y es tambien lo que hace que la pagina quepa.</strong> Medido contra la instancia: mil
     * filas proyectadas a estos diez campos pesan entre 150 y 164 KB, y las mismas mil filas sin
     * proyeccion pesan 6,2 MB —mas de lo que el transporte de la aplicacion guarda en memoria, que son
     * 256 KB—, y a un tecnico le respondio directamente {@code HTTP 500}. No es una optimizacion: sin
     * {@code forcedisplay} la ruta nueva fallaria igual que fallaba la vieja, y por el mismo motivo.
     */
    private static final List<Integer> DISPLAYED_FIELDS = List.of(
            FIELD_TITLE, FIELD_ID, FIELD_PRIORITY, FIELD_URGENCY, FIELD_IMPACT,
            FIELD_STATUS, FIELD_TYPE, FIELD_DATE, FIELD_TIME_TO_RESOLVE, FIELD_ACTION_TIME);

    /** Opcion de busqueda 13 de usuario: sus grupos. Es el criterio del catalogo. */
    private static final int FIELD_GROUP = 13;

    /** Opciones de usuario que el catalogo lee: identificador, login, nombre, apellido y vigencia. */
    private static final int FIELD_USER_ID = 2;
    private static final int FIELD_USER_LOGIN = 1;
    private static final int FIELD_USER_FIRSTNAME = 9;
    private static final int FIELD_USER_REALNAME = 34;
    private static final int FIELD_USER_ACTIVE = 8;

    /**
     * Lo que se le pide a la busqueda de usuarios.
     *
     * <p>Los cinco numeros estan comprobados contra la instancia con
     * {@code GET /listSearchOptions/User}, que es lo que publica como se llama cada opcion: 1 es
     * «Login» sobre {@code glpi_users.name}, 2 «ID», 8 «Active», 9 «First name», 34 «Last name» y 13
     * «Groups» sobre {@code glpi_groups.completename}.
     *
     * <p>No es una optimizacion como en los tickets —una pagina de cuarenta usuarios tampoco pesa—,
     * sino lo que hace que las claves de la fila sean estas y no las que GLPI quiera: sin
     * {@code forcedisplay} el mapa llega con otras columnas y el nombre de la persona sale nulo sin que
     * nada falle, que es un catalogo con identificadores y sin nombres.
     */
    private static final List<Integer> DISPLAYED_USER_FIELDS = List.of(
            FIELD_USER_ID, FIELD_USER_LOGIN, FIELD_USER_FIRSTNAME, FIELD_USER_REALNAME,
            FIELD_USER_ACTIVE);

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

    /**
     * Los tickets que GLPI tiene asignados al tecnico, leidos por paginas.
     *
     * <p>El filtro lo hace el servidor, asi que lo que se devuelve es lo que GLPI dijo y nada mas: no
     * hay una segunda pasada que pueda quedarse corta ni un techo de mil tickets que nadie vea.
     */
    @Override
    public List<GlpiTicket> ticketsOf(String glpiUserId) {
        Integer technician = numericId(glpiUserId);
        if (technician == null) {
            // La busqueda solo sabe comparar por identificador numerico. Con un login, GLPI no falla:
            // castea el valor a cero y devuelve los tickets del usuario cero, que son tickets de nadie.
            // Una lista vacia con su aviso es una respuesta honesta; la otra seria un dato inventado.
            log.warn("El identificador de usuario de GLPI '{}' no es numerico: la busqueda por tecnico "
                    + "no puede usarlo y no se devuelve ningun ticket", glpiUserId);
            return List.of();
        }

        Duration timeout = properties.timeout();
        String sessionToken = glpiClient.initSession().block(timeout);
        try {
            return search(technician, sessionToken, timeout);

        } finally {
            closeQuietly(sessionToken);
        }
    }

    /**
     * Los usuarios del grupo, leidos por paginas.
     *
     * <p>El grupo se busca por pertenencia «bajo» el y no «igual a» el: quien esta en un subgrupo de
     * «Desarrollo N2» esta en «Desarrollo N2», y la instancia lo confirma —pertenencia directa,
     * veintiuna personas; con subgrupos, cuarenta y una—.
     *
     * <p>A diferencia de la busqueda de tickets, aqui una lectura corta no se puede detectar: el
     * {@code totalcount} que GLPI declara cuenta solo lo que la cuenta de integracion puede ver, asi que
     * un usuario invisible no falta en el recuento, simplemente no existe para esta lectura. La
     * comprobacion de {@link #paginate} sigue valiendo —no se devuelve media pagina— y lo que no puede
     * hacer es prometer que estan todos.
     */
    @Override
    public List<GlpiUser> membersOfGroup(String groupId) {
        String group = groupId == null ? "" : groupId.trim();
        if (group.isEmpty()) {
            log.warn("No hay grupo configurado para el catalogo del equipo: no se enumera a nadie");
            return List.of();
        }

        Duration timeout = properties.timeout();
        String sessionToken = glpiClient.initSession().block(timeout);
        try {
            return paginate("miembros del grupo " + group, sessionToken, timeout,
                    from -> userSearchPath(group, from),
                    GlpiRestPlanningSource::toUser);

        } finally {
            closeQuietly(sessionToken);
        }
    }

    /**
     * Recorre las paginas de la busqueda hasta juntar todos los tickets que GLPI declara.
     *
     * <p>{@code totalcount} es lo que hace verificable el recorrido: se sabe cuantos hay antes de
     * terminar de leerlos, asi que al final se puede afirmar que se trajeron todos en lugar de suponer
     * que la lista esta completa. Una lectura corta no se devuelve: se denuncia. Devolver menos tickets
     * de los que hay produce un plan que parece completo y no lo esta, y ese es el fallo que esta clase
     * acaba de dejar atras.
     */
    private List<GlpiTicket> search(int technician, String sessionToken, Duration timeout) {
        List<GlpiTicket> found = paginate("tickets asignados al usuario " + technician,
                sessionToken, timeout, from -> searchPath(technician, from),
                GlpiRestPlanningSource::toTicket);

        log.info("GLPI devolvio {} tickets asignados al usuario {}", found.size(), technician);
        return found;
    }

    /**
     * Recorre las paginas de una busqueda hasta juntar todas las filas que GLPI declara.
     *
     * <p>{@code totalcount} es lo que hace verificable el recorrido: se sabe cuantas hay antes de
     * terminar de leerlas, asi que al final se puede afirmar que se trajeron todas en lugar de suponer
     * que la lista esta completa. Una lectura corta no se devuelve: se denuncia. Devolver menos filas
     * de las que hay produce un plan que parece completo y no lo esta, y ese es el fallo que esta clase
     * acaba de dejar atras.
     *
     * <p><strong>Es la misma paginacion para las dos busquedas, y por eso esta escrita una vez.</strong>
     * El recorrido y la comprobacion de lectura corta son una regla de correccion, no un detalle de una
     * ruta: dos copias se separarian el dia que alguien arregle una —por ejemplo, al anadir el tope de
     * paginas— y la otra seguiria devolviendo catalogos a medias sin que nada lo delate.
     *
     * @param what   que se esta leyendo, para el mensaje del fallo: «tickets asignados al usuario 296»
     * @param pathAt la ruta de la pagina que empieza en la fila que se le pasa
     * @param mapper la traduccion de una fila al DTO de su busqueda
     */
    private <T> List<T> paginate(String what, String sessionToken, Duration timeout,
            IntFunction<String> pathAt, Function<Map<String, Object>, T> mapper) {

        List<T> found = new ArrayList<>();
        int total = 0;

        for (int page = 0; page < MAX_PAGES; page++) {
            String path = pathAt.apply(page * PAGE_SIZE);
            GlpiSearchPage result = reading(path,
                    () -> glpiClient.get(path, sessionToken, GlpiSearchPage.class).block(timeout));

            total = result.total();
            result.rows().stream().map(mapper).forEach(found::add);

            // Se para al haberlas traido todas, y tambien cuando una pagina llega vacia: sin filas no
            // hay forma de avanzar, y seguir pidiendo paginas que no existen solo alarga la espera.
            if (found.size() >= total || result.rows().isEmpty()) {
                break;
            }
        }

        if (found.size() < total) {
            throw new GlpiInvalidDataException("GLPI declaro " + total + " " + what
                    + " y solo se pudieron leer " + found.size()
                    + ": la busqueda quedo incompleta y no se devuelve a medias");
        }

        return found;
    }

    /**
     * La ruta de una pagina de la busqueda.
     *
     * <p>El criterio es obligatorio y va explicito: sin el, la busqueda no falla, devuelve la instancia
     * entera —mas de sesenta mil tickets en la instancia medida—, que es un fallo silencioso bastante
     * peor que un error.
     */
    private static String searchPath(int technician, int from) {
        StringBuilder path = new StringBuilder(PATH_SEARCH_TICKETS)
                .append("?range=").append(from).append('-').append(from + PAGE_SIZE - 1)
                .append("&criteria[0][field]=").append(FIELD_TECHNICIAN)
                .append("&criteria[0][searchtype]=equals")
                .append("&criteria[0][value]=").append(technician);

        for (int i = 0; i < DISPLAYED_FIELDS.size(); i++) {
            path.append("&forcedisplay[").append(i).append("]=").append(DISPLAYED_FIELDS.get(i));
        }
        return path.toString();
    }

    /**
     * Una fila de la busqueda pasada al DTO.
     *
     * <p>Es la traduccion que no cabe en {@link GlpiTicket}, porque los dos lados no hablan el mismo
     * idioma: la fila viene indexada por numero de opcion y el DTO por nombre de campo. Se hace aqui
     * porque aqui estan los numeros, y se hace en un solo sitio para que el dia que GLPI renombre una
     * columna haya una unica funcion que mirar.
     *
     * <p>Un valor ausente queda nulo, que es lo que el DTO promete: en GLPI un ticket sin prioridad es
     * un ticket valido, y quien decide si eso lo descalifica es el validador, no esta conversion.
     */
    private static String userSearchPath(String group, int from) {
        StringBuilder path = new StringBuilder(PATH_SEARCH_USERS)
                .append("?range=").append(from).append('-').append(from + PAGE_SIZE - 1)
                .append("&criteria[0][field]=").append(FIELD_GROUP)
                .append("&criteria[0][searchtype]=under")
                .append("&criteria[0][value]=").append(UriUtils.encodeQueryParam(group, StandardCharsets.UTF_8));

        for (int i = 0; i < DISPLAYED_USER_FIELDS.size(); i++) {
            path.append("&forcedisplay[").append(i).append("]=").append(DISPLAYED_USER_FIELDS.get(i));
        }
        return path.toString();
    }

    /**
     * Una fila de la busqueda de usuarios pasada al DTO.
     *
     * <p>Misma traduccion que la de los tickets y por el mismo motivo: la fila viene indexada por numero
     * de opcion y el DTO por nombre de campo. El nombre de la persona no se compone aqui —eso es
     * {@link GlpiUser#displayName()}, que ya lo hace para las otras dos lecturas—, asi que un usuario
     * leido por el grupo y el mismo usuario leido por su identificador se ven igual.
     *
     * <p>El login es lo que el catalogo usa como identificador de la persona, y puede faltar: un
     * usuario sin login es un usuario al que no se le puede pedir nada por su nombre. Se devuelve igual
     * —es una fila de GLPI y quien la lee decide—. Quien la descarta es quien la junta.
     */
    private static GlpiUser toUser(Map<String, Object> row) {
        return new GlpiUser(
                integer(row, FIELD_USER_ID),
                text(row, FIELD_USER_LOGIN),
                text(row, FIELD_USER_REALNAME),
                text(row, FIELD_USER_FIRSTNAME),
                active(row, FIELD_USER_ACTIVE));
    }

    /** La vigencia, que GLPI publica como 0 o 1 y no como booleano. */
    private static Boolean active(Map<String, Object> row, int field) {
        Integer value = integer(row, field);
        return value == null ? null : value != 0;
    }

    private static GlpiTicket toTicket(Map<String, Object> row) {
        return new GlpiTicket(
                integer(row, FIELD_ID),
                text(row, FIELD_TITLE),
                integer(row, FIELD_STATUS),
                integer(row, FIELD_TYPE),
                integer(row, FIELD_PRIORITY),
                integer(row, FIELD_IMPACT),
                integer(row, FIELD_URGENCY),
                number(row, FIELD_ACTION_TIME),
                text(row, FIELD_TIME_TO_RESOLVE),
                text(row, FIELD_DATE));
    }

    private static Integer integer(Map<String, Object> row, int field) {
        return row.get(String.valueOf(field)) instanceof Number number ? number.intValue() : null;
    }

    private static Long number(Map<String, Object> row, int field) {
        return row.get(String.valueOf(field)) instanceof Number number ? number.longValue() : null;
    }

    private static String text(Map<String, Object> row, int field) {
        return row.get(String.valueOf(field)) instanceof String text ? text : null;
    }

    /** El identificador numerico, o {@code null} si lo que llego no lo es. */
    private static Integer numericId(String raw) {
        if (raw == null) {
            return null;
        }
        try {
            return Integer.valueOf(raw.trim());
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
