// Matchers de jest-dom (toBeInTheDocument, toHaveLength...) sobre el expect de Vitest.
import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * El presupuesto de las esperas de `findBy*`, subido de los 1000 ms por defecto a 3000.
 *
 * **Medido, no supuesto.** Con el valor por defecto, una de cada doce pasadas completas de la
 * bateria fallaba esperando el padron —`Unable to find role="option" and name "Ana Perez"`— con la
 * pantalla en un estado intermedio legitimo: el desplegable ya pintado y el padron todavia sin
 * llegar. La causa no es la pantalla sino el entorno: trece entornos jsdom en paralelo sobre una
 * carpeta sincronizada con OneDrive, donde cualquier stall del sistema se come el segundo entero.
 *
 * **No afloja ninguna afirmacion.** `waitFor` vuelve en cuanto la condicion se cumple, asi que en
 * una maquina despejada esto no cuesta nada; lo unico que cambia es cuanto se espera antes de darse
 * por vencido. Y sigue por debajo del `testTimeout` de 5 s, asi que una pantalla que de verdad se
 * cuelga sigue fallando —solo que tres segundos mas tarde—.
 */
configure({ asyncUtilTimeout: 3000 })

// Testing Library solo se limpia sola si los globales de Vitest estan activos, y aqui no lo
// estan. Sin esto el DOM se acumula entre casos y `screen` encuentra restos del anterior.
afterEach(cleanup)
