import { AlertTriangle, ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { DeclaredGapTable } from '@/components/dashboard/DeclaredGapTable'
import { DisplacedRequirementsTable } from '@/components/dashboard/DisplacedRequirementsTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeclaredGap, useDisplaced } from '@/hooks/usePlanningMetrics'
import { ROUTES } from '@/routes/navigation'
import { DISPLACED_TOKEN, isMetricToken } from '@/types/planningMetrics'
import type { MetricGap } from '@/types/planningMetrics'

/**
 * Lo que cada desglose es, en palabras.
 *
 * Las tres carencias declaradas comparten la misma forma de fila y solo cambian el titulo y la
 * explicacion; el cuarto desglose no se parece a ellas y tiene su propio texto. La tabla se queda
 * fuera a proposito: lo que se dice aqui es lo que el backend ya afirma con su `scope`.
 */
const DECLARED: Record<MetricGap, { title: string; description: string }> = {
  'sin-estimacion': {
    title: 'Requerimientos sin estimación',
    description:
      'Filas declaradas a las que nadie les puso horas. Sin estimación un requerimiento no entra al motor de planificación.',
  },
  'sin-compromiso': {
    title: 'Requerimientos sin compromiso',
    description:
      'Filas declaradas a las que nadie les puso fecha compromiso. Se pueden planificar, pero ninguna fecha declarada las ancla.',
  },
  'metadata-incompleta': {
    title: 'Metadata incompleta',
    description:
      'Todo lo que le falta al menos un valor: las que no tienen estimación, las que no tienen compromiso y las retiradas, que no tienen ninguno de los dos.',
  },
}

const DISPLACED = {
  title: 'Requerimientos desplazados',
  description:
    'Elementos que el plan vigente movió de su fecha original, con el incidente que los movió y la regla que se aplicó. Cada fila es un elemento: uno movido dos veces aparece una vez, con sus dos eventos.',
}

const INSTANT_FORMAT = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * La cascada de estados de una consulta, escrita una sola vez.
 *
 * Cargando, error con reintento, o el contenido. Es la misma forma que usa el tablero, y vive aqui
 * porque esta pagina tiene dos consultas distintas —una carencia declarada o los desplazamientos— y
 * no hay motivo para escribir la cascada dos veces.
 */
function DetailStates({
  isPending,
  isError,
  error,
  refetch,
  children,
}: {
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => void
  children: ReactNode
}) {
  if (isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  if (isError) {
    return (
      <EmptyState
        tone="danger"
        icon={AlertTriangle}
        title="No fue posible cargar el desglose"
        detail={error instanceof Error ? error.message : 'Error desconocido'}
        action={
          <Button variant="outline" size="sm" onClick={refetch}>
            Reintentar
          </Button>
        }
      />
    )
  }

  return <>{children}</>
}

/**
 * El encabezado de un desglose, con de donde salen sus filas.
 *
 * `source` y `scope` los declara el backend dentro de la respuesta, no esta vista: por eso el
 * encabezado solo existe cuando hay datos. Repetirlos aqui como texto fijo seria afirmar algo que
 * nadie comprueba.
 */
function DetailHeader({
  title,
  description,
  source,
  scope,
  generatedAt,
}: {
  title: string
  description: string
  source: string
  scope: string
  generatedAt: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-1 text-xs text-muted-foreground">
        <p>
          Origen: <span className="font-mono">{source}</span>
        </p>
        <p>Ámbito: {scope}</p>
        <p>
          Lista generada el <time dateTime={generatedAt}>{INSTANT_FORMAT.format(new Date(generatedAt))}</time>
        </p>
      </CardContent>
    </Card>
  )
}

/** Una carencia declarada: las filas de `planning_metadata` que la producen. */
function DeclaredDetail({ gap }: { gap: MetricGap }) {
  const { data, isPending, isError, error, refetch } = useDeclaredGap(gap)
  const { title, description } = DECLARED[gap]

  return (
    <div className="space-y-6">
      {data && (
        <DetailHeader
          title={title}
          description={description}
          source={data.source}
          scope={data.scope}
          generatedAt={data.generatedAt}
        />
      )}

      <DetailStates isPending={isPending} isError={isError} error={error} refetch={() => void refetch()}>
        {data && (
          <Card>
            <CardContent>
              <DeclaredGapTable items={data.items} />
            </CardContent>
          </Card>
        )}
      </DetailStates>
    </div>
  )
}

/** Los desplazamientos del plan vigente de cada desarrollador. */
function DisplacedDetail() {
  const { data, isPending, isError, error, refetch } = useDisplaced()

  return (
    <div className="space-y-6">
      {data && (
        <DetailHeader
          title={DISPLACED.title}
          description={DISPLACED.description}
          source={data.source}
          scope={data.scope}
          generatedAt={data.generatedAt}
        />
      )}

      <DetailStates isPending={isPending} isError={isError} error={error} refetch={() => void refetch()}>
        {data && (
          <Card>
            <CardContent>
              <DisplacedRequirementsTable items={data.items} />
            </CardContent>
          </Card>
        )}
      </DetailStates>
    </div>
  )
}

/** Una direccion que no corresponde a ninguna metrica del tablero. */
function UnknownMetric({ token }: { token: string | undefined }) {
  return (
    <EmptyState
      tone="danger"
      icon={AlertTriangle}
      title="Esa métrica no existe"
      detail={`«${token ?? ''}» no es una de las métricas navegables del tablero. No se pidió nada al servidor: la dirección se comprueba antes de consultar.`}
      action={
        <Button variant="outline" size="sm" asChild>
          <Link to={ROUTES.dashboard}>
            <ArrowLeft />
            Volver al tablero
          </Link>
        </Button>
      }
    />
  )
}

/**
 * El desglose de una metrica del tablero: de la cifra a los elementos que la producen.
 *
 * No calcula nada. Cada lista la sirve el backend desde la misma informacion que ya cuenta la
 * tarjeta —`planning_metadata` para lo declarado, el plan vigente y su auditoria para lo movido— y
 * esta pagina solo elige que tabla pintar y con que titulo.
 *
 * El segmento de la URL se valida antes de consultar: una direccion inventada se explica como tal en
 * vez de traducirse en una peticion que el backend contesta con un 400. Una sola pagina sirve los
 * cuatro desgloses porque los cuatro son la misma pregunta —que hay detras de esa cifra— y solo
 * cambian el origen y la forma de la fila.
 */
export function MetricDetail() {
  const { gap } = useParams()

  if (!isMetricToken(gap)) {
    return <UnknownMetric token={gap} />
  }

  return gap === DISPLACED_TOKEN ? <DisplacedDetail /> : <DeclaredDetail gap={gap} />
}
