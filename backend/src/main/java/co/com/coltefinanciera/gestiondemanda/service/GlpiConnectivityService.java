package co.com.coltefinanciera.gestiondemanda.service;

import java.time.Duration;
import java.time.Instant;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import co.com.coltefinanciera.gestiondemanda.client.GlpiClient;
import co.com.coltefinanciera.gestiondemanda.config.GlpiProperties;
import co.com.coltefinanciera.gestiondemanda.dto.GlpiHealthResponse;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiConnectionException;
import co.com.coltefinanciera.gestiondemanda.exception.GlpiUnreachableException;

/**
 * Servicio de conectividad con GLPI.
 *
 * <p>Unico punto de bloqueo de la aplicacion: compone las llamadas reactivas del
 * {@link GlpiClient} y las resuelve de forma sincrona para el stack servlet.
 *
 * <p>Este servicio no contiene ni contendra logica de priorizacion de incidentes o
 * requerimientos. Su unico rol es el diagnostico de la integracion.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GlpiConnectivityService {

    private static final String DETAIL_OK = "Conexion y autenticacion verificadas contra GLPI";
    private static final String DETAIL_NOT_CONFIGURED =
            "GLPI no esta configurado: defina GLPI_URL, GLPI_APP_TOKEN y GLPI_USER_TOKEN";

    private final GlpiClient glpiClient;
    private final GlpiProperties properties;

    /**
     * Verifica conectividad y autenticacion.
     *
     * <p>Nunca propaga la falla: un problema de GLPI se reporta como estado, no como error
     * HTTP. El endpoint siempre responde 200 con el diagnostico.
     */
    public GlpiHealthResponse check() {
        Instant checkedAt = Instant.now();
        String baseUrl = properties.normalizedBaseUrl();

        if (!properties.isConfigured()) {
            log.warn("Verificacion GLPI omitida: configuracion incompleta");
            return new GlpiHealthResponse(false, false, baseUrl, checkedAt, DETAIL_NOT_CONFIGURED);
        }

        Duration timeout = properties.timeout();
        long startedAt = System.nanoTime();

        try {
            String sessionToken = glpiClient.initSession().block(timeout);
            log.debug("Sesion GLPI iniciada");

            boolean authenticated;
            try {
                String session = glpiClient.getFullSession(sessionToken).block(timeout);
                authenticated = StringUtils.hasText(session);
            } finally {
                closeQuietly(sessionToken);
            }

            long elapsedMs = elapsedMs(startedAt);
            if (authenticated) {
                log.info("Verificacion GLPI exitosa en {} ms", elapsedMs);
                return new GlpiHealthResponse(true, true, baseUrl, checkedAt, DETAIL_OK);
            }

            log.warn("GLPI alcanzable pero la sesion no pudo validarse ({} ms)", elapsedMs);
            return new GlpiHealthResponse(true, false, baseUrl, checkedAt,
                    "GLPI respondio pero la sesion no pudo validarse");

        } catch (GlpiUnreachableException ex) {
            log.warn("GLPI inalcanzable: {}", ex.getMessage());
            return new GlpiHealthResponse(false, false, baseUrl, checkedAt, ex.getMessage());

        } catch (GlpiConnectionException ex) {
            // El servidor respondio (hay conectividad) pero rechazo la peticion.
            log.warn("GLPI rechazo la verificacion: {}", ex.getMessage());
            return new GlpiHealthResponse(true, false, baseUrl, checkedAt, ex.getMessage());

        } catch (RuntimeException ex) {
            // Timeout de bloqueo u otro fallo no previsto: se reporta, no se propaga.
            log.error("Error inesperado verificando GLPI", ex);
            return new GlpiHealthResponse(false, false, baseUrl, checkedAt,
                    "Error inesperado verificando GLPI: " + ex.getMessage());
        }
    }

    /** Cierra la sesion sin que un fallo de cierre invalide el diagnostico ya obtenido. */
    private void closeQuietly(String sessionToken) {
        try {
            glpiClient.killSession(sessionToken).block(properties.timeout());
        } catch (RuntimeException ex) {
            log.warn("No fue posible cerrar la sesion GLPI: {}", ex.getMessage());
        }
    }

    private static long elapsedMs(long startedAt) {
        return (System.nanoTime() - startedAt) / 1_000_000;
    }
}
