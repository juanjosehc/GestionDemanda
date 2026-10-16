const base = 'http://localhost:8080'
const r = await (await fetch(`${base}/api/planning-metadata/declarations/AbraAran`)).json()
console.log('AbraAran items:', r.items.length)
console.log('estados:', JSON.stringify(r.items.reduce((a,i)=>(a[i.declarationStatus]=(a[i.declarationStatus]??0)+1,a),{})))
const t = r.items.find((i) => i.workItemId === '68319')
console.log('68319 presente:', !!t)
if (t) console.log('  68319:', t.declarationStatus, '| declaration:', JSON.stringify(t.declaration), '| discards:', t.discards.map(d=>d.code).join(','))
