package co.com.coltefinanciera.gestiondemanda.integration.glpi;

/**
 * Por que un ticket de GLPI no llego al motor.
 *
 * <p>El texto del descarte —{@link GlpiDiscardedItem#reason()}— esta escrito para que lo lea una
 * persona que opera GLPI y nombra el campo que hay que corregir. Este codigo esta escrito para que lo
 * lea un programa, y existe porque las dos cosas no caben en un solo campo: un texto libre no se
 * puede contar, y contar los descartes por causa es lo unico que permite responder la pregunta de la
 * transicion —si van por detras los desarrolladores que estiman o los tickets que GLPI no fecha—.
 *
 * <p>Es un enum y no un conjunto de constantes de texto por lo mismo que
 * {@code PlanningMetadataField}: es un conjunto cerrado, y un codigo inventado en un sitio lejano
 * solo se descubre el dia que alguien lo lee en un informe.
 *
 * <p><strong>Desde la Fase 77 la carencia declarada es una sola.</strong>
 * {@link #SIN_COMPROMISO_DECLARADO} se retiro con la captura manual de la fecha: el compromiso es el
 * Internal TTR de GLPI y una declaracion ya no puede carecer de el. Lo que si sigue sin fecha son los
 * tickets a los que GLPI no les publica ninguna, y esos los nombra {@link #SIN_FECHA_EN_GLPI}.
 */
public enum GlpiDiscardReason {

    /** GLPI devolvio un ticket sin {@code id}: no hay con que buscarlo ni con que nombrarlo. */
    SIN_IDENTIFICADOR_TICKET,

    /** El {@code type} del ticket no esta en el contrato: no se sabe si es incidencia o peticion. */
    TIPO_DESCONOCIDO,

    /** El {@code status} no esta en la tabla de traduccion del contrato. */
    ESTADO_DESCONOCIDO,

    /** El campo {@code date} del ticket no se puede leer con el patron declarado. */
    FECHA_CREACION_ILEGIBLE,

    /**
     * El negocio no ha declarado cuanto dura el trabajo.
     *
     * <p>Cubre los dos casos: que no haya declaracion ninguna y que la haya sin estimacion. El texto
     * del descarte los distingue —no es lo mismo que nadie haya declarado que que alguien declarara y
     * retirara la estimacion—; el codigo no, porque la accion a tomar es la misma.
     */
    SIN_ESTIMACION_DECLARADA,

    /**
     * GLPI no trae fecha con la que ubicar el requerimiento.
     *
     * <p>Se pide {@code internal_time_to_resolve} y, si no esta, {@code time_to_resolve}: un
     * requerimiento sin ninguna de las dos no tiene fecha real y no se planifica. El arreglo no es una
     * declaracion —desde la Fase 66b la fecha no se declara— sino cargar la OLA o el SLA del ticket,
     * y por eso el codigo nombra a GLPI y no al negocio.
     */
    SIN_FECHA_EN_GLPI,

    /**
     * El ticket paso la validacion y aun asi no se pudo construir el objeto del dominio.
     *
     * <p>Hoy es inalcanzable: el validador comprueba antes exactamente las condiciones que harian
     * fallar la traduccion. Se conserva porque el mapeador devuelve un {@code Optional} y el dia que
     * sus condiciones y las del validador se separen, el descarte tiene que seguir siendo visible en
     * lugar de desaparecer en silencio.
     */
    TRADUCCION_FALLIDA
}
