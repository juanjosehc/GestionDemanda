package co.com.coltefinanciera.gestiondemanda.exception;

/**
 * El desarrollador pedido no existe en GLPI.
 *
 * <p>Es un 404 y no un error de integracion: la peticion estaba bien formada y GLPI respondio bien,
 * solo que el usuario no esta. Devolver 503 mandaria a quien llama a revisar la conexion con GLPI
 * cuando el problema es el identificador que escribio.
 *
 * <p>Existe porque el flujo desde GLPI arranca por el desarrollador: sin el no hay a quien planificar
 * y no tiene sentido traer tickets. Falla antes de pedirlos.
 */
public class GlpiDeveloperNotFoundException extends RuntimeException {

    public GlpiDeveloperNotFoundException(String message) {
        super(message);
    }
}
