#!/usr/bin/env node
/**
 * A CASCATA: tudo que a Track mandou para a AIVA × o que a AIVA reconhece hoje
 * como loja da Track × o que a Ume pagou. Pedido do Aldo, 09/11/2026 ("traga a
 * verdade sobre isso"), depois de o Nei apontar 527 lojas em 25/10.
 *
 * A chave é sempre o CNPJ — retailer ID só existe depois que a loja é criada,
 * e o nome muda de grafia em toda fonte.
 *
 * Os degraus (cada um perde lojas, e cada perda tem um dono diferente):
 *   1. mandamos    — sdr_registros_cnpj (pré-cadastro enviado à whitelist)
 *   2. a AIVA abriu cadastro  — existe onboarding na API do portal
 *   3. a AIVA criou a loja    — o onboarding tem retailer_id
 *   4. o portal mede como Track — aparece em retailer_performance (retrato diário)
 *   5. a Ume pagou            — linha no fechamento de outubro/2026
 * Em paralelo, o que o NOSSO Evo diz: funil 11 (conta fechada) e funil 15.
 *
 * E os dois sentidos contrários, que são os que explicam número que não fecha:
 *   - loja no portal/fechamento que NUNCA mandamos (veio por fora)
 *   - loja que o Evo dá como fechada e que não existe em degrau nenhum da AIVA
 *
 * Uso: node --env-file=.env.local scripts/cascata-track-x-aiva.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const cnpj14 = (v) => { const d = dig(v); return d ? d.padStart(14, '0').slice(-14) : null }
const so10 = (d) => (d ? String(d).slice(0, 10) : '')
const pct = (a, b) => (b ? `${(a / b * 100).toFixed(0)}%` : '—')

const todos = async (tabela, select, filtro = (q) => q) => {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(sb.from(tabela).select(select)).range(de, de + 999)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}
const pipe = async (p) => {
  const r = await fetch(`${process.env.EVO_TALKS_BASE_URL}/int/getPipeOpportunities`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: Number(process.env.EVO_TALKS_QUEUE_ID ?? 10), apiKey: process.env.EVO_TALKS_API_KEY, pipelineId: p }),
  })
  if (!r.ok) throw new Error(`funil ${p}: HTTP ${r.status}`)
  return r.json()
}

const J = JSON.parse(readFileSync('scripts/out-conferencia-ume-2026-10.json', 'utf8'))

const [regs, leads, diario, f11, f15] = await Promise.all([
  todos('sdr_registros_cnpj', 'cnpj,loja,telefone,status,rid,ativa_em,criado_em,enviado_em,tipo,lead_id'),
  todos('sdr_leads', 'id,nome,telefone,status,status_alterado_em,observacoes,evotalks_opportunity_id'),
  todos('aiva_portal_diario', 'data_ref,retailer_id,cnpj,mes,vendas,status,nome_varejo,cadastro_em'),
  pipe(11),
  pipe(15),
])
const onb = []
{
  let c = null
  do {
    const q = new URLSearchParams({ limit: '500' })
    if (c) q.set('cursor', c)
    const r = await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, {
      headers: { 'x-api-key': process.env.AIVA_PORTAL_API_KEY }, signal: AbortSignal.timeout(20_000),
    })
    const d = await r.json()
    onb.push(...(d.records ?? []))
    c = d.next_cursor ?? null
  } while (c)
}

// parseDescricaoOpp do painel, simplificado: só o CNPJ escrito na descrição
const cnpjDaDescricao = (txt) => {
  const m = String(txt ?? '').match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/)
  return m ? cnpj14(m[1]) : null
}

// ─────────────────────── um registro por CNPJ ───────────────────────
const L = new Map()   // cnpj -> ficha
const ficha = (c) => {
  if (!c) return null
  if (!L.has(c)) L.set(c, { cnpj: c, nomes: new Set() })
  return L.get(c)
}

// 1. mandamos
for (const r of regs) {
  const f = ficha(cnpj14(r.cnpj)); if (!f) continue
  f.mandamos = true
  f.enviadoEm = so10(r.enviado_em ?? r.criado_em)
  f.statusRegistro = r.status
  f.ridNosso = r.rid ?? f.ridNosso ?? null
  f.ativaEm = r.ativa_em ?? f.ativaEm ?? null
  f.telefone = dig(r.telefone) || f.telefone
  f.leadId = r.lead_id ?? f.leadId
  if (r.loja) f.nomes.add(r.loja)
}
// 2 e 3. a AIVA abriu cadastro / criou a loja
for (const o of onb) {
  const f = ficha(cnpj14(o.cnpj)); if (!f) continue
  f.temOnboarding = true
  f.quadro = o.board_column
  f.quadroDesde = so10(o.board_column_since)
  f.biometria = o.biometry_status
  f.lojaCriada = Boolean(o.retailer_id)
  f.ridAiva = o.retailer_id ? String(o.retailer_id) : f.ridAiva ?? null
  f.criadaEm = so10(o.retailer_registered_at)
  if (o.retailer_name || o.legal_name) f.nomes.add(o.retailer_name ?? o.legal_name)
}
// 4. o portal mede como Track (retrato diário — último dia disponível e união)
const datas = [...new Set(diario.map((l) => l.data_ref))].sort()
const ULTIMO = datas[datas.length - 1]
for (const l of diario) {
  const f = ficha(cnpj14(l.cnpj)); if (!f) continue
  f.noPortalAlgumDia = true
  f.primeiroRetrato = f.primeiroRetrato && f.primeiroRetrato < l.data_ref ? f.primeiroRetrato : (f.primeiroRetrato ?? l.data_ref)
  if (l.data_ref === ULTIMO) {
    f.noPortalUltimo = true
    f.statusPortal = l.status
    f.ridAiva = f.ridAiva ?? String(l.retailer_id)
  }
  if (Number(l.vendas) > 0) f.vendeuAlgumMes = true
  if (l.nome_varejo) f.nomes.add(l.nome_varejo)
}
// retailer IDs que a conferência já tinha juntado (vêm também do UME_RID escrito
// na descrição do card do Evo, que é um ID que a Ume nos deu e que o portal pode
// não mostrar). Sem isso o degrau 5 subconta feio.
for (const l of J.lojas) {
  const f = ficha(l.cnpj); if (!f) continue
  f.ridsConhecidos = new Set([...(f.ridsConhecidos ?? []), ...l.rids, ...(f.ridAiva ? [f.ridAiva] : []), ...(f.ridNosso ? [f.ridNosso] : [])])
  for (const n of l.nomes ?? []) f.nomes.add(n)
}
for (const f of L.values()) {
  f.ridsConhecidos = new Set([...(f.ridsConhecidos ?? []), ...(f.ridAiva ? [f.ridAiva] : []), ...(f.ridNosso ? [String(f.ridNosso)] : [])])
}

// 5. a Ume pagou
// ⚠️ Casar o fechamento só por CNPJ SUBCONTA: mandamos o CNPJ da matriz e a AIVA
// às vezes cria a loja no CNPJ da filial (AppleCel 0001-19 × 0002-08). O vínculo
// forte é o retailer ID; o CNPJ entra só quando não há ID conhecido.
const fichaPorRid = new Map()
for (const f of L.values()) {
  for (const r of f.ridsConhecidos ?? []) if (r) fichaPorRid.set(String(r), f)
}
for (const l of J.relatorioLinhas) {
  const f = fichaPorRid.get(String(l.rid)) ?? ficha(l.cnpj)
  if (!f) continue
  f.pagaEmOutubro = true
  f.comissaoOut = (f.comissaoOut ?? 0) + l.comissao
  f.contratosOut = (f.contratosOut ?? 0) + l.contratos
  f.ridPago = f.ridPago ? `${f.ridPago}/${l.rid}` : String(l.rid)
  if (l.varejo) f.nomes.add(l.varejo)
}
// o que o NOSSO Evo diz
const ETAPA = { 49: 'Cadastro Recebido', 50: 'Form varejo pendente', 96: 'Biometria pendente', 97: 'Biometria aprovada', 70: 'Cadastro finalizado', 98: 'Treinamento agendado', 71: 'Pronto para operar', 99: 'Primeiro acesso', 51: 'Loja Finalizada e Vendendo', 95: 'Descartada pela Aiva', 94: 'CNPJ trava' }
/** do mais atrasado ao mais avançado — define qual card vence quando há vários */
const ORDEM_ETAPA = [95, 94, 49, 50, 96, 97, 70, 98, 71, 99, 51]
for (const o of f11) {
  if (!(o.tags ?? []).some((t) => [7, 69].includes(t))) continue
  const f = ficha(cnpjDaDescricao(o.description)); if (!f) continue
  f.contaFechada = true
  if (o.title) f.nomes.add(o.title)
}
// ⚠️ O card do funil 15 quase nunca traz CNPJ na descrição (o do funil 11 traz).
// O vínculo certo é pelo lead: sdr_leads.evotalks_opportunity_id aponta o card,
// e o lead chega ao CNPJ pelos registros. Casar o funil 15 por descrição devolve
// 1 loja na etapa 51 em vez de 147 — e some justamente com as lojas vendendo.
const leadPorId = new Map(leads.map((l) => [l.id, l]))
const cnpjsDoLead = new Map()
for (const r of regs) {
  if (!r.lead_id) continue
  const c = cnpj14(r.cnpj); if (!c) continue
  if (!cnpjsDoLead.has(r.lead_id)) cnpjsDoLead.set(r.lead_id, new Set())
  cnpjsDoLead.get(r.lead_id).add(c)
}
const leadPorOpp = new Map()
for (const l of leads) if (l.evotalks_opportunity_id) leadPorOpp.set(String(l.evotalks_opportunity_id), l)
for (const o of f15) {
  const nome = ETAPA[o.fkStage]; if (!nome) continue
  const alvos = new Set()
  const porDesc = cnpjDaDescricao(o.description)
  if (porDesc) alvos.add(porDesc)
  const lead = leadPorOpp.get(String(o.id))
  for (const c of cnpjsDoLead.get(lead?.id) ?? []) alvos.add(c)
  for (const c of alvos) {
    const f = ficha(c); if (!f) continue
    // a etapa mais avançada manda (um lead pode ter card antigo e card novo)
    if (f.etapa15Num == null || ORDEM_ETAPA.indexOf(o.fkStage) > ORDEM_ETAPA.indexOf(f.etapa15Num)) {
      f.etapa15 = nome
      f.etapa15Num = o.fkStage
    }
    if (o.title) f.nomes.add(o.title)
  }
}
for (const f of L.values()) {
  const lead = f.leadId ? leadPorId.get(f.leadId) : null
  if (lead) { f.statusLead = lead.status; f.telefone = f.telefone || dig(lead.telefone) }
}

