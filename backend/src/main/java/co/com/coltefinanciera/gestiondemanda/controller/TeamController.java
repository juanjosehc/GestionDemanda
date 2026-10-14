package co.com.coltefinanciera.gestiondemanda.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import co.com.coltefinanciera.gestiondemanda.dto.TeamCatalogResponse;
import co.com.coltefinanciera.gestiondemanda.service.TeamCatalogService;

import lombok.RequiredArgsConstructor;

/**
 * El padron del equipo, por HTTP.
 *
 * <p><strong>Es la lectura que faltaba.</strong> Todo lo demas del sistema pregunta por alguien que ya
 * se conoce: los planes por desarrollador, las declaraciones por desarrollador, los tickets por
 * usuario de GLPI. Sin una ruta que enumere no habia forma de saber quien esta en el equipo, y por eso
 * la pantalla de recursos consolidaba planes: era lo unico enumerable.
 *
 * <p><strong>No calcula.</strong> No ejecuta el motor, no lee planes y no toca la base de datos. Junta
 * el grupo de GLPI con las excepciones declaradas y devuelve la lista. Las cifras —capacidad,
 * desplazamientos, alertas— siguen saliendo de {@code /api/planning/metrics}, y que sean dos respuestas
 * y no una es lo que permite que el padron siga en pie el dia que GLPI no responda.
 *
 * <p><strong>Cuando GLPI no responde, la ruta responde {@code 200} igual.</strong> El fallo viaja
 * dentro del payload, en {@code glpi}, porque un error aqui dejaria la pantalla del equipo sin nada
 * cuando el problema afecta solo a una de las dos fuentes —y porque las excepciones, que son las que
 * existen justo para esto, seguirian siendo legibles.
 */
@RestController
@RequestMapping("/api/team")
@RequiredArgsConstructor
public class TeamController {

    private final TeamCatalogService service;

    /** El equipo completo: las personas del grupo de GLPI y las declaradas a mano. */
    @GetMapping
    public TeamCatalogResponse team() {
        return service.catalog();
    }
}
