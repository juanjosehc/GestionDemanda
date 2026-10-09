package co.com.coltefinanciera.gestiondemanda;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Punto de entrada del backend.
 *
 * <p>{@code @ConfigurationPropertiesScan} habilita el binding de las clases de configuracion
 * tipadas (GlpiProperties) sin necesidad de registrarlas manualmente.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class GestionDemandaApplication {

    public static void main(String[] args) {
        SpringApplication.run(GestionDemandaApplication.class, args);
    }
}
