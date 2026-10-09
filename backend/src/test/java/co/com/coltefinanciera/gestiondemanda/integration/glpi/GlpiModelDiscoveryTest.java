package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.reactive.function.client.WebClient;

import co.com.coltefinanciera.gestiondemanda.client.GlpiClient;
import co.com.coltefinanciera.gestiondemanda.config.GlpiProperties;

/**
 * Descubre el modelo real de GLPI: donde vive el asignado, que representa cada fecha y de donde
 * podria salir un esfuerzo.
 *
 * <p>No afirma nada. Trae respuestas crudas de la instancia y las deja en disco; la lectura se hace
 * fuera, sobre los archivos. Es el mismo reparto que {@link GlpiContractValidationTest}: el
 * instrumento trae, el analisis interpreta. Convertir la conclusion en una asercion aqui seria
 * escribir la respuesta que se quiere leer.
 *
 * <p><strong>Por que una prueba y no un curl.</strong> Las credenciales entran al proceso por
 * {@code spring.config.import} de {@code .env}; el cliente ya tiene el almacen de confianza del
 * certificado. Sacar la sesion a un script obligaria a leer el archivo de credenciales, que es
 * justo lo que no se quiere. Ademas el JVM es el unico cliente que completa la cadena TLS de esta
 * instancia: ni Python ni OpenSSL piden el intermedio por AIA.
 *
 * <p><strong>Por que la ventana reciente.</strong> {@code range=0-999} devuelve los mil tickets mas
 * antiguos y todos estan cerrados, asi que no pueden responder si el asignado o el esfuerzo existen
 * en un ticket vivo. Se pide el extremo opuesto del rango.
 *
 * <p><strong>No corre con la suite.</strong> Desactivada salvo {@code GLPI_MODELO=true}, porque
 * necesita credenciales reales y una instancia alcanzable.
 */
@SpringBootTest
@ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named = "GLPI_MODELO", matches = "true")
class GlpiModelDiscoveryTest {

    private static final String HEADER_SESSION_TOKEN = "Session-Token";

    /** Margen para leer de una pieza una respuesta que supera el limite por defecto de 256 KB. */
    private static final int MAX_BUFFER = 16 * 1024 * 1024;

    /** La ventana mas reciente: los tickets con mas probabilidad de estar vivos y asignados. */
    private static final String PATH_RECIENTES = "/Ticket?range=67500-67599";

    /** Un ticket de la ventana mas antigua, cerrado, para contrastar contra los recientes. */
    private static final int ID_ANTIGUO = 3;

    /** Cuantos tickets recientes se abren uno por uno para mirar sus subrecursos. */
    private static final int MUESTRA = 6;

    /** La busqueda del servidor: la unica via que escala a filtrar por tecnico. */
    private static final String PATH_BUSQUEDA = "/search/Ticket?range=0-2";

    /** El mapa de opciones de busqueda: da el numero de campo sin tener que adivinarlo. */
    private static final String PATH_OPCIONES = "/listSearchOptions/Ticket";

    /** El padron de usuarios tal como lo pide el adaptador, sin rango. */
    private static final String PATH_USUARIOS = "/User/";

    /** El padron entero: la diferencia con la anterior dice si el adaptador ve solo la primera pagina. */
    private static final String PATH_USUARIOS_COMPLETO = "/User/?range=0-999";

    /**
     * La busqueda acotada a un tecnico.
     *
     * <p>El numero de campo no se adivina: {@code /listSearchOptions/Ticket} publica que el 5 es
     * "Technician" sobre {@code glpi_users.name}. Es la unica via que escala a filtrar por tecnico sin
     * abrir un subrecurso por cada uno de los sesenta y siete mil tickets.
     */
    private static final String PATH_BUSQUEDA_TECNICO =
            "/search/Ticket?range=0-4&criteria[0][field]=5&criteria[0][searchtype]=equals"
                    + "&criteria[0][value]=%d&forcedisplay[0]=2&forcedisplay[1]=12&forcedisplay[2]=5";

    /**
     * La busqueda tarda mas que el resto.
     *
     * <p>Con el limite del cliente —cinco segundos— no alcanzo a responder ni una vez. Ese es el
     * hallazgo, no un fallo de la sonda: se le da margen para separar "no responde" de "responde
     * tarde".
     */
    private static final Duration ESPERA_BUSQUEDA = Duration.ofSeconds(30);

    /** Cuantos tickets de cada estado se abren para ver si traen tecnico. */
    private static final int POR_ESTADO = 12;

    /**
     * El discriminador de {@code Ticket_User} que marca al tecnico.
     *
     * <p>GLPI guarda los tres papeles en la misma tabla: 1 solicitante, 2 asignado, 3 observador. El
     * tipo no es un adorno — sin el, la fila del solicitante se leeria como si fuera el responsable.
     */
    private static final int TIPO_ASIGNADO = 2;

