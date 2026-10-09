package co.com.coltefinanciera.gestiondemanda.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentStatus;
import co.com.coltefinanciera.gestiondemanda.domain.enums.RequirementStatus;

/**
 * Entrada de la simulacion.
 *
 * <p>Es el contrato HTTP, deliberadamente separado del dominio: el motor no sabe que existe un
 * endpoint. Las validaciones de aqui cubren la forma del mensaje; los invariantes de negocio los
 * sigue defendiendo el propio dominio.
 *
 * <p>{@code rules} es opcional: si no viene, se usan las reglas configuradas en {@code planning.*}.
 */
public record PlanningSimulationRequest(
        @NotNull @Valid DeveloperInput developer,
        @NotNull @Valid List<IncidentInput> incidents,
        @NotNull @Valid List<RequirementInput> requirements,
        @Valid RulesInput rules) {

    public record DeveloperInput(@NotBlank String id, @NotBlank String name) {
    }

    public record IncidentInput(
            @NotBlank String id,
            String title,
            @NotNull @DecimalMin("0.01") BigDecimal estimatedHours,
            @NotNull Instant reportedAt,
            @NotNull IncidentStatus status,
            IncidentSeverity severity) {
    }

    public record RequirementInput(
            @NotBlank String id,
            String title,
            @NotNull @DecimalMin("0.01") BigDecimal estimatedHours,
            @NotNull LocalDate plannedDate,
            @NotNull RequirementStatus status) {
    }

    /**
     * Sobrescritura puntual de las reglas, util para probar umbrales distintos sin reconfigurar.
     *
     * <p>No incluye la OLA por severidad: esa se ajusta en {@code planning.incident-policies.*} y es
     * comun a toda la aplicacion. Sobrescribirla por peticion permitiria simular acuerdos que no
     * son los vigentes, que es justo lo que un simulador de la OLA no debe hacer.
     */
    public record RulesInput(
            @DecimalMin("0.01") BigDecimal incidentThresholdHours,
            @DecimalMin("0.01") BigDecimal workingHoursPerDay,
            @Min(1) Integer planningHorizonDays) {
    }
}
