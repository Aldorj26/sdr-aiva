// Mineração de queixas/problemas das lojas em LOJA_FINALIZADA_E_VENDENDO
// (pedido do Aldo 31/08 — item 3 da discussão de Fase 5).
// Para cada loja: pega a conversa da janela pós-credenciamento (60 dias antes
// de status_alterado_em até hoje, pra pegar TREINAR/LOGIN também), pede pro
// Claude extrair os problemas relatados + quem resolveu + sinais da barreira
// de reprovação de crédito. Agrega tudo em um JSON pro relatório xlsx.
// Uso: node --env-file=.env.local scripts/mineracao-queixas-lfv-2026-08-31.mjs
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const OUT = 'scripts/out-mineracao-queixas-lfv.json'

const CATEGORIAS = [
  'reprovacao_credito', 'repasse_pagamento', 'ccb_sms_cliente_final', 'login_acesso_socio',
  'cadastro_usuarios_vendedores', 'plataforma_erro_tecnico', 'boleto_parcela_cliente_final',
  'precificacao_taxa_mdr', 'material_divulgacao', 'duvida_treinamento_operacao',
  'troca_conta_bancaria', 'limite_valor_credito', 'cancelamento_estorno_troca',
  'equipe_desmotivada_parou_ofertar', 'outros',
]

const SYSTEM = `Você analisa conversas de WhatsApp entre a VictorIA (agente SDR/suporte da Track, que representa o crediário AIVA/Flexfone) e lojistas de celular JÁ CREDENCIADOS e ativos. Mensagens "IN" são do lojista; "OUT" são da VictorIA (as marcadas [MANUAL] foram enviadas manualmente pelo Nei, humano do time, via painel).

Extraia APENAS problemas/queixas/dúvidas REAIS que o LOJISTA trouxe (ignore papo de qualificação comercial antiga, confirmações triviais e mensagens da VictorIA sem resposta). Responda SOMENTE com JSON válido:
{
 "problemas": [
   {
     "categoria": "<uma de: ${CATEGORIAS.join(', ')}>",
     "descricao": "<resumo em 1 frase do problema específico>",
     "resolvido_por": "victoria | nei_manual | encaminhado_livechat_aiva | encaminhado_outro_canal | nao_resolvido | nao_da_pra_saber",
     "resposta_foi_boa": true/false,
     "evidencia": "<trecho curto da msg do lojista, máx 120 chars>"
   }
 ],
 "sinais_reprovacao": {
   "reclamou_reprovacao": true/false,
   "qtd_mencoes_reprovacao": <int>,
   "parou_ou_desanimou_de_ofertar": true/false,
   "evidencia": "<trecho ou vazio>"
 },
 "pediu_material_divulgacao": true/false,
 "elogiou_ou_vendeu_bem": true/false,
 "resumo_loja": "<1-2 frases: situação geral desta loja no pós-venda>"
}
Se a conversa não tem nada relevante de pós-venda, devolva problemas=[] e campos false.`

const { data: leads } = await sb
  .from('sdr_leads')
  .select('id,nome,telefone,status_alterado_em')
  .eq('status', 'LOJA_FINALIZADA_E_VENDENDO')
  .order('nome')

// retomável: pula lojas já processadas
const resultado = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const pendentes = leads.filter((l) => !resultado[l.id])
console.log(`${leads.length} lojas LFV, ${pendentes.length} pendentes`)

async function processa(l) {
  const corte = l.status_alterado_em
    ? new Date(new Date(l.status_alterado_em).getTime() - 60 * 24 * 3600e3).toISOString()
    : '2026-01-01'
  const { data: msgs } = await sb
    .from('sdr_mensagens')
    .select('direcao,conteudo,enviado_em')
    .eq('lead_id', l.id)
    .gte('enviado_em', corte)
    .order('enviado_em')
  if (!msgs?.length) return { skip: 'sem mensagens na janela' }

  let linhas = msgs.map((m) => {
    const manual = /manual via painel/i.test(m.conteudo ?? '') ? ' [MANUAL]' : ''
    const c = String(m.conteudo ?? '').replace(/\s+/g, ' ').slice(0, 600)
    return `${m.enviado_em.slice(0, 10)} ${m.direcao.toUpperCase()}${manual}: ${c}`
  })
  // cap de contexto: mantém o FIM da conversa (mais recente)
  let transcript = linhas.join('\n')
  if (transcript.length > 19000) transcript = transcript.slice(-19000)

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Loja: ${l.nome}\n\nConversa:\n${transcript}` }],
  })
  const texto = resp.content.find((b) => b.type === 'text')?.text ?? ''
  const m = texto.match(/\{[\s\S]*\}/)
  if (!m) return { erro: 'sem JSON', bruto: texto.slice(0, 200) }
  try {
    return { ...JSON.parse(m[0]), n_msgs: msgs.length }
  } catch {
    return { erro: 'JSON inválido', bruto: texto.slice(0, 200) }
  }
}

let feitos = 0
const FILA = [...pendentes]
async function worker() {
  while (FILA.length) {
    const l = FILA.shift()
    try {
      resultado[l.id] = { nome: l.nome, telefone: l.telefone, ...(await processa(l)) }
    } catch (e) {
      resultado[l.id] = { nome: l.nome, telefone: l.telefone, erro: String(e).slice(0, 200) }
    }
    feitos++
    if (feitos % 10 === 0) {
      writeFileSync(OUT, JSON.stringify(resultado, null, 1))
      console.log(`${feitos}/${pendentes.length}`)
    }
  }
}
await Promise.all(Array.from({ length: 5 }, worker))
writeFileSync(OUT, JSON.stringify(resultado, null, 1))
console.log(`FIM: ${feitos} processadas → ${OUT}`)
setTimeout(() => process.exit(0), 800).unref()