    @Autowired
    private GlpiClient glpiClient;

    @Autowired
    private GlpiProperties properties;

    @Autowired
    @Qualifier("glpiWebClient")
    private WebClient webClient;

    private final ObjectMapper json = new ObjectMapper();

    @Test
    @DisplayName("Se traen las respuestas crudas que describen el modelo real de GLPI")
    void traeElModeloReal() throws IOException {
        assertThat(properties.isConfigured())
                .as("GLPI tiene que estar configurado: sin credenciales no hay nada que descubrir")
                .isTrue();

        Duration timeout = properties.timeout();
        Path dir = Path.of(System.getProperty("java.io.tmpdir"), "glpi-modelo");
        Files.createDirectories(dir);

        String sessionToken = glpiClient.initSession().block(timeout);
        List<String> indice = new ArrayList<>();
        String resumen;
        try {
            String recientes = dump(sessionToken, PATH_RECIENTES, "tickets-recientes.json", dir, indice);
            resumen = resumenDeLaVentana(recientes);

            List<Integer> ids = primerosIds(recientes, MUESTRA);
            ids.add(ID_ANTIGUO);
            for (Integer id : ids) {
                dump(sessionToken, "/Ticket/" + id, "ticket-" + id + ".json", dir, indice);
                dump(sessionToken, "/Ticket/" + id + "/Ticket_User/", "ticketuser-" + id + ".json", dir, indice);
                dump(sessionToken, "/Ticket/" + id + "/TicketTask/", "tickettask-" + id + ".json", dir, indice);
                dump(sessionToken, "/Ticket/" + id + "/Group_Ticket/", "groupticket-" + id + ".json", dir, indice);
            }
            dump(sessionToken, "/search/Ticket?range=0-2", "search-ticket.json", dir, indice);
        } finally {
            glpiClient.killSession(sessionToken).block(timeout);
        }

        System.out.println(informe(dir, resumen, indice));
    }

    /**
     * Trae una respuesta cruda y la deja en disco.
     *
     * <p>Un fallo se registra en el indice y no se propaga: que una sonda no exista en esta version
     * de GLPI es un hallazgo sobre el modelo, no un error de la prueba.
     */
    private String dump(String sessionToken, String path, String nombre, Path dir, List<String> indice) {
        return dump(sessionToken, path, nombre, dir, indice, properties.timeout());
    }

    private String dump(String sessionToken, String path, String nombre, Path dir, List<String> indice,
            Duration espera) {
        try {
            Captura captura = largeBodyClient().get()
                    .uri(path)
                    .header(HEADER_SESSION_TOKEN, sessionToken)
                    .exchangeToMono(response -> response.bodyToMono(String.class)
                            .defaultIfEmpty("")
                            .map(body -> {
                                String rango = response.headers().asHttpHeaders()
                                        .getFirst(HttpHeaders.CONTENT_RANGE);
                                return new Captura(response.statusCode().value(),
                                        rango == null ? "" : rango, body);
                            }))
                    .block(espera);

            if (captura == null) {
                indice.add(String.format("%-26s SIN RESPUESTA              %s", nombre, path));
                return "";
            }
            Files.writeString(dir.resolve(nombre), captura.body(), StandardCharsets.UTF_8);
            indice.add(String.format("%-26s HTTP %d  %9d car.  %-16s %s",
                    nombre, captura.status(), captura.body().length(), captura.contentRange(), path));
            return captura.body();
        } catch (RuntimeException | IOException ex) {
            indice.add(String.format("%-26s FALLO %s: %s  %s",
                    nombre, ex.getClass().getSimpleName(), ex.getMessage(), path));
            return "";
        }
    }

    /** Los primeros identificadores de la ventana, en el orden en que GLPI los devolvio. */
    private List<Integer> primerosIds(String cuerpo, int cuantos) throws IOException {
        List<Map<String, Object>> tickets = json.readValue(cuerpo, new TypeReference<>() {
        });
        List<Integer> ids = new ArrayList<>();
        for (Map<String, Object> ticket : tickets) {
            if (ticket.get("id") instanceof Number numero) {
                ids.add(numero.intValue());
            }
            if (ids.size() >= cuantos) {
                break;
            }
        }
        return ids;
    }

