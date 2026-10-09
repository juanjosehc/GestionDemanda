package co.com.coltefinanciera.gestiondemanda.exception;

/**
 * GLPI respondio, pero lo que respondio no se puede traducir al dominio.
 *
 * <p>Es distinta de {@link GlpiConnectionException} a proposito, y la distincion importa para quien
 * opera: un fallo de conexion se arregla revisando red, credenciales o el servicio de GLPI; un fallo
 * de datos se arregla revisando los tickets. Meterlas en la misma excepcion obligaria a leer el
 * mensaje para saber a quien llamar.
 *
 * <p>Se lanza cuando el cuerpo recibido no tiene la forma esperada —falta un campo obligatorio, un
 * numero llega como texto, la lista de tickets viene envuelta en algo que no es una lista—, es decir,
 * cuando el contrato de GLPI no es el que el adaptador cree conocer. Los datos <em>incompletos de un
 * ticket concreto</em> no llegan aqui: esos se descartan elemento a elemento y se reportan en la
 * respuesta, porque un ticket malo no debe tumbar la planificacion de los demas.
 */
public class GlpiInvalidDataException extends RuntimeException {

    public GlpiInvalidDataException(String message) {
        super(message);
    }

    public GlpiInvalidDataException(String message, Throwable cause) {
        super(message, cause);
    }
}
