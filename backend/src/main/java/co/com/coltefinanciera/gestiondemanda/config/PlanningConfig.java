package co.com.coltefinanciera.gestiondemanda.config;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import co.com.coltefinanciera.gestiondemanda.domain.PlanningEngine;
import co.com.coltefinanciera.gestiondemanda.domain.idempotency.RescheduleLedger;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiContract;

/**
 * Registra el dominio de planificacion como beans.
 *
 * <p>El paquete {@code domain} no lleva anotaciones de Spring: se compone aqui. Es lo que permite
 * probar el motor con {@code new PlanningEngine(...)} sin levantar contexto.
 *
 * <p>El registro de idempotencia ya no se construye aqui: lo aporta {@code JpaRescheduleLedger} como
 * componente, porque necesita un repositorio y este paquete no deberia conocer entidades. La
 * interfaz es lo unico que el motor ve, y sigue siendo un bean unico a proposito: la proteccion
 * contra reprocesamiento tiene que sobrevivir entre peticiones.
 */
@Configuration
public class PlanningConfig {

    /**
     * Reloj de la aplicacion.
     *
     * <p>Un solo reloj para el motor y para la capa de servicio, y se inyecta en lugar de leerse del
     * sistema: es lo que permite fijar la hora en las pruebas y comprobar marcas de tiempo sin
     * esperar a que pase el tiempo real.
     */
    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    public PlanningEngine planningEngine(RescheduleLedger rescheduleLedger, Clock clock) {
        return new PlanningEngine(rescheduleLedger, clock);
    }

    /**
     * El contrato de GLPI que la capa anticorrupcion asume.
     *
     * <p>Se registra aqui, en la raiz de composicion, y no se lee de la constante desde los mapeadores:
     * es el punto por el que se cambia de variante. Una instancia de GLPI con otros codigos de estado
     * u otra escala de prioridad se adapta devolviendo otro {@link GlpiContract} desde este metodo, y
     * ni el dominio ni el motor se enteran de que hubo un cambio.
     */
    @Bean
    public GlpiContract glpiContract() {
        return GlpiContract.REST_V1;
    }
}
