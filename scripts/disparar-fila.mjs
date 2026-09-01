#!/usr/bin/env node
/**
 * Dispara D+0 pros próximos N leads PENDENTES da fila sdr_fila_disparo
 * (lista varredura 01/09 — meta 150/dia útil).
 *
 * - Pega os N mais antigos com status PENDENTE
 * - POST em lotes de 5 pro /api/sdr/send-initial de produção (padrão comprovado
 *   do disparar-lote-aiva.mjs — chunks pequenos pra não estourar o timeout)
 * - Marca cada um na fila: DISPARADO (ok/bloqueado com lead criado) ou ERRO
 * - Resumo no console e WhatsApp pro Aldo/Nei
 *
 * Uso: node --env-file=.env.local scripts/disparar-fila.mjs [--qtd 150] [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const PROD = 'https://sdr-aiva.vercel.app/api/sdr/send-initial'
const CHUNK = 5
const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const pega = (f) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : null }
const QTD = pega('--qtd') ?? 150

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)

const horaBrt = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()))
if (!DRY && (horaBrt < 8 || horaBrt >= 19)) { console.error(`ABORTADO: ${horaBrt}h BRT fora da janela de disparo (8h-19h).`); process.exit(1) }

const { data: fila } = await sb.from('sdr_fila_disparo')
  .select('id,nome,telefone,cidade')
  .eq('status', 'PENDENTE')
  .order('criado_em', { ascending: true })
  .limit(QTD)
if (!fila?.length) { console.log('Fila vazia — nada a disparar.'); process.exit(0) }
console.log(`${fila.length} leads da fila${DRY ? ' (DRY)' : ''}`)
if (DRY) { fila.slice(0, 10).forEach((l) => console.log(`- ${l.nome} | ${l.telefone} | ${l.cidade}`)); process.exit(0) }

let sucesso = 0, bloqueado = 0, falha = 0
for (let i = 0; i < fila.length; i += CHUNK) {
  const lote = fila.slice(i, i + CHUNK)
  try {
    const res = await fetch(PROD, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // nome aparado no 1º separador (os nomes do Maps vêm com sufixo de
      // marketing: "RT Iphones - Loja de Celulares - IPhone - Xiaomi...")
      body: JSON.stringify({ leads: lote.map((l) => ({ nome: String(l.nome).split(/\s*[|–—-]\s+/)[0].slice(0, 48).trim() || l.nome, telefone: l.telefone, cidade: l.cidade ?? undefined })) }),
    })
    const j = await res.json().catch(() => ({}))
    const resultados = j.resultados ?? []
    for (const l of lote) {
      const r = resultados.find((x) => x.telefone === l.telefone)
      if (r?.ok) {
        sucesso++
        await sb.from('sdr_fila_disparo').update({ status: 'DISPARADO', disparado_em: new Date().toISOString() }).eq('id', l.id)
      } else if (r?.info || r?.erro) {
        // bloqueado pela blacklist do endpoint (já em cadência etc.) ou falha pontual
        const msg = (r.info ?? r.erro ?? '').slice(0, 180)
        const ehBloqueio = !!r.info
        if (ehBloqueio) bloqueado++; else falha++
        await sb.from('sdr_fila_disparo').update({ status: ehBloqueio ? 'DUPLICADO' : 'ERRO', detalhe: msg }).eq('id', l.id)
      } else {
        falha++
        await sb.from('sdr_fila_disparo').update({ status: 'ERRO', detalhe: `sem resultado (HTTP ${res.status})` }).eq('id', l.id)
      }
    }
    console.log(`lote ${i / CHUNK + 1}/${Math.ceil(fila.length / CHUNK)}: ok=${sucesso} bloq=${bloqueado} err=${falha}`)
  } catch (e) {
    for (const l of lote) await sb.from('sdr_fila_disparo').update({ status: 'ERRO', detalhe: String(e).slice(0, 180) }).eq('id', l.id)
    falha += lote.length
    console.error(`lote ${i / CHUNK + 1} FALHOU: ${String(e).slice(0, 120)}`)
  }
}

const { count: restantes } = await sb.from('sdr_fila_disparo').select('id', { count: 'exact', head: true }).eq('status', 'PENDENTE')
const resumo =
  `🚀 *Disparo D+0 — fila varredura*\n` +
  `Enviados: ${sucesso} | bloqueados (já na base): ${bloqueado} | falhas: ${falha}\n` +
  `Restam na fila: ${restantes} leads.`
console.log('\n' + resumo)

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...body }) })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return res.json()
}
for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean)) {
  try {
    const aberto = await post('/int/getClientOpenChats', { number: tel }).catch(() => null)
    const chatId = aberto?.chats?.[0]?.chatId
    if (chatId) await post('/int/sendMessageToChat', { chatId: Number(chatId), text: resumo })
    else await post('/int/openChat', { number: tel, message: resumo })
  } catch (e) { console.error(`digest falhou pra ${tel}`) }
}
setTimeout(() => process.exit(falha > sucesso ? 1 : 0), 800).unref()
