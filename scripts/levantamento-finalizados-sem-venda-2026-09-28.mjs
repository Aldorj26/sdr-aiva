/**
 * levantamento-finalizados-sem-venda-2026-09-28.mjs — leads com status
 * LOJA_FINALIZADA_E_VENDENDO que NÃO têm venda no portal da AIVA (Aldo, 28/09/2026).
 * SÓ LEITURA: monta a sugestão de etapa pela situação real no portal e grava
 * scripts/out-finalizados-sem-venda-2026-09-28.json (a planilha sai do .py irmão).
 *
 * Sugestão (mesma lógica do espelho portal→Evo):
 *   cadastro aberto no portal (formulário/biometria) → Em Análise AIVA (50)
 *   loja criada, senha NÃO registrada                 → Treinar (70)
 *   loja criada, senha enviada (ou anterior a 12/08)  → Login (71)
 *   reprovado pela AIVA                               → Loja Descartada pela Aiva (95)
 *   CNPJ não achado no portal                         → conferir na mão
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const agora = Date.now(), DIA = 864e5

const leads = []
for (let de = 0; ; de += 1000) { const { data } = await sb.from('sdr_leads').select('id,nome,telefone,cidade,observacoes,evotalks_opportunity_id,criado_em').eq('status', 'LOJA_FINALIZADA_E_VENDENDO').range(de, de + 999); leads.push(...data); if (data.length < 1000) break }
const ids = leads.map((l) => l.id)
const regs = []; for (let i = 0; i < ids.length; i += 200) { const { data } = await sb.from('sdr_registros_cnpj').select('lead_id,cnpj,tipo').in('lead_id', ids.slice(i, i + 200)); regs.push(...data) }
const cnpjsDe = (l) => [...new Set([...regs.filter((r) => r.lead_id === l.id).map((r) => dig(r.cnpj)), dig((l.observacoes ?? '').match(/cnpj_matriz=([0-9./-]+)/)?.[1])].filter((c) => c.length === 14))]

const { data: desemp } = await sb.from('aiva_desempenho').select('cnpj,mes,vendas,consultas')
const vendeu = new Set(desemp.filter((d) => d.vendas > 0).map((d) => dig(d.cnpj)))
const consultou = new Set(desemp.filter((d) => d.consultas > 0).map((d) => dig(d.cnpj)))

const onbs = []; let cursor = null
do { const q = new URLSearchParams({ limit: '500' }); if (cursor) q.set('cursor', cursor); const d = await (await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, { headers: { 'x-api-key': process.env.AIVA_PORTAL_API_KEY } })).json(); onbs.push(...(d.records ?? [])); cursor = d.next_cursor ?? null } while (cursor)
const onb = new Map(onbs.map((o) => [dig(o.cnpj), o]))
const U = process.env.AIVA_PORTAL_URL.replace(/\/$/, ''), A = process.env.AIVA_PORTAL_ANON_KEY
const tok = await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: A }, body: JSON.stringify({ email: process.env.AIVA_PORTAL_EMAIL, password: process.env.AIVA_PORTAL_SENHA }) })).json()
const H = { apikey: A, Authorization: `Bearer ${tok.access_token}` }
const ls = []; for (let de = 0; ; de += 1000) { const r = await fetch(`${U}/rest/v1/login_sends?select=retailer_id,permission_requested_at,credentials_sent_at`, { headers: { ...H, Range: `${de}-${de + 999}` } }); if (r.status === 416) break; const d = await r.json(); ls.push(...d); if (d.length < 1000) break }
const enviada = new Set(ls.filter((x) => x.credentials_sent_at).map((x) => String(x.retailer_id)))
const pedida = new Set(ls.map((x) => String(x.retailer_id)))
const perf = []; for (let de = 0; ; de += 1000) { const r = await fetch(`${U}/rest/v1/retailer_performance?select=retailer_id,cnpj,registered_at`, { headers: { ...H, Range: `${de}-${de + 999}` } }); if (r.status === 416) break; const d = await r.json(); perf.push(...d); if (d.length < 1000) break }
const perfCnpj = new Map(perf.map((p) => [dig(p.cnpj), p]))

const cards = await (await fetch(`${process.env.EVO_TALKS_BASE_URL}/int/getPipeOpportunities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: 10, apiKey: process.env.EVO_TALKS_API_KEY, pipelineId: 15 }) })).json()
const etapa = new Map(cards.map((c) => [Number(c.id), Number(c.fkStage)]))

const ultIn = new Map()
for (let i = 0; i < ids.length; i += 100) for (let de = 0; ; de += 1000) { const { data } = await sb.from('sdr_mensagens').select('lead_id,enviado_em').in('lead_id', ids.slice(i, i + 100)).eq('direcao', 'in').range(de, de + 999); for (const m of data) { const t = Date.parse(m.enviado_em); if (!ultIn.has(m.lead_id) || t > ultIn.get(m.lead_id)) ultIn.set(m.lead_id, t) } if (data.length < 1000) break }

const ORDEM = { em_analise: 0, treinar: 1, login: 2, reprovado: 3, conferir: 4 }
const out = []
for (const l of leads) {
  const cs = cnpjsDe(l)
  if (cs.some((c) => vendeu.has(c))) continue // já vendeu: status certo
  const situ = cs.map((c) => {
    const o = onb.get(c), p = perfCnpj.get(c)
    const rid = o?.retailer_id ? String(o.retailer_id) : p?.retailer_id ? String(p.retailer_id) : null
    const criada = String(o?.retailer_registered_at ?? p?.registered_at ?? '').slice(0, 10)
    let s
    if (o?.stage === 'not_approved') s = 'reprovado'
    else if (rid) s = enviada.has(rid) || (!pedida.has(rid) && criada && criada < '2026-08-12') ? 'login' : 'treinar'
    else if (o) s = o.stage === 'biometria' && o.biometry_status === 'aprovado' ? 'em_analise' : 'em_analise'
    else s = 'conferir'
    return { cnpj: c, s, stage: o?.stage ?? (p ? 'só no desempenho' : 'não está no portal'), rid, senha: rid ? (enviada.has(rid) ? 'enviada' : pedida.has(rid) ? 'pedida, não enviada' : criada < '2026-08-12' ? 'anterior ao controle' : 'sem pedido') : '-', consultou: consultou.has(c) }
  })
  // a melhor situação entre os CNPJs do lead manda (o mais avançado)
  const melhor = situ.length ? situ.reduce((a, b) => ({ login: 3, treinar: 2, em_analise: 1, reprovado: 0, conferir: -1 }[b.s] > { login: 3, treinar: 2, em_analise: 1, reprovado: 0, conferir: -1 }[a.s] ? b : a)) : null
  const sug = melhor?.s ?? 'conferir'
  const opp = Number(l.evotalks_opportunity_id) || null
  out.push({
    nome: l.nome, telefone: l.telefone, cidade: l.cidade,
    cnpjs: cs.join(', ') || '(nenhum CNPJ gravado)',
    portal: situ.map((x) => `${x.cnpj}: ${x.stage}${x.rid ? ` RID ${x.rid}` : ''}${x.rid ? ` · senha ${x.senha}` : ''}${x.consultou ? ' · já consultou' : ''}`).join(' | ') || '-',
    card: opp ? (etapa.get(opp) ?? 'fora do funil 15') : 'sem card',
    silencio: ultIn.has(l.id) ? Math.floor((agora - ultIn.get(l.id)) / DIA) : null,
    importado: (l.observacoes ?? '').includes('[IMPORTADO_PORTAL') ? 'sim' : '',
    sugestao: sug, ordem: ORDEM[sug],
  })
}
out.sort((a, b) => a.ordem - b.ordem || (a.silencio ?? 9999) - (b.silencio ?? 9999))
fs.writeFileSync('scripts/out-finalizados-sem-venda-2026-09-28.json', JSON.stringify(out, null, 1))
const c = {}; for (const x of out) c[x.sugestao] = (c[x.sugestao] ?? 0) + 1
const ce = {}; for (const x of out) ce[x.card] = (ce[x.card] ?? 0) + 1
console.log('sem venda:', out.length, '| sugestão:', JSON.stringify(c), '| card hoje:', JSON.stringify(ce), '| importados do portal:', out.filter((x) => x.importado).length)
console.log('silêncio do lojista: <=30d', out.filter((x) => x.silencio != null && x.silencio <= 30).length, '| 31-90d', out.filter((x) => x.silencio > 30 && x.silencio <= 90).length, '| >90d', out.filter((x) => x.silencio > 90).length, '| nunca', out.filter((x) => x.silencio == null).length)
