package co.com.coltefinanciera.gestiondemanda.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import co.com.coltefinanciera.gestiondemanda.config.TeamProperties;
import co.com.coltefinanciera.gestiondemanda.dto.TeamCatalogResponse;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiUnreachableException;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningSource;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiUser;

/**
 * Pruebas del padron del equipo, sin Spring y sin GLPI.
 *
 * <p><strong>Lo que se comprueba aqui es la union, que es lo unico que este servicio hace.</strong> Ni
 * el motor ni la base de datos entran: se le da un grupo y unas excepciones y se mira que sale. Las dos
 * fuentes se falsean —una con un doble, la otra con la configuracion— porque el objeto de la prueba es
 * la regla de fusion, y esa regla no depende de que GLPI responda de verdad.
 *
 * <p><strong>El caso de Nicolas Suarez Flores se prueba aqui y no en el endpoint</strong> porque lo que
 * hay que afirmar es una ausencia: su grupo esta vacio en GLPI, asi que no aparece en ninguna lectura
 * por grupo y solo se le puede ver si alguien lo declaro. Eso es un estado que el grupo real no puede
 * producir, y por eso se escribe.
 */
class TeamCatalogServiceTest {

    private static final Instant SELLO = Instant.parse("2026-10-14T15:00:00Z");

    private final GlpiPlanningSource glpi = mock(GlpiPlanningSource.class);

    @Test
    @DisplayName("Solo con GLPI el padron es el grupo, y cada persona dice de donde viene")
    void soloConGlpiElPadronEsElGrupo() {
        grupo(
                usuario(1071, "NicoSuar", "Nicolas Alejandro", "Suarez Florez", true),
                usuario(1202, "AnaPerez", "Ana", "Perez", true));

        TeamCatalogResponse catalogo = service(Map.of()).catalog();

        assertThat(catalogo.people()).extracting(TeamCatalogResponse.Person::developerId)
                .containsExactly("AnaPerez", "NicoSuar");
        assertThat(catalogo.people()).allSatisfy(persona ->
                assertThat(persona.sourceType()).isEqualTo(TeamCatalogResponse.Person.GLPI));
        assertThat(catalogo.glpi().available()).isTrue();
        assertThat(catalogo.glpi().groupId()).isEqualTo(1);
        assertThat(catalogo.glpi().groupName()).isEqualTo("Desarrollo N2");
        assertThat(catalogo.glpi().detail()).isNull();
        assertThat(catalogo.unusedExceptions()).isEmpty();
        assertThat(catalogo.generatedAt()).isEqualTo(SELLO);
        verify(glpi).membersOfGroup("1");
    }

    @Test
    @DisplayName("Solo con excepciones, y sin GLPI, el padron sigue en pie")
    void soloConExcepcionesElPadronSigueEnPie() {
        grupo();   // el grupo respondio, y no tenia a nadie legible

        TeamCatalogResponse catalogo = service(Map.of(
                "Tesoreria1", new TeamProperties.DeclaredException("Marta Gil", null, null)))
                .catalog();

        assertThat(catalogo.people()).singleElement().satisfies(persona -> {
            assertThat(persona.developerId()).isEqualTo("Tesoreria1");
            assertThat(persona.name()).isEqualTo("Marta Gil");
            assertThat(persona.glpiId()).isNull();
            assertThat(persona.active()).isTrue();
            assertThat(persona.sourceType()).isEqualTo(TeamCatalogResponse.Person.EXCEPTION);
        });
        // El grupo si respondio: no hay fallo que declarar, solo una lista vacia, que es un resultado.
        assertThat(catalogo.glpi().available()).isTrue();
    }

    @Test
    @DisplayName("Las dos fuentes se juntan en un solo padron, cada una con su origen")
    void lasDosFuentesSeJuntan() {
        grupo(usuario(1202, "AnaPerez", "Ana", "Perez", true));

        TeamCatalogResponse catalogo = service(Map.of(
                "Tesoreria1", new TeamProperties.DeclaredException("Marta Gil", null, null)))
                .catalog();

        assertThat(catalogo.people()).extracting(
                        TeamCatalogResponse.Person::developerId,
                        TeamCatalogResponse.Person::sourceType)
                .containsExactly(
                        tuple("AnaPerez", TeamCatalogResponse.Person.GLPI),
                        tuple("Tesoreria1", TeamCatalogResponse.Person.EXCEPTION));
    }

    @Test
    @DisplayName("Una excepcion que GLPI ya entrega no se aplica, y el padron lo publica")
    void laExcepcionQueGlpiYaEntregaNoSeAplica() {
        grupo(usuario(1202, "AnaPerez", "Ana", "Perez", true));

        // La misma persona declarada a mano, con un nombre distinto para que se note cual gano.
        TeamCatalogResponse catalogo = service(Map.of(
                "AnaPerez", new TeamProperties.DeclaredException("Ana P. (declarada)", 1202, true)))
                .catalog();

        assertThat(catalogo.people()).singleElement().satisfies(persona -> {
            // Gana GLPI: la excepcion no puede contradecir al sistema de origen.
            assertThat(persona.sourceType()).isEqualTo(TeamCatalogResponse.Person.GLPI);
            assertThat(persona.name()).isEqualTo("Ana Perez");
        });
        // Y la decision sin efecto se publica en lugar de aplicarse en silencio.
        assertThat(catalogo.unusedExceptions()).containsExactly("AnaPerez");
    }

