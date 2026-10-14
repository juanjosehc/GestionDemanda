package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * La respuesta de una busqueda de GLPI ({@code GET /search/...}), que no es un arreglo sino un sobre.
 *
 * <p>Es la diferencia de forma que impide leer una busqueda con {@code getList}: las filas no estan en
 * la raiz, estan en {@code data}, y al lado vienen {@code totalcount}, {@code count}, el orden y el
 * rango. Se declaran los dos unicos que se usan, y el resto se ignora.
 *
 * <p><strong>Es el sobre de cualquier busqueda, no el de una en particular.</strong> Nacio siendo el de
 * {@code /search/Ticket} y lo comparten {@code /search/Ticket} y {@code /search/User}: la forma del
 * sobre no depende de lo que se busca —{@code totalcount} y {@code data} significan lo mismo en las
 * dos—, y quien traduce cada fila es quien conoce los numeros de opcion de su tabla. Tener dos clases
 * identicas habria dejado dos sitios donde leer la misma forma.
 *
 * <p><strong>{@code data} no viene cuando no hay resultados.</strong> La instancia real responde
 * {@code {"totalcount":0,"count":0,"content-range":"0--1/0"}} y omite la clave, asi que {@link #rows()}
 * devuelve lista vacia en lugar de {@code null}: la ausencia de resultados es un resultado, no un campo
 * que falte.
 *
 * <p><strong>Las filas llegan indexadas por numero de opcion de busqueda.</strong> {@code "1"} es el
 * titulo, {@code "2"} el identificador, {@code "15"} la fecha de apertura. No son los nombres de campo
 * de {@code /Ticket}, porque esto es una proyeccion de la busqueda y no el ticket. Por eso el tipo de
 * la fila es un mapa y quien lo traduce es {@link GlpiRestPlanningSource}, que es quien conoce los
 * numeros.
 *
 * <p>Ver el contrato de estas rutas contra una instancia real es lo que documenta la decision 159: la
 * busqueda exige criterio —sin el devuelve la instancia entera— y el valor del criterio de tecnico es
 * el <em>identificador numerico</em> del usuario, no su login.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GlpiSearchPage(
        @JsonProperty("totalcount") Integer totalcount,
        @JsonProperty("data") List<Map<String, Object>> data) {

    /** Cuantas filas tiene la busqueda en total, mas alla de las que quepan en esta pagina. */
    public int total() {
        return totalcount == null ? 0 : totalcount;
    }

    /** Las filas de esta pagina, vacias si GLPI no mando ninguna. */
    public List<Map<String, Object>> rows() {
        return data == null ? List.of() : data;
    }
}
