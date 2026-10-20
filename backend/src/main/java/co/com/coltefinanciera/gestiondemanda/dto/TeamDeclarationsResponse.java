package co.com.coltefinanciera.gestiondemanda.dto;

import java.util.List;

/**
 * Salida de {@code GET /api/planning-metadata/declarations?developerId=...}: las declaraciones de
 * varias personas en una sola lectura.
 *
 * <p><strong>No es una lectura nueva, es la misma repetida en un viaje.</strong> Cada elemento de
 * {@code developers} es exactamente el mismo {@link DeveloperDeclarationsResponse} que sirve la ruta
 * por persona —mismo contrato, misma clasificacion, mismo orden de tickets—, y se construye llamando
 * a la misma clasificacion, no a una segunda. Lo unico que cambia es que sale un cuerpo en vez de
 * tantos como personas haya.
 *
 * <p><strong>Por que existe.</strong> La ruta por persona es la correcta para la pantalla de
 * declaracion, donde se pregunta por un tecnico. El timeline del equipo pregunta por todos a la vez
 * para pintar la capa de pendientes, y ahi la ruta por persona multiplicaba las peticiones del
 * navegador por el numero de filas. Con esta, el timeline hace <em>una</em> lectura.
 *
 * <p><strong>Un 404 esperado no tumba la respuesta.</strong> Un identificador que GLPI no conoce —un
 * plan guardado a nombre de alguien que ya no tiene cuenta, por ejemplo— sigue siendo un dato, no un
 * fallo: viaja en {@code unknownDevelopers} y las demas personas se leen igual. Lo que no se hace es
 * inventar una respuesta vacia para el desconocido, porque «no tiene trabajo» y «no existe» no son
 * lo mismo. Los fallos que no son ese —GLPI caido— <em>sí</em> tumbean la lectura entera: una
 * respuesta parcial ahi afirmaria que el resto no tiene pendientes.
 *
 * <p><strong>Tiene un techo declarado.</strong> Cada persona cuesta dos lecturas a GLPI —resolver el
 * usuario y sus tickets—, y esta clase las recorre una detras de otra. Para el punado de personas con
 * plan vigente que pinta el timeline es la forma correcta; para el padron entero —cuarenta y tantas—
 * el navegador sigue leyendo por persona y en paralelo, que es mas rapido que una sola peticion que
 * serialice ochenta lecturas. El techo esta en ese tamano y no en el contrato: si GLPI algun dia
 * expone una lectura por lista, esta ruta gana sin cambiar su forma.
 *
 * @param developers       las personas que GLPI conocio, en el orden en que se pidieron
 * @param unknownDevelopers los identificadores que GLPI no conoce, en el orden en que se pidieron
 */
public record TeamDeclarationsResponse(
        List<DeveloperDeclarationsResponse> developers,
        List<String> unknownDevelopers) {

    public TeamDeclarationsResponse {
        developers = developers == null ? List.of() : List.copyOf(developers);
        unknownDevelopers = unknownDevelopers == null ? List.of() : List.copyOf(unknownDevelopers);
    }
}
