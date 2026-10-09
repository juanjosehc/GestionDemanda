import { Users } from 'lucide-react'

import { ComingSoon } from '@/components/ComingSoon'

export function Resources() {
  return (
    <ComingSoon
      icon={Users}
      title="Gestión de recursos"
      description="El modelo de recursos ya está definido en types/resource.ts. Falta el mantenimiento de datos y su exposición mediante la API."
      planned={[
        'Alta, baja y modificación de recursos del equipo',
        'Capacidad semanal y disponibilidad por recurso',
        'Calendarios individuales, ausencias y festivos',
        'Endpoints REST en el backend (aún no existen)',
      ]}
    />
  )
}
