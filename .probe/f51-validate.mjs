// Validacion real de la Fase 51: el universo de Declaracion contra el que recibe el motor.
// Lee la declaracion de cada tecnico y despues pide el plan por el camino real (from-glpi).
import { writeFileSync } from 'node:fs'

const BASE = 'http://localhost:8080'
const PEOPLE = ['MaurMarm', 'JoseGarc', 'AbraAran']

for (const person of PEOPLE) {
  const declarationResponse = await fetch(
    `${BASE}/api/planning-metadata/declarations/${person}`,
  )
  const declaration = await declarationResponse.json()

  const planResponse = await fetch(`${BASE}/api/planning/from-glpi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ developerId: person }),
  })
  const plan = await planResponse.json()

  writeFileSync(
    `.probe/f51-after-${person}.json`,
    JSON.stringify({ declaration, plan }, null, 2),
  )

  const items = declaration.items ?? []
  const active = items.filter((item) => [1, 2, 3, 4].includes(item.status))
  const statuses = {}
  for (const item of active) {
    statuses[item.declarationStatus] = (statuses[item.declarationStatus] ?? 0) + 1
  }

  const declared = new Set(items.map((item) => item.workItemId))
  const discards = plan.discarded ?? []
  const discardedIds = [...new Set(discards.map((discard) => discard.ticketId))]
  const hidden = discardedIds.filter((id) => !declared.has(id))
  const allocations = plan.plan?.allocations ?? []

  console.log(`\n=== ${person} (HTTP declaracion ${declarationResponse.status}, plan ${planResponse.status}) ===`)
  console.log(`Declaracion: ${items.length} tickets, activos ${active.length}`, statuses)
  console.log(`Motor: ${allocations.length} asignaciones, ${discards.length} descartes sobre ${discardedIds.length} tickets`)
  console.log(`Descartes con ticket: ${discardedIds.join(', ') || '(ninguno)'}`)
  console.log(`Descartes sobre tickets que Declaracion no muestra: ${hidden.join(', ') || '(ninguno)'}`)
  console.log(
    `IDs planificados: ${[...new Set(allocations.map((a) => a.workItemId))].sort().join(', ') || '(ninguno)'}`,
  )
}
