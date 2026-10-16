package co.com.coltefinanciera.gestiondemanda.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Salida de {@code GET /api/planning/plans/{developerId}}: el historial de planes de un tecnico, del
 * mas antiguo al mas reciente.
 *
 * <p><strong>Es una lectura, y es la que faltaba.</strong> Hasta aqui un plan se podia releer por su
 * identificador, pero no habia forma de saber <em>cuales</em> tiene un tecnico: {@code /metrics}
 * publica el vigente de cada uno y descarta el resto, y nadie devolvia el historial. Sin esta lista,
 * «el plan anterior de este tecnico» no es una cosa nombrable, y la pregunta que la vista de
 * comparacion viene a contestar —que cambio entre dos planes— no se puede ni formular.
 *
 * <p>No planifica, no ejecuta el motor y no escribe nada. El orden lo fija la consulta y el navegador
 * no lo reordena: quien compara elige «el anterior» por posicion, y una segunda definicion de cual es
 * el anterior seria una segunda respuesta a la misma pregunta.
 *
 * <p><strong>Dos entradas pueden ser el mismo trabajo planificado dos veces.</strong> Guardar un plan
 * no es idempotente (riesgo 70): cada {@code POST} deja una fila nueva aunque el escenario sea
 * identico. Por eso {@code scope} lo dice en el propio payload y no solo aqui: quien lea el JSON
 * dentro de seis meses no va a venir a leer este comentario, y creer que la lista tiene planes
 * distintos cuando puede tener ejecuciones repetidas es exactamente el error que este campo evita.
 *
 * <p>No lleva un {@code total}: seria {@code plans.size()} con otro nombre.
 *
 * @param developerId el tecnico, tal como lo pidio quien llamo
 * @param plans       sus planes, del mas antiguo al mas reciente; vacio si no tiene ninguno
 * @param scope       que es exactamente este conjunto
 */
public record DeveloperPlansResponse(
        String developerId,
        List<Plan> plans,
        String scope) {

    public DeveloperPlansResponse {
        plans = plans == null ? List.of() : List.copyOf(plans);
    }

    /**
     * Un plan guardado, reducido a lo que hace falta para nombrarlo y situarlo.
     *
     * <p>Solo el identificador y cuando se calculo. Todo lo demas —la agenda, los conflictos, la
     * entrada, el contexto— se lee del plan concreto por sus propias rutas: devolverlo aqui obligaria
     * a traerse el historial entero del tecnico para elegir una fila.
     *
     * <p>{@code developerId} no se repite en cada fila porque es constante en la lista y ya viaja en
     * la respuesta.
     */
    public record Plan(UUID planId, Instant createdAt) {
    }
}
