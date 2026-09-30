// Uso: node --env-file=.env.local scripts/sonda-api-aiva.mjs — compara com o retrato de 24/09 (26 campos) e lista caminhos/filtros.
// Sondagem SÓ LEITURA da API pública da AIVA (GET/OPTIONS). Nada de POST: remove e resend-password têm efeito real.
const BASE = 'https://parceiro-aiva.lovable.app/api/public/partner'
const H = { 'x-api-key': process.env.AIVA_PORTAL_API_KEY }
const CONHECIDOS = ['id', 'cnpj', 'legal_name', 'partner_owner_name', 'retailer_id', 'retailer_name', 'stage', 'pre_cadastro_status', 'formulario_status', 'biometry_status', 'training_at', 'retailer_registered_at', 'created_at', 'updated_at', 'phone_number', 'email', 'liveness_url', 'cnpj_check_status', 'cnpj_check_reason', 'cnpj_official_name', 'cnpj_situacao', 'cnpj_checked_at', 'cnpj_opened_at', 'training_id', 'training_label', 'training_source']

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: H })
  const t = await r.text()
  let j = null; try { j = JSON.parse(t) } catch {}
  return { status: r.status, j, t, ctype: r.headers.get('content-type') }
}

// 1) registros e campos
const pg = await get('/onboardings?limit=500')
const recs = pg.j?.records ?? []
console.log('GET /onboardings →', pg.status, '| chaves da resposta:', Object.keys(pg.j ?? {}).join(', '), '| registros na página:', recs.length)
const campos = new Set(); for (const r of recs) Object.keys(r).forEach((k) => campos.add(k))
console.log('campos por registro:', campos.size)
console.log('  NOVOS:', [...campos].filter((c) => !CONHECIDOS.includes(c)).join(', ') || '(nenhum)')
console.log('  SUMIRAM:', CONHECIDOS.filter((c) => !campos.has(c)).join(', ') || '(nenhum)')
for (const c of [...campos].filter((c) => !CONHECIDOS.includes(c))) {
  const vals = recs.map((r) => r[c]).filter((v) => v != null && v !== '')
  console.log(`  · ${c}: ${vals.length}/${recs.length} preenchidos · exemplos: ${JSON.stringify([...new Set(vals.map((v) => typeof v === 'object' ? JSON.stringify(v) : v))].slice(0, 4))}`)
}
// total e distribuição
let todos = [...recs], cursor = pg.j?.next_cursor
while (cursor) { const p = await get(`/onboardings?limit=500&cursor=${encodeURIComponent(cursor)}`); todos.push(...(p.j?.records ?? [])); cursor = p.j?.next_cursor }
const dist = (k) => JSON.stringify(todos.reduce((a, r) => (a[r[k]] = (a[r[k]] ?? 0) + 1, a), {}))
console.log('total de cadastros:', todos.length)
console.log('stage:', dist('stage'))
console.log('biometry_status:', dist('biometry_status'))
console.log('cnpj_check_status:', dist('cnpj_check_status'))
for (const c of [...campos].filter((c) => !CONHECIDOS.includes(c) && todos.some((r) => typeof r[c] === 'string' && r[c].length < 40))) console.log(`${c}:`, dist(c))

// 2) parâmetros de filtro (filtro de verdade reduz a contagem)
const tamanho = async (q) => { const p = await get(`/onboardings?limit=500&${q}`); return `${p.status} → ${p.j?.records?.length ?? '-'}${p.j?.error ? ' ' + JSON.stringify(p.j.error).slice(0, 80) : ''}` }
for (const q of ['stage=biometria', 'cnpj=' + (todos[0]?.cnpj ?? ''), 'retailer_id=' + (todos.find((r) => r.retailer_id)?.retailer_id ?? ''), 'updated_since=2026-09-29T00:00:00Z', 'updated_after=2026-09-29T00:00:00Z', 'since=2026-09-29', 'q=cell', 'search=cell', 'biometry_status=aprovado', 'order=updated_at.desc'])
  console.log(`  ?${q.slice(0, 60)} ${await tamanho(q)}`)

// 3) caminhos
const caminhos = ['', '/', '/docs', '/openapi', '/openapi.json', '/swagger.json', '/health', '/me', '/stores', '/retailers', '/performance', '/retailer-performance', '/sales', '/vendas', '/consultas', '/queries', '/trainings', '/training-sessions', '/training-bookings', '/login-sends', '/credentials', '/password-resends', '/liveness', '/biometry', '/users', '/sellers', '/team', '/webhooks', '/events', '/onboardings/events', '/onboardings/stats', '/onboardings/export', '/onboardings/restore', '/onboardings/remove', '/onboardings/resend-password', '/onboardings/' + (todos[0]?.id ?? 'x'), '/onboardings/cnpj/' + String(todos[0]?.cnpj ?? '').replace(/\D/g, '')]
for (const c of caminhos) {
  const p = await get(c)
  const resumo = p.j ? JSON.stringify(p.j).slice(0, 140) : p.t.slice(0, 80).replace(/\s+/g, ' ')
  if (p.status !== 404) console.log(`  GET ${c.padEnd(40)} ${p.status}  ${resumo}`)
}
console.log('(caminhos com 404 omitidos)')
