import { Route, Routes } from 'react-router-dom'

import { MainLayout } from '@/layouts/MainLayout'
import { Alerts } from '@/pages/Alerts'
import { Calendar } from '@/pages/Calendar'
import { Dashboard } from '@/pages/Dashboard'
import { Declarations } from '@/pages/Declarations'
import { Incidents } from '@/pages/Incidents'
import { MetricDetail } from '@/pages/MetricDetail'
import { NotFound } from '@/pages/NotFound'
import { Planning } from '@/pages/Planning'
import { PlanningPreview } from '@/pages/PlanningPreview'
import { Renegotiations } from '@/pages/Renegotiations'
import { Resources } from '@/pages/Resources'
import { Settings } from '@/pages/Settings'
import { ROUTES } from '@/routes/navigation'

/** Tabla de rutas. Las rutas cuelgan de MainLayout mediante una ruta sin path (layout). */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Dashboard />} />
        <Route path={ROUTES.alerts} element={<Alerts />} />
        <Route path={ROUTES.resources} element={<Resources />} />
        <Route path={ROUTES.calendar} element={<Calendar />} />
        <Route path={ROUTES.calendarPlan} element={<Calendar />} />
        <Route path={ROUTES.incidents} element={<Incidents />} />
        <Route path={ROUTES.declarations} element={<Declarations />} />
        <Route path={ROUTES.planning} element={<Planning />} />
        <Route path={ROUTES.planningPreview} element={<PlanningPreview />} />
        <Route path={ROUTES.renegotiations} element={<Renegotiations />} />
        <Route path={ROUTES.metricDetail} element={<MetricDetail />} />
        <Route path={ROUTES.settings} element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
