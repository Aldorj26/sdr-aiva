#!/usr/bin/env node
/**
 * Detecta CNPJs registrados (sdr_registros_cnpj) que VIRARAM LOJA ATIVA —
 * apareceram no snapshot semanal do Data Studio (aiva_desempenho_semanal),
 * que traz CNPJ + Retailer ID de toda loja operando (regra 01/09).
 *
 * Pra cada ativação nova:
 *   1. marca status='ativa', grava rid e ativa_em na sdr_registros_cnpj
 *   2. cria a conta espelho no funil 11 (Contas Fechadas MRR) com
 *      "UME_RID: X | CNPJ: Y" na descrição + tag UME — dedupe por RID
 *      (NÃO por telefone: filiais compartilham o fone da matriz)
 *   3. digest WhatsApp pro Aldo/Nei (só quando houver novidade)
 *
 * Roda toda segunda no ciclo do pulso (depois do importar-desempenho-semanal).
 * Uso: node --env-file=.env.local scripts/detectar-lojas-ativas.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const PIPELINE_MRR = 11, STAGE_MRR_INICIO = 32, TAG_UME = 7, RESPONSAVEL_NEI = 507

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...body }) })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`)
  return res.json()
}

// última semana com snapshot
const { data: ult } = await sb.from('aiva_desempenho_semanal').select('semana').order('semana', { ascending: false }).limit(1)
if (!ult?.length) { console.log('Nenhum snapshot semanal — nada a detectar.'); process.exit(0) }
const semana = ult[0].semana
const { data: snap } = await sb.from('aiva_desempenho_semanal').select('cnpj,rid,loja,nome_varejo').eq('semana', semana)
const snapPorCnpj = new Map(snap.map((s) => [s.cnpj, s]))
console.log(`snapshot ${semana}: ${snap.length} lojas ativas`)

// registros ainda não ativos
const { data: pendentes } = await sb.from('sdr_registros_cnpj').select('id,lead_id,loja,telefone,cnpj,status').neq('status', 'ativa')
const ativaram = (pendentes ?? []).filter((r) => snapPorCnpj.has(r.cnpj))
console.log(`registros pendentes: ${pendentes?.length ?? 0} | ativaram: ${ativaram.length}`)
if (!ativaram.length) { console.log('Nenhuma ativação nova.'); process.exit(0) }

// funil 11 atual (pra dedupe por RID)
const opps = await post('/int/getPipeOpportunities', { pipelineId: PIPELINE_MRR })
const linhas = []
for (const r of ativaram) {
  const s = snapPorCnpj.get(r.cnpj)
  const rid = String(s.rid ?? '').trim()
  console.log(`ATIVOU: ${r.loja} — CNPJ ${r.cnpj} — RID ${rid || '?'} (${s.loja ?? s.nome_varejo ?? ''})`)
  if (DRY) { linhas.push(`• ${r.loja} (${s.loja ?? r.cnpj})`); continue }

  await sb.from('sdr_registros_cnpj').update({ status: 'ativa', rid: rid || null, ativa_em: new Date().toISOString() }).eq('id', r.id)

  let contaInfo = 'sem RID no snapshot — conta MRR NÃO criada (criar manual)'
  if (rid) {
    const re = new RegExp(`UME_RID:\\s*${rid}\\b`)
    const dup = opps.find((o) => re.test(o.description ?? ''))
    if (dup) {
      contaInfo = `conta MRR já existia (#${dup.id})`
    } else {
      try {
        const titulo = (s.loja ?? s.nome_varejo ?? r.loja ?? 'Loja AIVA').trim()
        const nova = await post('/int/createOpportunity', {
          fkPipeline: PIPELINE_MRR, fkStage: STAGE_MRR_INICIO, responsableid: RESPONSAVEL_NEI,
          title: titulo, mainphone: String(r.telefone ?? '').replace(/\D/g, ''), city: '',
        })
        await post('/int/updateOpportunity', {
          id: nova.id,
          description: `UME_RID: ${rid} | CNPJ: ${r.cnpj} | Loja de ${r.loja} (ativação detectada ${semana}) | Fone lojista: ${String(r.telefone ?? '').replace(/\D/g, '')}`,
          tags: [TAG_UME],
        })
        // read-after-write (lição 26/08: update do Evo pode retornar 200 sem persistir)
        const conf = await post('/int/getPipeOpportunities', { pipelineId: PIPELINE_MRR })
        const ok = conf.find((o) => o.id === nova.id && re.test(o.description ?? ''))
        contaInfo = ok ? `conta MRR criada (#${nova.id})` : `⚠️ conta #${nova.id} criada mas descrição NÃO confirmou — conferir`
      } catch (e) {
        contaInfo = `⚠️ falha ao criar conta MRR: ${String(e).slice(0, 100)}`
      }
    }
  }
  linhas.push(`• ${r.loja} — ${s.loja ?? r.cnpj} (RID ${rid || '?'}) → ${contaInfo}`)
}

const resumo = `🆕 *Lojas novas ATIVARAM (snapshot ${semana})*\n${linhas.join('\n')}`
console.log('\n' + resumo)
if (!DRY) {
  for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean)) {
    try {
      const aberto = await post('/int/getClientOpenChats', { number: tel }).catch(() => null)
      const chatId = aberto?.chats?.[0]?.chatId
      if (chatId) await post('/int/sendMessageToChat', { chatId: Number(chatId), text: resumo })
      else await post('/int/openChat', { number: tel, message: resumo })
    } catch { console.error(`digest falhou pra ${tel}`) }
  }
}
setTimeout(() => process.exit(0), 800).unref()
