package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.util.List;

/**
 * Salida de {@code GET /api/planning/alerts}: lo que hoy exige que alguien mire.
 *
 * <p><strong>No es una fuente de verdad y no recalcula nada.</strong> Es una proyeccion de
 * {@link PlanningOperationalMetricsResponse}: cada alerta toma su numero de un contador que la
 * fotografia ya publicaba, o —en las dos de capacidad— cuenta elementos de una lista que la fotografia
 * ya produjo. No se ejecuta el motor, no se consulta GLPI y no se lee la base por un camino distinto.
 * La consecuencia practica es la que importa: <em>la alerta y la metrica no pueden discrepar</em>,
 * porque no hay un segundo camino que pudiera separarse.
 *
 * <p><strong>Que añade sobre la fotografia.</strong> La fotografia describe un estado; no dice cual de
 * esos estados exige actuar. Nueve contadores hay que leerlos y juzgarlos; una alerta ya viene juzgada
 * —trae su severidad— y con el destino donde se ve el problema. Eso es pasar de una observabilidad
 * pasiva a una activa sin introducir ningun automatismo: nadie recibe nada, sigue habiendo que
 * preguntar; pero lo que se recibe ya viene con la pregunta contestada.
 *
 * <p><strong>Solo se listan las alertas disparadas.</strong> Una condicion que hoy no se cumple no
 * aparece, y cuando no se cumple ninguna la lista va vacia. El catalogo entero —las seis— esta en
 * {@link co.com.coltefinanciera.gestiondemanda.domain.enums.OperationalAlertType}: aqui no se repite
 * para decir «estas no», porque un catalogo publicado dos veces acaba publicado de dos formas.
 *
 * <p><strong>La salida va ordenada por gravedad</strong> y, dentro de cada nivel, por el orden del
 * catalogo. El orden no depende de por donde se recorra nada, asi que dos respuestas iguales se pueden
 * comparar con los ojos.
 *
 * @param generatedAt cuando se evaluaron las condiciones. Va tambien aqui, y no solo en cada alerta,
 *                    para que una lista vacia —«no hay nada que mirar»— se pueda fechar igualmente.
 * @param alerts      las alertas disparadas, de mas grave a menos. Vacia si no hay ninguna.
 */
public record OperationalAlertResponse(Instant generatedAt, List<OperationalAlert> alerts) {
}
