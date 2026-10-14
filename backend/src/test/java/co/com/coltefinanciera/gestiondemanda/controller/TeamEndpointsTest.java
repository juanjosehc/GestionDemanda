package co.com.coltefinanciera.gestiondemanda.controller;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import co.com.coltefinanciera.gestiondemanda.exception.GlpiUnreachableException;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiPlanningSource;
import co.com.coltefinanciera.gestiondemanda.integration.glpi.GlpiUser;

/**
 * Pruebas HTTP del padron del equipo.
 *
 * <p>Levantan el contexto entero porque lo que se comprueba es el contrato que consume la pantalla: los
 * nombres de los campos, que cada persona diga de donde viene y que el fallo de GLPI viaje dentro de la
 * respuesta en lugar de convertirse en un error. Eso ultimo es lo que no se puede probar en el servicio:
 * alli se ve la degradacion, aqui se ve que llega al cliente como {@code 200} y no como {@code 500}.
 *
 * <p>Las excepciones se declaran por propiedad y no en {@code application-test.properties} para que se
 * lean en la propia prueba: lo que se afirma depende de quien esta declarado.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "team.exceptions[NicoSuar].name=Nicolas Alejandro Suarez Flores",
        "team.exceptions[NicoSuar].glpi-id=1071",
        "team.exceptions[AnaPerez].name=Ana Perez, declarada por error",
})
class TeamEndpointsTest {

    private static final String RUTA = "/api/team";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GlpiPlanningSource glpiPlanningSource;

    @Test
    @DisplayName("El padron publica el origen, el sello y a cada persona con el suyo")
    void publicaElOrigenYElSello() throws Exception {
        grupoDeGlpi(usuario(1202, "AnaPerez", "Ana", "Perez", true));

        mockMvc.perform(get(RUTA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generatedAt").isNotEmpty())
                .andExpect(jsonPath("$.source.glpi").isNotEmpty())
                .andExpect(jsonPath("$.source.exceptions").isNotEmpty())
                .andExpect(jsonPath("$.glpi.available").value(true))
                .andExpect(jsonPath("$.glpi.groupId").value(1))
                .andExpect(jsonPath("$.glpi.groupName").value("Desarrollo N2"))
                .andExpect(jsonPath("$.glpi.detail").value(nullValue()))
                .andExpect(jsonPath("$.people", hasSize(2)))
                // Ordenado por identificador, que es el orden en el que la pantalla lo enseña.
                .andExpect(jsonPath("$.people[0].developerId").value("AnaPerez"))
                .andExpect(jsonPath("$.people[0].glpiId").value(1202))
                .andExpect(jsonPath("$.people[0].name").value("Ana Perez"))
                .andExpect(jsonPath("$.people[0].active").value(true))
                .andExpect(jsonPath("$.people[0].sourceType").value("GLPI"))
                .andExpect(jsonPath("$.people[1].developerId").value("NicoSuar"))
                .andExpect(jsonPath("$.people[1].glpiId").value(1071))
                .andExpect(jsonPath("$.people[1].name").value("Nicolas Alejandro Suarez Flores"))
                .andExpect(jsonPath("$.people[1].sourceType").value("EXCEPTION"))
                // La excepcion de Ana no se aplico —GLPI la entrega— y el padron lo dice.
                .andExpect(jsonPath("$.unusedExceptions", contains("AnaPerez")));
    }

    @Test
    @DisplayName("Con GLPI caido responde 200 con las excepciones y el motivo, no un error")
    void conGlpiCaidoRespondeConElMotivo() throws Exception {
        when(glpiPlanningSource.membersOfGroup("1"))
                .thenThrow(new GlpiUnreachableException("Connection refused", null));

        mockMvc.perform(get(RUTA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.glpi.available").value(false))
                .andExpect(jsonPath("$.glpi.detail").value("Connection refused"))
                .andExpect(jsonPath("$.people", hasSize(2)))
                .andExpect(jsonPath("$.people[*].sourceType", contains("EXCEPTION", "EXCEPTION")))
                .andExpect(jsonPath("$.unusedExceptions", empty()));
    }

    private void grupoDeGlpi(GlpiUser... miembros) {
        when(glpiPlanningSource.membersOfGroup("1")).thenReturn(List.of(miembros));
    }

    private static GlpiUser usuario(
            int id, String login, String nombre, String apellido, Boolean vigente) {

        return new GlpiUser(id, login, apellido, nombre, vigente);
    }
}
