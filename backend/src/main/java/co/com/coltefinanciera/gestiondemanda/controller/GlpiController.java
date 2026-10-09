package co.com.coltefinanciera.gestiondemanda.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import lombok.RequiredArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.dto.GlpiHealthResponse;
import co.com.coltefinanciera.gestiondemanda.service.GlpiConnectivityService;

/** Diagnostico de la integracion con GLPI. */
@RestController
@RequestMapping("/api/glpi")
@RequiredArgsConstructor
public class GlpiController {

    private final GlpiConnectivityService glpiConnectivityService;

    /**
     * {@code GET /api/glpi/health}
     *
     * <p>Responde 200 incluso cuando GLPI esta caido: el cuerpo describe el estado y el
     * campo {@code detail} explica la causa.
     */
    @GetMapping("/health")
    public GlpiHealthResponse health() {
        return glpiConnectivityService.check();
    }
}
