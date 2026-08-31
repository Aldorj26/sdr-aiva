#!/usr/bin/env node
/**
 * PULSO SEMANAL DE VENDAS — lojas em LOJA_FINALIZADA_E_VENDENDO (regra 31/08).
 * Textos aprovados pelo Aldo em 31/08/2026.
 *
 * Lê aiva_desempenho_semanal (semana fechada W e, se houver, W-1), segmenta
 * cada loja pela evolução e envia 1 mensagem via HSM 48 coringa:
 *   A. aprovados=0 e vendas=0        → destrave (+ anti-desânimo embutido)
 *   B. aprovados>0 e vendas=0        → aprovou e não fechou — o que travou?
 *   C. queda vs semana anterior      → diagnóstico (vendas < ant, ant>=2)
 *   D. vendeu / cresceu              → reconhecimento + meta
 *
 * Salvaguardas: horário comercial 8-20 BRT; máx 1 msg/loja/semana (marcador
 * [PULSO_SEMANAL:<semana>] nas observações); pula conversa ativa (<24h desde
 * data_ultimo_contato); teto 150 envios/rodada e 240s; digest WhatsApp pra
 * Aldo e Nei ao final. Idempotente — pode rodar N vezes até completar.
 *
 * Uso: node --env-file=.env.local scripts/pulso-semanal.mjs [--semana YYYY-MM-DD] [--dry]
 *   --semana = segunda da semana FECHADA (default: a segunda anterior a hoje).
 */
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const pega = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const TEMPLATE = 48

const horaBrt = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()))
if (!DRY && (horaBrt < 8 || horaBrt >= 20)) { console.error(`ABORTADO: ${horaBrt}h BRT fora do horário comercial.`); process.exit(1) }

// semana fechada: a segunda-feira anterior à segunda corrente
function segundaAnterior() {
  const agora = new Date(Date.now() - 3 * 3600e3) // BRT aproximado
  const dow = agora.getUTCDay() // 1 = segunda
  const diasAteSegundaCorrente = (dow + 6) % 7 // 0 se hoje é segunda
  const segundaCorrente = new Date(agora.getTime() - diasAteSegundaCorrente * 86400e3)
  const seg = new Date(segundaCorrente.getTime() - 7 * 86400e3)
  return seg.toISOString().slice(0, 10)
}
const semana = pega('--semana') ?? segundaAnterior()
const semanaAnt = new Date(new Date(semana + 'T12:00:00Z').getTime() - 7 * 86400e3).toISOString().slice(0, 10)
const MARCADOR = `[PULSO_SEMANAL:${semana}]`
console.log(`semana fechada: ${semana} (anterior: ${semanaAnt}) | marcador ${MARCADOR}${DRY ? ' | DRY' : ''}`)

const { data: snapW } = await sb.from('aiva_desempenho_semanal').select('*').eq('semana', semana)
if (!snapW?.length) {
  console.error(`SEM SNAPSHOT da semana ${semana} — rode a coleta + importar-desempenho-semanal.mjs antes. Nada disparado.`)
  await new Promise((r) => setTimeout(r, 800)) // deixa os sockets do supabase fecharem (crash uv no Windows)
  process.exit(1)
}
const { data: snapAnt } = await sb.from('aiva_desempenho_semanal').select('cnpj,vendas').eq('semana', semanaAnt)
const antPorCnpj = new Map((snapAnt ?? []).map((r) => [r.cnpj, r.vendas]))
console.log(`snapshot: ${snapW.length} lojas | semana anterior: ${snapAnt?.length ?? 0} lojas`)

// leads LFV + mapa CNPJ(14 díg. nas observações) → lead
const { data: leads } = await sb.from('sdr_leads')
  .select('id,nome,telefone,observacoes,data_ultimo_contato')
  .eq('status', 'LOJA_FINALIZADA_E_VENDENDO')
const porCnpj = new Map()
for (const l of leads) {
  for (const c of (l.observacoes ?? '').replace(/[.\-\/]/g, '').match(/\d{14}/g) ?? []) {
    if (!porCnpj.has(c)) porCnpj.set(c, l)
  }
}

const sanitize = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
const primeiroNome = (n) => {
  const p = sanitize(n).split(/[\s—-]+/)[0]
  return /^\d+$/.test(p) || !p ? 'parceiro(a)' : p
}

// ─── Textos aprovados (Aldo 31/08) — sem \n (HSM coringa) ───────────────────
function textoA(nome, loja) {
  return `Passando pro nosso check-in de segunda: vi que semana passada não saiu nenhuma aprovação aí na ${loja}. Travou alguma coisa — login, equipe, dúvida no sistema? Me conta que eu destravo contigo. E se estiverem consultando e as primeiras reprovarem, é normal — depende do perfil de cada cliente. Lembra: consulta leva 2 minutos e não custa nada — todo cliente que entra na loja é uma consulta! 💪`
}
function textoB(nome, loja, aprovados) {
  return `Vi que a ${loja} teve ${aprovados} cliente(s) APROVADO(S) semana passada e a venda ainda não saiu — tá quase! 👏 O que travou no fechamento? Uma dica: mostra a PARCELA (não o total) e oferece o aparelho dentro do limite aprovado — cliente aprovado é venda na mão. Precisa de ajuda pra fechar? Me chama!`
}
function textoC(nome, loja, vendas, vendasAnt) {
  return `Acompanhando a ${loja}: semana retrasada foram ${vendasAnt} vendas e semana passada ${vendas}. Aconteceu algo por aí — equipe, movimento, alguma trava? Me conta que eu ajudo a retomar. Uma dica rápida que funciona: pedir o CPF logo na abordagem — quem consulta na entrada fecha mais na saída. 😉`
}
function textoD(nome, loja, vendas) {
  return `Que semana! 🎉 ${vendas} venda(s) no crediário na ${loja} — mandaram muito. E a comissão dos vendedores agradece (R$10 por venda pra eles!). A meta de referência é 15 aparelhos no mês, e vocês estão no caminho. Quer munição pra acelerar ainda mais (combo de acessórios dentro do limite aprovado)? Tô aqui!`
}

