package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.function.Supplier;

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
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiContractVerifier.Report;

/**
 * Ejecuta la verificacion del contrato contra la instancia real de GLPI.
 *
 * <p>Es el otro extremo de {@link GlpiContractVerifier}: el verificador compara, pero recibe texto y
 * no sabe de donde salio. Esta clase es quien trae el texto —de la instancia de verdad, por el mismo
 * cliente y el mismo transporte que usa la aplicacion— y quien deja el resultado donde se pueda leer.
 *
 * <p><strong>Captura dos veces a proposito.</strong> Primero por el {@code WebClient} sin la politica
 * de errores del cliente, porque la pregunta que responde esta clase es <em>que devuelve GLPI</em> y
 * una politica que clasifica antes de que nadie mire contamina la respuesta. Despues por
 * {@link GlpiClient}, que es lo que la aplicacion vera. Cuando las dos lecturas no coinciden, la
 * diferencia es un hallazgo y no un detalle de implementacion.
 *
 * <p><strong>No corre con la suite.</strong> Esta desactivada salvo que se declare
 * {@code GLPI_VALIDACION=true}, porque necesita credenciales reales y una instancia alcanzable, y una
 * prueba que falla en la maquina de quien no tiene eso no es una prueba: es un estorbo. Las 160 de
 * siempre siguen sin depender de la red, que es lo que el brief de la Fase 10 fijaba.
 *
 * <p><strong>No afirma que el contrato sea compatible.</strong> El veredicto se imprime y se
 * documenta; convertirlo en una asercion antes de conocerlo seria escribir la respuesta que se quiere
 * leer. Lo unico que se afirma es que la muestra existe, porque una muestra vacia el verificador la
 * reporta como {@code COMPATIBLE} por no tener nada que objetar.
 */
@SpringBootTest
@ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named = "GLPI_VALIDACION", matches = "true")
class GlpiContractValidationTest {

    /** La misma ruta que usa el adaptador, para verificar el contrato que el adaptador lee. */
    private static final String PATH_TICKETS = "/Ticket?range=0-999";

    /** La misma ruta con un rango minimo: separa "el 206 es intolerable" de "el cuerpo no cabe". */
    private static final String PATH_TICKETS_SMALL = "/Ticket?range=0-1";

    private static final String HEADER_SESSION_TOKEN = "Session-Token";
    private static final String CAPTURE_PROPERTY = "glpi.captura";
    private static final String CAPTURE_DEFAULT = "glpi-tickets.json";

    /**
     * Margen para leer la respuesta entera en memoria.
     *
     * <p>El limite por defecto son 256 KB y la respuesta de {@code /Ticket} lo supera, asi que la
     * lectura cruda muere con {@code DataBufferLimitException} antes de poder mirarla. Se sube aqui y
     * no en el cliente de la aplicacion: es una necesidad de esta captura —que quiere el texto entero
     * de una pieza para pasarselo al verificador— y no del transporte, que lee por elementos.
     */
    private static final int MAX_BUFFER = 16 * 1024 * 1024;

    @Autowired
    private GlpiClient glpiClient;

    @Autowired
    private GlpiProperties properties;

    @Autowired
    @Qualifier("glpiWebClient")
    private WebClient webClient;

    /** Lo que GLPI respondio, antes de que nadie lo haya clasificado. */
    private record Captura(int status, String contentRange, String body) {
    }

    @Test
    @DisplayName("El contrato declarado se compara contra una respuesta real de GLPI")
    void verificaElContratoContraLaInstanciaReal() throws IOException {
        assertThat(properties.isConfigured())
                .as("GLPI tiene que estar configurado: sin credenciales no hay nada que verificar")
                .isTrue();

        Duration timeout = properties.timeout();
        String sessionToken = glpiClient.initSession().block(timeout);

        Captura captura;
        String viaCliente;
        try {
            captura = largeBodyClient().get()
                    .uri(PATH_TICKETS)
                    .header(HEADER_SESSION_TOKEN, sessionToken)
                    .exchangeToMono(response -> response.bodyToMono(String.class)
                            .defaultIfEmpty("")
                            .map(body -> new Captura(
                                    response.statusCode().value(),
                                    String.valueOf(response.headers().asHttpHeaders()
                                            .getFirst(HttpHeaders.CONTENT_RANGE)),
                                    body)))
                    .block(timeout);

            viaCliente = readThroughClient(sessionToken, timeout);
        } finally {
            glpiClient.killSession(sessionToken).block(timeout);
        }

        Path capture = capturePath();
        Files.writeString(capture, captura.body(), StandardCharsets.UTF_8);

        System.out.println(encabezado(captura, capture, viaCliente));
        System.out.println(informe(GlpiContractVerifier.verify(captura.body()), capture));

        assertThat(captura.status())
                .as("La lectura cruda tiene que haber respondido con exito")
                .isBetween(200, 299);
        assertThat(GlpiContractVerifier.verify(captura.body()).tickets())
                .as("La instancia respondio, pero sin tickets: no hay muestra que verificar")
                .isPositive();
    }

