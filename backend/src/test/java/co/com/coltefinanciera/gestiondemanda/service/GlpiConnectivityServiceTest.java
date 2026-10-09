package co.com.coltefinanciera.gestiondemanda.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import reactor.core.publisher.Mono;

import co.com.coltefinanciera.gestiondemanda.client.GlpiClient;
import co.com.coltefinanciera.gestiondemanda.config.GlpiProperties;
import co.com.coltefinanciera.gestiondemanda.dto.GlpiHealthResponse;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiConnectionException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiUnreachableException;

/** Prueba el mapeo de estados del servicio: conectado vs autenticado. */
class GlpiConnectivityServiceTest {

    private static final String URL = "https://glpi.test/apirest.php";
    private static final String SESSION_TOKEN = "sess-123";

    private GlpiClient glpiClient;

    @BeforeEach
    void setUp() {
        glpiClient = mock(GlpiClient.class);
    }

    private GlpiConnectivityService serviceWith(GlpiProperties properties) {
        return new GlpiConnectivityService(glpiClient, properties);
    }

    private static GlpiProperties configured() {
        return new GlpiProperties(URL, "app-token", "user-token", Duration.ofSeconds(2));
    }

    @Test
    void sinConfiguracionReportaNoConectadoYNoAutenticado() {
        GlpiProperties properties = new GlpiProperties("", "", "", Duration.ofSeconds(2));

        GlpiHealthResponse response = serviceWith(properties).check();

        assertThat(response.connected()).isFalse();
        assertThat(response.authenticated()).isFalse();
        assertThat(response.baseUrl()).isEmpty();
        assertThat(response.detail()).contains("no esta configurado");
        verify(glpiClient, never()).initSession();
    }

    @Test
    void handshakeCompletoReportaConectadoYAutenticado() {
        when(glpiClient.initSession()).thenReturn(Mono.just(SESSION_TOKEN));
        when(glpiClient.getFullSession(SESSION_TOKEN)).thenReturn(Mono.just("{\"session\":{}}"));
        when(glpiClient.killSession(anyString())).thenReturn(Mono.empty());

        GlpiHealthResponse response = serviceWith(configured()).check();

        assertThat(response.connected()).isTrue();
        assertThat(response.authenticated()).isTrue();
        assertThat(response.baseUrl()).isEqualTo(URL);
        assertThat(response.checkedAt()).isNotNull();
        // La sesion siempre se cierra, incluso en el camino feliz.
        verify(glpiClient).killSession(SESSION_TOKEN);
    }

    @Test
    void servidorInalcanzableReportaNoConectado() {
        when(glpiClient.initSession())
                .thenReturn(Mono.error(new GlpiUnreachableException("Connection refused", null)));

        GlpiHealthResponse response = serviceWith(configured()).check();

        assertThat(response.connected()).isFalse();
        assertThat(response.authenticated()).isFalse();
        assertThat(response.baseUrl()).isEqualTo(URL);
    }

    @Test
    void credencialesRechazadasReportaConectadoPeroNoAutenticado() {
        when(glpiClient.initSession())
                .thenReturn(Mono.error(new GlpiConnectionException("GLPI respondio HTTP 400 en initSession")));

        GlpiHealthResponse response = serviceWith(configured()).check();

        assertThat(response.connected()).isTrue();
        assertThat(response.authenticated()).isFalse();
        assertThat(response.detail()).contains("HTTP 400");
        verify(glpiClient, never()).killSession(anyString());
    }
}
