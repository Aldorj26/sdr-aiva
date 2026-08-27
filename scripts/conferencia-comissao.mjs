#!/usr/bin/env node
/**
 * Conferência de comissão do mês — a mesma lógica do painel /comissoes
 * (lib/comissoes.ts), em linha de comando, com digest opcional no WhatsApp.
 *
 * Cruza: relatório da UME (ume_comissoes) × funil 11 (Contas fechadas MRR,
 * ao vivo do Evo) × snapshot do Data Studio (aiva_desempenho, contraprova 🔴).
 *
 * Uso:
 *   node --env-file=.env.local scripts/conferencia-comissao.mjs [--mes YYYY-MM] [--whatsapp]
 *
 * - sem --mes: usa o mês mais recente importado em ume_comissoes_meta
 * - --whatsapp: envia o digest pro Aldo (ALDO_WHATSAPP) e pro Nei (NEI_WHATSAPP)
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const WHATSAPP = args.includes('--whatsapp')
const pegaMes = () => { const i = args.indexOf('--mes'); return i >= 0 ? args[i + 1] : null }

rmSync('.tsc-tmp', { recursive: true, force: true })
execSync('npx tsc lib/comissoes.ts --outDir .tsc-tmp --module commonjs --target es2020 --esModuleInterop --skipLibCheck', { stdio: 'inherit' })
const { conferir, AIVA_GRUPOS } = require(process.cwd() + '/.tsc-tmp/comissoes.js')

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...body }) })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`)
  return res.json()
}
// mesmo fluxo do lib sendText: chat aberto → mensagem no chat; senão abre chat
const enviarWhats = async (numero, texto) => {
  try {
    const aberto = await post('/int/getClientOpenChats', { number: numero }).catch(() => null)
    const chatId = aberto?.chats?.[0]?.chatId
    if (chatId) await post('/int/sendMessageToChat', { chatId: Number(chatId), text: texto })
    else await post('/int/openChat', { number: numero, message: texto })
    return true
  } catch (err) {
    console.error(`falha ao enviar WhatsApp pra ${numero}:`, err.message)
    return false
  }
}

// ── mês
const { data: metas } = await sb.from('ume_comissoes_meta').select('*').order('mes', { ascending: false })
const mes = pegaMes() ?? metas?.[0]?.mes
if (!mes) { console.error('Nenhum mês importado em ume_comissoes_meta.'); process.exit(1) }
const metasMes = (metas ?? []).filter((m) => m.mes === mes)

// ── dados
const [{ data: linhas }, { data: desemp }] = await Promise.all([
  sb.from('ume_comissoes').select('*').eq('mes', mes),
  sb.from('aiva_desempenho').select('cnpj,aprovados,vendas,valor_vendas').eq('mes', mes),
])
const resPipe = await fetch(`${BASE}/int/getPipeOpportunities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: process.env.EVO_TALKS_API_KEY, pipelineId: 11 }) })
const contas = (await resPipe.json()).filter((o) => (o.tags ?? []).includes(7) || (o.tags ?? []).includes(69))

const conf = conferir(
  contas.map((o) => ({ id: o.id, title: o.title, mainphone: o.mainphone ?? '', description: o.description ?? '' })),
  linhas ?? [],
  desemp ?? [],
)

// ── números
const brl = (v) => `R$ ${(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const nf = metasMes.reduce((s, m) => s + (Number(m.total_comissao) || 0), 0)
const comissaoAiva = (linhas ?? []).filter((l) => l.origem === 'carteira' && AIVA_GRUPOS.has(l.grupo ?? '')).reduce((s, l) => s + (l.comissao ?? 0), 0)
const est = { comissionada: 0, sem_venda: 0, sem_rid: 0, so_relatorio: 0 }
conf.forEach((c) => est[c.estado]++)
const divs = conf.filter((c) => c.divergencia)
const soRelSemConta = conf.filter((c) => c.estado === 'so_relatorio' && (c.relatorio?.origem ?? 'carteira') === 'carteira')
const temContraprova = (desemp ?? []).length > 0

// ── digest
const linhasDigest = [
  `📊 *Conferência de comissão — ${mes}*`,
  '',
  `💰 Valor da NF (Carteira + FCDL): *${brl(nf)}*`,
  ...(metasMes.length < 2 ? ['⚠️ Só uma das duas planilhas foi importada até agora (Carteira + FCDL fecham a NF).'] : []),
  `📱 Comissão dos grupos AIVA: ${brl(comissaoAiva)}`,
  '',
  `✅ Comissionadas: ${est.comissionada}`,
  `💤 Sem venda no mês: ${est.sem_venda}`,
  `⚠️ Sem Retailer ID: ${est.sem_rid}`,
  `🆕 No relatório sem conta no funil 11 (carteira): ${soRelSemConta.length}`,
  temContraprova
    ? `🔴 Divergências (Data Studio × relatório): ${divs.length}${divs.length ? ' — VER NO PAINEL' : ''}`
    : `🔴 Divergências: sem contraprova — falta importar o Funil por Loja de ${mes} (coletor + scripts/importar-funil-loja.mjs)`,
  ...divs.slice(0, 8).map((d) => `   • ${(d.opp?.title ?? d.relatorio?.varejo ?? '?').slice(0, 40)} (vendeu ${d.desempenho?.vendas} no DS e não foi comissionada)`),
  '',
  `Detalhe loja a loja: https://sdr-aiva.vercel.app/comissoes?mes=${mes}`,
]
const digest = linhasDigest.join('\n')
console.log('\n' + digest + '\n')

if (WHATSAPP) {
  for (const num of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean)) {
    const ok = await enviarWhats(num, digest)
    console.log(`WhatsApp ${num}: ${ok ? '✓ enviado' : '✗ falhou'}`)
  }
}
rmSync('.tsc-tmp', { recursive: true, force: true })
// saída suave: process.exit() imediato crasha no Windows (uv assertion) com
// sockets do supabase-js abertos.
setTimeout(() => process.exit(0), 800).unref()
