#!/usr/bin/env node
/**
 * Lojas que o NOSSO quadro dá como fechadas mas que não existem (ou não viraram
 * loja) do lado da AIVA — pedido do Aldo, 09/11/2026, depois de a conferência de
 * comissão de outubro esbarrar na Upcell (58.267.251/0001-17).
 *
 * O perfil: loja sem retailer ID em lugar nenhum. Sem RID não há venda
 * registrada e não há o que a Ume comissionar — então, enquanto estiver assim,
 * ela NUNCA entra num fechamento, por mais que o funil 11 a conte como fechada.
 *
 * Separa em quatro situações, porque a ação de cada uma é diferente:
 *   A. conta fechada no funil 11 e SEM cadastro nenhum no portal AIVA
 *   B. conta fechada, cadastro existe no portal, mas a loja não foi criada
 *   C. não marcada como fechada, cadastro em andamento no portal (normal)
 *   D. não marcada como fechada e sem cadastro nenhum no portal
 *
 * Também marca quem foi movida À MÃO: o lead virou LOJA_FINALIZADA_E_VENDENDO
 * ANTES de o pré-cadastro ser enviado — ordem impossível pelo caminho normal.
 *
 * E olha a RAIZ do CNPJ (8 primeiros dígitos): quando outro CNPJ do mesmo grupo
 * já é loja na AIVA, o lojista não sumiu — foi ESTE CNPJ que não virou loja.
 * Muda a conversa: em vez de prospectar de novo, é cadastrar a filial.
 *
 * Uso: node --env-file=.env.local scripts/lojas-fechadas-sem-loja-na-aiva.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const cnpj14 = (v) => { const d = dig(v); return d ? d.padStart(14, '0').slice(-14) : null }

// paginação: PostgREST corta em 1000
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
const pipe = async (pipelineId) => {
  const r = await fetch(`${BASE}/int/getPipeOpportunities`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QID, apiKey: process.env.EVO_TALKS_API_KEY, pipelineId }),
  })
  if (!r.ok) throw new Error(`funil ${pipelineId}: HTTP ${r.status}`)
  return r.json()
}

const J = JSON.parse(readFileSync('scripts/out-conferencia-ume-2026-10.json', 'utf8'))
const semRid = J.lojas.filter((l) => !l.rids.length && l.cnpj)

const [registros, leads, f11] = await Promise.all([
  todos('sdr_registros_cnpj', 'cnpj,loja,telefone,tipo,status,rid,ativa_em,criado_em,enviado_em,origem,cidade,lead_id'),
  todos('sdr_leads', 'id,nome,telefone,status,status_alterado_em,observacoes,data_ultimo_contato,evotalks_opportunity_id'),
  pipe(11),
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

const regPorCnpj = new Map()
const regPorRaiz = new Map()
for (const r of registros) {
  const c = cnpj14(r.cnpj)
  if (!c) continue
  if (!regPorCnpj.has(c)) regPorCnpj.set(c, [])
  regPorCnpj.get(c).push(r)
  const raiz = c.slice(0, 8)
  if (!regPorRaiz.has(raiz)) regPorRaiz.set(raiz, [])
  regPorRaiz.get(raiz).push(r)
}
/** quem do mesmo grupo (mesma raiz de CNPJ) JÁ é loja na AIVA */
const lojaPorRaiz = new Map()
const anota = (raiz, txt) => {
  if (!raiz) return
  if (!lojaPorRaiz.has(raiz)) lojaPorRaiz.set(raiz, new Set())
  lojaPorRaiz.get(raiz).add(txt)
}
for (const o of onb) {
  const c = cnpj14(o.cnpj)
  if (c && o.retailer_id) anota(c.slice(0, 8), `${c} = retailer ${o.retailer_id}`)
}
for (const l of J.relatorioLinhas) {
  if (l.cnpj) anota(String(l.cnpj).slice(0, 8), `${l.cnpj} = retailer ${l.rid} (no fechamento de out)`)
}
const leadPorId = new Map(leads.map((l) => [l.id, l]))
const onbPorCnpj = new Map()
for (const o of onb) { const c = cnpj14(o.cnpj); if (c) onbPorCnpj.set(c, o) }
// card do funil 11 pelo CNPJ escrito na descrição
const f11PorCnpj = new Map()
for (const o of f11) {
  for (const m of String(o.description ?? '').matchAll(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/g)) {
    const c = cnpj14(m[1]); if (c) f11PorCnpj.set(c, o)
  }
}

/** campo=valor dentro de [DADOS_COLETADOS:...] */
const campo = (obs, nome) => {
  const bloco = String(obs ?? '').match(/\[DADOS_COLETADOS:([^\]]*)\]/)?.[1] ?? ''
  return bloco.split('|').find((p) => p.startsWith(nome + '='))?.slice(nome.length + 1)?.trim() || ''
}
const so10 = (d) => (d ? String(d).slice(0, 10) : '')

