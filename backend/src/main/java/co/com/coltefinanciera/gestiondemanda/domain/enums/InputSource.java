package co.com.coltefinanciera.gestiondemanda.domain.enums;

/**
 * De donde salieron los datos con que se planifico.
 *
 * <p><strong>Esto no es un concepto de GLPI.</strong> Es una etiqueta de procedencia, del mismo tipo
 * que {@code status} o {@code severity}: dice algo del origen del dato, no de su forma. El dominio
 * puede nombrar de donde viene una entrada sin saber como esta hecha por dentro, igual que puede
 * decir que un incidente esta {@code RESUELTO} sin conocer la tabla que lo guarda.
 *
 * <p>Lo que el dominio NO conoce —y esta es la frontera que sostiene la capa anticorrupcion— es el
 * contrato de GLPI: sus DTOs, sus prioridades, sus codigos numericos y su JSON. Todo eso se traduce
 * antes de llegar aqui. Si algun dia el origen es otro, se añade una constante y nada mas cambia.
 */
public enum InputSource {

    /** La entrada llego por la API HTTP de esta aplicacion: la escribio quien llamo al endpoint. */
    HTTP,

    /** La entrada se extrajo de GLPI y se tradujo antes de entrar al motor. */
    GLPI
}