const todas = [...L.values()]
const tem = (p) => todas.filter(p)

// ─────────────────────── a cascata ───────────────────────
const mandamos = tem((f) => f.mandamos)
const d1 = mandamos
const d2 = d1.filter((f) => f.temOnboarding)
const d3 = d2.filter((f) => f.lojaCriada)
const d4 = d3.filter((f) => f.noPortalAlgumDia)
const d5 = d4.filter((f) => f.pagaEmOutubro)

console.log('=============== A CASCATA (chave = CNPJ) ===============')
console.log('1. MANDAMOS para a AIVA (pré-cadastro enviado) ....... %d', d1.length)
console.log('2. a AIVA abriu cadastro (tem onboarding) ............ %d   (%s do degrau 1)', d2.length, pct(d2.length, d1.length))
console.log('3. a AIVA CRIOU a loja (tem retailer ID) ............. %d   (%s do degrau 2)', d3.length, pct(d3.length, d2.length))
console.log('4. o portal mede como Track (retrato diário) ......... %d   (%s do degrau 3)', d4.length, pct(d4.length, d3.length))
console.log('5. a Ume PAGOU em outubro ........................... %d   (%s do degrau 4)', d5.length, pct(d5.length, d4.length))
console.log('\nperdas de um degrau para o outro:')
console.log('   mandamos e a AIVA nem abriu cadastro ............. %d', d1.length - d2.length)
console.log('   abriu cadastro e NÃO criou a loja ................ %d', d2.length - d3.length)
console.log('   criou a loja e o portal não mede ................. %d', d3.length - d4.length)
console.log('   o portal mede e a Ume não pagou em outubro ....... %d', d4.length - d5.length)

