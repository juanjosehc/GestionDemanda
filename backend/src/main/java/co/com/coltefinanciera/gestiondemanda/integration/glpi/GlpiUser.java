package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Un usuario de GLPI, tal como lo devuelve {@code GET /User/{id}}.
 *
 * <p>Es un DTO externo: refleja el JSON de GLPI y nada mas. Sus nombres de campo son los de GLPI, no
 * los del dominio, y por eso vive aqui y no en {@code dto/}. Nadie fuera de este paquete deberia
 * recibir un {@code GlpiUser}: lo que sale de la capa anticorrupcion es un {@code Developer}.
 *
 * <p>GLPI devuelve muchos mas campos —telefonos, entidades, perfiles— y se ignoran. Se declaran solo
 * los que se traducen; {@code ignoreUnknown} evita que un campo nuevo en el servidor rompa la
 * lectura, que es la unica forma de que esta capa no haya que tocarla en cada actualizacion de GLPI.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GlpiUser(
        @JsonProperty("id") Integer id,
        @JsonProperty("name") String name,
        @JsonProperty("realname") String realname,
        @JsonProperty("firstname") String firstname,
        @JsonProperty("is_active") Boolean active) {

    /**
     * Un usuario del que no se pregunto la vigencia.
     *
     * <p>La busqueda del grupo si la pide —opcion 8—; {@code /User/{id}} tambien la publica. Pero quien
     * arma un usuario a mano esta describiendo a alguien, no interrogando a GLPI, y para ese caso el
     * nulo es lo correcto: no es un dato, es una pregunta que no se hizo.
     */
    public GlpiUser(Integer id, String name, String realname, String firstname) {
        this(id, name, realname, firstname, null);
    }

    /**
     * Si la cuenta esta vigente, con el nulo de GLPI leido como lo que es.
     *
     * <p>El campo puede no venir —{@code /User/{id}} lo publica y una busqueda solo si se pide su
     * opcion 8—, y entonces no se sabe. Se devuelve {@code true} en ese caso a proposito: el unico
     * consumidor que decide algo con esto es el catalogo del equipo, y ante la duda prefiere mostrar a
     * alguien que resulta estar dado de baja que hacerlo desaparecer. Un catalogo con una persona de
     * mas se corrige leyendo; uno con una de menos no se nota.
     */
    public boolean isActive() {
        return active == null || active;
    }

    /**
     * El nombre con que se conoce a la persona, para el dominio.
     *
     * <p>GLPI separa nombre y apellido, y el dominio espera uno solo. Se compone aqui —en la frontera,
     * que es donde se decide como se ve un usuario de GLPI desde fuera— y se cae al {@code name}, que
     * es el login y siempre existe. Devolver cadena vacia no sirve: {@code Developer} exige texto, y
     * un nombre en blanco seria un dato invalido disfrazado de valido.
     *
     * <p>Puede devolver nulo, y quien lo llama decide que hacer con eso: la construccion de la peticion
     * del plan lo rechaza, porque el dominio exige un nombre para calcular; la lectura de las
     * declaraciones de un tecnico lo deja en nulo, porque lo que esta leyendo son sus tickets y no va a
     * negarse a listarlos por como se llama quien los tiene.
     */
    public String displayName() {
        String composed = ((firstname == null ? "" : firstname.trim()) + " "
                + (realname == null ? "" : realname.trim())).trim();
        if (!composed.isEmpty()) {
            return composed;
        }
        return name == null || name.isBlank() ? null : name.trim();
    }
}
