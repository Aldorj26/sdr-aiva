/**
 * template-utilidade.ts — envio pelas rotinas trocando o coringa 48 (marketing) pelos templates de
 * UTILIDADE 87 (pendência) e 86 (etapa concluída). Textos e regras em lib/template-utilidade-calc.ts.
 *
 * LIGA/DESLIGA NO BANCO: chave `coringa_utilidade_ativo` em `sdr_avisos_chave` (mesmo padrão do
 * `silencio_templates` e da `regua_alerta_ativa`). LIGADA desde 17/11/2026, por ordem do Aldo, que em
 * seguida determinou: "não quero que saia mais nada pelo coringa 48" — TODA rotina que usava o 48 passa
 * por aqui. A chave continua existindo só como volta de emergência (apagar = volta pro 48 sem deploy, se
 * a Meta reclassificar um template ou a entrega cair); quem decide apagar é o Aldo. Falha na LEITURA da
 * chave não derruba pro 48: segue em utilidade.
 *   ligar:    insert into sdr_avisos_chave (chave, ultimo_aviso) values ('coringa_utilidade_ativo', now())
 *   desligar: delete from sdr_avisos_chave where chave = 'coringa_utilidade_ativo'
 */
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { montar, type MsgUtilidade } from '@/lib/template-utilidade-calc'

export const TPL_PENDENCIA = Number(process.env.AIVA_TPL_PENDENCIA_ID) || 87
export const TPL_ETAPA = Number(process.env.AIVA_TPL_ETAPA_ID) || 86
export const CHAVE_UTILIDADE = 'coringa_utilidade_ativo'

let cache: { valor: boolean; em: number } | null = null

/** As rotinas devem usar os templates de utilidade? Cache de 20 s. Falha de leitura = SIM (nada pelo 48). */
export async function utilidadeLigada(): Promise<boolean> {
  if (cache && Date.now() - cache.em < 20_000) return cache.valor
  let valor = true
  try {
    const { data, error } = await supabaseAdmin.from('sdr_avisos_chave').select('chave').eq('chave', CHAVE_UTILIDADE).maybeSingle()
    if (error) throw new Error(error.message)
    valor = !!data
  } catch (e) {
    console.error('[template-utilidade] não consegui ler a chave — seguindo em utilidade (nada pelo 48):', e)
  }
  cache = { valor, em: Date.now() }
  return valor
}

export type EnvioCoringa = {
  nome: string
  loja: string
  /** Caminho antigo: ID do coringa e o texto do {{2}}. */
  coringaId: number
  miolo: string
  /** Como a rotina gravava o `conteudo` no caminho antigo (cada uma tinha o seu formato). */
  conteudoAntigo: string
  /** Caminho novo. */
  util: MsgUtilidade
}

/**
 * Envia pelo template de utilidade se a chave estiver ligada; senão, pelo coringa antigo, igual a antes.
 * Devolve o `conteudo` a gravar em sdr_mensagens (o texto como o lojista leu) e por onde saiu.
 * Lança se o envio falhar — quem chama já trata, como tratava o `sendTemplate`.
 */
export async function enviarCoringa(telefone: string, e: EnvioCoringa): Promise<{ conteudo: string; viaUtilidade: boolean; resultado: Awaited<ReturnType<typeof sendTemplate>> }> {
  if (await utilidadeLigada()) {
    const m = montar(e.nome, e.loja, e.util)
    const resultado = await sendTemplate(telefone, e.util.tipo === 'pendencia' ? TPL_PENDENCIA : TPL_ETAPA, m.vars)
    return { conteudo: m.texto, viaUtilidade: true, resultado }
  }
  if (!e.coringaId) throw new Error('AIVA_REATIVACAO_TEMPLATE_ID não configurado')
  const resultado = await sendTemplate(telefone, e.coringaId, [e.nome, e.miolo])
  return { conteudo: e.conteudoAntigo, viaUtilidade: false, resultado }
}