console.log('\n=============== O QUE O NOSSO EVO DIZ ===============')
console.log('conta fechada no funil 11 (tag 7/69) ................. %d', tem((f) => f.contaFechada).length)
console.log('   dessas, a AIVA criou a loja ...................... %d', tem((f) => f.contaFechada && f.lojaCriada).length)
console.log('   dessas, sem loja criada na AIVA .................. %d', tem((f) => f.contaFechada && !f.lojaCriada).length)
console.log('funil 15 na etapa 51 (Loja Finalizada e Vendendo) .... %d', tem((f) => f.etapa15Num === 51).length)
console.log('   dessas, a AIVA criou a loja ...................... %d', tem((f) => f.etapa15Num === 51 && f.lojaCriada).length)
console.log('   dessas, o portal mede ............................ %d', tem((f) => f.etapa15Num === 51 && f.noPortalAlgumDia).length)
console.log('   dessas, a Ume pagou em outubro ................... %d', tem((f) => f.etapa15Num === 51 && f.pagaEmOutubro).length)
console.log('lead LOJA_FINALIZADA_E_VENDENDO ...................... %d', tem((f) => f.statusLead === 'LOJA_FINALIZADA_E_VENDENDO').length)

console.log('\n=============== O SENTIDO CONTRÁRIO ===============')
// Dois conjuntos diferentes, que é fácil confundir: a AIVA e a Ume não são a
// mesma base. O fechamento da Ume traz FCDL e varejo dela que nunca passou pelo
// nosso funil — isso não é furo, é outro canal.
const noPortalSemMandar = tem((f) => !f.mandamos && (f.noPortalAlgumDia || f.lojaCriada))
console.log('no portal da AIVA (como Track) e NUNCA mandamos ...... %d', noPortalSemMandar.length)
for (const f of noPortalSemMandar)
  console.log('     %s  %s  | retailer %s | quadro %s', f.cnpj, ([...f.nomes][0] ?? '?').slice(0, 30).padEnd(30), f.ridAiva ?? '—', f.quadro ?? '—')
