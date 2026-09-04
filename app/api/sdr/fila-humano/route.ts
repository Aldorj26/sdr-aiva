/**
 * fila-humano/route.ts (AIVA — lista diária de atendimento humano pro Nei)
 *
 * Pedido do Aldo 2026-07-29: toda manhã o Nei recebe no WhatsApp a fila de
 * leads com acionar_humano=true, categorizada por tipo de ação — atendimento
 * humano é a prioridade nº 1 dele.
 *
 * Categorias (por padrão do motivo em observacoes):
 *   🔴 Ação pendente  — acesso/técnico + pedidos diretos dos lojistas
 *   📄 Docs/colaborador — documentação pronta pra processar com o Edu
 *   🟡 Mover card     — biometria/cadastro confirmados, só avançar etapa
 *   ⚪ Sem motivo     — flags antigas, revisar e marcar "Atendido"
 *
 * Fila vazia → mensagem de fila zerada (reforço positivo).
 *
 * Params: ?dry=true (devolve a mensagem sem enviar)
 * Schedule: 0 11 * * 1-5 UTC = 8h BRT, seg-sex
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { alertHuman } from '@/lib/evotalks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Classificação compartilhada com a página /atendimento (lib/fila.ts, 03/09) —
// uma fonte só pra motivo/categoria, digest e painel nunca divergem.
import { RE_MOTIVO, categoriaFila as categoria } from '@/lib/fila'

type Item = { nome: string; telefone: string; status: string; motivo: string; ultimaMsg: string | null }

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === 'true'

  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, observacoes, data_ultimo_contato')
    .eq('acionar_humano', true)
    .not('status', 'in', '("FORMULARIO_ENVIADO","OPT_OUT","NAO_QUALIFICADO","DESCARTADO")')
    .order('data_ultimo_contato', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // CS separado (02/09): lojas ATIVAS têm seção própria e são tratadas no
  // /desempenho — não se misturam com o funil.
  const grupos: Record<string, Item[]> = { acao: [], docs: [], mover: [], sem_motivo: [], cs: [] }
  for (const l of leads ?? []) {
    const motivo = ((l.observacoes ?? '').match(RE_MOTIVO)?.[1] ?? '').trim()
    const item = {
      nome: l.nome,
      telefone: l.telefone,
      status: l.status,
      motivo,
      ultimaMsg: l.data_ultimo_contato,
    }
    if (l.status === 'LOJA_FINALIZADA_E_VENDENDO') grupos.cs.push(item)
    else grupos[categoria(motivo)].push(item)
  }

  const total = (leads ?? []).length
  const dataHoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })

  let msg: string
  if (total === 0) {
    msg = `📋 *FILA DE ATENDIMENTO HUMANO — ${dataHoje}*\n\n🎉 Fila zerada! Nenhum lead aguardando atendimento.`
  } else {
    const linha = (i: Item, n: number) => {
      const mot = i.motivo ? ` — ${i.motivo.slice(0, 90).trim()}` : ''
      return `${n}. *${i.nome}* (${i.telefone})${mot}`
    }
    const secao = (titulo: string, itens: Item[], offset: number) =>
      itens.length ? `\n${titulo}\n${itens.map((i, idx) => linha(i, offset + idx + 1)).join('\n')}\n` : ''

    let n = 0
    const s1 = secao(`🔴 *AÇÃO PENDENTE (${grupos.acao.length})* — resolver hoje:`, grupos.acao, n); n += grupos.acao.length
    const s2 = secao(`📄 *DOCS/COLABORADORES (${grupos.docs.length})* — processar com o Edu:`, grupos.docs, n); n += grupos.docs.length
    const s3 = secao(`🟡 *MOVER CARD (${grupos.mover.length})* — cadastro/biometria confirmados:`, grupos.mover, n); n += grupos.mover.length
    const s4 = secao(`⚪ *SEM MOTIVO REGISTRADO (${grupos.sem_motivo.length})* — revisar e marcar "Atendido":`, grupos.sem_motivo, n); n += grupos.sem_motivo.length
    const s5 = secao(`🟣 *CS — LOJAS ATIVAS (${grupos.cs.length})* — tratar na aba Atendimento:`, grupos.cs, n)

    msg =
      `📋 *FILA DE ATENDIMENTO HUMANO — ${dataHoje}* (${total} lead${total > 1 ? 's' : ''})\n` +
      `Prioridade nº 1 do dia 👊\n` +
      s1 + s2 + s3 + s4 + s5 +
      `\nFunil: https://sdr-aiva.vercel.app/?aguardando_humano=true\n` +
      (grupos.cs.length ? `CS (lojas ativas): https://sdr-aiva.vercel.app/atendimento\n` : '') +
      `(Atendeu? Marca "Atendido" no painel pra sair da fila.)`
  }

  // Teto de segurança do WhatsApp (~4096 chars)
  if (msg.length > 3900) msg = msg.slice(0, 3850) + '\n… lista completa no painel.'

  if (!dry) {
    if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
    console.log(`[FILA_HUMANO] Lista diária enviada: ${total} leads`)
  }

  return NextResponse.json({ ok: true, dry, total, porCategoria: Object.fromEntries(Object.entries(grupos).map(([k, v]) => [k, v.length])), mensagem: msg })
}
