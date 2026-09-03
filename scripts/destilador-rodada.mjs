// DESTILADOR — mineração da rodada de aprendizado autônomo da VictorIA.
// (skill .claude/skills/destilar-enviar-info — decisão do Aldo 03/09)
// Duas fontes: (A) respostas manuais do Nei via painel; (B) respostas da
// VictorIA seguidas de avanço de status do lead. Classifica via Claude API e
// grava scripts/out-destilador.json pro operador aplicar caps/zonas proibidas.
// Uso: node --env-file=.env.local scripts/destilador-rodada.mjs [--desde ISO]
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const LOG = 'docs/destilador-enviar-info.log'
const OUT = 'scripts/out-destilador.json'

const args = process.argv.slice(2)
const iDesde = args.indexOf('--desde')
let desde = iDesde >= 0 ? args[iDesde + 1] : null
if (!desde && existsSync(LOG)) {
  const linhas = readFileSync(LOG, 'utf8').trim().split('\n')
  const ult = linhas.reverse().find((l) => l.startsWith('RODADA: '))
  if (ult) desde = ult.slice(8, 33).trim().split(' ')[0]
}
if (!desde) desde = new Date(Date.now() - 14 * 86400e3).toISOString()
console.log('janela: desde', desde)

const AVANCO = ['PRE_APROVACAO', 'CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA', 'TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO']

// ── FONTE A: respostas manuais do Nei ────────────────────────────────────────
const { data: manuaisRaw } = await sb
  .from('sdr_mensagens')
  .select('id, lead_id, conteudo, enviado_em')
  .eq('direcao', 'out')
  .like('conteudo', '%manual via painel%')
  .gte('enviado_em', desde)
  .order('enviado_em', { ascending: false })
  .limit(40)
console.log('fonte A (Enviar info):', manuaisRaw?.length ?? 0, 'respostas manuais')

// ── FONTE B: avanços de status recentes ──────────────────────────────────────
const { data: avancosRaw } = await sb
  .from('sdr_leads')
  .select('id, nome, telefone, status, status_alterado_em')
  .in('status', AVANCO)
  .gte('status_alterado_em', desde)
  .order('status_alterado_em', { ascending: false })
  .limit(40)
console.log('fonte B (avanços):', avancosRaw?.length ?? 0, 'leads avançaram de etapa')

async function janela(leadId, ateIso, n = 10) {
  const { data } = await sb
    .from('sdr_mensagens')
    .select('direcao, conteudo, enviado_em')
    .eq('lead_id', leadId)
    .lte('enviado_em', ateIso)
    .order('enviado_em', { ascending: false })
    .limit(n)
  return (data ?? []).reverse()
    .map((m) => `${m.direcao.toUpperCase()}${/manual via painel/i.test(m.conteudo ?? '') ? '[MANUAL-NEI]' : ''}: ${String(m.conteudo ?? '').replace(/\s+/g, ' ').slice(0, 450)}`)
    .join('\n')
}

const SYS_A = `Você audita o aprendizado de uma agente de IA (VictorIA, SDR do crediário AIVA/Track). No trecho, mensagens OUT[MANUAL-NEI] foram escritas pelo humano (Nei) porque a IA não resolveu. Responda SÓ JSON:
{
 "tipo": "correcao_de_conduta | fato_novo | caso_pontual | zona_proibida | sem_conteudo",
 "tema": "<3-6 palavras>",
 "zona_proibida_motivo": "<se aplicável: telefone_ou_golpe | parcelex | promessa_aprovacao_taxa | coleta_de_dados, senão null>",
 "contem_fone_ou_url": true/false,
 "curadoria": { "pergunta": "<o que o lojista disse antes>", "resposta_ruim": "<o que a IA respondeu de errado/insuficiente, ou null se ela não respondeu>", "correcao": "<a resposta do Nei reescrita na voz da VictorIA (calorosa, direta, WhatsApp)>" } (só se tipo=correcao_de_conduta, senão null),
 "regra_prompt": { "texto": "<a regra objetiva em 1-3 frases>", "justificativa": "<por quê>" } (só se tipo=fato_novo, senão null)
}
zona_proibida SEMPRE ganha dos outros tipos quando o tema toca em: telefones/contatos/golpe, Parcelex, promessa de aprovação/prazo/taxa/comissão, coleta de dados de colaboradores ou CNPJ. "sem_conteudo" = registro vazio tipo "[Info pendente...]" sem texto útil.`

const SYS_B = `Você garimpa JOGADAS VENCEDORAS de uma agente de IA (VictorIA, SDR do crediário AIVA). O lead AVANÇOU de etapa logo após esta janela de conversa. Identifique se alguma resposta OUT da IA (não as [MANUAL-NEI]) foi decisiva pro avanço. Responda SÓ JSON:
{
 "vale_como_jogada": true/false,
 "motivo": "<1 frase>",
 "pergunta": "<a mensagem do lead à qual ela respondeu bem>",
 "resposta": "<a resposta vencedora dela, na íntegra ou levemente encurtada>",
 "tema": "<3-6 palavras>"
}
Critério exigente: só vale se a resposta claramente destravou (contornou objeção, explicou e o lead topou, conduziu pro próximo passo). Avanço por cron/operador sem mérito da resposta = false.`

const resultado = { desde, fonteA: [], fonteB: [] }

for (const m of manuaisRaw ?? []) {
  if (!m.lead_id) continue
  const ctx = await janela(m.lead_id, m.enviado_em, 10)
  if (!ctx || ctx.length < 40) continue
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 900, system: SYS_A,
      messages: [{ role: 'user', content: ctx }],
    })
    const t = r.content.find((b) => b.type === 'text')?.text ?? ''
    const j = t.match(/\{[\s\S]*\}/)
    if (j) resultado.fonteA.push({ lead_id: m.lead_id, mensagem_id: m.id, quando: m.enviado_em, ...JSON.parse(j[0]) })
  } catch (e) { console.error('A', m.id, String(e).slice(0, 80)) }
}
console.log('fonte A destilada:', resultado.fonteA.length)

for (const l of avancosRaw ?? []) {
  const ctx = await janela(l.id, l.status_alterado_em, 12)
  if (!ctx || ctx.length < 40) continue
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 800, system: SYS_B,
      messages: [{ role: 'user', content: `Lead avançou para ${l.status}.\n\n${ctx}` }],
    })
    const t = r.content.find((b) => b.type === 'text')?.text ?? ''
    const j = t.match(/\{[\s\S]*\}/)
    if (j) resultado.fonteB.push({ lead_id: l.id, nome: l.nome, status: l.status, ...JSON.parse(j[0]) })
  } catch (e) { console.error('B', l.id, String(e).slice(0, 80)) }
}
console.log('fonte B destilada:', resultado.fonteB.length)

writeFileSync(OUT, JSON.stringify(resultado, null, 1))
const resumo = {
  correcoes: resultado.fonteA.filter((x) => x.tipo === 'correcao_de_conduta').length,
  fatos_novos: resultado.fonteA.filter((x) => x.tipo === 'fato_novo').length,
  zonas_proibidas: resultado.fonteA.filter((x) => x.tipo === 'zona_proibida').length,
  pontuais: resultado.fonteA.filter((x) => x.tipo === 'caso_pontual').length,
  jogadas: resultado.fonteB.filter((x) => x.vale_como_jogada).length,
}
console.log('RESUMO:', JSON.stringify(resumo))
setTimeout(() => process.exit(0), 800).unref()
