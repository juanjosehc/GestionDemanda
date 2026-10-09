package co.com.coltefinanciera.gestiondemanda.persistence;

import java.time.Clock;
import java.time.Instant;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.domain.idempotency.RescheduleLedger;

/**
 * Registro de idempotencia sobre base de datos.
 *
 * <p>Sustituye a la implementacion en memoria sin que {@code PlanningEngine} cambie una linea, que
 * es exactamente lo que la interfaz prometia desde la Fase 2. Lo que cambia no es el comportamiento
 * sino su alcance: el registro deja de reabrirse en cada reinicio, y un desplazamiento auditado ayer
 * no se vuelve a auditar hoy.
 *
 * <p><strong>Atomicidad.</strong> El reclamo es un intento de insercion y la restriccion unica de la
 * tabla es quien decide. Comprobar con un {@code SELECT} y escribir despues dejaria una ventana en
 * la que dos peticiones simultaneas reclaman la misma pareja y las dos se creen primeras; con el
 * indice, la base de datos resuelve la carrera y la que pierde recibe una violacion de integridad,
 * que aqui se traduce a {@code false}.
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
    private final Clock clock;

    @Override
    public boolean claim(String incidentId, String requirementId) {
        try {
            claims.saveAndFlush(
                    new RescheduleClaimEntity(causeOf(incidentId), requirementId, Instant.now(clock)));
            return true;
        } catch (DataIntegrityViolationException alreadyClaimed) {
            return false;
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