    @Test
    @DisplayName("El mismo login escrito en minusculas tampoco duplica a quien GLPI entrega")
    void elLoginEnMinusculasTampocoDuplica() {
        grupo(usuario(1202, "AnaPerez", "Ana", "Perez", true));

        TeamCatalogResponse catalogo = service(Map.of(
                "anaperez", new TeamProperties.DeclaredException("Ana Perez", 1202, true)))
                .catalog();

        // Comparar sin distinguir mayusculas evita que la pantalla enseñe dos veces a la misma persona,
        // pero el identificador publicado conserva su forma: es la clave con la que se piden los planes.
        assertThat(catalogo.people()).singleElement()
                .extracting(TeamCatalogResponse.Person::developerId).isEqualTo("AnaPerez");
        assertThat(catalogo.unusedExceptions()).containsExactly("anaperez");
    }

    @Test
    @DisplayName("Nicolas Suarez, que no esta en el grupo, entra por la excepcion declarada")
    void nicolasSuarezEntraPorLaExcepcion() {
        // El grupo responde sin el: en GLPI existe y esta activo, pero su grupo esta vacio, asi que no
        // aparece en ninguna lectura por grupo. Es exactamente el caso que la excepcion existe para
        // cubrir —una persona vigente que desapareceria del equipo por como esta GLPI—.
        grupo(usuario(1202, "AnaPerez", "Ana", "Perez", true));

        TeamCatalogResponse catalogo = service(Map.of(
                "NicoSuar", new TeamProperties.DeclaredException(
                        "Nicolas Alejandro Suarez Flores", 1071, null)))
                .catalog();

        assertThat(catalogo.people()).extracting(TeamCatalogResponse.Person::developerId)
                .containsExactly("AnaPerez", "NicoSuar");

        assertThat(catalogo.people()).last().satisfies(persona -> {
            assertThat(persona.developerId()).isEqualTo("NicoSuar");
            assertThat(persona.glpiId()).isEqualTo(1071);
            assertThat(persona.name()).isEqualTo("Nicolas Alejandro Suarez Flores");
            // Declarado sin vigencia: una excepcion se escribe para que alguien aparezca.
            assertThat(persona.active()).isTrue();
            assertThat(persona.sourceType()).isEqualTo(TeamCatalogResponse.Person.EXCEPTION);
        });

        // Y no sobra: no vino del grupo, asi que la excepcion si hizo algo.
        assertThat(catalogo.unusedExceptions()).isEmpty();
    }

    @Test
    @DisplayName("Con GLPI caido el padron sale de las excepciones, y el fallo viaja en la respuesta")
    void conGlpiCaidoElPadronSaleDeLasExcepciones() {
        when(glpi.membersOfGroup("1"))
                .thenThrow(new GlpiUnreachableException("Connection refused", null));

        TeamCatalogResponse catalogo = service(Map.of(
                "NicoSuar", new TeamProperties.DeclaredException(
                        "Nicolas Alejandro Suarez Flores", 1071, null)))
                .catalog();

        assertThat(catalogo.people()).singleElement()
                .extracting(TeamCatalogResponse.Person::developerId).isEqualTo("NicoSuar");

        // La degradacion se declara entera: no respondio, que se intento leer y por que no se pudo.
        // Sin el motivo, «GLPI no responde» y «el grupo esta vacio» se leerian igual.
        assertThat(catalogo.glpi().available()).isFalse();
        assertThat(catalogo.glpi().groupId()).isEqualTo(1);
        assertThat(catalogo.glpi().detail()).isEqualTo("Connection refused");
    }

    @Test
    @DisplayName("Una excepcion retirada entra al padron marcada, no desaparece")
    void unaExcepcionRetiradaEntraMarcada() {
        grupo();

        TeamCatalogResponse catalogo = service(Map.of(
                "NicoSuar", new TeamProperties.DeclaredException("Nicolas Suarez", 1071, false)))
                .catalog();

        // active=false retira a la persona sin borrar la fila: quien la lea puede ver que estuvo.
        assertThat(catalogo.people()).singleElement()
                .extracting(TeamCatalogResponse.Person::active).isEqualTo(false);
    }

    @Test
    @DisplayName("Un usuario del grupo sin login no entra: no habria con que pedirle nada")
    void unUsuarioSinLoginNoEntra() {
        grupo(
                usuario(1202, "AnaPerez", "Ana", "Perez", true),
                new GlpiUser(1300, "  ", "Sin", "Login"),
                new GlpiUser(1301, null, "Sin", "Login"));

        TeamCatalogResponse catalogo = service(Map.of()).catalog();

        assertThat(catalogo.people()).extracting(TeamCatalogResponse.Person::developerId)
                .containsExactly("AnaPerez");
    }

    private TeamCatalogService service(Map<String, TeamProperties.DeclaredException> excepciones) {
        return new TeamCatalogService(
                glpi,
                new TeamProperties(1, "Desarrollo N2", excepciones),
                Clock.fixed(SELLO, ZoneOffset.UTC));
    }

    private void grupo(GlpiUser... miembros) {
        when(glpi.membersOfGroup("1")).thenReturn(List.of(miembros));
    }

    private static GlpiUser usuario(
            int id, String login, String nombre, String apellido, Boolean vigente) {

        return new GlpiUser(id, login, apellido, nombre, vigente);
    }
}
