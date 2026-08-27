#!/usr/bin/env node
/**
 * Disparo 27/08/2026 — novidade Flexfone (AIVA + Odres numa consulta) pros
 * leads na etapa INTERESSADO (stage 47), aprovado pelo Aldo ("pode disparar
 * pros 933"). Lista congelada em scratchpad/interessados-flexfone.json
 * (977 na etapa; excluidos conversa ativa <24h e aguardando humano).
 *
 * HSM 48 coringa via /int/sendWaTemplate (fluxo comprovado dos lembretes).
 * Idempotente por [NOVIDADE_FLEXFONE_2026-08-27] — pode rodar N vezes até
 * completar (teto de 240s por rodada; ~90 envios por rodada).
 *
 * Uso: node --env-file=.env.local scripts/novidade-flexfone-interessados-2026-08-27.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const TEMPLATE = 48
const MARCADOR = '[NOVIDADE_FLEXFONE_2026-08-27]'

const horaBrt = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()))
if (horaBrt < 8 || horaBrt >= 20) { console.error(`ABORTADO: ${horaBrt}h BRT fora do horário comercial.`); process.exit(1) }

const sanitize = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...body }) })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`)
  return res.json()
}

const corpoHsm = sanitize(
  'tenho uma novidade grande pra sua loja: agora quem se credencia na AIVA ganha acesso a DUAS financeiras numa plataforma só — AIVA e Odres Cred. ' +
  'Você consulta o CPF do cliente uma vez e, se a AIVA não aprovar, a Odres tenta na hora, automaticamente. ' +
  'Na prática: muito mais aprovação e menos venda perdida. O credenciamento é gratuito, sem mensalidade, e leva poucos minutos. ' +
  'Quer garantir o da sua loja? Me responde aqui que eu já sigo com seu cadastro! 🚀'
)

const lista = JSON.parse(readFileSync(
  'C:/Users/rocha/AppData/Local/Temp/claude/C--projetos-claude-sdr-aiva/6fed26f2-b6d8-4bd9-a126-63f22d3b40bb/scratchpad/interessados-flexfone.json', 'utf8'))
const elegiveis = lista.filter((l) => !l.conversaAtiva && !l.aguardaHumano)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ok = 0, pulados = 0, falhas = 0
const t0 = Date.now()
for (const l of elegiveis) {
  if (Date.now() - t0 > 240_000) { console.log(`teto de tempo — rodada encerrada (rode de novo pra continuar)`); break }
  try {
    let obsAtual = ''
    if (l.lead_id) {
      const { data } = await sb.from('sdr_leads').select('observacoes').eq('id', l.lead_id).maybeSingle()
      obsAtual = data?.observacoes ?? ''
      if (obsAtual.includes(MARCADOR)) { pulados++; continue }
    }
    let bruto = sanitize(l.nome || l.loja)
    // nome que é telefone/placeholder ("Loja — 5521...", só dígitos) → saudação neutra
    if ((bruto.match(/\d/g) ?? []).length > 6 || bruto.replace(/[^\p{L}]/gu, '').length < 3) bruto = 'parceiro(a)'
    const nome = bruto === bruto.toUpperCase() && bruto.length > 2
      ? bruto.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
      : bruto
    if (DRY) { if (ok < 5) console.log(`  DRY ${l.loja} → "Olá ${nome}, ${corpoHsm.slice(0, 55)}…"`); ok++; continue }

    await post('/int/sendWaTemplate', { number: l.tel, templateId: TEMPLATE, data: [nome, corpoHsm], openNewChat: true })
    if (l.lead_id) {
      await sb.from('sdr_mensagens').insert({ lead_id: l.lead_id, direcao: 'out', conteudo: `Olá ${nome}, ${corpoHsm}`, template_hsm: 'aiva_coringa_48' })
      await sb.from('sdr_leads').update({
        data_ultimo_contato: new Date().toISOString(),
        observacoes: `${obsAtual.trim()} ${MARCADOR}`.trim(),
      }).eq('id', l.lead_id)
    }
    ok++
    if (ok % 25 === 0) console.log(`  … ${ok} enviados`)
    await sleep(1400)
  } catch (err) {
    console.error(`  ✗ ${l.loja}:`, err.message)
    falhas++
  }
}
console.log(`\n${DRY ? 'DRY — enviaria' : 'Enviados nesta rodada'}: ${ok} | pulados (já receberam): ${pulados} | falhas: ${falhas} | restantes: ${elegiveis.length - ok - pulados - falhas}`)