const noFechamentoSemMandar = tem((f) => !f.mandamos && f.pagaEmOutubro)
console.log('no fechamento da Ume e nunca mandamos ................ %d   (FCDL + varejo da própria Ume)', noFechamentoSemMandar.length)
console.log('   desses, que o portal da AIVA mede como Track ..... %d', noFechamentoSemMandar.filter((f) => f.noPortalAlgumDia).length)

console.log('\n=============== PAGAS × PORTAL (o cruzamento que importa) ===============')
const nossa = (f) => f.mandamos || f.contaFechada || f.etapa15 || f.noPortalAlgumDia || f.statusLead
const pagas = tem((f) => f.pagaEmOutubro)
const pagasNossas = pagas.filter(nossa)
const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
console.log('linhas do fechamento de outubro ..................... %d CNPJs', pagas.length)
console.log('   que a Track reconhece como sua ................... %d  (%s)', pagasNossas.length, brl(pagasNossas.reduce((s, f) => s + (f.comissaoOut ?? 0), 0)))
console.log('   dessas, que o portal da AIVA mede como Track ..... %d  (%s)',
  pagasNossas.filter((f) => f.noPortalAlgumDia).length, brl(pagasNossas.filter((f) => f.noPortalAlgumDia).reduce((s, f) => s + (f.comissaoOut ?? 0), 0)))
console.log('   ⚠️ pagas a nós e que o portal NÃO mostra ......... %d  (%s)',
  pagasNossas.filter((f) => !f.noPortalAlgumDia).length, brl(pagasNossas.filter((f) => !f.noPortalAlgumDia).reduce((s, f) => s + (f.comissaoOut ?? 0), 0)))
