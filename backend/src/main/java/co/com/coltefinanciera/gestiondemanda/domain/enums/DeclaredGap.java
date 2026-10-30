package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * La carencia declarada que se puede listar: la unica que queda.
 *
 * <p>Es el vocabulario de la navegacion del tablero, no el de un descarte: el codigo con el que la
 * capa anticorrupcion nombra esta misma carencia sigue siendo {@link
 * co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiDiscardReason}, y sigue siendo el unico
 * —aqui no se escribe ninguno—. Lo que hay aqui es la pregunta, no la causa.
 *
 * <p><strong>El nombre de la constante se escribe en la ruta tal cual.</strong> Spring convierte el
 * segmento con {@code Enum.valueOf} y sin tolerancia: {@code SIN_ESTIMACION} llega y {@code
 * sin-estimacion} no. Se probo la ruta con guiones —que se lee mejor— y exige una tabla de traduccion
 * en algun sitio, que es un segundo vocabulario esperando a divergir del primero; y el nombre
 * exacto ya viaja de vuelta en el campo {@code gap} de la respuesta, asi que la ruta y lo que se
 * recibe se escriben igual. Un valor que no corresponda a ninguna constante no llega hasta aqui:
 * muere en la conversion con un {@code 400 INVALID_PARAMETER}, que el manejador de errores ya sabe
 * armar.
 */
public enum DeclaredGap {

    /**
     * Filas declaradas sin horas estimadas. Incluye las retiradas, que no dejaron ningun valor.
     *
     * <p>Desde la Fase 77 es la unica carencia que la declaracion puede tener: la fecha de
     * compromiso la publica GLPI y ya no se captura, asi que no hay una segunda mitad que pueda
     * faltar. {@code SIN_COMPROMISO} y {@code METADATA_INCOMPLETA} se retiraron con la captura.
     */
    SIN_ESTIMACION
}
