package co.com.coltefinanciera.gestiondemanda.domain.enums;

import java.math.BigDecimal;

/**
 * Comportamiento de planificacion de un incidente: como compite por la jornada.
 *
 * <p>Es la parte de la politica que el motor consulta. Vive aqui, y no en un {@code switch} dentro
 * de {@code PlanningEngine}, para que la correspondencia severidad hacia comportamiento sea
 * configurable sin recompilar: cambiar la OLA es cambiar una propiedad.
 *
 * <p>Cada comportamiento responde dos preguntas al motor:
 *
 * <ul>
 *   <li>{@link #preempts(BigDecimal, BigDecimal)}: reclama capacidad <em>antes</em> que los
 *       requerimientos del mismo dia, o compite despues por lo que sobre.
 *   <li>{@link #claimsWholeDay()}: cierra el resto de la jornada en que arranca aunque le sobren
 *       horas.
 * </ul>
 */
public enum DisplacementPolicy {

    /**
     * Prioridad maxima. No negocia: cierra lo que queda de la jornada en que arranca, de modo que
     * cualquier requerimiento pactado para ese dia se desplaza aunque hubiera capacidad.
     *
     * <p>Cerrar la jornada es reclamar el dia, no consumirlo: el incidente sigue ocupando
     * exactamente sus horas, y las que ya habian pasado antes de que arrancara no se le imputan.
     */
    INMEDIATA {
        @Override
        public boolean preempts(BigDecimal estimatedHours, BigDecimal workingHoursPerDay) {
            return true;
        }

        @Override
        public boolean claimsWholeDay() {
            return true;
        }
    },

    /**
     * Compite por capacidad real. Consume sus horas de forma voraz desde el dia del reporte y
     * desborda a los dias siguientes; desplaza solo lo que efectivamente ya no cabe.
     */
    POR_CAPACIDAD {
        @Override
        public boolean preempts(BigDecimal estimatedHours, BigDecimal workingHoursPerDay) {
            return true;
        }

        @Override
        public boolean claimsWholeDay() {
            return false;
        }
    },

    /**
     * Convivencia. El incidente se ubica despues de los requerimientos y solo ocupa lo que sobra,
     * asi que por si mismo no desplaza nada.
     *
     * <p>La excepcion es la saturacion: un incidente que no cabe ni en una jornada completa no
     * puede convivir con nada, y en ese caso reclama capacidad como cualquier otro.
     */
    POR_SATURACION {
        @Override
        public boolean preempts(BigDecimal estimatedHours, BigDecimal workingHoursPerDay) {
            return estimatedHours.compareTo(workingHoursPerDay) > 0;
        }

        @Override
        public boolean claimsWholeDay() {
            return false;
        }
    };

    /** Indica si el incidente reclama capacidad antes que los requerimientos del mismo dia. */
    public abstract boolean preempts(BigDecimal estimatedHours, BigDecimal workingHoursPerDay);

    /** Indica si el incidente cierra el resto de la jornada del dia en que arranca. */
    public abstract boolean claimsWholeDay();

    /** Regla que queda registrada en la auditoria cuando este comportamiento provoca un desplazamiento. */
    public AppliedRule appliedRule() {
        return switch (this) {
            case INMEDIATA -> AppliedRule.REPLANIFICACION_INMEDIATA;
            case POR_CAPACIDAD -> AppliedRule.CAPACIDAD_COMPROMETIDA;
            case POR_SATURACION -> AppliedRule.SATURACION;
        };
    }
}
