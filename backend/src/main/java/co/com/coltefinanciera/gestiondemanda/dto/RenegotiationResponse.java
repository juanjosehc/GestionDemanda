package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.time.LocalDate;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;
import co.com.coltefinanciera.gestiondemanda.domain.model.Renegotiation;

/**
 * El acuerdo vigente de un requerimiento desplazado.
 *
 * <p><strong>Es el acuerdo y solo el acuerdo.</strong> Ni el incidente que causo el desplazamiento ni
 * la fecha original ni la fecha a la que el motor movio el requerimiento: todo eso es el
 * desplazamiento, que vive en la auditoria del plan y que la lectura consolidada devuelve junto a
 * esto. Mezclarlos aqui daria dos sitios donde leer la misma causa, que es como acaban discrepando.
 *
 * <p>Lo que si lleva es {@code source}: de donde vino el acuerdo. Hoy solo puede ser {@code HTTP}
 * —lo registra una persona por la API—, y la columna existe porque la procedencia es parte de la
 * auditoria y no porque haya un segundo origen previsto.
 *
 * @param workItemId el requerimiento, el identificador del ticket en GLPI como texto.
 * @param agreedDate la fecha nueva que se acordó con quien pidio el requerimiento.
 * @param agreedBy   quien registro el acuerdo.
 * @param agreedAt   cuando se registro. Sale del bean {@code Clock}, nunca del cuerpo de la peticion.
 * @param source     de donde vino el acuerdo.
 */
public record RenegotiationResponse(
        String workItemId,
        LocalDate agreedDate,
        String agreedBy,
        Instant agreedAt,
        InputSource source) {

    public static RenegotiationResponse of(Renegotiation renegotiation) {
        return new RenegotiationResponse(
                renegotiation.workItemId(),
                renegotiation.agreedDate(),
                renegotiation.agreedBy(),
                renegotiation.agreedAt(),
                renegotiation.source());
    }
}
