/**
 * Loja BLOQUEADA POR LIMITE DE ORIGINAÇÃO no portal da AIVA (Aldo 06/10/2026).
 *
 * A AIVA trava a loja quando ela bate o teto de vendas liberado (o Aldo informou R$ 15 mil por semana) e o
 * portal mostra "Inativo" + o selo "⚠️ Bloqueada por limite de originação". A fonte é a tabela
 * `store_origination_limit` do banco do portal (criada pela AIVA em 06/10; só tem retailer_id,
 * bloqueado_por_limite e bloqueado_desde — não traz o valor do limite nem a data de volta). Não está
 * na API pública: lê pelo login do portal, como o resto de lib/portal-aiva.
 *
 * Caso que motivou: Ajucelulares (RID 6587), bloqueada desde 25/09 — a VictorIA respondia "registrei
 * urgente pro time verificar o que travou sua conta", como se a causa fosse desconhecida.
 *
 * ⚠️ Nada aqui lança erro pra quem chama: falha na leitura não pode calar a VictorIA (sem a informação
 * ela responde como antes).
 */
import { loginPortal, rest } from '@/lib/portal-aiva'
import { supabaseAdmin } from '@/lib/supabase'
import { cnpjsDoLead } from '@/lib/desempenho-loja'

export type Bloqueio = { rid: string; cnpj: string | null; desde: string | null }

let cache: { em: number; porCnpj: Map<string, Bloqueio>; porRid: Map<string, Bloqueio> } | null = null
const VALIDADE_MS = 10 * 60_000

/** Lojas bloqueadas agora, por CNPJ e por RID (cache de 10 min). */
export async function lojasBloqueadasPorLimite(): Promise<{ porCnpj: Map<string, Bloqueio>; porRid: Map<string, Bloqueio> }> {
  if (cache && Date.now() - cache.em < VALIDADE_MS) return cache
  const s = await loginPortal()
  const { data } = await rest<Array<{ retailer_id: string | number; bloqueado_desde: string | null }>>(
    s, 'store_origination_limit?select=retailer_id,bloqueado_desde&bloqueado_por_limite=eq.true',
  )
  const porRid = new Map<string, Bloqueio>()
  for (const x of data ?? []) porRid.set(String(x.retailer_id), { rid: String(x.retailer_id), cnpj: null, desde: x.bloqueado_desde })
  const porCnpj = new Map<string, Bloqueio>()
  if (porRid.size) {
    // retailer_performance liga RID → CNPJ (a tabela de limite não traz o CNPJ)
    const { data: perf } = await rest<Array<{ retailer_id: string | number; cnpj: string | null }>>(
      s, `retailer_performance?select=retailer_id,cnpj&retailer_id=in.(${[...porRid.keys()].join(',')})`,
    )
    for (const p of perf ?? []) {
      const b = porRid.get(String(p.retailer_id))
      const cnpj = String(p.cnpj ?? '').replace(/\D/g, '')
      if (b && cnpj.length === 14) { b.cnpj = cnpj; porCnpj.set(cnpj, b) }
    }
  }
  cache = { em: Date.now(), porCnpj, porRid }
  return cache
}

/** Bloqueio de alguma loja deste lead (pelos CNPJs do lead), ou null. Nunca lança. */
export async function bloqueioDoLead(leadId: string, observacoes?: string | null, extra: (string | null | undefined)[] = []): Promise<Bloqueio | null> {
  try {
    const { porCnpj } = await lojasBloqueadasPorLimite()
    if (!porCnpj.size) return null
    for (const c of await cnpjsDoLead(leadId, observacoes, extra)) {
      const b = porCnpj.get(String(c).replace(/\D/g, ''))
      if (b) return b
    }
    return null
  } catch (e) {
    console.error('[limite-originacao] leitura falhou:', e instanceof Error ? e.message : e)
    return null
  }
}

/** Ids dos leads com alguma loja bloqueada (registros + cnpj_matriz). Pras rotinas de HSM pularem a loja
 *  (revisor 06/10: a dica das 10h mandava "ofereça pra todo cliente"/"te ajudo a destravar" pra loja travada).
 *  Falha na leitura devolve vazio — a rotina segue como antes. */
export async function leadsBloqueadosPorLimite(): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    const cnpjs = [...(await lojasBloqueadasPorLimite()).porCnpj.keys()]
    if (!cnpjs.length) return ids
    const { data } = await supabaseAdmin.from('sdr_registros_cnpj').select('lead_id').in('cnpj', cnpjs)
    for (const r of data ?? []) if (r.lead_id) ids.add(r.lead_id)
    for (const c of cnpjs) {
      const { data: ls } = await supabaseAdmin.from('sdr_leads').select('id').like('observacoes', `%cnpj_matriz=${c}%`)
      for (const l of ls ?? []) ids.add(l.id)
    }
  } catch (e) {
    console.error('[limite-originacao] leads bloqueados:', e instanceof Error ? e.message : e)
  }
  return ids
}

