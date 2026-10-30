package co.com.coltefinanciera.gestiondemanda.service;

import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.function.IntPredicate;

import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;

import co.com.coltefinanciera.gestiondemanda.domain.enums.OperationalAlertType;
import co.com.coltefinanciera.gestiondemanda.dto.OperationalAlert;
import co.com.coltefinanciera.gestiondemanda.dto.OperationalAlertResponse;
import co.com.coltefinanciera.gestiondemanda.dto.PlanningOperationalMetricsResponse;

/**
 * Las alertas operativas: la fotografia, juzgada.
 *
 * <p><strong>Es una proyeccion, y se toma la palabra en serio.</strong> Este servicio no tiene
 * repositorios, no tiene reloj y no conoce el motor: su unica dependencia es {@link
 * PlanningMetricsService}, y todo lo que hace es leer su respuesta y contar. No hay un segundo camino
 * hacia la base, asi que una alerta y la metrica de la que sale <em>no pueden discrepar</em>: no es una
 * promesa, es que no existe la forma de que se separen.
 *
 * <p><strong>Por que un servicio aparte y no un metodo en {@link PlanningMetricsService}.</strong> El
 * servicio de metricas tiene un oficio declarado —traducir lo guardado a numeros— y las alertas no son
 * numeros: son un juicio sobre ellos, con severidad y con destino. Meterlas alli obligaria a tocar el
 * contrato de la Fase 17 para publicar dos contadores que hoy no publica. Ademas es la costura por la
 * que una fase futura engancharia una notificacion sin tocar nada de esto.
 *
 * <p><strong>Cuatro de los seis numeros ya estaban contados.</strong> Las dos carencias declaradas, lo
 * incompleto y los desplazamientos son, literalmente, el numero que la fotografia publica. Los dos de
 * capacidad son lo unico que se cuenta aqui, y se cuentan filtrando la lista de desarrolladores que la
 * fotografia ya produjo, con los mismos dos predicados que usa la tabla de cuellos de botella —restante
 * exactamente cero y restante negativo—, no con umbrales nuevos. Los dos son excluyentes, asi que un
 * desarrollador cae en una de las dos alertas o en ninguna, nunca en las dos.
 *
 * <p><strong>Sin transaccion, y es deliberado</strong>, por el mismo motivo que la fotografia: la
 * unica lectura que hay —la suya— abre y cierra la suya.
 *
 * <p><strong>Un plan vigente roto tumba las alertas enteras.</strong> Si la fotografia responde
 * {@code 404 PLAN_NOT_FOUND}, ese {@code 404} sale de aqui sin recortarlo. Una lista de alertas
 * calculada sobre una foto incompleta diria que no hay problemas donde no se ha mirado, que es la peor
 * forma de fallar de una alerta.
 */
@Service
@RequiredArgsConstructor
public class OperationalAlertService {

    private final PlanningMetricsService planningMetricsService;

    /** Las condiciones que hoy se cumplen, de mas grave a menos. */
    public OperationalAlertResponse alerts() {
        return project(planningMetricsService.metrics());
    }

    /**
     * La proyeccion, pura: de la fotografia a las alertas.
     *
     * <p>Es estatica y no toca nada —ni Spring, ni la base, ni el reloj— para poder probarla
     * construyendo el estado a mano. Y hace falta: la alerta de capacidad negativa <em>no puede
     * dispararse de punta a punta</em>, porque el motor nunca sobrepasa la jornada. Aqui, donde el
     * estado se escribe en vez de producirse, si se puede.
     *
     * <p>El catalogo no esta aqui: se recorre {@link OperationalAlertType}, que es donde estan escritas
     * la severidad, la condicion y el destino de cada alerta. Aqui solo se aporta el numero. Añadir una
     * alerta al catalogo la hace aparecer sola, y olvidarse de decir cuanto urge no compila.
     */
    static OperationalAlertResponse project(PlanningOperationalMetricsResponse photo) {
        List<OperationalAlert> alerts = Arrays.stream(OperationalAlertType.values())
                .map(type -> alertOf(type, photo))
                .filter(alert -> alert.count() > 0)
                .sorted(Comparator.comparing(OperationalAlert::severity)
                        .thenComparing(OperationalAlert::type))
                .toList();

        return new OperationalAlertResponse(photo.generatedAt(), alerts);
    }

    /** Una alerta, con todo menos el numero tomado del catalogo y el numero contado aqui. */
    private static OperationalAlert alertOf(
            OperationalAlertType type, PlanningOperationalMetricsResponse photo) {

        Provenance provenance = provenanceOf(type);

        return new OperationalAlert(
                type,
                type.severity(),
                provenance.source(),
                type.condition(),
                provenance.scope(),
                countOf(type, photo),
                type.detailUrl(),
                photo.generatedAt());
    }

    /**
     * Cuantos elementos cumplen la condicion de una alerta, leido de la fotografia.
     *
     * <p>Sin rama por defecto, como el {@code switch} de las carencias declaradas: añadir una alerta al
     * catalogo deja de compilar hasta que se diga de donde sale su numero, en vez de publicar un cero
     * que diria que no hay problema.
     */
    private static long countOf(OperationalAlertType type, PlanningOperationalMetricsResponse photo) {
        return switch (type) {
            case CAPACIDAD_NEGATIVA -> developersWith(photo, signum -> signum < 0);
            case CAPACIDAD_AGOTADA -> developersWith(photo, signum -> signum == 0);
            case REQUERIMIENTOS_DESPLAZADOS -> photo.current().displacedRequirements();
            case SIN_ESTIMACION -> photo.declared().withoutEstimation().count();
        };
    }

    /**
     * Cuantos desarrolladores vigentes estan en un estado de capacidad.
     *
     * <p>El predicado se aplica al signo del restante y no al restante: comparar un {@code BigDecimal}
     * con cero usando {@code equals} falla por la escala —{@code 0} y {@code 0.0} no son iguales para
     * {@code equals}—, que es la clase de fallo que aparece una vez cada dos años y cuesta una tarde.
     */
    private static long developersWith(
            PlanningOperationalMetricsResponse photo, IntPredicate remaining) {

        return photo.current().byDeveloper().stream()
                .filter(developer -> remaining.test(developer.capacity().remainingHours().signum()))
                .count();
    }

    /**
     * De que bloque de la fotografia sale el numero, con la procedencia que ese bloque ya publica.
     *
     * <p>Los textos se toman de las constantes del contrato en vez de escribirse aqui: la alerta dice de
     * donde sale su numero con las mismas palabras con las que lo dice la metrica, y si el origen de un
     * bloque cambia, cambia en los dos sitios a la vez.
     */
    private static Provenance provenanceOf(OperationalAlertType type) {
        return switch (type) {
            case CAPACIDAD_NEGATIVA, CAPACIDAD_AGOTADA, REQUERIMIENTOS_DESPLAZADOS ->
                    new Provenance(
                            PlanningOperationalMetricsResponse.Current.SOURCE,
                            PlanningOperationalMetricsResponse.Current.SCOPE);
            case SIN_ESTIMACION ->
                    new Provenance(
                            PlanningOperationalMetricsResponse.Declared.SOURCE,
                            PlanningOperationalMetricsResponse.Declared.SCOPE);
        };
    }

    /** La procedencia de un numero: de que tabla sale y sobre que se conto. */
    private record Provenance(String source, String scope) {
    }
}
