const base = 'http://localhost:8080'
const team = await (await fetch(`${base}/api/team`)).json()
for (const p of team.people) {
  const r = await fetch(`${base}/api/planning-metadata/declarations/${encodeURIComponent(p.developerId)}`)
  if (!r.ok) continue
  const b = await r.json()
  for (const it of b.items ?? []) {
    if (it.declaration || it.declarationStatus !== 'SIN_DECLARACION') {
      console.log(`${p.developerId} / ${it.workItemId} / ${it.declarationStatus} / ${it.type} / ${it.status}`)
      console.log('   declaration:', JSON.stringify(it.declaration))
      console.log('   discards:', JSON.stringify(it.discards))
    }
  }
}
