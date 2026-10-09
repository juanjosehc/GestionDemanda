package co.com.coltefinanciera.gestiondemanda.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Cuerpo de {@code POST /api/planning/from-glpi}: a quien se le planifica desde GLPI.
 *
 * <p>Pide un solo dato, y es deliberado. Todo lo demas —los incidentes, los requerimientos, sus
 * horas, sus fechas— no lo elige quien llama: lo trae GLPI. Un cuerpo con campos para las reglas
 * abriria la puerta a que el plan no corresponda a la configuracion con que se decidio, y la
 * trazabilidad de la Fase 8 quedaria afirmando algo falso. Si hace falta planificar con otras reglas,
 * se cambia la configuracion, que es donde vive la politica.
 *
 * <p>{@code developerId} es el identificador con que se busca al usuario en GLPI, y es tambien el que
 * queda registrado en el plan: la respuesta se puede correlacionar con la peticion sin conocer la
 * numeracion interna de GLPI.
 */
public record PlanningFromGlpiRequest(@NotBlank String developerId) {
}
