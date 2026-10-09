package co.com.coltefinanciera.gestiondemanda.exception;

/**
 * GLPI no tiene el elemento que se le pidio.
 *
 * <p>Existe porque GLPI responde a esto con {@code HTTP 400} y un cuerpo
 * {@code ["ERROR_ITEM_NOT_FOUND", ...]}, no con un 404. Sin esta clase, pedir un usuario que no
 * existe se veria desde fuera como un fallo de conexion, y quien llama recibiria un 503 que le dice
 * que revise la red cuando el problema es el identificador que escribio.
 *
 * <p>Hereda de {@link GlpiConnectionException} para que un manejador generico siga tratandolo como
 * lo que es —un fallo de la integracion— y para que no haya que tocar los manejadores existentes. El
 * adaptador lo captura y lo convierte en un {@code Optional} vacio, que es la traduccion correcta:
 * "no esta" es un resultado, no una excepcion.
 */
public class GlpiItemNotFoundException extends GlpiConnectionException {

    public GlpiItemNotFoundException(String message) {
        super(message);
    }
}