console.log('   (a Ume paga por elas, o portal da AIVA não as lista: a base dos dois não é a mesma)')
console.log('no portal como Track e SEM pagamento em outubro ..... %d', tem((f) => f.noPortalAlgumDia && !f.pagaEmOutubro).length)
console.log('   dessas, com venda registrada em algum mês ........ %d', tem((f) => f.noPortalAlgumDia && !f.pagaEmOutubro && f.vendeuAlgumMes).length)

console.log('\n=============== O PORTAL ENCOLHEU? ===============')
console.log('retratos diários: %s a %s (%d dias)', datas[0], ULTIMO, datas.length)
console.log('CNPJs que já apareceram no portal da Track ........... %d', tem((f) => f.noPortalAlgumDia).length)
console.log('CNPJs no ÚLTIMO retrato (%s) ................. %d', ULTIMO, tem((f) => f.noPortalUltimo).length)
console.log('SUMIRAM do portal (estavam e não estão) .............. %d', tem((f) => f.noPortalAlgumDia && !f.noPortalUltimo).length)
for (const f of tem((f) => f.noPortalAlgumDia && !f.noPortalUltimo))
  console.log('   %s  %s  (visto desde %s)', f.cnpj, [...f.nomes][0] ?? '?', f.primeiroRetrato)

// ─────────────────────── dump ───────────────────────
const degrau = (f) => !f.mandamos ? '0. veio por fora (não mandamos)'
  : !f.temOnboarding ? '1. mandamos e a AIVA não abriu cadastro'
    : !f.lojaCriada ? '2. cadastro aberto, loja NÃO criada'
      : !f.noPortalAlgumDia ? '3. loja criada, o portal não mede'
        : !f.pagaEmOutubro ? '4. o portal mede, a Ume não pagou em outubro'
          : '5. paga em outubro'

const saida = todas.map((f) => ({
  degrau: degrau(f),
  cnpj: f.cnpj,
  loja: [...f.nomes][0] ?? '',
  telefone: f.telefone ?? '',
  mandamos: f.mandamos ? 'sim' : 'nao',
  enviadoEm: f.enviadoEm ?? '',
  statusRegistro: f.statusRegistro ?? '',
  temOnboarding: f.temOnboarding ? 'sim' : 'nao',
  quadroAiva: f.quadro ?? '',
  quadroDesde: f.quadroDesde ?? '',
  biometria: f.biometria ?? '',
  lojaCriada: f.lojaCriada ? 'sim' : 'nao',
  retailerId: [...(f.ridsConhecidos ?? [])].join('/'),
  retailerIdNoPortal: f.ridAiva ?? '',
  criadaEm: f.criadaEm ?? '',
  noPortal: f.noPortalAlgumDia ? 'sim' : 'nao',
  noPortalHoje: f.noPortalUltimo ? 'sim' : 'nao',
  statusPortal: f.statusPortal ?? '',
  vendeuNoPortal: f.vendeuAlgumMes ? 'sim' : 'nao',
  pagaEmOutubro: f.pagaEmOutubro ? 'sim' : 'nao',
  comissaoOut: Number((f.comissaoOut ?? 0).toFixed(2)),
  contratosOut: f.contratosOut ?? 0,
  contaFechadaEvo: f.contaFechada ? 'sim' : 'nao',
  etapa15: f.etapa15 ?? '',
  statusLead: f.statusLead ?? '',
})).sort((a, b) => a.degrau.localeCompare(b.degrau) || a.loja.localeCompare(b.loja))

writeFileSync('scripts/out-cascata-track-aiva.json', JSON.stringify({
  ultimoRetrato: ULTIMO, primeiroRetrato: datas[0], diasDeRetrato: datas.length,
  curva: datas.map((d) => ({ data: d, lojas: new Set(diario.filter((l) => l.data_ref === d).map((l) => String(l.retailer_id))).size })),
  cascata: { mandamos: d1.length, onboarding: d2.length, lojaCriada: d3.length, noPortal: d4.length, paga: d5.length },
  linhas: saida,
}, null, 1))
console.log('\ndump: scripts/out-cascata-track-aiva.json (%d CNPJs)', saida.length)
setTimeout(() => process.exit(0), 500).unref()
