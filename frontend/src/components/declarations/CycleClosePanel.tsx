import { CalendarRange, Handshake, PlayCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ROUTES, planningPath } from '@/routes/navigation'

interface CycleClosePanelProps {
  developerId: string
  developerName: string
  /** Cuantas declaraciones se acaban de guardar en esta sesion. */
  count: number
}

/**
 * Lo que viene despues de declarar, en el mismo sitio donde se declaro.
 *
 * **Declarar no es cubrir.** La Fase 47 lo midio: un ticket declarado pasa de «falta informacion» a
 * «no incluido en el ultimo plan», y solo cuenta como cubierto cuando el motor lo coloca y su fecha
 * queda acordada. El gestor tenía que recordar esa cadena y reconstruirla a mano por tres pantallas.
 * Este panel la deja escrita, con el tecnico ya puesto en el enlace.
 *
 * No genera ni acuerda nada por su cuenta: son enlaces a las pantallas que ya existen, porque
 * planificar escribe y un acuerdo es una decision de dos partes. Lo que se quita es el tecleo y el
 * cambio de contexto, no la accion.
 */
export function CycleClosePanel({ developerId, developerName, count }: CycleClosePanelProps) {
  return (
    <Card data-slot="cycle-close">
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          {count === 1 ? 'Declaración guardada' : `${count} declaraciones guardadas`}
        </CardTitle>
        <CardDescription>
          La cobertura se mueve cuando el plan coloca el trabajo y la fecha queda acordada. Estos son
          los dos pasos que faltan, con {developerName} ya elegido.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link to={planningPath(developerId)} data-slot="cycle-plan">
            <PlayCircle aria-hidden="true" />
            Generar plan de {developerName}
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to={ROUTES.renegotiations} data-slot="cycle-renegotiate">
            <Handshake aria-hidden="true" />
            Registrar acuerdos
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to={ROUTES.teamTimeline} data-slot="cycle-timeline">
            <CalendarRange aria-hidden="true" />
            Volver al Timeline
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
