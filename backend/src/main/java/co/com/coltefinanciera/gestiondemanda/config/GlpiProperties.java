package co.com.coltefinanciera.gestiondemanda.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.util.StringUtils;

/**
 * Configuracion de la integracion con GLPI.
 *
 * <p>Se modela como {@code record} inmutable: son credenciales que no deben cambiar en
 * caliente, y el binding por constructor de Spring Boot 3 no requiere boilerplate.
 *
 * <p>Ninguna propiedad se valida al arrancar de forma obligatoria. El sistema debe poder
 * levantar sin GLPI configurado; el diagnostico se expone en {@code GET /api/glpi/health}.
 *
 * @param baseUrl   URL base del API REST de GLPI, incluyendo {@code /apirest.php}.
 *                  Ej: {@code https://glpi.midominio.com/apirest.php}
 * @param appToken  App-Token generado en GLPI (Configuracion > API).
 * @param userToken User token del usuario de integracion.
 * @param timeout   Tiempo maximo de espera por peticion individual.
 */
@ConfigurationProperties(prefix = "glpi")
public record GlpiProperties(
        String baseUrl,
        String appToken,
        String userToken,
        @DefaultValue("5s") Duration timeout) {

    /** Normaliza la URL quitando la barra final para poder concatenar paths sin duplicarla. */
    public String normalizedBaseUrl() {
        if (!StringUtils.hasText(baseUrl)) {
            return "";
        }
        return baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    /** Indica si las tres credenciales necesarias estan presentes. */
    public boolean isConfigured() {
        return StringUtils.hasText(baseUrl)
                && StringUtils.hasText(appToken)
                && StringUtils.hasText(userToken);
    }
}
