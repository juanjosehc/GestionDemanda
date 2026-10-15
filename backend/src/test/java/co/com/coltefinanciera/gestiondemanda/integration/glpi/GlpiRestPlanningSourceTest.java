package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.lang.reflect.RecordComponent;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.stubbing.OngoingStubbing;
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
 * prueba no es la red —eso es de WebClient— sino que cada fallo salga por la puerta que le toca, que la
 * sesion se cierre pase lo que pase y que los tickets se pidan por donde se tienen que pedir: la
 * recuperacion de tickets asignados es lo que la decision 159 corrige, y estas pruebas son su red.
 */
class GlpiRestPlanningSourceTest {

    private static final String URL = "https://glpi.test/apirest.php";
    private static final String SESSION = "sess-1";

    private GlpiClient glpiClient;
    private GlpiProperties properties;
    private GlpiRestPlanningSource source;

    @BeforeEach
    void setUp() {
        glpiClient = mock(GlpiClient.class);
        properties = new GlpiProperties(URL, "app-token", "user-token", Duration.ofSeconds(2));
        // Un doble devuelve null para Mono<Void>; el cierre de sesion tiene que emitir vacio.
        when(glpiClient.killSession(anyString())).thenReturn(Mono.empty());
        source = new GlpiRestPlanningSource(glpiClient, properties);
    }

    /**
     * Una fila de {@code /search/Ticket} con la forma real.
     *
     * <p>Las claves son numeros de opcion de busqueda y no nombres de campo, porque eso es lo que GLPI
     * devuelve al proyectar una busqueda. La columna {@code "5"} viene puesta a proposito: es el tecnico
     * y el adaptador ya no la lee —quien filtra es el servidor—, asi que una fila que la traiga distinta
     * de nada no puede cambiar el resultado.
     */
    private static Map<String, Object> row(int id, String name, int status, int type, String date) {
        Map<String, Object> row = new HashMap<>();
        row.put("1", name);
        row.put("2", id);
        row.put("3", 3);
        row.put("10", 3);
        row.put("11", 3);
        row.put("12", status);
        row.put("14", type);
        row.put("15", date);
        row.put("18", "2026-10-06 17:00:00");
        row.put("45", 3600);
        row.put("5", "13");
        return row;
    }

    private static Map<String, Object> row(int id) {
        return row(id, "Ticket " + id, 1, GlpiTicket.TYPE_INCIDENT, "2026-10-05 09:00:00");
    }

    private void sessionOpens() {
        when(glpiClient.initSession()).thenReturn(Mono.just(SESSION));
    }

    /** Encadena las paginas que la busqueda va a devolver, en orden. */
    private void searchReturns(GlpiSearchPage... pages) {
        OngoingStubbing<Mono<GlpiSearchPage>> stubbing =
                when(glpiClient.get(anyString(), eq(SESSION), eq(GlpiSearchPage.class)));
        for (GlpiSearchPage page : pages) {
            stubbing = stubbing.thenReturn(Mono.just(page));
        }
    }

    /** La unica ruta de busqueda que se pidio. */
    private String searchedPath() {
        ArgumentCaptor<String> paths = ArgumentCaptor.forClass(String.class);
        verify(glpiClient).get(paths.capture(), eq(SESSION), eq(GlpiSearchPage.class));
        return paths.getValue();
    }

