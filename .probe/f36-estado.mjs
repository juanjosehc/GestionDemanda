// Solo lectura: el estado de entrada del motor, hoy, para todo el padron.
const base = 'http://localhost:8080'
const team = await (await fetch(`${base}/api/team`)).json()
const estados = {}
const porPersona = []
let filas = 0, conFila = 0
for (const p of team.people) {
  const r = await fetch(`${base}/api/planning-metadata/declarations/${encodeURIComponent(p.developerId)}`)
  if (!r.ok) { console.log('FALLO', p.developerId, r.status); continue }
  const body = await r.json()
  const cuenta = {}
  for (const it of body.items ?? []) {
    filas++
    if (it.declaration) conFila++
    estados[it.declarationStatus] = (estados[it.declarationStatus] ?? 0) + 1
    cuenta[it.declarationStatus] = (cuenta[it.declarationStatus] ?? 0) + 1
  }
  porPersona.push({ id: p.developerId, nombre: p.name, operativo: p.operational, n: (body.items ?? []).length, cuenta })
}
console.log('personas:', team.people.length)
console.log('filas activas:', filas, '| con fila de metadata:', conFila)
console.log('estados:', JSON.stringify(estados, null, 1))
const mixtas = porPersona.filter((x) => Object.keys(x.cuenta).length > 1)
console.log('personas con mezcla de estados:', mixtas.length, JSON.stringify(mixtas.slice(0,3)))
console.log('personas con trabajo:', porPersona.filter(x=>x.n>0).length)
console.log('muestra:', JSON.stringify(porPersona.filter(x=>x.n>0).slice(0,4)))
