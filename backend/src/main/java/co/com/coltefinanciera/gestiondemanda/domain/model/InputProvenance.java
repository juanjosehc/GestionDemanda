package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.time.Instant;
import java.util.Objects;

import co.com.coltefinanciera.gestiondemanda.domain.enums.InputSource;

/**
 * De donde salio la entrada de una ejecucion, y con que se tradujo.
 *
 * <p>La fotografia de la entrada ({@link PlanningInputSnapshot}) dice <em>que</em> datos entraron al
 * motor; esto dice <em>de donde vinieron</em>. Sin esta mitad, una entrada extraida de GLPI y una
 * entrada escrita a mano por la API son indistinguibles en la base de datos, y una auditoria no
 * puede responder la primera pregunta que se hace: quien puso estos datos aqui.
 *
 * <p>El tercer dato, {@code adapterVersion}, es el que hace util la trazabilidad cuando algo se
 * tradujo mal. Un plan calculado con datos de GLPI se puede volver a leer, pero no se puede volver a
 * traducir: los tickets ya cambiaron. Saber con que version del adaptador se tradujeron permite
 * reconstruir la interpretacion, no solo el dato. Es la misma idea que {@code engineVersion} en el
 * contexto, aplicada a la frontera.
 *
 * <p><strong>Solo GLPI se fecha y se versiona.</strong> La procedencia HTTP no tiene extraccion que
 * fechar ni traduccion que versionar: los datos llegaron ya en la forma del dominio, escritos por
 * quien llamo al endpoint. Exigirle una fecha obligaria a inventarla, y una fecha inventada en un
 * registro de auditoria es peor que su ausencia.
 */
public record InputProvenance(
        InputSource source,
        Instant extractedAt,
        String adapterVersion) {

    /** La entrada llego por la API HTTP: no hubo extraccion ni traduccion que registrar. */
    public static final InputProvenance HTTP = new InputProvenance(InputSource.HTTP, null, null);

    /**
     * Quien declare GLPI tiene que decir cuando extrajo y con que adaptador tradujo.
     *
     * <p>Es la invariante que impide el caso inutil: una fila que dice {@code GLPI} y no dice nada
     * mas. Una procedencia a medias no permite auditar nada y ademas afirma una trazabilidad que no
     * existe, que es peor que declarar {@code HTTP}.
     */
    public InputProvenance {
        Objects.requireNonNull(source, "source es obligatorio");
        if (source == InputSource.GLPI) {
            Objects.requireNonNull(extractedAt, "una entrada de GLPI exige la fecha de extraccion");
            DomainPreconditions.requireText(adapterVersion, "adapterVersion");
        }
    }

    /** La procedencia de una extraccion de GLPI hecha con un adaptador concreto. */
    public static InputProvenance glpi(Instant extractedAt, String adapterVersion) {
        return new InputProvenance(InputSource.GLPI, extractedAt, adapterVersion);
    }

    /** Si la entrada se extrajo de GLPI, en lugar de haber llegado por la API. */
    public boolean fromGlpi() {
        return source == InputSource.GLPI;
    }
}
