package co.com.coltefinanciera.gestiondemanda.config;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * El padron de excepciones del equipo: las personas que el catalogo tiene que enseñar aunque GLPI no
 * las entregue.
 *
 * <p><strong>Esto no sustituye a GLPI, lo complementa.</strong> El catalogo se arma con el grupo
 * configurado en {@code team.group-id} y despues se le suman las excepciones de aqui. Una excepcion
 * nunca reemplaza a un miembro que GLPI si entrego: si el login ya vino del grupo, la excepcion sobra y
 * se declara como sobrante en lugar de aplicarse en silencio. La regla esta escrita asi porque el
 * sentido contrario —que una lista mantenida a mano mande sobre el sistema de origen— convierte un
 * padron en el que nadie confia en cuanto los dos discrepan.
 *
 * <p><strong>Por que vive en la configuracion y no en una tabla.</strong> Se evaluaron las cuatro
 * formas (decision 168). Lo que inclino la balanza es que una excepcion es una decision de negocio
 * sobre quien esta en el equipo, no un dato operativo: se escribe una vez cada muchos meses, la
 * revisa una persona y lo que se le pide es que quede en el historial con su autor. En
 * {@code application.properties} eso sale gratis —el cambio va en un diff, con quien lo hizo y
 * cuando— y a cambio hay que reiniciar para que aplique, que para un hecho que cambia dos veces al año
 * es un precio que no se paga nunca. Una tabla propia habria traido entidad, repositorio y migracion
 * —y este proyecto no usa Flyway, asi que el esquema lo gobierna {@code ddl-auto}— para ganar una
 * edicion en caliente que nadie pidio.
 *
 * <p><strong>Las excepciones se declaran sesgadas a que alguien aparezca, no a que desaparezca.</strong>
 * Una excepcion solo puede <em>añadir</em> (el login no vino de GLPI) o <em>marcar</em> (vino, y esta
 * inactiva). No hay forma de borrar a alguien de GLPI desde aqui: si GLPI dice que una persona esta en
 * el equipo, el padron no puede contradecirlo. Es lo que hace que el sistema de origen siga siendo el
 * sistema de origen.
 *
 * @param groupId    identificador numerico del grupo de GLPI que se lee. En esta instancia, 1 es
 *                   «Desarrollo N2», con sus tres subgrupos.
 * @param groupName  como se llama ese grupo, para que el catalogo y la pantalla puedan decir de donde
 *                   salen las personas sin que nadie tenga que adivinar que es el 1.
 * @param exceptions las personas declaradas a mano, indexadas por su login en GLPI —el mismo texto que
 *                   el catalogo publica como {@code developerId}, porque es la clave con la que se
 *                   piden los tickets, las declaraciones y los planes—.
 */
@ConfigurationProperties(prefix = "team")
public record TeamProperties(
        @DefaultValue("1") Integer groupId,
        @DefaultValue("Desarrollo N2") String groupName,
        @DefaultValue Map<String, DeclaredException> exceptions) {

    public TeamProperties {
        exceptions = exceptions == null ? Map.of() : Map.copyOf(exceptions);
    }

    /**
     * Una persona que el catalogo tiene que incluir aunque no venga del grupo.
     *
     * <p>Los tres casos que cubre, que son los tres motivos por los que una excepcion existe:
     * <ul>
     *   <li><strong>GLPI no la tiene en el grupo y deberia.</strong> El caso de Nicolas Alejandro
     *       Suarez Flores: existe, esta activo y su grupo esta vacio, asi que no aparece en ninguna
     *       lectura por grupo. Se declara aqui mientras alguien corrige la pertenencia alla.</li>
     *   <li><strong>GLPI no la puede leer.</strong> Un usuario que la cuenta de integracion no tiene
     *       permiso de ver no aparece en la busqueda ni en su {@code totalcount}: no es un fallo que se
     *       pueda detectar, es una ausencia silenciosa.</li>
     *   <li><strong>No esta en GLPI.</strong> Alguien que trabaja en el equipo y no tiene cuenta —una
     *       persona de otra area, un contratista con acceso por otra via—, con su {@code glpiId} en
     *       nulo porque no hay ninguno.</li>
     * </ul>
     *
     * <p>{@code active} permite retirar a alguien sin borrar la fila, que es lo que hace auditable la
     * excepcion: un padron en el que las bajas se borran no puede contar por que alguien estuvo.
     *
     * @param name   el nombre con el que se reconoce a la persona. Puede faltar —se enseñaria su login—
     *               pero para una excepcion suele ser el motivo de serlo.
     * @param glpiId el identificador numerico en GLPI, o nulo si no tiene cuenta. Es lo que permite
     *               pedirle sus tickets y lo que enlaza su plan cuando se planifico por numero.
     * @param active si la persona sigue vigente. Nulo se lee como vigente: una excepcion se declara para
     *               que alguien aparezca.
     */
    public record DeclaredException(String name, Integer glpiId, Boolean active) {

        /** Si la persona sigue vigente, con el nulo leido como lo que es. */
        public boolean isActive() {
            return active == null || active;
        }
    }

    /**
     * Las excepciones declaradas, sin las entradas vacias.
     *
     * <p><strong>La clave conserva su texto tal como se escribio</strong>, porque es el identificador con
     * el que se pide todo lo demas —los tickets, la declaracion, el plan— y ese si distingue mayusculas.
     * Comparar contra GLPI sin distinguirlas es tarea de quien junta las dos fuentes, que es quien sabe
     * que la comparacion no es el identificador.
     */
    public Map<String, DeclaredException> declaredExceptions() {
        Map<String, DeclaredException> declared = new LinkedHashMap<>();
        exceptions.forEach((login, exception) -> {
            if (login != null && !login.isBlank()) {
                declared.put(login.trim(), exception);
            }
        });
        return declared;
    }
}
