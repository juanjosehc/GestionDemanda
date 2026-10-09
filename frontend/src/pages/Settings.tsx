import { useGlpiHealth } from '@/hooks/useGlpiHealth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const ENV_VARIABLES = [
  { name: 'GLPI_URL', hint: 'URL del API REST, incluye /apirest.php' },
  { name: 'GLPI_APP_TOKEN', hint: 'App-Token generado en GLPI' },
  { name: 'GLPI_USER_TOKEN', hint: 'Token del usuario de integración' },
  { name: 'GLPI_TIMEOUT', hint: 'Opcional. Por defecto 5s' },
] as const

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-right text-sm font-medium',
          ok === true && 'text-emerald-600',
          ok === false && 'text-red-600',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/** Solo lectura: la configuración real vive en el backend (.env o variables de entorno). */
export function Settings() {
  const { data, isPending, isError } = useGlpiHealth()
  const loading = isPending && !data

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Integración GLPI</CardTitle>
          <CardDescription>Parámetros activos reportados por el backend</CardDescription>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-5 w-full" />
              ))}
            </div>
          ) : (
            <dl>
              <Row label="URL del API" value={data?.baseUrl || 'No configurada'} />
              <Row
                label="Conectado"
                value={isError ? 'Backend no disponible' : data?.connected ? 'Sí' : 'No'}
                ok={!isError && data?.connected}
              />
              <Row
                label="Autenticado"
                value={data?.authenticated ? 'Sí' : 'No'}
                ok={data?.authenticated}
              />
              <Row label="Detalle" value={isError ? 'Error consultando el backend' : (data?.detail ?? '—')} />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variables de entorno</CardTitle>
          <CardDescription>
            Se definen en el archivo <code className="font-mono text-xs">.env</code> del backend
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <ul className="space-y-3">
            {ENV_VARIABLES.map((variable) => (
              <li key={variable.name} className="space-y-0.5">
                <p className="font-mono text-xs font-medium">{variable.name}</p>
                <p className="text-xs text-muted-foreground">{variable.hint}</p>
              </li>
            ))}
          </ul>

          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            Los tokens nunca se exponen al frontend: el endpoint de salud reporta únicamente
            si están configurados, no su valor.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
