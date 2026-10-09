import { AlertTriangle } from 'lucide-react'

import { ComingSoon } from '@/components/ComingSoon'

export function Incidents() {
  return (
    <ComingSoon
      icon={AlertTriangle}
      title="Incidentes y requerimientos"
      description="Origen de los datos: GLPI. La Fase 1 solo verifica la conectividad; la carga de incidentes y requerimientos, y su priorización, llegan en la Fase 2."
      planned={[
        'Sincronización de incidentes y requerimientos desde GLPI',
        'Motor de priorización entre ambas fuentes',
        'Asignación de prioridad, recurso y fecha comprometida',
        'Integración con la línea de tiempo del calendario',
      ]}
    />
  )
}