    /**
     * Que hay en la ventana reciente: rango de identificadores y reparto por estado y tipo.
     *
     * <p>Es la comprobacion de que la sonda alcanzo tickets vivos. Si el reparto sale igual al de la
     * ventana antigua —todo cerrado—, la conclusion no es que el modelo no tenga estados: es que la
     * muestra no los toco.
     */
    private String resumenDeLaVentana(String cuerpo) throws IOException {
        if (cuerpo.isBlank()) {
            return "la ventana reciente no devolvio nada";
        }
        List<Map<String, Object>> tickets = json.readValue(cuerpo, new TypeReference<>() {
        });
        if (tickets.isEmpty()) {
            return "la ventana reciente devolvio cero tickets";
        }

        List<Integer> ids = new ArrayList<>();
        List<String> estados = new ArrayList<>();
        List<String> tipos = new ArrayList<>();
        for (Map<String, Object> ticket : tickets) {
            if (ticket.get("id") instanceof Number numero) {
                ids.add(numero.intValue());
            }
            estados.add(String.valueOf(ticket.get("status")));
            tipos.add(String.valueOf(ticket.get("type")));
        }
        return "n=" + tickets.size()
                + "  ids " + ids.stream().min(Integer::compareTo).orElse(-1)
                + ".." + ids.stream().max(Integer::compareTo).orElse(-1)
                + System.lineSeparator() + "  status " + cuenta(estados)
                + System.lineSeparator() + "  type   " + cuenta(tipos);
    }

    private static String cuenta(List<String> valores) {
        Map<String, Integer> cuenta = new java.util.TreeMap<>();
        for (String valor : valores) {
            cuenta.merge(valor, 1, Integer::sum);
        }
        return cuenta.toString();
    }

    /**
     * El mismo cliente, con sitio para la respuesta entera.
     *
     * <p>{@code mutate()} conserva el conector y con el el almacen de confianza del cliente de GLPI.
     */
    private WebClient largeBodyClient() {
        return webClient.mutate()
                .codecs(config -> config.defaultCodecs().maxInMemorySize(MAX_BUFFER))
                .build();
    }

    /**
     * La asignacion, ticket por ticket, y la busqueda del servidor.
     *
     * <p>Tres preguntas que la primera pasada dejo abiertas. Primero: {@code /search/Ticket} no
     * alcanzo a responder con el limite del cliente, y es la unica via que escala a filtrar por
     * tecnico sin abrir sesenta y siete mil subrecursos. Segundo: el numero de campo de "asignado a"
     * no se adivina, lo publica {@code /listSearchOptions/Ticket}. Tercero: saber que un ticket trae
     * un {@code users_id} no dice si ese usuario existe en el padron que el adaptador ya lee.
     *
     * <p>Los tickets se abren repartidos por estado, no los primeros de la ventana: si todos fueran
     * del mismo estado, "tiene tecnico" y "esta vivo" quedarian confundidos.
     */
    @Test
    @DisplayName("Se trae donde vive el asignado, la busqueda del servidor y el padron de usuarios")
    void traeLaAsignacion() throws IOException {
        Duration timeout = properties.timeout();
        Path dir = Path.of(System.getProperty("java.io.tmpdir"), "glpi-modelo");
        List<Map<String, Object>> ventana = leeVentana(dir);
        assertThat(ventana)
                .as("Primero hay que traer la ventana reciente: de ahi salen los tickets que se abren")
                .isNotEmpty();

        String sessionToken = glpiClient.initSession().block(timeout);
        List<String> indice = new ArrayList<>();
        try {
            dump(sessionToken, PATH_BUSQUEDA, "search-ticket.json", dir, indice, ESPERA_BUSQUEDA);
            dump(sessionToken, PATH_OPCIONES, "search-options-ticket.json", dir, indice, ESPERA_BUSQUEDA);
            dump(sessionToken, PATH_USUARIOS, "usuarios.json", dir, indice);
            dump(sessionToken, PATH_USUARIOS_COMPLETO, "usuarios-completos.json", dir, indice);
            for (Integer id : idsPorEstado(ventana, POR_ESTADO)) {
                dump(sessionToken, "/Ticket/" + id + "/Ticket_User/", "ticketuser-" + id + ".json", dir, indice);
                dump(sessionToken, "/Ticket/" + id + "/Group_Ticket/", "groupticket-" + id + ".json", dir, indice);
            }
            for (Integer id : idsDeLaVentanaAntigua(POR_ESTADO)) {
                dump(sessionToken, "/Ticket/" + id + "/Ticket_User/", "ticketuser-viejo-" + id + ".json", dir, indice);
            }
            Integer tecnico = unTecnico(dir);
            if (tecnico != null) {
                dump(sessionToken, "/User/" + tecnico, "usuario-tecnico.json", dir, indice);
                dump(sessionToken, PATH_BUSQUEDA_TECNICO.formatted(tecnico), "search-por-tecnico.json", dir, indice,
                        ESPERA_BUSQUEDA);
            }
        } finally {
            glpiClient.killSession(sessionToken).block(timeout);
        }

        System.out.println(informe(dir, "", indice));
    }

