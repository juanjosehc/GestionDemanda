package co.com.coltefinanciera.gestiondemanda.persistence;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * Tabla del registro de idempotencia.
 *
 * <p>Es la pieza que hace que un reinicio no reaudite nada: la restriccion unica sobre
 * {@code (incident_id, requirement_id)} es la que decide quien llega primero, y el intento de
 * insercion es el reclamo. No hay comprobacion previa porque comprobar y escribir por separado deja
 * una ventana en la que dos ejecuciones concurrentes pasan las dos.
 *
 * <p>Lleva clave sustituta y no compuesta: la unicidad la da la restriccion, y una columna
 * {@code BIGINT} generada por la base es mas barata de mantener que un {@code @IdClass}. Cuando
 * alguien necesite preguntar "que reclamo este incidente", la columna {@code incident_id} ya esta
 * indexada por la propia restriccion.
 *
 * <p>{@code incident_id} no admite nulo: los desplazamientos sin incidente causante se registran
 * con una marca, igual que hacia el registro en memoria, para que la restriccion unica los cubra
 * tambien a ellos. En PostgreSQL los nulos no colisionan entre si, de modo que dejarlos pasar
 * desactivaria justo la proteccion que esta tabla existe para dar.
 */
@Entity
@Table(name = "reschedule_claim",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_reschedule_claim", columnNames = {"incident_id", "requirement_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RescheduleClaimEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "incident_id", nullable = false, length = 64)
    private String incidentId;

    @Column(name = "requirement_id", nullable = false, length = 64)
    private String requirementId;

    @Column(name = "claimed_at", nullable = false)
    private Instant claimedAt;

    RescheduleClaimEntity(String incidentId, String requirementId, Instant claimedAt) {
        this.incidentId = incidentId;
        this.requirementId = requirementId;
        this.claimedAt = claimedAt;
    }
}
