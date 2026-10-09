package co.com.coltefinanciera.gestiondemanda.integration.glpi;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.StreamSupport;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import co.com.coltefinanciera.gestiondemanda.exception.GlpiInvalidDataException;

/**
 * Compara el contrato que el adaptador asume contra una respuesta real de GLPI.
 *
 * <p>Es la respuesta al riesgo 43. Hasta ahora todo lo que se daba por cierto de GLPI estaba
 * justificado por documentacion y por sentido comun, y ninguna de las dos cosas es una instancia. Esta
 * clase recibe el JSON que GLPI devolvio de verdad —copiado de una respuesta, de un registro, de una
 * prueba manual— y dice en que se diferencia de lo declarado en {@link GlpiContract}: que campos
 * faltan, cuales llegan con otro tipo, cuales no estan modelados, que prioridades se salen de la
 * escala y que fechas no se pueden leer.
 *
 * <p><strong>No consulta GLPI.</strong> Recibe texto. Es deliberado y es lo que la hace util: se puede
 * ejecutar contra una captura guardada, contra la respuesta de un {@code curl} hecho a mano y contra
 * un caso inventado en una prueba, sin depender de que la instancia este disponible ni de que las
 * credenciales funcionen. Quien trae el JSON es otra cosa; esto solo lo lee.
 *
 * <p><strong>El veredicto distingue lo que rompe de lo que solo degrada.</strong> {@code INCOMPATIBLE}
 * es que falta un campo obligatorio o que uno llega con otro tipo: el adaptador no puede leer esa
 * respuesta y hay que cambiarlo antes de seguir. {@code DEGRADED} es que se lee, pero por un camino de
 * respaldo: una prioridad fuera de escala se interpreta como ausente y una fecha ilegible descarta el
 * ticket. {@code COMPATIBLE} es que todo se lee como se declaro. Un campo desconocido <em>no</em>
 * degrada nada: significa que GLPI trae mas de lo que se modela, que es informacion y no un problema.
 */
public final class GlpiContractVerifier {

    /** Hasta donde llega la coincidencia entre lo declarado y lo observado. */
    public enum Verdict {

        /** Todo lo declarado esta y se lee como se declaro. */
        COMPATIBLE,

        /** Se puede leer, pero algo entro por un camino de respaldo. */
        DEGRADED,

        /** No se puede leer: falta un campo obligatorio o uno llega con otro tipo. */
        INCOMPATIBLE
    }

    /**
     * El resultado de comparar una respuesta contra el contrato.
     *
     * <p>Cada lista acumula hallazgos ya deduplicados y en el orden en que aparecieron, para que dos
     * tickets con el mismo defecto no inflen el informe y para que el texto se pueda leer tal cual.
     */
    public record Report(
            String adapterVersion,
            String contractVersion,
            Verdict verdict,
            int tickets,
            List<String> missingRequired,
            List<String> unknownFields,
            List<String> typeMismatches,
            List<String> outOfRangeValues,
            List<String> unreadableDates) {

        public Report {
            missingRequired = List.copyOf(missingRequired);
            unknownFields = List.copyOf(unknownFields);
            typeMismatches = List.copyOf(typeMismatches);
            outOfRangeValues = List.copyOf(outOfRangeValues);
            unreadableDates = List.copyOf(unreadableDates);
        }

        public boolean compatible() {
            return verdict == Verdict.COMPATIBLE;
        }
    }

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Los campos que el contrato declara como escala de prioridad. */
    private static final Set<String> PRIORITY_FIELDS = Set.of("priority", "impact", "urgency");

    /** Los campos que el contrato declara como fecha. */
    private static final Set<String> DATE_FIELDS = Set.of("date", "time_to_resolve");

    private GlpiContractVerifier() {
    }

    /** Verifica una respuesta contra {@link GlpiContract#REST_V1}, que es el contrato en uso. */
    public static Report verify(String rawJson) {
        return verify(rawJson, GlpiContract.REST_V1);
    }

