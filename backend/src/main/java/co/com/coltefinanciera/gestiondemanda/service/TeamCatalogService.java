package co.com.coltefinanciera.gestiondemanda.service;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import co.com.coltefinanciera.gestiondemanda.config.TeamProperties;
import co.com.coltefinanciera.gestiondemanda.dto.TeamCatalogResponse;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiConnectionException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiInvalidDataException;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningSource;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiUser;

/**
 * Caso de uso: el padron del equipo, juntando el grupo de GLPI con las excepciones declaradas.
 *
 * <p><strong>Son tres pasos y ninguno decide nada de negocio.</strong> Leer el grupo, leer las
 * excepciones y unirlas. Un plan no entra aqui, una capacidad tampoco: esto responde <em>quienes
 * son</em>, y el <em>como estan</em> lo sigue respondiendo {@code /api/planning/metrics}. La pantalla
 * cruza las dos respuestas por el identificador de la persona, que es lo que el catalogo publica.
 *
 * <p><strong>GLPI es la fuente principal y la union no la puede contradecir.</strong> Si un login
 * declarado como excepcion ya vino del grupo, la excepcion no se aplica: gana GLPI, y el login se
 * publica en {@code unusedExceptions} para que la decision sin efecto se vea. Lo contrario —dejar que
 * la lista escrita a mano pise al sistema de origen— haria que el padron dejara de decir lo que GLPI
 * dice, y entonces nadie podria usarlo para saber quien esta en el equipo.
 *
 * <p><strong>El fallo de GLPI no es un fallo del catalogo.</strong> Si el grupo no se puede leer, se
 * devuelve el padron con las excepciones y el bloque {@code glpi} explica que no se pudo y por que. La
 * consecuencia hay que decirla entera: en ese estado el catalogo tiene <em>solo</em> las personas
 * declaradas a mano, que no es el equipo completo, y por eso el fallo viaja en la respuesta en lugar de
 * quedarse en el registro del servidor.
 *
 * <p><strong>Se capturan las excepciones de la integracion, no cualquier cosa.</strong> Un fallo de red,
 * de autenticacion, de contrato o de lectura corta significan lo mismo desde aqui —no se pudo leer— y
 * se degrada. Un {@code NullPointerException} no: eso es un error de este codigo, y esconderlo detras de
 * «GLPI no responde» dejaria la pantalla diciendo que el problema esta en otro sitio.
 *
 * <p><strong>Quien es operativo no cambia el padron: cambia lo que se enseña por defecto.</strong> El
 * catalogo sigue publicando a todo el mundo —GLPI enumera y esa lista no se recorta— y cada persona
 * lleva ademas si pertenece al equipo operativo. La marca se resuelve aqui, al construir la fila, y no
 * filtra nada: quien decide que se enseña es la pantalla, que para eso tiene los dos modos. Recortar la
 * lista desde aqui habria hecho que «mostrar todos» fuera otra peticion y que el padron dependiera de
 * una preferencia de vista.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TeamCatalogService {

    private final GlpiPlanningSource glpiPlanningSource;
    private final TeamProperties properties;
    private final Clock clock;

    /** El padron del equipo. */
    public TeamCatalogResponse catalog() {
        Reading reading = readGroup();
        Map<String, TeamCatalogResponse.Person> people = new LinkedHashMap<>();

        // Los logins de GLPI por su forma comparables, para poder reconocer si una excepcion sobra sin
        // tocar el identificador con el que se publica a la persona.
        Map<String, String> glpiLogins = new LinkedHashMap<>();
        for (GlpiUser user : reading.members()) {
            TeamCatalogResponse.Person person = fromGlpi(user);
            if (person == null) {
                continue;
            }
            glpiLogins.put(person.developerId().toLowerCase(Locale.ROOT), person.developerId());
            people.putIfAbsent(person.developerId(), person);
        }

        List<String> unused = new ArrayList<>();
        properties.declaredExceptions().forEach((login, declared) -> {
            if (glpiLogins.containsKey(login.toLowerCase(Locale.ROOT))) {
                unused.add(login);
                return;
            }
            people.put(login, fromException(login, declared));
        });

        if (!unused.isEmpty()) {
            log.warn("Excepciones del equipo que GLPI ya entrega y por tanto no se aplican: {}", unused);
        }

        // Las marcas de pertenencia que no alcanzan a nadie. Se publican por el mismo motivo que las
        // excepciones sobrantes: la lista del equipo operativo se escribe a mano, y una errata en un
        // login no cambia nada visible —la persona sigue fuera y quien la escribio no se entera—.
        List<String> marcasSinEfecto = properties.operational().keySet().stream()
                .filter(login -> people.keySet().stream()
                        .noneMatch(publicado -> publicado.equals(login)))
                .sorted()
                .toList();

        if (!marcasSinEfecto.isEmpty()) {
            log.warn("Marcas del equipo operativo que no corresponden a nadie del padron: {}",
                    marcasSinEfecto);
        }

        List<TeamCatalogResponse.Person> catalog = people.values().stream()
                .sorted(Comparator.comparing(TeamCatalogResponse.Person::developerId))
                .toList();

        long operativos = catalog.stream().filter(TeamCatalogResponse.Person::operational).count();

        log.info("Catalogo del equipo: {} personas ({} de GLPI, {} declaradas), {} operativas, "
                        + "grupo {} legible: {}",
                catalog.size(), reading.members().size(), unused.size(), operativos,
                properties.groupId(), reading.glpi().available());

        return new TeamCatalogResponse(
                Instant.now(clock),
                new TeamCatalogResponse.Source(
                        TeamCatalogResponse.Source.GLPI, TeamCatalogResponse.Source.EXCEPTIONS),
                reading.glpi(),
                catalog,
                unused,
                marcasSinEfecto);
    }

    /**
     * Una persona del grupo de GLPI.
     *
     * <p>Sin login no hay persona que publicar: el login es el identificador con el que se le piden sus
     * tickets y su declaracion, y una fila sin el no se puede usar para nada. Se descarta con su aviso
     * en lugar de publicarse con un identificador inventado —el numero— que haria que el sistema la
     * tratara como a otra persona distinta de la que GLPI conoce.
     */
    private TeamCatalogResponse.Person fromGlpi(GlpiUser user) {
        String login = user.name() == null ? null : user.name().trim();
        if (login == null || login.isEmpty()) {
            log.warn("GLPI devolvio un usuario del grupo sin login (id {}): no entra al catalogo", user.id());
            return null;
        }
        return new TeamCatalogResponse.Person(
                login, user.id(), user.displayName(), user.isActive(), TeamCatalogResponse.Person.GLPI,
                properties.isOperational(login));
    }

    /**
     * Una persona declarada a mano.
     *
     * <p>El nombre se publica tal como se declaro, sin componer: quien la escribio en la configuracion
     * escribio un nombre, no un nombre y un apellido de campos distintos. Y puede venir en nulo, que es
     * un dato —una excepcion declarada solo para que alguien aparezca y pueda colgarle un plan— y no un
     * hueco que haya que rellenar.
     */
    private TeamCatalogResponse.Person fromException(
            String login, TeamProperties.DeclaredException declared) {

        return new TeamCatalogResponse.Person(
                login, declared.glpiId(), declared.name(), declared.isActive(),
                TeamCatalogResponse.Person.EXCEPTION, properties.isOperational(login));
    }

    /**
     * Lee el grupo, o declara por que no pudo.
     *
     * <p>Devuelve las dos cosas juntas —las personas y el estado de la lectura— porque quien llama
     * necesita las dos y separarlas obligaria a preguntar dos veces por lo mismo. Con el grupo ilegible,
     * la lista vacia <em>no</em> significa «el grupo no tiene miembros»: significa que no se pregunto, y
     * quien lo distingue es {@code glpi.available}.
     */
    private Reading readGroup() {
        TeamCatalogResponse.Glpi ok = new TeamCatalogResponse.Glpi(
                true, properties.groupId(), properties.groupName(), null);

        try {
            List<GlpiUser> members = glpiPlanningSource.membersOfGroup(String.valueOf(properties.groupId()));
            return new Reading(members, ok);

        } catch (GlpiConnectionException | GlpiInvalidDataException ex) {
            log.warn("El catalogo del equipo no pudo leer el grupo {} de GLPI: {}",
                    properties.groupId(), ex.getMessage());
            return new Reading(List.of(), new TeamCatalogResponse.Glpi(
                    false, properties.groupId(), properties.groupName(), ex.getMessage()));
        }
    }

    /** Lo que se pudo leer del grupo y como fue la lectura. */
    private record Reading(List<GlpiUser> members, TeamCatalogResponse.Glpi glpi) {
    }
}
