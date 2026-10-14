package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.util.List;

/**
 * Salida de {@code GET /api/team}: el padron del equipo, con el origen de cada persona.
 *
 * <p><strong>Es el catalogo que faltaba.</strong> Todas las lecturas del sistema eran de a uno —dado un
 * identificador, que tiene dentro—, y por eso no existia una pantalla que representara personas:
 * {@code /recursos} consolidaba <em>planes</em> y quien no tenia uno no aparecia. Aqui se publica la
 * lista, y publicar la lista es lo que permite que el equipo se lea como equipo.
 *
 * <p><strong>No recalcula nada.</strong> No se ejecuta el motor y no se leen planes: sale del grupo de
 * GLPI y de la configuracion, y su unico trabajo es juntarlos. La capacidad y los desplazamientos
 * siguen saliendo de {@code /api/planning/metrics}, y por eso la pantalla cruza dos respuestas en vez
 * de recibir una sola con todo dentro: el dia que GLPI no responda, esto sigue en pie y la fotografia
 * de los planes tambien.
 *
 * <p><strong>La degradacion es parte del contrato, no un estado de error.</strong> Si GLPI no responde,
 * el catalogo se devuelve igual —con las excepciones— y el bloque {@code glpi} dice que no se pudo leer
 * y por que. La alternativa, responder un error, dejaria la pantalla del equipo vacia por un fallo que
 * solo afecta a una de las dos fuentes. Lo que no se hace en ningun caso es omitir el fallo: quien lea
 * la respuesta tiene que poder distinguir «el grupo tiene estas personas» de «no se pudo preguntar».
 *
 * @param generatedAt      cuando se armo el catalogo. Es lo unico que depende del reloj.
 * @param source           de donde sale cada mitad del padron, declarado dentro del propio payload.
 * @param glpi             como fue la lectura del grupo: si respondio, cual se leyo y que dijo si no.
 * @param people           las personas del equipo, ordenadas por identificador.
 * @param unusedExceptions logins declarados como excepcion que ya vinieron de GLPI. Van en la respuesta
 *                         para que se puedan ver: una excepcion que no hace nada es una decision de
 *                         alguien que quedo sin efecto, y callarla deja el padron con una entrada
 *                         muerta que solo se descubre el dia que alguien la lee y no entiende para que
 *                         esta.
 */
public record TeamCatalogResponse(
        Instant generatedAt,
        Source source,
        Glpi glpi,
        List<Person> people,
        List<String> unusedExceptions) {

    public TeamCatalogResponse {
        people = people == null ? List.of() : List.copyOf(people);
        unusedExceptions = unusedExceptions == null ? List.of() : List.copyOf(unusedExceptions);
    }

    /**
     * De donde sale cada mitad del padron.
     *
     * <p>Las dos constantes viven aqui, junto al contrato, por el mismo motivo que las de
     * {@link DeveloperDeclarationsResponse.Source}: renombrarlas es un solo sitio y la prueba puede
     * afirmarlas tal como salen.
     */
    public record Source(String glpi, String exceptions) {

        /** La fuente principal: el grupo configurado, con sus subgrupos. */
        public static final String GLPI =
                "/search/User por criterio de grupo (opcion 13), con subgrupos: id, login, nombre, "
                        + "apellido y vigencia";

        /** La fuente que complementa: las excepciones declaradas en la configuracion. */
        public static final String EXCEPTIONS =
                "team.exceptions de la configuracion: personas declaradas a mano con su login, su "
                        + "identificador de GLPI si lo tienen y su vigencia";
    }

    /**
     * Como fue la lectura del grupo.
     *
     * <p>Un bloque y no un booleano suelto porque hay tres cosas que decir y las tres se usan: si
     * respondio, que grupo se leyo —un catalogo sin su grupo no se puede auditar— y, cuando no
     * respondio, por que. {@code detail} lleva el mensaje de la excepcion tal como lo redacto la capa de
     * integracion, que es la que sabe si fue la red, la autenticacion o el contrato.
     *
     * @param available si la lectura del grupo se pudo completar
     * @param groupId   el grupo que se intento leer
     * @param groupName como se llama, para poder decirlo en la pantalla
     * @param detail    el motivo por el que no se pudo leer, o {@code null} si si se pudo
     */
    public record Glpi(boolean available, Integer groupId, String groupName, String detail) {
    }

    /**
     * Una persona del equipo.
     *
     * <p><strong>El identificador de la persona es su login, no el numero.</strong>
     * {@code developerId} es el texto con el que el resto del sistema la nombra —es lo que se guarda en
     * el plan, lo que viaja en la declaracion y lo que se publica en cada metrica por desarrollador—, y
     * por eso el catalogo lo publica como clave. El numero de GLPI viaja aparte, en {@code glpiId},
     * porque hace falta para dos cosas concretas —pedir sus tickets, que solo se buscan por numero, y
     * enlazar un plan que se calculo tecleando el numero en vez del login— y para nada mas.
     *
     * @param developerId el login con el que el sistema nombra a esta persona
     * @param glpiId      su identificador numerico en GLPI, o {@code null} si no tiene cuenta
     * @param name        su nombre legible, o {@code null} si GLPI no publica ninguno utilizable
     * @param active      si su cuenta esta vigente
     * @param sourceType  de donde salio esta fila: {@link #GLPI} o {@link #EXCEPTION}
     */
    public record Person(
            String developerId,
            Integer glpiId,
            String name,
            boolean active,
            String sourceType) {

        /** La persona vino del grupo de GLPI, que es la fuente principal. */
        public static final String GLPI = "GLPI";

        /** La persona vino de las excepciones declaradas, que complementan a GLPI. */
        public static final String EXCEPTION = "EXCEPTION";
    }
}
