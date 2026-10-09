package co.com.coltefinanciera.gestiondemanda.client;

import java.util.List;
import java.util.function.Function;

import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Mono;

import co.com.coltefinanciera.gestiondemanda.config.GlpiProperties;
import co.com.coltefinanciera.gestiondemanda.dto.GlpiSessionResponse;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiAuthenticationException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiConnectionException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiItemNotFoundException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiUnreachableException;

/**
 * Cliente dedicado al API REST de GLPI.
 *
 * <p>Encapsula el ciclo de vida de la sesion y traduce todo fallo a excepciones propias
 * ({@link GlpiConnectionException} / {@link GlpiUnreachableException}), de modo que ninguna
 * otra capa dependa de Reactor ni de Spring WebClient. Esa es la frontera que evita acoplar
 * la logica de negocio a GLPI.
 *
 * <p>Expone tipos reactivos ({@code Mono}) de forma natural, pero el bloqueo se concentra en
 * un unico punto: {@code GlpiConnectivityService}. El resto de la aplicacion es Spring MVC.
 *
 * <p>Nunca se registran tokens ni en logs de nivel DEBUG.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GlpiClient {

    private static final String PATH_INIT_SESSION = "/initSession";
    private static final String PATH_KILL_SESSION = "/killSession";
    private static final String PATH_FULL_SESSION = "/getFullSession";
    private static final String HEADER_SESSION_TOKEN = "Session-Token";
    private static final int MAX_BODY_IN_MESSAGE = 300;

    /** La marca con que GLPI dice "ese elemento no existe" dentro de un {@code HTTP 400}. */
    private static final String ERROR_ITEM_NOT_FOUND = "ERROR_ITEM_NOT_FOUND";

    private final WebClient glpiWebClient;
    private final GlpiProperties properties;

    /**
     * Abre sesion en GLPI.
     *
     * @return {@code Mono} con el session_token emitido por GLPI.
     */
    public Mono<String> initSession() {
        requireConfigured();
        log.debug("GLPI initSession contra {}", properties.normalizedBaseUrl() + PATH_INIT_SESSION);

        Mono<String> request = glpiWebClient.get()
                .uri(PATH_INIT_SESSION)
                .header(HttpHeaders.AUTHORIZATION, "user_token " + properties.userToken())
                .retrieve()
                .bodyToMono(GlpiSessionResponse.class)
                .map(GlpiSessionResponse::sessionToken)
                .filter(StringUtils::hasText)
                .switchIfEmpty(Mono.error(new GlpiConnectionException(
                        "GLPI no retorno un session_token en initSession")));

        return translateErrors(request, "initSession");
    }

    /**
     * Invoca {@code getFullSession}: endpoint de prueba que confirma que el session_token
     * es valido. Se devuelve el cuerpo crudo porque su contenido no se consume todavia.
     */
    public Mono<String> getFullSession(String sessionToken) {
        Mono<String> request = glpiWebClient.get()
                .uri(PATH_FULL_SESSION)
                .header(HEADER_SESSION_TOKEN, sessionToken)
                .retrieve()
                .bodyToMono(String.class);

        return translateErrors(request, "getFullSession");
    }

    /**
     * Lee un recurso de GLPI y lo deserializa al tipo pedido.
     *
     * <p>El tipo lo elige quien llama, y por eso este cliente no conoce ningun DTO de negocio: solo
     * el ciclo de sesion y el transporte. Los tipos de {@code integration.glpi} entran por el
     * parametro, de modo que la dependencia va en un solo sentido —la integracion conoce al cliente,
     * el cliente no conoce a la integracion— y el dia que haya un segundo consumidor no hay que
     * tocar nada aqui.
     *
     * <p>{@code path} incluye la barra inicial y los parametros ya codificados, porque saber que
     * existe {@code /Ticket} es saber el contrato de GLPI, y eso es de quien adapta, no del
     * transporte.
     */
    public <T> Mono<T> get(String path, String sessionToken, Class<T> responseType) {
        Mono<T> request = glpiWebClient.get()
                .uri(path)
                .header(HEADER_SESSION_TOKEN, sessionToken)
                .retrieve()
                .bodyToMono(responseType);

        return translateErrors(request, path);
    }

    /**
     * Lee una coleccion de GLPI, que siempre llega como un arreglo JSON en la raiz.
     *
     * <p>Se lee como flujo y se recolecta en lugar de deserializar a una lista, porque asi el tipo
     * del elemento se declara una sola vez y no hace falta una referencia parametrizada. GLPI no
     * envia el arreglo envuelto en un objeto, y ese detalle del contrato se resuelve aqui.
     */
    public <T> Mono<List<T>> getList(String path, String sessionToken, Class<T> elementType) {
        Mono<List<T>> request = glpiWebClient.get()
                .uri(path)
                .header(HEADER_SESSION_TOKEN, sessionToken)
                .retrieve()
                .bodyToFlux(elementType)
                .collectList();

        return translateErrors(request, path);
    }

    /** Cierra la sesion para no dejar sesiones colgadas en GLPI. */
    public Mono<Void> killSession(String sessionToken) {
        Mono<Void> request = glpiWebClient.get()
                .uri(PATH_KILL_SESSION)
                .header(HEADER_SESSION_TOKEN, sessionToken)
                .retrieve()
                .toBodilessEntity()
                .then();

        return translateErrors(request, "killSession");
    }

    /** Falla temprano y con un mensaje util si faltan credenciales. */
    private void requireConfigured() {
        if (!properties.isConfigured()) {
            throw new GlpiConnectionException(
                    "GLPI no esta configurado: defina GLPI_URL, GLPI_APP_TOKEN y GLPI_USER_TOKEN");
        }
    }

    /**
     * Traduce los fallos de WebClient a la jerarquia de excepciones propia.
     *
     * <p>Todo lo que no llega a haber respuesta —GLPI caido, DNS, TLS, y tambien el vencimiento del
     * tiempo de espera, que Spring envuelve en la misma excepcion— cae en
     * {@link GlpiUnreachableException}, cuyo mensaje conserva la causa original y por tanto distingue
     * un timeout de un rechazo de conexion. Los codigos de respuesta se separan en cambio por su
     * significado, porque son los que el operador necesita distinguir de un vistazo.
     */
    private <T> Mono<T> translateErrors(Mono<T> request, String operation) {
        Function<WebClientRequestException, Throwable> unreachable = ex -> new GlpiUnreachableException(
                "No fue posible alcanzar GLPI en " + properties.normalizedBaseUrl()
                        + " durante " + operation + ": " + ex.getMessage(),
                ex);

        Function<WebClientResponseException, Throwable> rejected =
                ex -> rejection(ex, operation);

        return request
                .onErrorMap(WebClientRequestException.class, unreachable)
                .onErrorMap(WebClientResponseException.class, rejected);
    }

    /**
     * Clasifica una respuesta de error de GLPI.
     *
     * <p>El caso incomodo es el elemento inexistente: GLPI lo responde con {@code HTTP 400} y un
     * cuerpo {@code ["ERROR_ITEM_NOT_FOUND", ...]}, no con un 404, asi que el codigo de estado no
     * alcanza para reconocerlo y hay que mirar el cuerpo. Se mira sobre el cuerpo completo y no sobre
     * el truncado, para que el reconocimiento no dependa del limite de longitud de los mensajes.
     */
    private GlpiConnectionException rejection(WebClientResponseException ex, String operation) {
        String raw = ex.getResponseBodyAsString();
        String detail = "GLPI respondio HTTP " + ex.getStatusCode().value() + " en " + operation
                + ": " + truncate(raw);
        int status = ex.getStatusCode().value();

        if (status == 401 || status == 403) {
            return new GlpiAuthenticationException(
                    detail + " (revise GLPI_USER_TOKEN y GLPI_APP_TOKEN)", ex);
        }
        if (raw != null && raw.contains(ERROR_ITEM_NOT_FOUND)) {
            return new GlpiItemNotFoundException(detail);
        }
        return new GlpiConnectionException(detail, ex);
    }

    private static String truncate(String body) {
        if (!StringUtils.hasText(body)) {
            return "(cuerpo vacio)";
        }
        String clean = body.replaceAll("\\s+", " ").trim();
        return clean.length() <= MAX_BODY_IN_MESSAGE ? clean : clean.substring(0, MAX_BODY_IN_MESSAGE) + "...";
    }
}
