package co.com.coltefinanciera.gestiondemanda;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/** Verifica que el contexto de Spring levante con la configuracion por defecto (sin GLPI). */
@SpringBootTest
@ActiveProfiles("test")
class GestionDemandaApplicationTests {

    @Test
    void contextLoads() {
        // El contexto debe levantarse aunque GLPI no este configurado. La base de datos si es
        // obligatoria: el perfil "test" la resuelve con H2 en memoria.
    }
}
