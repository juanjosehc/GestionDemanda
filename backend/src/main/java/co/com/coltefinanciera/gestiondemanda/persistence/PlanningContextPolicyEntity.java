package co.com.coltefinanciera.gestiondemanda.persistence;

import java.math.BigDecimal;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.domain.enums.DisplacementPolicy;
import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.rules.IncidentPolicy;

/**
 * Tabla de la OLA vigente por severidad en el momento de un calculo.
 *
 * <p>Es la parte del contexto que no cabe en una columna: tres filas por plan, una por severidad.
 * Existe porque la OLA es lo que convierte una severidad en comportamiento, y sin ella un evento con
 * regla {@code SATURACION} no se puede explicar: {@code SATURACION} no significa nada por si solo,
 * significa que la severidad del incidente tenia declarado {@code POR_SATURACION} aquel dia.
 *
 * <p>Se guardan las tres severidades siempre, no solo las que aparecieron en la peticion. Es
 * deliberado y no es duplicar la configuracion: la pregunta que responde esta tabla es "cual era el
 * acuerdo vigente", y un acuerdo del que solo se guarda la parte que se uso no se puede comparar con
 * el de manana para ver que cambio. Las severidades que <em>participaron</em> son otra cosa y se
 * guardan aparte, en {@code planning_context.severities}.
 *
 * <p>{@code severity} es unico dentro de un plan, y no se declara como restriccion: el agregado se
 * escribe entero de una vez y nunca se actualiza, asi que una fila repetida solo podria venir de un
 * error de programacion, no de una carrera entre peticiones.
 */
@Entity
@Table(
        name = "planning_context_policy",
        indexes = @Index(name = "ix_planning_context_policy_plan", columnList = "plan_id"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PlanningContextPolicyEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "plan_id", nullable = false, updatable = false)
    private UUID planId;

    @Enumerated(EnumType.STRING)
    @Column(name = "severity", nullable = false, length = 32)
    private IncidentSeverity severity;

    @Column(name = "target_ownership_minutes", nullable = false)
    private int targetOwnershipMinutes;

    @Column(name = "target_resolution_hours", nullable = false, precision = 10, scale = 4)
    private BigDecimal targetResolutionHours;

    @Enumerated(EnumType.STRING)
    @Column(name = "displacement_policy", nullable = false, length = 32)
    private DisplacementPolicy displacementPolicy;

    private PlanningContextPolicyEntity(UUID planId, IncidentPolicy policy) {
        this.planId = planId;
        this.severity = policy.severity();
        this.targetOwnershipMinutes = policy.targetOwnershipMinutes();
        this.targetResolutionHours = policy.targetResolutionHours();
        this.displacementPolicy = policy.displacementPolicy();
    }

    static PlanningContextPolicyEntity of(UUID planId, IncidentPolicy policy) {
        return new PlanningContextPolicyEntity(planId, policy);
    }

    IncidentPolicy toDomain() {
        return new IncidentPolicy(
                severity, targetOwnershipMinutes, targetResolutionHours, displacementPolicy);
    }
}
