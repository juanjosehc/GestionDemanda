package co.com.coltefinanciera.gestiondemanda.domain.model;

import java.time.Instant;
import java.time.ZoneId;
import java.util.Objects;
import java.util.Set;

import co.com.coltefinanciera.gestiondemanda.domain.enums.IncidentSeverity;
import co.com.coltefinanciera.gestiondemanda.domain.rules.PlanningRules;

/**
 * Foto del contexto con el que se calculo un plan: con que reglas, con que calendario y con que
 * motor.
 *
 * <p>Es el complemento de {@link PlanSnapshot}. El plan dice <em>que</em> se decidio; esto dice
 * <em>con que</em> se decidio. Hasta ahora esa mitad se perdia: las reglas viven en
 * {@code application.properties} y cambian sin dejar rastro, de modo que un evento de auditoria
 * viejo se leia con la configuracion de hoy. Un {@code UMBRAL_INCIDENTE_EXCEDIDO} guardado no decia
 * si el umbral era de cuatro horas o de ocho, y por tanto no se podia comprobar si la regla estaba
 * bien aplicada.
 *
 * <p><strong>Por que esto no contradice la decision 45.</strong> Aquella decision descarto guardar
 * las reglas por ser "un segundo origen de verdad para el mismo valor". Sigue siendo cierto para la
 * configuracion vigente, y por eso esto no la sustituye: es una copia fechada, atada a un plan
 * concreto y que no se modifica nunca. La configuracion de la aplicacion sigue siendo la unica
 * fuente de verdad de lo que se aplicara manana; esto es la evidencia de lo que se aplico aquel dia.
 *
 * <p>Es un <em>snapshot</em>, como el plan: se escribe una vez, en la misma transaccion, y no se
 * toca. Corregir la configuracion no reescribe el pasado.
 *
 * @param engineVersion version del algoritmo de planificacion. Ver {@link #ENGINE_VERSION}.
 * @param calculatedAt  instante en que el motor calculo. Es la marca de tiempo de la evidencia.
 * @param zoneId        zona horaria con la que se convirtieron las fechas pactadas en instantes. No
 *                      es decorativo: la agenda se deriva de un instante y una zona, asi que sin la
 *                      zona los tramos guardados no se pueden volver a situar.
 * @param severities    severidades que participaron en el calculo. Responde "que severidades estaban
 *                      en juego" sin guardar los incidentes, que son de GLPI.
 * @param rules         reglas vigentes en el momento del calculo: umbral, horizonte, OLA por
 *                      severidad y calendario laboral.
 */
public record PlanningContextSnapshot(
        String engineVersion,
        Instant calculatedAt,
        String zoneId,
        Set<IncidentSeverity> severities,
        PlanningRules rules) {

    /**
     * Version del algoritmo de planificacion.
     *
     * <p>Se sube <strong>a mano</strong> cuando cambia <em>como</em> se planifica, no cuando cambia
     * el codigo: un plan calculado con la version 1 no se explica con las reglas de la version 2.
     *
     * <p>Se declara aqui y no se deriva de la version del artefacto a proposito. La version de Maven
     * cambia en cada compilacion y no dice nada sobre el algoritmo, de modo que dos planes
     * identicos en comportamiento apareceran con versiones distintas y la comparacion deja de
     * significar nada. Es la misma eleccion que una version de esquema: manual, aburrida y util.
     */
    public static final String ENGINE_VERSION = "1.0";

    public PlanningContextSnapshot {
        DomainPreconditions.requireText(engineVersion, "engineVersion");
        Objects.requireNonNull(calculatedAt, "calculatedAt es obligatorio");
        DomainPreconditions.requireText(zoneId, "zoneId");
        severities = severities == null ? Set.of() : Set.copyOf(severities);
        Objects.requireNonNull(rules, "rules es obligatorio");
    }

    /**
     * El contexto de una ejecucion recien terminada.
     *
     * <p>Es el unico constructor que se usa en produccion: la version la pone el dominio y la zona
     * la pone el reloj con el que se calculo, que es lo que garantiza que el contexto describa la
     * ejecucion y no el entorno de quien la lee.
     */
    public static PlanningContextSnapshot of(
            PlanningRules rules, Set<IncidentSeverity> severities, Instant calculatedAt, ZoneId zone) {
        Objects.requireNonNull(zone, "zone es obligatoria");
        return new PlanningContextSnapshot(
                ENGINE_VERSION, calculatedAt, zone.getId(), severities, rules);
    }
}
