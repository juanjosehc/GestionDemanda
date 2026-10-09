package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.util.List;
import java.util.Optional;

/**
 * Lo que la capa anticorrupcion necesita saber de GLPI, expresado como dos preguntas.
 *
 * <p>Es un puerto, y es el artefacto que hace explicita la frontera: de un lado, el dominio y su
 * caso de uso, que solo conocen esta interfaz; del otro, el adaptador HTTP, que es el unico que sabe
 * que hay un API REST detras. Cambiar de GLPI a otro sistema es escribir otro adaptador; el caso de
 * uso no se entera.
 *
 * <p>Devuelve los DTOs externos ({@link GlpiUser}, {@link GlpiTicket}) y no objetos del dominio, a
 * proposito: la traduccion no es responsabilidad de quien trae los datos. Un adaptador que ya
 * tradujera tendria que decidir la politica de descarte y el mapeo de prioridades, y entonces la
 * capa anticorrupcion dejaria de tener un sitio unico donde leerse —estaria dentro del cliente HTTP,
 * que es justo donde el documento de decisiones dice que no debe estar.
 *
 * <p>Falla con las excepciones propias de la integracion, no con las de Reactor ni con las de
 * Spring: quien implemente esta interfaz se compromete a que ningun detalle del transporte se escape
 * por aqui.
 */
public interface GlpiPlanningSource {

    /**
     * Busca un usuario de GLPI por su identificador.
     *
     * <p>Vacio significa que el usuario no existe. Es un resultado, no un fallo: quien llama decide
     * si la ausencia es un 404 o un caso a tolerar.
     */
    Optional<GlpiUser> findUser(String userId);

    /**
     * Los tickets asignados a un usuario de GLPI.
     *
     * <p>Devuelve los de cualquier tipo —incidencias y peticiones— porque separarlos es tarea del
     * mapeador, no del transporte. Filtrar aqui repartiria el criterio entre dos capas.
     */
    List<GlpiTicket> ticketsOf(String userId);
}
