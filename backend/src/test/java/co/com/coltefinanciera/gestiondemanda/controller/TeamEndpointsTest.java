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
 *
 * <p><strong>Lo que esta prueba no puede afirmar, y por que.</strong> El perfil de pruebas no sustituye
 * a {@code application.properties}: lo complementa, asi que las dieciocho marcas de equipo operativo de
 * produccion se cargan tambien aqui, y {@code unusedOperational} llega lleno de logins que no existen en
 * el grupo falseado. Afirmar que esa lista esta vacia seria afirmar algo sobre la configuracion de
 * produccion desde una prueba. Por eso lo que se afirma es **la bandera de una persona concreta**, que
 * se controla declarando su marca aqui, y el caso de la marca sin destinatario se prueba en
 * {@code TeamCatalogServiceTest}, que construye la configuracion a mano y no hereda nada.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "team.exceptions[NicoSuar].name=Nicolas Alejandro Suarez Flores",
        "team.exceptions[NicoSuar].glpi-id=1071",
        "team.exceptions[AnaPerez].name=Ana Perez, declarada por error",
        // La pertenencia se declara aqui por el mismo motivo que las excepciones, y ademas porque el
        // perfil de pruebas no sustituye a la configuracion de produccion: sin estas dos lineas, los dos
        // valores vendrian de alli y la prueba afirmaria lo que diga el fichero de produccion.
        "team.operational[AnaPerez]=true",
        "team.operational[NicoSuar]=false",
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
                // La pertenencia viaja con la persona, y las dos filas siguen aqui: marcar no recorta.
                .andExpect(jsonPath("$.people[0].operational").value(true))
                .andExpect(jsonPath("$.people[1].developerId").value("NicoSuar"))
                .andExpect(jsonPath("$.people[1].glpiId").value(1071))
                .andExpect(jsonPath("$.people[1].name").value("Nicolas Alejandro Suarez Flores"))
                .andExpect(jsonPath("$.people[1].sourceType").value("EXCEPTION"))
                // El «false» de la configuracion se lee como lo que es: fuera del equipo operativo, y en
                // el padron igual. Es lo que distingue una decision escrita de un olvido.
                .andExpect(jsonPath("$.people[1].operational").value(false))
                // La excepcion de Ana no se aplico —GLPI la entrega— y el padron lo dice.
                .andExpect(jsonPath("$.unusedExceptions", contains("AnaPerez")))
                // El campo viaja siempre; aqui llega lleno porque el perfil de pruebas no sustituye a
                // la configuracion de produccion (ver el javadoc de la clase). Lo que se afirma es su
                // forma, no su contenido: afirmar el contenido seria afirmar el fichero de produccion.
                .andExpect(jsonPath("$.unusedOperational").isArray());
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
                // La pertenencia no depende de que GLPI responda: es una decision escrita, no una
                // lectura, y sobrevive a que el grupo no se pueda leer.
                .andExpect(jsonPath("$.people[0].operational").value(true))
                .andExpect(jsonPath("$.people[1].operational").value(false))
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