const linhas = []
for (const l of semRid) {
  const regs = regPorCnpj.get(l.cnpj) ?? []
  const reg = regs.find((r) => r.status !== 'descartado') ?? regs[0] ?? {}
  // filial costuma chegar só pelo card do funil 11, sem registro próprio: aí o
  // contato do lojista está no lead da MATRIZ (mesma raiz de CNPJ).
  const regIrmao = regs.length ? null
    : (regPorRaiz.get(l.cnpj.slice(0, 8)) ?? []).find((r) => r.lead_id) ?? null
  const lead = (reg.lead_id && leadPorId.get(reg.lead_id))
    || leads.find((x) => String(x.observacoes ?? '').includes(l.cnpj))
    || leads.find((x) => dig(x.telefone) && dig(x.telefone) === dig(l.telefone))
    || (regIrmao?.lead_id && leadPorId.get(regIrmao.lead_id))
    || {}
  const portal = onbPorCnpj.get(l.cnpj) ?? null
  const card11 = f11PorCnpj.get(l.cnpj) ?? null
  const fechada = l.fontes.some((f) => /funil 11/.test(f))
  const vendendo = l.fontes.some((f) => /VENDENDO/.test(f)) || lead.status === 'LOJA_FINALIZADA_E_VENDENDO'

  const situacao = fechada
    ? (portal ? 'B. fechada no funil 11, cadastro no portal sem loja criada'
      : 'A. fechada no funil 11 e SEM cadastro no portal')
    : (portal ? 'C. não marcada como fechada, cadastro em andamento'
      : 'D. não marcada como fechada e sem cadastro no portal')
  const irmas = [...(lojaPorRaiz.get(l.cnpj.slice(0, 8)) ?? [])].filter((t) => !t.startsWith(l.cnpj))

  // movida à mão: status de loja vendendo ANTES do pré-cadastro existir
  const dtStatus = lead.status_alterado_em ? new Date(lead.status_alterado_em) : null
  const dtPre = reg.enviado_em || reg.criado_em ? new Date(reg.enviado_em ?? reg.criado_em) : null
  const aMao = Boolean(vendendo && dtStatus && dtPre && dtStatus < dtPre)

  const diagnostico = aMao
    ? `movida à mão: marcada como vendendo em ${so10(lead.status_alterado_em)}, antes do pré-cadastro (${so10(reg.enviado_em ?? reg.criado_em)})`
    : portal
      ? `no portal em "${portal.board_column ?? portal.stage}" — loja ainda não criada`
      : reg.status
        ? `parou em "${reg.status}" e nunca virou loja na AIVA`
        : irmas.length
          ? 'filial sem cadastro próprio — o grupo já é loja na AIVA com outro CNPJ'
          : 'sem pré-cadastro registrado e sem cadastro no portal'

  linhas.push({
    situacao,
    cnpj: l.cnpj,
    loja: l.nomes[0] ?? reg.loja ?? lead.nome ?? '',
    socio: campo(lead.observacoes, 'nome_socio'),
    telefone: dig(l.telefone || reg.telefone || lead.telefone),
    email: campo(lead.observacoes, 'email_socio'),
    regiao: campo(lead.observacoes, 'regiao_varejo') || reg.cidade || '',
    statusLead: lead.status ?? '',
    statusDesde: so10(lead.status_alterado_em),
    statusRegistro: reg.status ?? '',
    preCadastroEm: so10(reg.enviado_em ?? reg.criado_em),
    origem: reg.origem ?? '',
    noPortal: portal ? 'sim' : 'nao',
    quadroPortal: portal?.board_column ?? '',
    biometria: portal?.biometry_status ?? '',
    cardF11: card11 ? String(card11.id) : '',
    cardF15: lead.evotalks_opportunity_id ? String(lead.evotalks_opportunity_id) : '',
    ultimoContato: so10(lead.data_ultimo_contato),
    aMao: aMao ? 'sim' : 'nao',
    grupoJaELoja: irmas.length ? 'sim' : 'nao',
    irmasNaAiva: irmas.join(' · '),
    diagnostico,
    fontes: l.fontes.join(' · '),
  })
}

linhas.sort((a, b) => a.situacao.localeCompare(b.situacao) || a.loja.localeCompare(b.loja))
writeFileSync('scripts/out-lojas-sem-loja-na-aiva.json', JSON.stringify(linhas, null, 1))

const cont = {}
for (const l of linhas) cont[l.situacao] = (cont[l.situacao] ?? 0) + 1
console.log('lojas nossas sem retailer ID: %d', linhas.length)
for (const [k, v] of Object.entries(cont).sort()) console.log('   %s  %d', k.padEnd(44), v)
console.log('   movidas à mão (vendendo antes do pré-cadastro): %d', linhas.filter((l) => l.aMao === 'sim').length)
console.log('dump: scripts/out-lojas-sem-loja-na-aiva.json')
setTimeout(() => process.exit(0), 500).unref()
