import type { LucideIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'

interface ComingSoonProps {
  icon: LucideIcon
  title: string
  description: string
  /** Alcance previsto, para dejar explicito que falta y por que. */
  planned?: readonly string[]
}

/** Panel para las secciones cuyo alcance funcional pertenece a la Fase 2. */
export function ComingSoon({ icon: Icon, title, description, planned = [] }: ComingSoonProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" />
        </span>

        <div className="max-w-lg space-y-1.5">
          <p className="text-base font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        {planned.length > 0 && (
          <ul className="mt-2 space-y-1.5 text-left text-xs text-muted-foreground">
            {planned.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