/** Bloco dinâmico do prompt (fora do cache). */
export function blocoPromptBloqueio(b: Bloqueio): string {
  const desde = b.desde ? new Date(b.desde).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : null
  return `[INSTRUÇÃO DO SISTEMA — LOJA BLOQUEADA POR LIMITE DE ORIGINAÇÃO DA AIVA]
O portal da AIVA mostra (informação do sistema, não do lojista) que esta loja está BLOQUEADA POR LIMITE DE ORIGINAÇÃO${desde ? ` desde ${desde}` : ''}: ela atingiu o teto de vendas que a AIVA libera por semana (hoje, R$ 15 mil). Por isso o sistema mostra a loja como inativa e não deixa vender ("Loja inativada", "entre em contato com o suporte").
- Se ele falar de conta/loja travada, inativa, bloqueada, "não consigo vender", mensagem de suporte, ou perguntar o que aconteceu: EXPLIQUE com clareza e sem drama — não é erro dele nem problema no cadastro; a loja vendeu até o limite de vendas que a AIVA libera e a liberação é da AIVA. Diga que o nosso time já está tratando isso com a AIVA. ⛔ NÃO peça print (a regra 📸 não vale aqui: a causa já é conhecida) e NÃO mande abrir o Live Chat por causa do bloqueio — a liberação é tratada pelo nosso time com a AIVA.
- O QUE DIZER sobre o bloqueio é SÓ isto (até 3 frases, com as suas palavras): (1) a loja atingiu o limite de vendas da semana que a AIVA libera, por isso aparece inativa; (2) não é erro dele nem do cadastro; (3) o nosso time já está tratando a liberação com a AIVA e, quando liberar, a loja volta a vender normalmente. Nada além disso sobre o bloqueio — sem dica, sem alternativa, sem contorno, sem prazo, sem promessa de aviso.
- Se a conversa for sobre outro assunto e você ainda NÃO explicou o bloqueio nesta conversa, responda o que ele perguntou e avise em UMA linha no final.
- ⛔ NÃO diga que "registrou pro time verificar o que travou" como se a causa fosse desconhecida. ⛔ NÃO prometa data de liberação, NÃO diga que o limite vai aumentar e NÃO invente como o limite é calculado além do que está aqui — nada de "é tipo um limite de crédito", "controle de risco", "a AIVA vai liberando aos poucos" ou "depende da análise interna". Se ele perguntar quando volta: diga só que não temos data e que o time está tratando com a AIVA.
- ⛔ NÃO prometa que VOCÊ vai avisar quando liberar ("te aviso aqui", "assim que houver novidade eu te falo") — nada avisa a gente automaticamente. Diga que, quando liberar, a loja volta a vender normalmente.
- ⛔ NÃO diga o que funciona ou não durante o bloqueio (ex.: "a consulta de CPF continua liberada") — a gente não sabe. Não sugira contorno.
- ⛔ NÃO ofereça outra financeira (Parcelex ou qualquer outra) por causa do bloqueio, nem no fim da mensagem — este bloco SOBREPÕE a regra que oferece Parcelex quando a loja reclama de reprovação/parada. Só se ELE perguntar por alternativa.
- Acione no turno em que você EXPLICAR ou AVISAR do bloqueio pela primeira vez nesta conversa (seja ele quem trouxe o assunto ou você): acionar_humano = true, motivo_humano = "loja_bloqueada_limite_originacao". Se você JÁ explicou e ele só agradece ou diz "ok", não acione de novo.
⚠️ Este bloco SOBREPÕE: o bloco de números da loja (a queda de vendas aqui é o bloqueio, não falta de uso — não dê dica de vender mais); qualquer frase-modelo do suporte pós-venda sobre conta inativa/travada; o item 1️⃣ da FASE 5, a situação A do SUPORTE PÓS-VENDA e o item 3 da REGRA CRÍTICA PÓS-CADASTRO (Live Chat, acionar_humano = false, "nunca diga que vai chamar o time"); o item 2️⃣ da FASE 5 (radar de churn: queda de vendas ou desânimo enquanto a loja está bloqueada usa o motivo "loja_bloqueada_limite_originacao", NÃO "loja_ativa_sem_vendas", e não leva dica de venda); e a regra 📸 do print.
✅ CHECAGEM ANTES DE ENVIAR: a resposta tem prazo? promessa de "te aviso"/"compartilho novidade"/"a gente resolve"? sugestão do que fazer durante o bloqueio (consultar CPF, segurar aprovação)? outra financeira? Se tiver qualquer um, TIRE.
[FIM INSTRUÇÃO DO SISTEMA]`
}
