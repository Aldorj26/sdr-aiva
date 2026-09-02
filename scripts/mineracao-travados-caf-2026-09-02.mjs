// Mineração dos leads TRAVADOS em EM_ANALISE_AIVA que já esgotaram as 3
// cobranças automáticas do CAF (pedido do Aldo 02/09).
// Pra cada lead: transcript da conversa → Claude extrai o MOTIVO da travada,
// se respondeu às cobranças e a ação recomendada. Sai JSON pro relatório.
// Uso: node --env-file=.env.local scripts/mineracao-travados-caf-2026-09-02.mjs
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const OUT = 'scripts/out-mineracao-travados-caf.json'

const CATEGORIAS = [
  'biometria_dificuldade_ou_medo', 'link_ou_problema_tecnico', 'socio_ausente_sem_tempo',
  'esfriou_sem_motivo_declarado', 'nunca_respondeu_cobrancas', 'diz_que_vai_fazer_e_nao_faz',
  'aguardando_terceiro_ou_documento', 'desistiu_ou_mudou_de_ideia', 'ja_diz_ter_concluido', 'outro',
]

const SYSTEM = `Você analisa conversas de WhatsApp entre a VictorIA (agente da Track/AIVA) e lojistas que completaram o cadastro e estão TRAVADOS na etapa final: concluir o onboarding CAF (7 etapas + biometria facial) no link https://retail-onboarding-hub.vercel.app/. Eles receberam até 3 cobranças automáticas sem destravar.

Mensagens IN = lojista; OUT = VictorIA/time. Responda SOMENTE JSON válido:
{
 "categoria": "<uma de: ${CATEGORIAS.join(', ')}>",
 "respondeu_cobrancas": true/false,
 "ultima_fala_relevante": "<trecho curto da última msg significativa do lojista, ou vazio>",
 "motivo_resumo": "<1 frase: por que ESTE lead não concluiu o CAF>",
 "sinal_de_vida": true/false,  // ainda demonstra interesse?
 "acao_recomendada": "ligar | reenviar_link_com_passo_a_passo | orientar_biometria | esperar_data_combinada | humano_negociar | considerar_descarte",
 "acao_detalhe": "<1 frase concreta: o que fazer com este lead>"
}`

const { data: todos } = await sb.from('sdr_leads')
  .select('id,nome,telefone,status_alterado_em,observacoes')
  .eq('status', 'EM_ANALISE_AIVA')
const alvo = todos.filter((l) => {
  const m = (l.observacoes ?? '').match(/\[FOLLOWUP_FASE_COUNT:(\d+)\]/)
  return m && parseInt(m[1]) >= 3
})
const resultado = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const pendentes = alvo.filter((l) => !resultado[l.id])
console.log(`${alvo.length} travados (3 cobranças), ${pendentes.length} pendentes`)

async function processa(l) {
  const { data: msgs } = await sb.from('sdr_mensagens')
    .select('direcao,conteudo,enviado_em')
    .eq('lead_id', l.id).order('enviado_em')
  if (!msgs?.length) return { skip: 'sem mensagens' }
  let transcript = msgs.map((m) =>
    `${m.enviado_em.slice(0, 10)} ${m.direcao.toUpperCase()}: ${String(m.conteudo ?? '').replace(/\s+/g, ' ').slice(0, 500)}`,
  ).join('\n')
  if (transcript.length > 18000) transcript = transcript.slice(-18000)
  const diasNaEtapa = l.status_alterado_em ? Math.round((Date.now() - new Date(l.status_alterado_em).getTime()) / 86400e3) : null

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5', max_tokens: 700, system: SYSTEM,
    messages: [{ role: 'user', content: `Loja: ${l.nome} (na etapa Em Análise há ${diasNaEtapa ?? '?'} dias)\n\nConversa:\n${transcript}` }],
  })
  const texto = resp.content.find((b) => b.type === 'text')?.text ?? ''
  const m = texto.match(/\{[\s\S]*\}/)
  if (!m) return { erro: 'sem JSON' }
  try { return { ...JSON.parse(m[0]), dias_na_etapa: diasNaEtapa, n_msgs: msgs.length } }
  catch { return { erro: 'JSON inválido' } }
}

let feitos = 0
const FILA = [...pendentes]
async function worker() {
  while (FILA.length) {
    const l = FILA.shift()
    try { resultado[l.id] = { nome: l.nome, telefone: l.telefone, ...(await processa(l)) } }
    catch (e) { resultado[l.id] = { nome: l.nome, telefone: l.telefone, erro: String(e).slice(0, 150) } }
    feitos++
    if (feitos % 5 === 0) { writeFileSync(OUT, JSON.stringify(resultado, null, 1)); console.log(`${feitos}/${pendentes.length}`) }
  }
}
await Promise.all(Array.from({ length: 5 }, worker))
writeFileSync(OUT, JSON.stringify(resultado, null, 1))
console.log(`FIM: ${feitos} → ${OUT}`)
setTimeout(() => process.exit(0), 800).unref()
