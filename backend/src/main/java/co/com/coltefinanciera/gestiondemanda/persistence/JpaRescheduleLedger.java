package co.com.coltefinanciera.gestiondemanda.persistence;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.domain.idempotency.RescheduleLedger;

/**
 * Registro de idempotencia sobre base de datos.
 *
 * <p>Sustituye a la implementacion en memoria sin que {@code PlanningEngine} cambie de fondo, que es
 * exactamente lo que la interfaz prometia desde la Fase 2. Lo que cambia no es el comportamiento
 * sino su alcance: el registro deja de reabrirse en cada reinicio, y un desplazamiento auditado ayer
 * no se vuelve a auditar hoy.
 *
 * <p><strong>Atomicidad.</strong> El reclamo es un intento de insercion y la restriccion unica de la
 * tabla es quien decide. Comprobar con un {@code SELECT} y escribir despues dejaria una ventana en
 * la que dos peticiones simultaneas reclaman la misma pareja y las dos se creen primeras; con el
 * indice, la base de datos resuelve la carrera y la que pierde recibe una violacion de integridad.
 * La que pierde no se va con las manos vacias: relee la fila ganadora y devuelve <strong>su</strong>
 * instante, que es el que la auditoria va a conservar de todas formas.
 *
 * <p><strong>Sin transaccion envolvente.</strong> Cada reclamo corre en su propia transaccion. Es
 * deliberado: el motor reclama durante el calculo, y ese calculo no esta dentro de la transaccion
 * que guarda el plan. Si lo estuviera, un reclamo perdido marcaria la transaccion como fallida y
 * tumbaria el guardado entero por un evento que, por definicion, ya estaba registrado.
 */
@Component
@RequiredArgsConstructor
public class JpaRescheduleLedger implements RescheduleLedger {

    /**
     * Marca de los desplazamientos sin incidente causante.
     *
     * <p>Existe porque la columna es {@code NOT NULL}: en PostgreSQL los nulos no colisionan entre
     * si, asi que dos desplazamientos sin incidente sobre el mismo requerimiento pasarian los dos
     * por la restriccion unica. La marca los mete en la misma proteccion que al resto.
     */
    private static final String SIN_INCIDENTE = "-";

    private final RescheduleClaimJpaRepository claims;

    @Override
    public Instant claim(String incidentId, String requirementId, Instant auditedAt) {
        String cause = causeOf(incidentId);
        // La columna guarda microsegundos: se recorta antes de escribir para que el instante que
        // devuelve este reclamo sea exactamente el que devolvera la lectura de la fila en la
        // siguiente corrida. Sin recortar, la segunda corrida publicaria el mismo evento con otra
        // marca y la auditoria pareceria haber cambiado.
        Instant instante = auditedAt.truncatedTo(ChronoUnit.MICROS);
        try {
            claims.saveAndFlush(new RescheduleClaimEntity(cause, requirementId, instante));
            return instante;
        } catch (DataIntegrityViolationException alreadyClaimed) {
            // La fila la borro alguien entre la violacion y esta lectura: no hay instante original
            // que devolver y el propuesto sirve igual. El reclamo de todas formas ya se perdio.
            return claims.findByIncidentIdAndRequirementId(cause, requirementId)
                    .map(RescheduleClaimEntity::getClaimedAt)
                    .orElse(instante);
        }
    }

    @Override
    public boolean contains(String incidentId, String requirementId) {
        return claims.existsByIncidentIdAndRequirementId(causeOf(incidentId), requirementId);
    }

    private static String causeOf(String incidentId) {
        return incidentId == null || incidentId.isBlank() ? SIN_INCIDENTE : incidentId;
    }
}