    @Test
    @DisplayName("Un usuario inexistente es un Optional vacio, no una excepcion")
    void unUsuarioInexistenteDevuelveVacio() {
        sessionOpens();
        when(glpiClient.get(anyString(), eq(SESSION), eq(GlpiUser.class)))
                .thenReturn(Mono.error(new GlpiItemNotFoundException(
                        "GLPI respondio HTTP 400: [\"ERROR_ITEM_NOT_FOUND\"]")));

        assertThat(source.findUser("999")).isEmpty();
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("Un usuario existente se devuelve tal como lo dio GLPI")
    void unUsuarioExistenteSeDevuelve() {
        sessionOpens();
        GlpiUser user = new GlpiUser(7, "jdoe", "Doe", "Jane");
        when(glpiClient.get("/User/7", SESSION, GlpiUser.class)).thenReturn(Mono.just(user));

        assertThat(source.findUser("7")).contains(user);
    }

    // --- El login: la traduccion que el sistema necesita y GLPI no tiene ------------------------

    /**
     * El login resuelto contra la instancia.
     *
     * <p>Estas pruebas existen porque el catalogo publica logins y el plan se pide por ellos, mientras
     * que GLPI solo sabe buscar un tecnico por numero: {@code /User/{login}} no da un 404, contesta 206
     * con la coleccion entera de usuarios. Sin esta traduccion, la cadena persona → login → glpiId →
     * tickets se corta en el segundo paso y lo que se ve es «sin dato», que es lo que la fase corrige.
     */

    /** Una fila de {@code /search/User} con la forma real: claves por numero de opcion. */
    private static Map<String, Object> userRow(int id, String login, String realname, String firstname,
            int active) {
        Map<String, Object> row = new HashMap<>();
        row.put("1", login);
        row.put("2", id);
        row.put("8", active);
        row.put("9", firstname);
        row.put("34", realname);
        return row;
    }

    @Test
    @DisplayName("Un login se resuelve por la busqueda de usuarios, no por la ruta del elemento")
    void unLoginSeResuelvePorLaBusqueda() {
        sessionOpens();
        searchReturns(new GlpiSearchPage(1, List.of(userRow(1179, "AbraAran", "Arana Aldana", "Abraham", 1))));

        assertThat(source.findUser("AbraAran"))
                .map(GlpiUser::id)
                .contains(1179);

        // La ruta del elemento no se pide para un login: es la que contesta la coleccion entera.
        verify(glpiClient, never()).get(anyString(), anyString(), eq(GlpiUser.class));

        String path = searchedPath();
        assertThat(path)
                .startsWith("/search/User")
                .contains("criteria[0][field]=1")
                .contains("criteria[0][value]=AbraAran")
                // Medido: con `equals` sobre la opcion 1 la instancia devuelve cero filas para un login
                // que existe, asi que la igualdad se comprueba con las filas delante.
                .contains("criteria[0][searchtype]=contains");
    }

    @Test
    @DisplayName("De lo que la contenencia traiga de mas solo vale el login exacto")
    void soloValeElLoginExacto() {
        // «jose» trae a JoseDiaz y a JosePerez; el segundo no es el usuario que se pidio.
        sessionOpens();
        searchReturns(new GlpiSearchPage(2, List.of(
                userRow(31, "JosePerez", "Perez", "Jose", 1),
                userRow(296, "JoseDiaz", "Diaz Urrego", "Jose Alejandro", 1))));

        assertThat(source.findUser("JoseDiaz"))
                .map(GlpiUser::id)
                .contains(296);
        assertThat(source.findUser("JoseDiaz"))
                .map(GlpiUser::name)
                .contains("JoseDiaz");
    }

    @Test
    @DisplayName("Un login que no coincide con ninguna fila es vacio, no la primera que aparezca")
    void sinCoincidenciaExactaEsVacio() {
        sessionOpens();
        searchReturns(new GlpiSearchPage(2, List.of(
                userRow(31, "JosePerez", "Perez", "Jose", 1),
                userRow(296, "JoseDiaz", "Diaz Urrego", "Jose Alejandro", 1))));

        assertThat(source.findUser("JoseQuintero")).isEmpty();
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("El login se compara sin distinguir mayusculas, porque GLPI no las distingue")
    void elLoginSeComparaSinMayusculas() {
        sessionOpens();
        searchReturns(new GlpiSearchPage(1, List.of(userRow(36, "AnalRuiz", "Ruiz", "Analy", 1))));

        assertThat(source.findUser("analruiz")).map(GlpiUser::id).contains(36);
    }

    @Test
    @DisplayName("Un identificador vacio no llega a abrir sesion")
    void unIdentificadorVacioNoBusca() {
        assertThat(source.findUser("   ")).isEmpty();
        verifyNoInteractions(glpiClient);
    }

    @Test
    @DisplayName("El numero no pasa por la busqueda: la traduccion solo va en un sentido")
    void elNumeroNoPasaPorLaBusqueda() {
        sessionOpens();
        when(glpiClient.get("/User/296", SESSION, GlpiUser.class))
                .thenReturn(Mono.just(new GlpiUser(296, "JoseDiaz", "Diaz Urrego", "Jose Alejandro")));

        assertThat(source.findUser("296")).map(GlpiUser::id).contains(296);
        verify(glpiClient, never()).get(anyString(), anyString(), eq(GlpiSearchPage.class));
    }

    @Test
    @DisplayName("Los tickets asignados son los que la busqueda devuelve, traducidos campo a campo")
    void traeLosTicketsAsignadosAlTecnico() {
        sessionOpens();
        searchReturns(new GlpiSearchPage(2, List.of(
                row(5602, "Eliminación de usuario PSE", 6, GlpiTicket.TYPE_REQUEST, "2026-10-05 09:00:00"),
                row(4666, "Error en ciclo de pagos", 6, GlpiTicket.TYPE_INCIDENT, "2026-10-04 08:30:00"))));

        List<GlpiTicket> tickets = source.ticketsOf("13");

        assertThat(tickets).extracting(GlpiTicket::id).containsExactly(5602, 4666);
        assertThat(tickets.get(0)).isEqualTo(new GlpiTicket(5602, "Eliminación de usuario PSE", 6,
                GlpiTicket.TYPE_REQUEST, 3, 3, 3, 3600L, "2026-10-06 17:00:00", "2026-10-05 09:00:00"));
        assertThat(tickets.get(1).type()).isEqualTo(GlpiTicket.TYPE_INCIDENT);
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("El filtro por tecnico viaja a GLPI como criterio, no se hace en memoria")
    void buscaPorElCriterioDeTecnico() {
        sessionOpens();
        searchReturns(new GlpiSearchPage(0, List.of()));

        source.ticketsOf("13");

        String path = searchedPath();
        assertThat(path)
                .startsWith("/search/Ticket")
                .contains("criteria[0][field]=5", "criteria[0][searchtype]=equals", "criteria[0][value]=13");
        // La ruta anterior: traia la instancia entera y filtraba despues, con un techo de mil tickets.
        assertThat(path).doesNotStartWith("/Ticket");
    }

    @Test
    @DisplayName("La recuperacion no depende de users_id_assign: ni en la ruta, ni en el contrato, ni en el DTO")
    void noDependeDeUsersIdAssign() {
        sessionOpens();
        searchReturns(new GlpiSearchPage(1, List.of(row(7))));

        source.ticketsOf("13");

        assertThat(searchedPath()).doesNotContain("users_id_assign");
        assertThat(GlpiContract.REST_V1.ticketFields()).doesNotContainKey("users_id_assign");
        assertThat(Stream.of(GlpiTicket.class.getRecordComponents()).map(RecordComponent::getName))
                .as("el campo se retiro del DTO porque nunca llego desde GLPI")
                .doesNotContain("assignedUserId");
    }

    @Test
    @DisplayName("Una busqueda de mas de una pagina se recorre entera")
    void recorreMasDeUnaPagina() {
        sessionOpens();
        searchReturns(
                new GlpiSearchPage(4, List.of(row(1), row(2))),
                new GlpiSearchPage(4, List.of(row(3), row(4))));

        assertThat(source.ticketsOf("13")).extracting(GlpiTicket::id).containsExactly(1, 2, 3, 4);

        ArgumentCaptor<String> paths = ArgumentCaptor.forClass(String.class);
        verify(glpiClient, times(2)).get(paths.capture(), eq(SESSION), eq(GlpiSearchPage.class));
        assertThat(paths.getAllValues().get(0)).contains("range=0-999");
        assertThat(paths.getAllValues().get(1)).contains("range=1000-1999");
    }

    @Test
    @DisplayName("Una busqueda sin resultados es una lista vacia, no un fallo")
    void unaBusquedaVaciaEsUnaListaVacia() {
        sessionOpens();
        // La instancia real omite "data" cuando no hay tickets: {"totalcount":0,"count":0,...}
        searchReturns(new GlpiSearchPage(0, null));

        assertThat(source.ticketsOf("13")).isEmpty();
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("Sin tickets, error de GLPI y respuesta parcial son tres desenlaces distintos")
    void distingueSinTicketsDeErrorYDeRespuestaParcial() {
        sessionOpens();

        // Uno: no tiene trabajo. Lista vacia, y el plan vacio que salga de aqui es la respuesta correcta.
        searchReturns(new GlpiSearchPage(0, List.of()));
        assertThat(source.ticketsOf("13")).isEmpty();

        // Dos: GLPI fallo. Sale como fallo, para que nadie lo lea como "este desarrollador no tiene nada".
        when(glpiClient.get(anyString(), eq(SESSION), eq(GlpiSearchPage.class)))
                .thenReturn(Mono.error(new GlpiConnectionException("GLPI respondio HTTP 500")));
        assertThatThrownBy(() -> source.ticketsOf("13"))
                .isInstanceOf(GlpiConnectionException.class)
                .hasMessageContaining("500");

        // Tres: GLPI declaro mas tickets de los que entrego. Leer medio trabajo y planificarlo como si
        // fuera todo es el fallo que esta fase corrige, asi que se denuncia en lugar de devolverse.
        searchReturns(new GlpiSearchPage(5, List.of(row(1))), new GlpiSearchPage(5, List.of()));
        assertThatThrownBy(() -> source.ticketsOf("13"))
                .isInstanceOf(GlpiInvalidDataException.class)
                .hasMessageContaining("5")
                .hasMessageContaining("incompleta");
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

        assertThatThrownBy(() -> source.findUser("7"))
                .isInstanceOf(GlpiAuthenticationException.class);
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("GLPI inalcanzable sale como excepcion de alcance, con la causa original")
    void glpiInalcanzable() {
        when(glpiClient.initSession()).thenReturn(Mono.error(
                new GlpiUnreachableException("Response timeout after 2000ms", null)));

        assertThatThrownBy(() -> source.ticketsOf("13"))
                .isInstanceOf(GlpiUnreachableException.class)
                .hasMessageContaining("timeout");
    }

    @Test
    @DisplayName("Un cuerpo ilegible es un fallo de datos, no un error interno")
    void unCuerpoIlegibleEsUnFalloDeDatos() {
        sessionOpens();
        when(glpiClient.get(anyString(), eq(SESSION), eq(GlpiSearchPage.class)))
                .thenReturn(Mono.error(new DecodingException("no es un sobre de busqueda")));

        assertThatThrownBy(() -> source.ticketsOf("13"))
                .isInstanceOf(GlpiInvalidDataException.class)
                .hasMessageContaining("no se puede leer");
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("Un identificador no numerico no busca y no inventa tickets")
    void unIdentificadorNoNumericoNoDevuelveTickets() {
        // Con un login, la busqueda no falla: GLPI castea el valor a cero y devuelve los tickets del
        // usuario cero. Por eso no se pregunta: no hay nada que preguntar y preguntarlo daria un dato
        // falso, no un dato vacio.
        assertThat(source.ticketsOf("jdoe")).isEmpty();

        verifyNoInteractions(glpiClient);
    }

    @Test
    @DisplayName("Un fallo al cerrar la sesion no invalida la lectura ya hecha")
    void unFalloAlCerrarNoInvalidaLaLectura() {
        sessionOpens();
        when(glpiClient.get(anyString(), eq(SESSION), eq(GlpiUser.class)))
                .thenReturn(Mono.just(new GlpiUser(7, "jdoe", "Doe", "Jane")));
        when(glpiClient.killSession(SESSION)).thenReturn(
                Mono.error(new GlpiConnectionException("no se pudo cerrar")));

        assertThat(source.findUser("7")).isPresent();
    }

    @Test
    @DisplayName("Una sesion que no se puede abrir no llega a buscar")
    void sinSesionNoSeBusca() {
        when(glpiClient.initSession()).thenReturn(Mono.error(
                new GlpiAuthenticationException("GLPI respondio HTTP 401 en initSession")));

        assertThatThrownBy(() -> source.ticketsOf("13"))
                .isInstanceOf(GlpiAuthenticationException.class);
        verify(glpiClient, never()).get(anyString(), anyString(), eq(GlpiSearchPage.class));
    }

    // --- Los tickets activos: el estado va en la busqueda ------------------------------------

    /**
     * El filtro de activos, que es lo que separa «su historico» de «su carga».
     *
     * <p>Estas pruebas miran la ruta que se le pide a GLPI y no solo lo que vuelve, porque ahi esta la
     * decision: lo que se devuelve es lo que GLPI dijo, y si el criterio estuviera mal el adaptador no
     * tendria como notarlo —una busqueda que filtra mal no falla, contesta otra cosa—.
     */

    @Test
    @DisplayName("Los activos se piden por estado, como un grupo con OR por dentro, y no se descartan despues")
    void losActivosSePidenPorEstado() {
        sessionOpens();
        searchReturns(new GlpiSearchPage(0, List.of()));

        source.activeTicketsOf("13");

        String path = searchedPath();
        assertThat(path)
                .startsWith("/search/Ticket")
                // Los cuatro estados que siguen siendo carga, dentro de un mismo criterio: agrupados, no
                // sueltos. Sueltos se leeria «tecnico AND estado1 OR estado2 OR ...» y a partir del
                // segundo estado entrarian los tickets activos de cualquier otro tecnico.
                .contains("criteria[0][criteria][0][field]=12", "criteria[0][criteria][0][value]=1")
                .contains("criteria[0][criteria][1][link]=OR", "criteria[0][criteria][1][value]=2")
                .contains("criteria[0][criteria][2][value]=3")
                .contains("criteria[0][criteria][3][value]=4")
                // Y el grupo es una condicion mas del tecnico, no una alternativa.
                .contains("criteria[0][link]=AND")
                .contains("criteria[1][field]=5", "criteria[1][searchtype]=equals",
                        "criteria[1][value]=13");
    }

    @Test
    @DisplayName("El filtro de activos no pide lo resuelto ni lo cerrado, ni usa los operadores que mienten")
    void elFiltroDeActivosNoPideLoResueltoNiLoCerrado() {
        sessionOpens();
        searchReturns(new GlpiSearchPage(0, List.of()));

        source.activeTicketsOf("13");

        // Medido contra la instancia: `notequals 5` devuelve 237, que es el recuento de `equals 5`, y
        // `lessthan 5` devuelve lo mismo. Los dos operadores se comportan como una igualdad, asi que
        // excluir por negacion contaba cero tickets activos para un tecnico que tenia dieciseis.
        assertThat(searchedPath())
                .doesNotContain("notequals", "lessthan")
                .doesNotContain("[value]=5", "[value]=6");
    }

    @Test
    @DisplayName("El caso medido: un tecnico con mil doscientos sesenta y seis tickets y todos cerrados")
    void unTecnicoConTodoCerradoNoTieneActivos() {
        // El 296 de la instancia real: 1266 tickets asignados, los 1266 en estado 6. `ticketsOf` los
        // devuelve todos —es el historico, y el plan lo necesita para poder decir por que descarta— y
        // `activeTicketsOf` no devuelve ninguno, porque la busqueda no llega a pedirlos.
        sessionOpens();
        searchReturns(new GlpiSearchPage(0, null));

        assertThat(source.activeTicketsOf("296")).isEmpty();
        assertThat(searchedPath())
                .contains("criteria[0][criteria][0][value]=1", "criteria[0][criteria][3][value]=4")
                .contains("criteria[1][value]=296");
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("Los activos de mas de una pagina se recorren enteros")
    void losActivosTambienSeRecorrenPorPaginas() {
        sessionOpens();
        searchReturns(
                new GlpiSearchPage(3, List.of(row(1), row(2))),
                new GlpiSearchPage(3, List.of(row(3))));

        assertThat(source.activeTicketsOf("13")).extracting(GlpiTicket::id).containsExactly(1, 2, 3);

        ArgumentCaptor<String> paths = ArgumentCaptor.forClass(String.class);
        verify(glpiClient, times(2)).get(paths.capture(), eq(SESSION), eq(GlpiSearchPage.class));
        assertThat(paths.getAllValues().get(0)).contains("range=0-999");
        assertThat(paths.getAllValues().get(1)).contains("range=1000-1999");
    }

    @Test
    @DisplayName("Sin activos no hay fallo: una lista vacia es la respuesta")
    void sinActivosEsUnaListaVacia() {
        sessionOpens();
        searchReturns(new GlpiSearchPage(0, List.of()));

        assertThat(source.activeTicketsOf("13")).isEmpty();
        verify(glpiClient).killSession(SESSION);
    }

    @Test
    @DisplayName("Lo que no esta activo no se cuenta aunque la busqueda lo devuelva")
    void losQueNoEstanActivosNoCuentanAunqueVengan() {
        // El criterio de estado ya los excluye, asi que esto no deberia ocurrir; se prueba porque en
        // esta instancia un operador de busqueda contesto al reves sin fallar, y una lista mixta —unos
        // activos y otros no— es exactamente la forma que tendria ese fallo si volviera por aqui.
        sessionOpens();
        searchReturns(new GlpiSearchPage(3, List.of(
                row(1, "Falla en produccion", 1, GlpiTicket.TYPE_INCIDENT, "2026-10-05 09:00:00"),
                row(2, "Solucionado", 5, GlpiTicket.TYPE_INCIDENT, "2026-10-05 09:00:00"),
                row(3, "Eliminacion de usuario", 6, GlpiTicket.TYPE_REQUEST, "2026-10-05 09:00:00"))));

        assertThat(source.activeTicketsOf("13")).extracting(GlpiTicket::id).containsExactly(1);
    }

    @Test
    @DisplayName("Un tecnico con todo solucionado no tiene carga, y no es lo mismo que todo cerrado")
    void unTecnicoConSoloResueltosNoTieneActivos() {
        sessionOpens();
        searchReturns(new GlpiSearchPage(2, List.of(
                row(1, "Solucionado", 5, GlpiTicket.TYPE_INCIDENT, "2026-10-05 09:00:00"),
                row(2, "Solucionado", 5, GlpiTicket.TYPE_REQUEST, "2026-10-05 09:00:00"))));

        assertThat(source.activeTicketsOf("13")).isEmpty();
    }

    @Test
    @DisplayName("Un identificador no numerico tampoco busca activos")
    void unIdentificadorNoNumericoNoBuscaActivos() {
        assertThat(source.activeTicketsOf("jdoe")).isEmpty();

        verifyNoInteractions(glpiClient);
    }
}