    /**
     * El mismo cliente, con sitio para la respuesta entera.
     *
     * <p>{@code mutate()} conserva el conector, y con el el almacen de confianza del cliente de GLPI:
     * lo unico que cambia es cuanto cabe en memoria. Construir un {@code WebClient} nuevo aqui habria
     * dejado la captura fuera del transporte que se esta validando, que es justo lo que no se quiere.
     */
    private WebClient largeBodyClient() {
        return webClient.mutate()
                .codecs(config -> config.defaultCodecs().maxInMemorySize(MAX_BUFFER))
                .build();
    }

    /**
     * Que hace el cliente de la aplicacion con esa misma respuesta: es lo que el flujo vera.
     *
     * <p>Tres sondas y no una, porque "falla" no es un hallazgo util. La primera es la llamada que
     * hace el adaptador de verdad. La segunda lee el mismo cuerpo entero de una pieza, que es lo que
     * rompe el limite de memoria del transporte. La tercera pide un rango minimo para separar dos
     * causas que se parecen —que el codigo 206 sea intolerable, o que el cuerpo no quepa—. Sin la
     * tercera, un fallo de tamano se leeria como un fallo de contrato.
     */
    private String readThroughClient(String sessionToken, Duration timeout) {
        return "getList(/Ticket?range=0-999) : " + probe(() ->
                glpiClient.getList(PATH_TICKETS, sessionToken, GlpiTicket.class).block(timeout).size()
                        + " tickets")
                + System.lineSeparator()
                + "get(String) misma ruta       : " + probe(() ->
                glpiClient.get(PATH_TICKETS, sessionToken, String.class).block(timeout).length()
                        + " caracteres")
                + System.lineSeparator()
                + "getList(/Ticket?range=0-1)   : " + probe(() ->
                glpiClient.getList(PATH_TICKETS_SMALL, sessionToken, GlpiTicket.class).block(timeout).size()
                        + " tickets");
    }

    private static String probe(Supplier<String> call) {
        try {
            return call.get();
        } catch (RuntimeException ex) {
            return "FALLO: " + ex.getClass().getSimpleName() + " - " + ex.getMessage();
        }
    }

    /** Donde se deja la respuesta cruda, fuera del repositorio por defecto. */
    private static Path capturePath() {
        String declared = System.getProperty(CAPTURE_PROPERTY);
        String name = declared == null || declared.isBlank() ? CAPTURE_DEFAULT : declared;
        return Path.of(System.getProperty("java.io.tmpdir"), name);
    }

    private static String encabezado(Captura captura, Path capture, String viaCliente) {
        return System.lineSeparator()
                + "=============== CAPTURA REAL DE GLPI ===============" + System.lineSeparator()
                + "ruta             : " + PATH_TICKETS + System.lineSeparator()
                + "HTTP             : " + captura.status() + System.lineSeparator()
                + "Content-Range    : " + captura.contentRange() + System.lineSeparator()
                + "cuerpo           : " + captura.body().length() + " caracteres" + System.lineSeparator()
                + "via GlpiClient   : " + viaCliente + System.lineSeparator()
                + "captura cruda    : " + capture + System.lineSeparator();
    }

    private static String informe(Report report, Path capture) {
        return "=============== VERIFICACION DEL CONTRATO ===============" + System.lineSeparator()
                + "contrato asumido      : " + report.contractVersion() + System.lineSeparator()
                + "adaptador             : " + report.adapterVersion() + System.lineSeparator()
                + "tickets leidos        : " + report.tickets() + System.lineSeparator()
                + "veredicto             : " + report.verdict() + System.lineSeparator()
                + "obligatorios ausentes : " + report.missingRequired() + System.lineSeparator()
                + "tipos incompatibles   : " + report.typeMismatches() + System.lineSeparator()
                + "campos no modelados   : " + report.unknownFields() + System.lineSeparator()
                + "fuera de escala       : " + report.outOfRangeValues() + System.lineSeparator()
                + "fechas ilegibles      : " + report.unreadableDates() + System.lineSeparator()
                + "captura cruda         : " + capture + System.lineSeparator()
                + "=========================================================" + System.lineSeparator();
    }
}
