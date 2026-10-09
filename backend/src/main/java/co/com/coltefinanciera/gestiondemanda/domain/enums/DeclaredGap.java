package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * Las tres carencias declaradas que se pueden listar una a una.
 *
 * <p>Es el vocabulario de la navegacion del tablero, no el de un descarte: los codigos con los que la
 * capa anticorrupcion nombra estas mismas carencias siguen siendo {@link
 * co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiDiscardReason}, y siguen siendo los
 * unicos —aqui no se escribe ninguno—. Lo que hay aqui es la pregunta, no la causa.
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

    /** Filas declaradas sin horas estimadas. Incluye las retiradas. */
    SIN_ESTIMACION,

    /** Filas declaradas sin fecha compromiso. Incluye las retiradas. */
    SIN_COMPROMISO,

    /**
     * Filas declaradas a las que les falta al menos uno de los dos valores.
     *
     * <p>Es la union de las dos carencias y no su interseccion, porque es lo que significa
     * {@code incomplete} en la fotografia —{@code withoutEstimation + withoutCommitment - retracted}—
     * y una fila sin ninguno de los dos valores falta por los dos. El listado que sirve esta carencia
     * es, por tanto, el predicado «nulo en cualquiera de las dos columnas», que es el mismo que ya la
     * cuenta.
     */
    METADATA_INCOMPLETA
}
