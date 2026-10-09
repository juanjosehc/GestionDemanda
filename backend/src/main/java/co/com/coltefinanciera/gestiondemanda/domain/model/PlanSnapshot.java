package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Foto de una ejecucion del motor, con identidad propia.
 *
 * <p>Es {@link PlanningResult} convertido en dato: lo que se calculo, para quien y cuando. Existe
 * porque el resultado no tiene identidad y no debe tenerla —es un valor que se produce y se
 * consume—, mientras que un plan guardado es algo a lo que se vuelve despues, por su nombre,
 * aunque la aplicacion se haya reiniciado entre medias.
 *
 * <p>Es un <em>snapshot</em>, no una entidad con ciclo de vida: no se modifica. Corregir un plan
 * produce un plan nuevo, y el anterior sigue contando lo que se decidio aquel dia.
 *
 * @param id          identidad del plan. La asigna quien lo guarda, no el motor.
 * @param createdAt   momento en que se calculo. Es lo que ordena los planes de un desarrollador.
 * @param result      el resultado integro: asignaciones, bloques, auditoria y conflictos. Se guarda
 *                    entero a proposito: un plan a medias no se puede releer.
 */
public record PlanSnapshot(
        UUID id,
        String developerId,
        Instant createdAt,
        PlanningResult result) {

    public PlanSnapshot {
        Objects.requireNonNull(id, "id es obligatorio");
        DomainPreconditions.requireText(developerId, "developerId");
        Objects.requireNonNull(createdAt, "createdAt es obligatorio");
        Objects.requireNonNull(result, "result es obligatorio");
    }
}
