package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.math.BigDecimal;
import java.util.Objects;

/**
 * Guardas compartidas por los objetos de dominio.
 *
 * <p>Paquete-privada y sin dependencias: el dominio se valida a si mismo y no delega sus
 * invariantes en las anotaciones de la capa web.
 */
final class DomainPreconditions {

    private DomainPreconditions() {
    }

    static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " es obligatorio");
        }
        return value;
    }

    static BigDecimal requirePositive(BigDecimal value, String field) {
        Objects.requireNonNull(value, field + " es obligatorio");
        if (value.signum() <= 0) {
            throw new IllegalArgumentException(field + " debe ser mayor que cero");
        }
        return value;
    }
}
