import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ROUTES } from '@/routes/navigation'

export function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-5xl font-semibold tracking-tight">404</p>
      <p className="text-sm text-muted-foreground">La página solicitada no existe.</p>
      <Button asChild>
        <Link to={ROUTES.dashboard}>Volver al dashboard</Link>
      </Button>
    </div>
  )
}
