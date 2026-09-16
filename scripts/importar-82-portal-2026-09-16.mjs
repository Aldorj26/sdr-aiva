#!/usr/bin/env node
/**
 * Importa os 82 CNPJs atribuídos à Track no Portal AIVA que nunca passaram pelo
 * nosso funil (decisão do Aldo 16/09/2026: "já são nossos clientes na AIVA —
 * enriquecer na Receita e lançar em Em Análise AIVA" — corrigido de Loja Finalizada pra Em Análise, o portal os tem em dados_varejo).
 *
 * Pra cada CNPJ: lead em sdr_leads (EM_ANALISE_AIVA) + card no funil
 * 15 do Evo direto na etapa 50 (Em Análise AIVA) + linha em sdr_registros_cnpj (pre_cadastro_enviado,
 * o CNPJ já está no portal). Telefone = fixo da Receita quando existe; senão
 * marcador `sem-tel-<cnpj>` até a AIVA passar o WhatsApp. VictorIA fica MUDA
 * ([CONSULTORIA_OPTOUT]) e o aviso de etapa 50 é suprimido ([ALERTA_ETAPA:50]).
 *
 * Entrada: SAIDA/form-varejo-pendente.json (os 82) + SAIDA/receita-82.json
 * (BrasilAPI) + SAIDA/portal-dump.json (onboardings). Saída: SAIDA/importados-82.json.
 *
 *   node --env-file=.env.local scripts/importar-82-portal-2026-09-16.mjs --dry
 *   node --env-file=.env.local scripts/importar-82-portal-2026-09-16.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const S = process.env.SAIDA
const HOJE = '2026-09-16'
const so = (c) => String(c ?? '').replace(/\D/g, '')
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))

const rows = JSON.parse(readFileSync(S + '/form-varejo-pendente.json', 'utf8'))
const lista = rows.filter((o) => String(o.origem ?? '').startsWith('nunca esteve no nosso funil')).map((o) => so(o.cnpj))
const receita = JSON.parse(readFileSync(S + '/receita-82.json', 'utf8'))
const { onb } = JSON.parse(readFileSync(S + '/portal-dump.json', 'utf8'))
const portal = new Map(onb.map((o) => [so(o.cnpj), o]))

const dv = (c) => {
  if (c.length !== 14) return false
  const calc = (b) => { let s = 0; for (let i = 0; i < b.length; i++) s += Number(c[i]) * b[i]; const r = s % 11; return r < 2 ? 0 : 11 - r }
  return Number(c[12]) === calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) && Number(c[13]) === calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
}
const idadeAnos = (d) => (d ? (Date.now() - new Date(d).getTime()) / (365.25 * 86400000) : null)
const titulo = (s) => String(s ?? '').trim().toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase())

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const EVO = process.env.EVO_TALKS_BASE_URL
const evo = async (path, body) => {
  const res = await fetch(`${EVO}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: Number(process.env.EVO_TALKS_QUEUE_ID), apiKey: process.env.EVO_TALKS_QUEUE_API_KEY, ...body }),
    signal: AbortSignal.timeout(30000),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Evo ${path} ${res.status}: ${txt.slice(0, 160)}`)
  try { return JSON.parse(txt) } catch { return {} }
}

// ── monta o plano
const usados = new Set()
const { data: existentes } = await sb.from('sdr_leads').select('telefone')
for (const e of existentes ?? []) usados.add(e.telefone)
const plano = []
for (const cnpj of lista) {
  const r = receita[cnpj]?.ok ? receita[cnpj] : null
  const p = portal.get(cnpj)
  const flags = []
  if (!dv(cnpj)) flags.push('CNPJ com dígito inválido (erro no portal)')
  else if (!r) flags.push('não consta na BrasilAPI')
  if (r?.situacao && r.situacao !== 'ATIVA') flags.push(`Receita: ${r.situacao}`)
  const idade = idadeAnos(r?.abertura)
  if (idade != null && idade < 1) flags.push(`menos de 1 ano (abertura ${r.abertura})`)
  const nome = titulo(r?.fantasia || r?.razao || p?.legal_name) || `Loja CNPJ ${cnpj}`
  const cidade = r?.municipio ? `${titulo(r.municipio)}/${r.uf}` : null
  let tel = [r?.tel1, r?.tel2, p?.phone_number].map(so).find((t) => t.length >= 10 && t.length <= 13) ?? ''
  if (tel && !tel.startsWith('55')) tel = '55' + tel
  let telefone = tel || `sem-tel-${cnpj}`
  let origemTel = tel ? (so(p?.phone_number) === tel.slice(2) || so(p?.phone_number) === tel ? 'portal' : 'Receita (fixo)') : 'marcador'
  if (usados.has(telefone)) { telefone = `sem-tel-${cnpj}`; origemTel = 'marcador (telefone repetido)' }
  usados.add(telefone)
  const socios = (r?.socios ?? []).map(titulo).join(', ')
  const obs = [
    `[IMPORTADO_PORTAL:${HOJE}]`, '[ALERTA_ETAPA:50]', '[CONSULTORIA_OPTOUT]',
    r ? `[CNPJ_RECEITA:${cnpj}:${r.situacao}:${r.abertura}]` : '',
    `Cliente Track já operando na AIVA (portal, lote sem funil — importado ${HOJE}).`,
    r ? `Receita: ${r.razao}${r.fantasia ? ` (${r.fantasia})` : ''} · ${r.situacao} · abertura ${r.abertura} · ${r.cnae ?? ''}${socios ? ` · sócios: ${socios}` : ''}.` : 'Sem dados da Receita.',
    flags.length ? `⚠️ ${flags.join(' · ')}.` : '',
    origemTel === 'marcador' || origemTel.startsWith('marcador') ? 'Sem WhatsApp conhecido — pedir à AIVA.' : `Telefone da ${origemTel}.`,
  ].filter(Boolean).join(' ')
  plano.push({ cnpj, nome, cidade, telefone, origemTel, razao: r?.razao ?? p?.legal_name ?? null, fantasia: r?.fantasia ?? null, situacao: r?.situacao ?? null, abertura: r?.abertura ?? null, cnae: r?.cnae ?? null, socios, flags, obs, tipo: cnpj.slice(8, 12) === '0001' ? 'matriz' : 'adicional', onboarding_id: p?.id ?? null, portal_stage: p?.stage ?? null })
}
console.log(`plano: ${plano.length} CNPJs · com telefone real ${plano.filter((x) => !x.telefone.startsWith('sem-tel')).length} · com flags ${plano.filter((x) => x.flags.length).length}`)
if (DRY) {
  for (const x of plano) console.log(`  ${x.cnpj} · ${x.nome} · ${x.cidade ?? '—'} · ${x.telefone} (${x.origemTel})${x.flags.length ? ' · ⚠️ ' + x.flags.join('; ') : ''}`)
  writeFileSync(S + '/importados-82.json', JSON.stringify(plano, null, 1))
  process.exit(0)
}

// ── executa
let n = 0
for (const x of plano) {
  n++
  const res = { ...x, lead_id: null, opp: null, erro: null }
  try {
    const { data: lead, error } = await sb.from('sdr_leads').insert({
      nome: x.nome, telefone: x.telefone, cidade: x.cidade, produto: 'AIVA', status: 'EM_ANALISE_AIVA',
      etapa_cadencia: 1, acionar_humano: false, importante: false, observacoes: x.obs, status_alterado_em: new Date().toISOString(),
    }).select('id').single()
    if (error) throw new Error(`lead: ${error.message}`)
    res.lead_id = lead.id

    try {
      const opp = await evo('/int/createOpportunity', {
        fkPipeline: 15, fkStage: 50, responsableid: 507, title: `${x.nome} — AIVA`,
        mainphone: x.telefone.startsWith('sem-tel') ? '' : x.telefone, city: x.cidade ?? '',
      })
      res.opp = Number(opp?.id ?? opp?.data?.id ?? 0) || null
      if (res.opp) {
        await dorme(600)
        await evo('/int/updateOpportunity', { id: res.opp, tags: [69] })
        await sb.from('sdr_leads').update({ evotalks_opportunity_id: String(res.opp) }).eq('id', lead.id)
      }
    } catch (e) { res.erro = `opp: ${String(e).slice(0, 140)}` }

    const { error: er } = await sb.from('sdr_registros_cnpj').upsert(
      { lead_id: lead.id, loja: x.nome, telefone: x.telefone, cnpj: x.cnpj, tipo: x.tipo, status: 'pre_cadastro_enviado', enviado: true, origem: 'portal' },
      { onConflict: 'lead_id,cnpj', ignoreDuplicates: true },
    )
    if (er) res.erro = (res.erro ? res.erro + ' · ' : '') + `registro: ${er.message.slice(0, 120)}`
  } catch (e) { res.erro = String(e).slice(0, 160) }
  console.log(`${String(n).padStart(2)}/${plano.length} ${x.cnpj} · ${x.nome} · lead ${res.lead_id ? 'ok' : 'FALHOU'} · opp ${res.opp ?? '—'}${res.erro ? ' · ⚠️ ' + res.erro : ''}`)
  plano[n - 1] = res
  writeFileSync(S + '/importados-82.json', JSON.stringify(plano, null, 1))
  await dorme(900)
}
console.log(`\nfeito: leads ${plano.filter((x) => x.lead_id).length} · cards ${plano.filter((x) => x.opp).length} · erros ${plano.filter((x) => x.erro).length}`)
process.exit(0)
