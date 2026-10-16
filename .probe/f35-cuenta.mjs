// Solo lectura: cuenta los tickets activos del equipo operativo y busca uno compartido.
const base = 'http://localhost:8080'
const team = await (await fetch(`${base}/api/team`)).json()
const people = team.people
const operativos = people.filter((p) => p.operational)
const seen = new Map() // workItemId -> [developerId]
const status = {}
let total = 0
for (const p of operativos) {
  const url = `${base}/api/planning-metadata/declarations/${encodeURIComponent(p.developerId)}`
  const r = await fetch(url)
  if (!r.ok) { console.log('FALLO', p.developerId, r.status); continue }
  const body = await r.json()
  for (const item of body.items ?? []) {
    total++
    status[item.declarationStatus] = (status[item.declarationStatus] ?? 0) + 1
    if (!seen.has(item.workItemId)) seen.set(item.workItemId, [])
    seen.get(item.workItemId).push(p.developerId)
  }
}
const compartidos = [...seen.entries()].filter(([, ids]) => new Set(ids).size > 1)
console.log('padron total:', people.length, '| operativos:', operativos.length)
console.log('filas activas (persona x ticket):', total, '| tickets distintos:', seen.size)
console.log('estados:', JSON.stringify(status))
console.log('compartidos:', compartidos.length, JSON.stringify(compartidos.slice(0, 5)))
