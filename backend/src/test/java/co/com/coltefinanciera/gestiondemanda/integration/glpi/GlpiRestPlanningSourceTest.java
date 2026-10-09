package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.codec.DecodingException;

import reactor.core.publisher.Mono;

import co.com.coltefinanciera.gestiondemanda.client.GlpiClient;
import co.com.coltefinanciera.gestiondemanda.config.GlpiProperties;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiAuthenticationException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiConnectionException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiInvalidDataException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiItemNotFoundException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiUnreachableException;

/**
 * El adaptador HTTP: clasificacion de fallos y forma de lo que devuelve.
 *
 * <p>El cliente se sustituye por un doble, asi que no hay ninguna instancia de GLPI detras. Lo que se
 * prueba no es la red —eso es de WebClient— sino que cada fallo salga por la puerta que le toca y que
 * la sesion se cierre pase lo que pase.
 */
class GlpiRestPlanningSourceTest {

    private static final String URL = "https://glpi.test/apirest.php";
    private static final String SESSION = "sess-1";

    private GlpiClient glpiClient;
    private GlpiRestPlanningSource source;

    @BeforeEach
    void setUp() {
        glpiClient = mock(GlpiClient.class);
        // Un doble devuelve null para Mono<Void>; el cierre de sesion tiene que emitir vacio.
        when(glpiClient.killSession(anyString())).thenReturn(Mono.empty());
        source = new GlpiRestPlanningSource(glpiClient,
                new GlpiProperties(URL, "app-token", "user-token", Duration.ofSeconds(2)));
    }

    private static GlpiTicket ticket(int id, int assignedUserId) {
        return new GlpiTicket(id, "Ticket " + id, 1, GlpiTicket.TYPE_INCIDENT, 3, null, null,
                3600L, null, "2026-10-05 09:00:00", assignedUserId);
    }

    private void sessionOpens() {
        when(glpiClient.initSession()).thenReturn(Mono.just(SESSION));
    }

    @Test
    @DisplayName("Un usuario inexistente es un Optional vacio, no una excepcion")
    void unUsuarioInexistenteDevuelveVacio() {
        sessionOpens();
        when(glpiClient.get(anyString(), eq(SESSION), eq(GlpiUser.class)))
                .thenReturn(Mono.error(new GlpiItemNotFoundException(
                        "GLPI respondio HTTP 400: [\"ERROR_ITEM_NOT_FOUND\"]")));

        assertThat(source.findUser("nadie")).isEmpty();
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("Un usuario existente se devuelve tal como lo dio GLPI")
    void unUsuarioExistenteSeDevuelve() {
        sessionOpens();
        GlpiUser user = new GlpiUser(7, "jdoe", "Doe", "Jane");
        when(glpiClient.get("/User/jdoe", SESSION, GlpiUser.class)).thenReturn(Mono.just(user));

        assertThat(source.findUser("jdoe")).contains(user);
    }

    @Test
    @DisplayName("Autenticacion fallida al abrir sesion sale como excepcion de autenticacion")
    void autenticacionFallidaAlAbrirSesion() {
        when(glpiClient.initSession()).thenReturn(Mono.error(
                new GlpiAuthenticationException("GLPI respondio HTTP 401 en initSession")));

        assertThatThrownBy(() -> source.findUser("jdoe"))
                .isInstanceOf(GlpiAuthenticationException.class)
                .hasMessageContaining("401");
    }

    @Test
    @DisplayName("Autenticacion fallida al leer datos sale igual, y cierra la sesion")
    void autenticacionFallidaAlLeerDatos() {
        sessionOpens();
        when(glpiClient.get(anyString(), eq(SESSION), eq(GlpiUser.class)))
                .thenReturn(Mono.error(new GlpiAuthenticationException("HTTP 403")));

        assertThatThrownBy(() -> source.findUser("jdoe"))
                .isInstanceOf(GlpiAuthenticationException.class);
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("GLPI inalcanzable sale como excepcion de alcance, con la causa original")
    void glpiInalcanzable() {
        when(glpiClient.initSession()).thenReturn(Mono.error(
                new GlpiUnreachableException("Response timeout after 2000ms", null)));

        assertThatThrownBy(() -> source.ticketsOf("7"))
                .isInstanceOf(GlpiUnreachableException.class)
                .hasMessageContaining("timeout");
    }

    @Test
    @DisplayName("Un cuerpo ilegible es un fallo de datos, no un error interno")
    void unCuerpoIlegibleEsUnFalloDeDatos() {
        sessionOpens();
        when(glpiClient.getList(anyString(), eq(SESSION), eq(GlpiTicket.class)))
                .thenReturn(Mono.error(new DecodingException("no es un arreglo")));

        assertThatThrownBy(() -> source.ticketsOf("7"))
                .isInstanceOf(GlpiInvalidDataException.class)
                .hasMessageContaining("no se puede leer");
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("Los tickets se filtran por asignado y se conserva el orden")
    void filtraPorAsignado() {
        sessionOpens();
        when(glpiClient.getList(anyString(), eq(SESSION), eq(GlpiTicket.class)))
                .thenReturn(Mono.just(List.of(ticket(1, 7), ticket(2, 9), ticket(3, 7))));

        assertThat(source.ticketsOf("7")).extracting(GlpiTicket::id).containsExactly(1, 3);
    }

    @Test
    @DisplayName("Un identificador no numerico no puede filtrar y no inventa tickets")
    void unIdentificadorNoNumericoNoDevuelveTickets() {
        sessionOpens();
        when(glpiClient.getList(anyString(), eq(SESSION), eq(GlpiTicket.class)))
                .thenReturn(Mono.just(List.of(ticket(1, 7))));

        assertThat(source.ticketsOf("jdoe")).isEmpty();
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("Un fallo al cerrar la sesion no invalida la lectura ya hecha")
    void unFalloAlCerrarNoInvalidaLaLectura() {
        sessionOpens();
        when(glpiClient.get(anyString(), eq(SESSION), eq(GlpiUser.class)))
                .thenReturn(Mono.just(new GlpiUser(7, "jdoe", "Doe", "Jane")));
        when(glpiClient.killSession(SESSION)).thenReturn(
                Mono.error(new GlpiConnectionException("no se pudo cerrar")));

        assertThat(source.findUser("jdoe")).isPresent();
    }
}
