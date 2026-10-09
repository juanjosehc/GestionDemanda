package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;

/**
 * Requerimiento con fecha pactada con el usuario.
 *
 * <p>Es el trabajo desplazable: cuando un incidente consume su franja, cambia de fecha y pasa a
 * {@link RequirementStatus#PENDIENTE_DE_RENEGOCIACION}.
 */
public record Requirement(
        String id,
        String title,
        BigDecimal estimatedHours,
        LocalDate plannedDate,
        RequirementStatus status) {

    public Requirement {
        DomainPreconditions.requireText(id, "id");
        DomainPreconditions.requirePositive(estimatedHours, "estimatedHours");
        Objects.requireNonNull(plannedDate, "plannedDate es obligatorio");
        Objects.requireNonNull(status, "status es obligatorio");
    }

    /**
     * Solo se replanifica trabajo vivo.
     *
     * <p>Un requerimiento ya renegociado espera un acuerdo nuevo con el usuario y uno finalizado
     * ya no compite: volver a moverlos duplicaria el desplazamiento en lugar de resolverlo.
     */
    public boolean isPlannable() {
        return status == RequirementStatus.PLANIFICADO || status == RequirementStatus.EN_EJECUCION;
    }
}
