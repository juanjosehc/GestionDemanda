package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.util.List;
import java.util.Optional;

/**
 * Lo que la capa anticorrupcion necesita saber de GLPI, expresado como cuatro preguntas.
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
     * Busca un usuario de GLPI por su identificador: el login o el numero de usuario.
     *
     * <p><strong>Las dos formas son parte del contrato, y no una comodidad.</strong> El sistema nombra
     * a las personas por su login —es lo que publica el catalogo del equipo y con lo que se las pide en
     * todas las rutas— y GLPI no sabe buscar un tecnico por ahi: la busqueda de tickets solo compara
     * numeros. La traduccion de login a numero es responsabilidad de quien implementa esto; quien llama
     * no tiene por que saber cual de las dos formas tiene entre manos.
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
     *
     * <p>Devuelve tambien los cerrados, y eso no es un descuido: es el historico, y quien pregunta
     * esto —el plan— necesita ver todo lo que GLPI tiene para poder decir por que descarta lo que
     * descarta. Quien mide lo que queda por hacer pregunta {@link #activeTicketsOf(String)}.
     */
    List<GlpiTicket> ticketsOf(String userId);

    /**
     * Los tickets asignados a un usuario que todavia son carga operativa: ni resueltos ni cerrados.
     *
     * <p>Es una pregunta distinta y no un recorte de {@link #ticketsOf}: un ticket cerrado sigue
     * asignado a la persona —la instancia medida tiene quien acumula mil doscientos sesenta y seis,
     * todos cerrados— y dejo de ser trabajo. Contarlo convierte el historico de alguien en su jornada.
     *
     * <p>El corte son los dos ultimos estados de GLPI —solucionado y cerrado—, que el contrato traduce
     * al mismo estado del dominio: {@code RESUELTO} o {@code FINALIZADO}, segun el tipo de ticket. Los
     * cuatro anteriores siguen dentro, incluido el planificado: el trabajo esta acordado y no hecho.
     */
    List<GlpiTicket> activeTicketsOf(String userId);

    /**
     * Los usuarios que pertenecen a un grupo de GLPI, con sus subgrupos.
     *
     * <p>Es la pregunta que faltaba: las demas son de a uno —dado un usuario, quien es y que tiene
     * asignado— y ninguna enumera. Por eso el sistema no tenia padron de personas y la pantalla de
     * recursos consolidaba planes en lugar de equipo: sin una operacion que liste, el unico modo de
     * saber quien existe era preguntar por alguien que ya se conocia.
     *
     * <p><strong>Incluye los subgrupos, y eso es una decision, no un efecto del API.</strong> El grupo
     * «Desarrollo N2» de esta instancia tiene tres subgrupos, y quien pertenece a uno de ellos
     * pertenece al equipo: leer solo la pertenencia directa devolveria veintiuna personas de las
     * cuarenta y una que hay. Quien quiera el sentido estricto tiene un grupo sin hijos.
     *
     * <p><strong>Puede devolver menos de los que hay, y esto no se puede comprobar desde aqui.</strong>
     * Un usuario que la cuenta de integracion no tiene permiso de leer no aparece —ni en la lista ni en
     * el total—, asi que no hay forma de distinguir «el grupo esta vacio» de «no se pudo leer a nadie».
     * Es la limitacion que el catalogo declara y la razon por la que existen las excepciones.
     *
     * <p>Una lista vacia es un resultado: el grupo no tiene miembros legibles.
     */
    List<GlpiUser> membersOfGroup(String groupId);
}
