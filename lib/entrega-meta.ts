/**
 * lib/entrega-meta.ts — o IO da checagem de entrega (a decisão está no -calc).
 *
 * Lê os templates que saíram hoje (sdr_mensagens), pega uma amostra, procura
 * cada um no chat do Evo e pergunta se a Meta entregou (clientrcvtime).
 *
 * ⚠️ Amostra, não a fila inteira: são 400 envios num dia cheio e cada consulta é
 * uma chamada à Evo. 30 chats respondem a pergunta ("está entregando ou não?")
 * em ~20s; 400 estourariam o orçamento de 300s da função.
 */
import { supabaseAdmin } from './supabase'
import { getChatMessages, getOpenChatId } from './evotalks'
import { avaliarEntrega, entregaDoChat, CARENCIA_MS, type Veredito } from './entrega-meta-calc'

/** Quantos chats conferir por rodada. */
const TAMANHO_AMOSTRA = 30

/** Meia-noite BRT de hoje, em ISO UTC. */
function inicioDoDiaBrt(agora = new Date()): string {
  const brt = new Date(agora.getTime() - 3 * 3_600_000)
  return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()) + 3 * 3_600_000).toISOString()
}

export type Resultado = Veredito & {
  enviados_hoje: number
  alvos: number
  sem_template_no_chat: number
  sem_chat: number
  evo_falhou: number
  chat_renovado: number
  exemplos: string[]
}

export async function conferirEntregaHoje(agora = new Date()): Promise<Resultado> {
  const de = inicioDoDiaBrt(agora)
  const ate = new Date(agora.getTime() - CARENCIA_MS).toISOString()

  // templates que saíram hoje e já passaram da carência
  const { data: outs } = await supabaseAdmin
    .from('sdr_mensagens')
    .select('lead_id,enviado_em,template_hsm')
    .eq('direcao', 'out')
    .not('template_hsm', 'is', null)
    .neq('template_hsm', 'manual_humano')
    .gte('enviado_em', de)
    .lte('enviado_em', ate)
    .order('enviado_em')
    .limit(3000)

  // um envio por lead (o lead que recebeu dois hoje não vale dois na amostra)
  const leadsUnicos = [...new Set((outs ?? []).map((m) => m.lead_id))]
  const enviados = leadsUnicos.length
  if (!enviados) {
    return { ...avaliarEntrega(0, 0), enviados_hoje: 0, alvos: 0, sem_template_no_chat: 0, sem_chat: 0, evo_falhou: 0, chat_renovado: 0, exemplos: [] }
  }

  // Amostra espalhada pelo dia E ancorada no FIM. Com `floor` + `slice`, um dia
  // de 30-59 envios virava "os 30 primeiros" — só a manhã, o oposto do que a
  // gente quer: se a entrega cai às 14h, a amostra da manhã diz "está tudo bem".
  // `ceil` corrige a varredura, e os ÚLTIMOS 10 entram sempre, porque são os
  // envios mais recentes e os que revelam a falha que acabou de começar.
  const passo = Math.max(1, Math.ceil(enviados / TAMANHO_AMOSTRA))
  const varredura = leadsUnicos.filter((_, i) => i % passo === 0)
  const recentes = leadsUnicos.slice(-10)
  const alvos = [...new Set([...varredura, ...recentes])].slice(-TAMANHO_AMOSTRA)

  // contadores separados: "sem chat", "Evo falhou" e "template não achado" são
  // problemas diferentes, e misturá-los esconderia justamente o defeito do chat velho
  let amostra = 0, entregues = 0, semTemplate = 0, semChat = 0, falhouEvo = 0, chatRenovado = 0
  const exemplos: string[] = []
  for (const leadId of alvos) {
    const { data: lead } = await supabaseAdmin.from('sdr_leads').select('nome,telefone,evotalks_chat_id').eq('id', leadId).maybeSingle()
    if (!lead) continue
    let chatId = lead.evotalks_chat_id ? Number(lead.evotalks_chat_id) : null
    const veioDoBanco = !!chatId
    if (!chatId) { try { chatId = await getOpenChatId(lead.telefone) } catch { chatId = null } }
    if (!chatId) { semChat++; continue }
    let msgs: Awaited<ReturnType<typeof getChatMessages>> = []
    try { msgs = await getChatMessages(chatId, 20) } catch { falhouEvo++; continue }
    let v = entregaDoChat(msgs, de, ate)
    // ⚠️ `evotalks_chat_id` fica VELHO: o lojista abre chat novo e o campo segue
    // apontando pro antigo. Medido em 22/09: 29 de 48 leads do lembrete tinham o
    // template SÓ no chat aberto atual. Sem esta segunda tentativa o lead sumia da
    // amostra como "sem_template" e a amostra encolhia até `sem_dados` — o vigia
    // ficaria calado justamente no dia do apagão.
    if (v === 'sem_template' && veioDoBanco) {
      try {
        const atual = await getOpenChatId(lead.telefone)
        if (atual && atual !== chatId) {
          const msgs2 = await getChatMessages(atual, 20)
          const v2 = entregaDoChat(msgs2, de, ate)
          if (v2 !== 'sem_template') { v = v2; chatRenovado++ }
        }
      } catch { /* segue com o veredito do chat antigo */ }
    }
    if (v === 'sem_template') { semTemplate++; continue }
    amostra++
    if (v === 'entregue') entregues++
    else if (exemplos.length < 5) exemplos.push(`${lead.nome} (${lead.telefone})`)
  }

  return {
    ...avaliarEntrega(amostra, entregues),
    enviados_hoje: enviados, alvos: alvos.length,
    sem_template_no_chat: semTemplate, sem_chat: semChat, evo_falhou: falhouEvo, chat_renovado: chatRenovado,
    exemplos,
  }
}