    /**
     * Identificadores repartidos por la ventana antigua —los mil tickets mas viejos, todos cerrados—.
     *
     * <p>Es el otro extremo del contraste. Si en los recientes todos traen tecnico, hay que ver si eso
     * es como funciona GLPI o es como se empezo a usar hace poco: la respuesta cambia si el
     * responsable es un dato que siempre estuvo o uno que solo existe de un tiempo a esta parte.
     *
     * <p>Se lee la captura de la fase anterior en vez de volver a pedir mil tickets.
     */
    private List<Integer> idsDeLaVentanaAntigua(int cuantos) throws IOException {
        Path archivo = Path.of(System.getProperty("java.io.tmpdir"), "glpi-tickets.json");
        if (!Files.exists(archivo)) {
            return List.of();
        }
        List<Map<String, Object>> tickets = json.readValue(
                Files.readString(archivo, StandardCharsets.UTF_8), new TypeReference<>() {
                });
        List<Integer> ids = new ArrayList<>();
        int paso = Math.max(1, tickets.size() / Math.max(1, cuantos));
        for (int i = 0; i < tickets.size() && ids.size() < cuantos; i += paso) {
            if (tickets.get(i).get("id") instanceof Number id) {
                ids.add(id.intValue());
            }
        }
        return ids;
    }

    /**
     * Un identificador de tecnico asignado, leido de lo que esta sonda ya trajo.
     *
     * <p>La busqueda se prueba contra un tecnico que de verdad tiene tickets: pedirla sin criterio no
     * distingue "la busqueda no sirve" de "la busqueda entera es cara".
     */
    private Integer unTecnico(Path dir) throws IOException {
        List<Path> archivos;
        try (var listado = Files.list(dir)) {
            archivos = listado
                    .filter(archivo -> archivo.getFileName().toString().startsWith("ticketuser-"))
                    .sorted()
                    .toList();
        }
        for (Path archivo : archivos) {
            String texto = Files.readString(archivo, StandardCharsets.UTF_8);
            if (texto.isBlank()) {
                continue;
            }
            List<Map<String, Object>> filas = json.readValue(texto, new TypeReference<>() {
            });
            for (Map<String, Object> fila : filas) {
                if (Integer.valueOf(TIPO_ASIGNADO).equals(fila.get("type")) && fila.get("users_id") instanceof Number id) {
                    return id.intValue();
                }
            }
        }
        return null;
    }

    /** La ventana reciente tal como quedo en disco: no se vuelve a pedir lo que ya se trajo. */
    private List<Map<String, Object>> leeVentana(Path dir) throws IOException {
        Path archivo = dir.resolve("tickets-recientes.json");
        if (!Files.exists(archivo)) {
            return List.of();
        }
        return json.readValue(Files.readString(archivo, StandardCharsets.UTF_8), new TypeReference<>() {
        });
    }

    /**
     * Identificadores de la ventana repartidos por estado, en el orden en que GLPI los devolvio.
     *
     * <p>El contraste que pide el brief: tickets cerrados, abiertos, asignados y sin asignar. Si solo
     * se abrieran los primeros de la ventana, todos serian del mismo estado y el contraste no
     * existiria.
     */
    private static List<Integer> idsPorEstado(List<Map<String, Object>> ventana, int porEstado) {
        Map<Integer, Integer> usados = new HashMap<>();
        List<Integer> ids = new ArrayList<>();
        for (Map<String, Object> ticket : ventana) {
            if (!(ticket.get("id") instanceof Number id) || !(ticket.get("status") instanceof Number estado)) {
                continue;
            }
            int clave = estado.intValue();
            int yaUsados = usados.getOrDefault(clave, 0);
            if (yaUsados >= porEstado) {
                continue;
            }
            usados.put(clave, yaUsados + 1);
            ids.add(id.intValue());
        }
        return ids;
    }

    private static String informe(Path dir, String resumen, List<String> indice) {
        String encabezado = resumen.isBlank()
                ? "ventana reciente : (no se volvio a pedir)" + System.lineSeparator()
                : "ventana reciente : " + System.lineSeparator() + "  " + resumen + System.lineSeparator();
        return System.lineSeparator()
                + "=============== MODELO REAL DE GLPI ===============" + System.lineSeparator()
                + encabezado
                + "---------------------------------------------------" + System.lineSeparator()
                + String.join(System.lineSeparator(), indice) + System.lineSeparator()
                + "carpeta          : " + dir + System.lineSeparator()
                + "===================================================" + System.lineSeparator();
    }

    /**
     * Lo que GLPI respondio, antes de que nadie lo haya clasificado.
     *
     * <p>{@code Content-Range} no es adorno: dice si una lista vino entera o solo la primera pagina,
     * y esa diferencia decide si el padron de usuarios que lee el adaptador esta completo.
     */
    private record Captura(int status, String contentRange, String body) {
    }
}
