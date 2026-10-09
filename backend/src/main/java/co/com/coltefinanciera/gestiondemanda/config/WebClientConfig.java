package co.com.coltefinanciera.gestiondemanda.config;

import org.springframework.boot.ssl.SslBundles;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;

import io.netty.channel.ChannelOption;
import io.netty.handler.ssl.ClientAuth;
import io.netty.handler.ssl.JdkSslContext;
import reactor.netty.http.client.HttpClient;

/**
 * WebClient dedicado a GLPI.
 *
 * <p>Se registra con nombre propio ({@code glpiWebClient}) para que en fases posteriores
 * puedan coexistir otros clientes HTTP sin ambiguedad al inyectar.
 *
 * <p><strong>Trae su propio conjunto de confianza.</strong> El servidor de GLPI no envia su
 * certificado intermedio, y la JVM —a diferencia de Windows— no lo descarga por su cuenta: la
 * cadena no se puede construir y el handshake falla antes de llegar a la API. El conjunto declarado
 * en {@code spring.ssl.bundle.pem.glpi} aporta el eslabon que falta.
 *
 * <p>El conjunto es <em>mas estrecho</em> que el almacen por defecto, no mas amplio: solo acepta lo
 * que firme esa CA. Aqui no se desactiva ninguna verificacion; se completa una cadena que el
 * servidor dejo incompleta. Saltarse la verificacion habria cambiado un problema de configuracion
 * por un agujero de seguridad.
 */
@Configuration
public class WebClientConfig {

    /** Nombre del conjunto de confianza, tal como se declara en application.properties. */
    private static final String TRUST_BUNDLE = "glpi";

    @Bean
    public WebClient glpiWebClient(GlpiProperties properties, SslBundles sslBundles) {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, (int) properties.timeout().toMillis())
                .responseTimeout(properties.timeout())
                .secure(spec -> spec.sslContext(new JdkSslContext(
                        sslBundles.getBundle(TRUST_BUNDLE).createSslContext(), true, ClientAuth.NONE)));

        WebClient.Builder builder = WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient));

        // Si la URL no esta configurada se omite baseUrl a proposito: el diagnostico legible
        // lo entrega GlpiClient, en lugar de fallar la construccion del bean al arrancar.
        if (StringUtils.hasText(properties.normalizedBaseUrl())) {
            builder.baseUrl(properties.normalizedBaseUrl());
        }
        if (StringUtils.hasText(properties.appToken())) {
            builder.defaultHeader("App-Token", properties.appToken());
        }

        return builder.build();
    }
}