    /**
     * Verifica una respuesta contra un contrato concreto.
     *
     * <p>Acepta tanto un ticket suelto como el arreglo que devuelve {@code /Ticket}, porque las dos
     * formas son respuestas legitimas del API y obligar a envolver una para verificarla seria trabajo
     * para quien llama sin ganancia para nadie.
     */
    public static Report verify(String rawJson, GlpiContract contract) {
        JsonNode root = parse(rawJson);
        List<JsonNode> tickets = root.isArray()
                ? StreamSupport.stream(root.spliterator(), false).toList()
                : List.of(root);

        Set<String> missing = new LinkedHashSet<>();
        Set<String> unknown = new LinkedHashSet<>();
        Set<String> mismatched = new LinkedHashSet<>();
        Set<String> outOfRange = new LinkedHashSet<>();
        Set<String> unreadable = new LinkedHashSet<>();

        DateTimeFormatter dates = DateTimeFormatter.ofPattern(contract.datePattern());

        for (JsonNode ticket : tickets) {
            collectUnknown(ticket, contract, unknown);
            collectMissingAndMismatched(ticket, contract, missing, mismatched);
            collectOutOfRange(ticket, contract, outOfRange);
            collectUnreadableDates(ticket, dates, unreadable);
        }

        return new Report(
                GlpiRestPlanningSource.VERSION,
                contract.version(),
                verdict(missing, mismatched, outOfRange, unreadable),
                tickets.size(),
                List.copyOf(missing),
                List.copyOf(unknown),
                List.copyOf(mismatched),
                List.copyOf(outOfRange),
                List.copyOf(unreadable));
    }

    private static Verdict verdict(Set<String> missing, Set<String> mismatched, Set<String> outOfRange,
            Set<String> unreadable) {

        if (!missing.isEmpty() || !mismatched.isEmpty()) {
            return Verdict.INCOMPATIBLE;
        }
        if (!outOfRange.isEmpty() || !unreadable.isEmpty()) {
            return Verdict.DEGRADED;
        }
        return Verdict.COMPATIBLE;
    }

    /** Lo que GLPI manda y el contrato no declara: no es un defecto, es lo que aun no se modela. */
    private static void collectUnknown(JsonNode ticket, GlpiContract contract, Set<String> unknown) {
        Iterator<String> names = ticket.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            if (!contract.ticketFields().containsKey(name)) {
                unknown.add(name);
            }
        }
    }

    private static void collectMissingAndMismatched(JsonNode ticket, GlpiContract contract,
            Set<String> missing, Set<String> mismatched) {

        contract.ticketFields().forEach((name, field) -> {
            JsonNode value = ticket.get(name);
            if (value == null || value.isNull()) {
                if (field.required()) {
                    missing.add(name);
                }
                return;
            }
            if (!matches(field.type(), value)) {
                mismatched.add(name + ": se esperaba " + field.type() + " y llego " + value.getNodeType());
            }
        });
    }

    private static void collectOutOfRange(JsonNode ticket, GlpiContract contract, Set<String> outOfRange) {
        for (String name : PRIORITY_FIELDS) {
            JsonNode value = ticket.get(name);
            if (value != null && value.isIntegralNumber() && !contract.inScale(value.intValue())) {
                outOfRange.add(name + "=" + value.intValue() + " fuera de la escala "
                        + contract.minPriority() + ".." + contract.maxPriority());
            }
        }
    }

    private static void collectUnreadableDates(JsonNode ticket, DateTimeFormatter dates,
            Set<String> unreadable) {

        for (String name : DATE_FIELDS) {
            JsonNode value = ticket.get(name);
            if (value != null && value.isTextual() && !parseable(value.textValue(), dates)) {
                unreadable.add(name + "='" + value.textValue() + "'");
            }
        }
    }

    private static boolean matches(String declared, JsonNode value) {
        return switch (declared) {
            case GlpiContract.Field.INTEGER -> value.isIntegralNumber();
            case GlpiContract.Field.STRING -> value.isTextual();
            default -> true;
        };
    }

    private static boolean parseable(String raw, DateTimeFormatter format) {
        try {
            LocalDateTime.parse(raw.trim(), format);
            return true;
        } catch (DateTimeParseException ex) {
            return false;
        }
    }

    /**
     * Lee el cuerpo que se va a verificar.
     *
     * <p>Un cuerpo que no es JSON no es un contrato incompatible: es un fallo de datos, y sale como
     * tal. Distinguirlo importa porque el veredicto {@code INCOMPATIBLE} manda a revisar el contrato y
     * este manda a revisar la respuesta.
     */
    private static JsonNode parse(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            throw new GlpiInvalidDataException("No hay respuesta de GLPI que verificar");
        }
        try {
            return JSON.readTree(rawJson);
        } catch (JsonProcessingException ex) {
            throw new GlpiInvalidDataException(
                    "La respuesta de GLPI no se puede leer como JSON: " + ex.getOriginalMessage(), ex);
        }
    }
}
