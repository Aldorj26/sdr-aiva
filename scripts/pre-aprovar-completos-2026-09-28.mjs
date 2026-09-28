/**
 * pre-aprovar-completos-2026-09-28.mjs — leva pra PRÉ-APROVAÇÃO lojas que já tinham os
 * 5 dados da Fase 1 e ficaram paradas em INTERESSADO/AGUARDANDO (conversa travou numa
 * pergunta desnecessária; casos de jul–ago, antes dos ajustes de 28/09). Aldo, 28/09/2026.
 *
 * Replica a transição do webhook (bloco "FASE 1 completa"), na mesma ordem:
 *   card → 54 (só avança) · nota no card · planilha AIVA (Sheets) · CNPJ matriz no
 *   /registros · status PRE_APROVACAO · alerta 🟡 pro Nei e o Aldo.
 * Conferido antes: CNPJ ATIVA e > 1 ano, fora da base AIVA/Odres, não está no portal
 * da Track, card no funil 15 em 47, os 5 campos no formulário do card.
 * Cristal Celular (card já em 49) só ganha o registro no /registros — não volta de etapa.
 *
 * Uso: node --env-file=.env.local scripts/pre-aprovar-completos-2026-09-28.mjs [--executar]
 */
import { createClient } from '@supabase/supabase-js'

const EXECUTAR = process.argv.includes('--executar')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const Q = { queueId: Number(process.env.EVO_TALKS_QUEUE_ID ?? 10), apiKey: process.env.EVO_TALKS_QUEUE_API_KEY }
const evo = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Q, ...body }) })
  const t = await r.text(); if (!r.ok) throw new Error(`${path} HTTP ${r.status} ${t.slice(0, 120)}`)
  try { return JSON.parse(t) } catch { return t }
}
// mesmo caminho do alertHuman/sendText (lib/evotalks.ts): chat aberto do número → sendMessageToChat;
// sem chat aberto → openChat com a mensagem. E registra em sdr_alertas (painel de alertas).
const alertar = async (numero, texto) => {
  const abertos = await evo('/int/getClientOpenChats', { number: numero }).catch(() => null)
  const chatId = abertos?.chats?.[0]?.chatId
  if (chatId) await evo('/int/sendMessageToChat', { chatId, text: texto })
  else await evo('/int/openChat', { number: numero, message: texto })
}
const registrarAlerta = async (texto) => {
  await sb.from('sdr_alertas').insert({ tipo: '🟡', mensagem: texto, entregue: true })
}

const PRE = [
  { id: '41b3205d-1990-4728-9202-f94063c85050', nome: 'Queiroz TEC' },
  { id: 'ed4669bb-f137-412f-9014-3ccaefe39299', nome: 'Inova Celulares' },
  { id: '0262f748-480a-45cf-95b3-eb6e850a4bf5', nome: 'Shopping Infinity LTDA' },
]
const SO_REGISTRO = [{ id: '2d76a834-2e22-4011-a197-e02e92278aad', nome: 'Cristal celular' }]

const ids = [...PRE, ...SO_REGISTRO].map((x) => x.id)
const { data: leads } = await sb.from('sdr_leads').select('id,nome,telefone,status,observacoes,evotalks_opportunity_id').in('id', ids)
const porId = new Map(leads.map((l) => [l.id, l]))
const cnpjDe = (l) => String((l.observacoes ?? '').match(/cnpj_matriz=([0-9./-]+)/)?.[1] ?? '').replace(/\D/g, '')

for (const x of PRE) {
  const l = porId.get(x.id)
  if (!['INTERESSADO', 'AGUARDANDO'].includes(l.status)) { console.log(`- ${x.nome}: status mudou pra ${l.status}, pulei`); continue }
  const opp = Number(l.evotalks_opportunity_id)
  const card = await evo('/int/getOpportunity', { id: opp })
  const f = card.formsdata ?? {}
  console.log(`- ${x.nome}: card #${opp} na etapa ${card.fkStage} · CNPJ ${cnpjDe(l)} · ${EXECUTAR ? 'executando' : 'ensaio'}`)
  if (!EXECUTAR) continue
  if (card.fkStage === 47) await evo('/int/changeOpportunityStage', { id: opp, destStageId: 54 })
  await evo('/int/insertOpportunityNote', { id: opp, note: 'Qualificação inicial (5 dados) já estava completa desde a conversa com a VictorIA; levada pra Pré Aprovação na revisão do funil de 28/09/2026. Aguardando análise AIVA.' })
  if (process.env.GOOGLE_SHEETS_WEBHOOK_URL) {
    await fetch(process.env.GOOGLE_SHEETS_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      nome_socio: f.da6ddf70, email_socio: f.dafa40f0, telefone: f.db8569f0, nome_varejo: f.dcacfa00, cnpj_matriz: f.dd2ab580,
      faturamento_anual: f.ddb960f0, valor_boleto_mensal: f.de2cbc30, regiao_varejo: f.dede58f0, numero_lojas: f.df6f9c70,
      localizacao_lojas: f.e0099280, possui_outra_financeira: f.e07d62f0, cnpjs_adicionais: f.e0f66380, status: 'PRE_APROVACAO', opportunity_id: String(opp),
    }) })
  }
  await sb.from('sdr_registros_cnpj').upsert([{ lead_id: l.id, loja: l.nome, telefone: l.telefone, cnpj: cnpjDe(l), tipo: 'matriz', status: 'informada' }], { onConflict: 'lead_id,cnpj', ignoreDuplicates: true })
  await sb.from('sdr_leads').update({ status: 'PRE_APROVACAO', observacoes: `${(l.observacoes ?? '').trim()} [PRE_APROV_REVISAO:${new Date().toISOString()}]` }).eq('id', l.id)
  const msg = `🟡 *${l.nome}* (${l.telefone}) qualificado p/ pré-aprovação (revisão do funil — os 5 dados já estavam completos e a conversa tinha travado).\n` +
    `CNPJ: ${cnpjDe(l)} · sócio: ${f.da6ddf70 ?? '-'} · lojas: ${f.df6f9c70 ?? '-'}\n\n` +
    `📝 *Pré-cadastro liberado:* o CNPJ já está no painel pra lançar no form da AIVA:\nhttps://sdr-aiva.vercel.app/registros\n` +
    `➡️ Assim que você marcar como enviado lá, o card vai sozinho pra *Cadastro Recebido*.`
  for (const n of [process.env.NEI_WHATSAPP, process.env.ALDO_WHATSAPP].filter(Boolean)) await alertar(n, msg).catch((e) => console.log('   alerta falhou:', String(e).slice(0, 100)))
  await registrarAlerta(msg).catch(() => {})
  console.log('   ✅ feito')
}
for (const x of SO_REGISTRO) {
  const l = porId.get(x.id)
  console.log(`- ${x.nome}: só registro no /registros (card já em Cadastro Recebido) · CNPJ ${cnpjDe(l)}`)
  if (EXECUTAR) { await sb.from('sdr_registros_cnpj').upsert([{ lead_id: l.id, loja: l.nome, telefone: l.telefone, cnpj: cnpjDe(l), tipo: 'matriz', status: 'informada' }], { onConflict: 'lead_id,cnpj', ignoreDuplicates: true }); console.log('   ✅ registro criado') }
}
