/**
 * cadastro-recebido-cobranca/route.ts (AIVA)
 *
 * Cadência que cobra os DADOS FALTANTES dos leads parados na etapa "Cadastro
 * Recebido". Fonte da verdade = ETAPA do Evo Talks (lib/cadastro-recebido).
 *
 * Régua (dias na etapa, via stagebegintime do Evo):
 *   Toque 1 → D+1 · Toque 2 → D+3 · Toque 3 → D+7
 *   Após 3 toques sem completar → escala pro Nei (uma vez) e para.
 *
 * Entrega: template HSM reabridor (AIVA_REATIVACAO_TEMPLATE_ID) + texto livre
 * listando o que falta. Quando o lojista responde, a VictorIA (Fase 3) coleta.
 *
 * Flags em observacoes: [COBRANCA_CAD:n] [COBRANCA_CAD_AT:ISO] [COBRANCA_ESGOTADA]
 * (preservados pelo webhook ao remontar observacoes).
 *
 * Overrides: ?force=true (ignora régua/horário) · ?max=N (lote).
 * Schedule: `0 18 * * 1-5` UTC = 15h BRT seg-sex. Auth: Bearer WEBHOOK_SECRET/CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate, alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { listarCadastroRecebidoIncompletos } from '@/lib/cadastro-recebido'
import { normalizaNome } from '@/lib/text'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const REOPEN_TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const DIAS_POR_TOQUE = [1, 3, 7]
const MAX_TOQUES = 3
const GAP_MIN_MS = 20 * 60 * 60 * 1000

// Pedido em linguagem natural por campo faltante. A ORDEM define qual pedimos
// primeiro: do mais fácil de responder (e-mail, cidade) pro que exige o lojista
// parar e pensar (faturamento). Pedir UM de cada vez converte melhor que listar
// todos — a VictorIA coleta o resto na conversa quando ele responde.
const PEDIDO_AMIGAVEL: Record<string, string> = {
  email_socio: 'o seu melhor e-mail',
  localizacao_lojas: 'em qual cidade fica a sua loja',
  regiao_varejo: 'em qual cidade fica a sua loja',
  nome_varejo: 'o nome da sua loja',
  nome_socio: 'o seu nome completo',
  telefone_socio: 'o seu telefone de contato',
  cnpj_matriz: 'o CNPJ da loja',
  numero_lojas: 'quantas lojas você tem',
  possui_outra_financeira: 'se você já trabalha com outra financeira hoje',
  valor_boleto_mensal: 'quanto a loja vende por mês no crediário (pode ser por alto)',
  faturamento_anual: 'quanto a loja fatura por ano (pode ser por alto)',
}
const ORDEM_PEDIDO = [
  'email_socio', 'localizacao_lojas', 'regiao_varejo', 'nome_varejo', 'nome_socio',
  'telefone_socio', 'cnpj_matriz', 'numero_lojas', 'possui_outra_financeira',
  'valor_boleto_mensal', 'faturamento_anual',
]

function pedidoAmigavel(faltandoKeys: string[]): string {
  const escolhido = ORDEM_PEDIDO.find((k) => faltandoKeys.includes(k)) ?? faltandoKeys[0]
  return PEDIDO_AMIGAVEL[escolhido] ?? 'os dados que faltam pra concluir o cadastro'
}

function flagN(obs: string, key: string): number {
  return parseInt(obs.match(new RegExp(`\\[${key}:(\\d+)\\]`))?.[1] ?? '0', 10)
}
function flagDate(obs: string, key: string): Date | null {
  const m = obs.match(new RegExp(`\\[${key}:([^\\]]+)\\]`))
  if (!m) return null
  const d = new Date(m[1])
  return isNaN(d.getTime()) ? null : d
}
function setCobrancaFlags(obs: string, n: number, atISO: string): string {
  const base = (obs ?? '')
    .replace(/\s*\[COBRANCA_CAD:\d+\]\s*/g, ' ')
    .replace(/\s*\[COBRANCA_CAD_AT:[^\]]+\]\s*/g, ' ')
    .trim()
  return `[COBRANCA_CAD:${n}] [COBRANCA_CAD_AT:${atISO}] ${base}`.trim()
}
function nomeDoSocio(obs: string | null, fallback: string): string {
  const m = (obs ?? '').match(/nome_socio=([^|\]]+)/)
  return normalizaNome(m?.[1] ?? null) || normalizaNome(fallback) || 'tudo bem'
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'
  const maxRun = Math.min(Number(url.searchParams.get('max')) || 40, 40)

  const horasBRT = new Date().getUTCHours() - 3
  if (!force && (horasBRT < 8 || horasBRT >= 18)) {
    return NextResponse.json({ ok: true, ignorado: 'fora_horario_comercial', horasBRT })
  }

  const { total, incompletos } = await listarCadastroRecebidoIncompletos()
  const agora = Date.now()
  let cobrados = 0
  let escalados = 0
  const resultados: Array<{ telefone: string; acao: string; toque?: number }> = []

  for (const c of incompletos) {
    if (cobrados + escalados >= maxRun) break
    if (!c.leadId) continue
    const obs = c.observacoes ?? ''
    if (/\[COBRANCA_ESGOTADA\]/.test(obs)) continue

    const tentativas = flagN(obs, 'COBRANCA_CAD')
    const diasNaEtapa = Math.floor(c.horasNaEtapa / 24)

    // Esgotou os 3 toques e ainda falta → escala pro Nei (uma vez) e marca.
    if (tentativas >= MAX_TOQUES) {
      const novaObs = `[COBRANCA_ESGOTADA] ${obs.replace(/\s*\[COBRANCA_ESGOTADA\]\s*/g, ' ').trim()}`.trim()
      await supabaseAdmin.from('sdr_leads').update({ observacoes: novaObs }).eq('id', c.leadId)
      const msg = `🚨 *${c.nome}* (${c.telefone}) — em Cadastro Recebido há ${diasNaEtapa}d e ainda faltam dados após ${tentativas} cobranças automáticas: ${c.faltando.join(', ')}. Precisa de um help manual.`
      if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
      if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
      escalados++
      resultados.push({ telefone: c.telefone, acao: 'escalado' })
      continue
    }

    // Próximo toque é devido pela régua (dias na etapa)?
    if (!force && diasNaEtapa < DIAS_POR_TOQUE[tentativas]) continue
    // Min-gap / não interromper lead ativo: pula se houve contato nas últimas ~20h.
    const ultimo = flagDate(obs, 'COBRANCA_CAD_AT') ?? (c.dataUltimoContato ? new Date(c.dataUltimoContato) : null)
    if (!force && ultimo && agora - ultimo.getTime() < GAP_MIN_MS) continue

    if (!REOPEN_TEMPLATE_ID) continue
    const nome = nomeDoSocio(obs, c.nome)
    // Conteúdo vai NO PRÓPRIO HSM (uma linha, sem \n) — entrega garantida mesmo com
    // janela fria. NADA de texto livre separado (falhava 2s após o HSM, antes da
    // janela reabrir — foi o que aconteceu no Iron Celulares).
    // O corpo do template já começa com "Oi {{1}}, tudo bem?" — então o {{2}} entra
    // direto no assunto (sem repetir saudação).
    // Copy revisada 2026-07-20: a versão antiga despejava os 4 campos de uma vez
    // ("falta: email do sócio, faturamento anual, valor boleto mensal, localização")
    // — burocrática e de alta fricção. 19 dos 25 leads da etapa ignoraram os 3
    // toques com ela. Nova abordagem: lidera com o ganho (loja JÁ aprovada) e pede
    // UM dado só, o mais fácil primeiro. O resto a VictorIA coleta na conversa.
    const pedido = pedidoAmigavel(c.faltandoKeys)
    const miolo = `Sua loja já passou na análise da AIVA e falta pouco pra liberar o crediário! Pra destravar, me manda ${pedido}? O resto eu resolvo com você por aqui, leva 1 minutinho. 😊`
    const textoCompleto = `Olá ${nome}, ${miolo}`
    try {
      await sendTemplate(c.telefone, REOPEN_TEMPLATE_ID, [nome, miolo])

      const novaObs = setCobrancaFlags(obs, tentativas + 1, new Date().toISOString())
      await supabaseAdmin
        .from('sdr_leads')
        .update({ observacoes: novaObs, data_ultimo_contato: new Date().toISOString() })
        .eq('id', c.leadId)
      await supabaseAdmin.from('sdr_mensagens').insert([
        { lead_id: c.leadId, direcao: 'out', conteudo: `[Cobrança Cadastro Recebido — toque ${tentativas + 1}/${MAX_TOQUES}]`, template_hsm: 'aiva_reativacao_48h' },
        { lead_id: c.leadId, direcao: 'out', conteudo: textoCompleto },
      ])
      cobrados++
      resultados.push({ telefone: c.telefone, acao: 'cobrado', toque: tentativas + 1 })
    } catch (err) {
      console.error(`[cobranca-cad] falha ${c.telefone}:`, err)
    }
  }

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    total_cadastro_recebido: total,
    incompletos: incompletos.length,
    cobrados,
    escalados,
    resultados,
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