function segmenta(r, vendasAnt) {
  const temAnt = vendasAnt !== undefined
  if (r.vendas > 0) {
    if (temAnt && r.vendas < vendasAnt && vendasAnt >= 2) return 'C'
    return 'D'
  }
  if (r.aprovados > 0) return 'B'
  if (temAnt && vendasAnt >= 2) return 'C'
  return 'A'
}

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...body }) })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`)
  return res.json()
}

const INICIO = Date.now()
const stats = { A: 0, B: 0, C: 0, D: 0 }
let enviados = 0, jaTinha = 0, semLead = 0, conversaAtiva = 0, falhas = 0
const radar = [] // segmentos A/B/C pro digest
const semLeadNomes = []

for (const r of snapW) {
  if (Date.now() - INICIO > 240_000) { console.warn('TETO DE TEMPO (240s) — rode de novo pra completar.'); break }
  if (enviados >= 150) { console.warn('TETO DE 150 envios — rode de novo pra completar.'); break }
  const lead = porCnpj.get(r.cnpj)
  if (!lead) { semLead++; semLeadNomes.push(`${r.loja ?? r.nome_varejo} (${r.cnpj})`); continue }
  if ((lead.observacoes ?? '').includes(MARCADOR)) { jaTinha++; continue }
  if (lead.data_ultimo_contato && Date.now() - new Date(lead.data_ultimo_contato).getTime() < 24 * 3600e3) {
    conversaAtiva++
    continue // conversa quente — não interrompe com pulso
  }
  const vendasAnt = antPorCnpj.get(r.cnpj)
  const seg = segmenta(r, vendasAnt)
  const nome = primeiroNome(lead.nome)
  const loja = sanitize(r.loja ?? r.nome_varejo ?? lead.nome)
  const corpo = seg === 'A' ? textoA(nome, loja)
    : seg === 'B' ? textoB(nome, loja, r.aprovados)
    : seg === 'C' ? textoC(nome, loja, r.vendas, vendasAnt ?? 0)
    : textoD(nome, loja, r.vendas)

  if (DRY) {
    console.log(`[DRY][${seg}] ${lead.nome} (${lead.telefone}): ${corpo.slice(0, 110)}...`)
    stats[seg]++
    if (seg !== 'D') radar.push(`${seg} · ${lead.nome}`)
    continue
  }
  try {
    await post('/int/sendWaTemplate', { number: lead.telefone, templateId: TEMPLATE, data: [nome, sanitize(corpo)], openNewChat: true })
    await sb.from('sdr_leads').update({ observacoes: `${lead.observacoes ?? ''}\n${MARCADOR} seg=${seg}`.trim() }).eq('id', lead.id)
    await sb.from('sdr_mensagens').insert({ lead_id: lead.id, direcao: 'out', conteudo: `Olá ${nome}, ${corpo}`, template_hsm: `coringa-48 pulso-semanal-${seg}` })
    stats[seg]++; enviados++
    if (seg !== 'D') radar.push(`${seg} · ${lead.nome}`)
    console.log(`[${seg}] ${lead.nome} ok`)
  } catch (e) {
    falhas++
    console.error(`FALHA ${lead.nome} (${lead.telefone}): ${String(e).slice(0, 120)}`)
  }
}

const resumo =
  `📊 *Pulso semanal AIVA — semana ${semana}*\n` +
  `Enviadas: ${enviados} (A destrave: ${stats.A} | B aprovou-não-vendeu: ${stats.B} | C queda: ${stats.C} | D vendendo: ${stats.D})\n` +
  `Puladas: ${jaTinha} já tinham recebido, ${conversaAtiva} com conversa ativa (<24h), ${semLead} sem lead casado, ${falhas} falhas.\n` +
  (radar.length ? `\n🚨 *Radar (precisam de atenção):*\n${radar.slice(0, 30).map((x) => `• ${x}`).join('\n')}${radar.length > 30 ? `\n(+${radar.length - 30})` : ''}` : '') +
  (semLeadNomes.length ? `\n\n❓ Sem lead casado (conferir CNPJ): ${semLeadNomes.slice(0, 8).join('; ')}${semLeadNomes.length > 8 ? ` (+${semLeadNomes.length - 8})` : ''}` : '')

console.log('\n' + resumo)
// digest — mesmo fluxo comprovado da conferência: chat aberto → mensagem; senão abre chat
async function enviarWhats(numero, texto) {
  try {
    const aberto = await post('/int/getClientOpenChats', { number: numero }).catch(() => null)
    const chatId = aberto?.chats?.[0]?.chatId
    if (chatId) await post('/int/sendMessageToChat', { chatId: Number(chatId), text: texto })
    else await post('/int/openChat', { number: numero, message: texto })
  } catch (e) {
    console.error(`digest falhou pra ${numero}: ${String(e).slice(0, 100)}`)
  }
}
if (!DRY && enviados + falhas > 0) {
  for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean)) await enviarWhats(tel, resumo)
}
setTimeout(() => process.exit(falhas > 0 ? 1 : 0), 800).unref()
