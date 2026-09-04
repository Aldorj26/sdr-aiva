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

// Zona proibida da fonte B roda em passe SEPARADO, recebendo SÓ o texto da
// jogada extraída. Quando as duas perguntas iam no mesmo prompt, o modelo
// rotulava o ASSUNTO DA CONVERSA em vez do texto (5 de 11 conversas de
// qualificação viravam "coleta_de_dados") — e aí toda jogada parqueava.
const SYS_ZONA = `Você recebe UM texto: uma resposta da VictorIA (SDR do crediário AIVA) candidata a virar exemplo de treino. Diga se ESTE texto — nada além dele — toca numa zona proibida. Responda SÓ JSON:
{
 "zona_proibida_motivo": "<telefone_ou_golpe | parcelex | promessa_aprovacao_taxa | coleta_de_dados, ou null>",
 "contem_fone_ou_url": true/false,
 "contem_valor_taxa_prazo": true/false,
 "trecho": "<o trecho exato que disparou, ou null>"
}
Zonas:
- telefone_ou_golpe: o texto traz telefone, contato ou URL, ou opina se um número é/não é legítimo;
- parcelex: cita a Parcelex ou o Ricardo;
- promessa_aprovacao_taxa: garante aprovação, OU traz número concreto de taxa/comissão ("12%"), prazo de pagamento/análise ("D+2", "em até 24h"), quantidade de parcelas ("6x, 9x ou 12x") ou faixa de valor de aparelho ("de R$ 700 a R$ 2.000");
- coleta_de_dados: enuncia REGRA de quais documentos/dados de CNPJ ou de colaboradores o lojista precisa mandar.
Regras de precisão, siga à risca:
- Perguntar um dado ao lojista ("qual seu faturamento?", "tem outros CNPJs?") ou anotar a resposta dele NÃO é coleta_de_dados — só conta quando o texto ENUNCIA a regra de quais documentos são exigidos.
- Número dito PELO LOJISTA e apenas ecoado ("anotado: R$ 300 mil/ano") NÃO é promessa_aprovacao_taxa. Só conta número da OFERTA da AIVA.
- "contem_valor_taxa_prazo" é true só com NÚMERO concreto de taxa, prazo, parcela ou faixa de valor da oferta; alusão genérica ("tem uma taxa por venda", "cai rapidinho") é false.
Na dúvida entre marcar e não marcar, NÃO marque — o objetivo é pegar o texto que congela valor que muda, não toda conversa de qualificação.`

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
    if (!j) continue
    const jogada = { lead_id: l.id, nome: l.nome, status: l.status, ...JSON.parse(j[0]) }
    // Só a jogada aprovada precisa do passe de zona proibida — é ela que pode virar curadoria.
    if (jogada.vale_como_jogada && jogada.resposta) {
      const z = await anthropic.messages.create({
        model: 'claude-sonnet-4-5', max_tokens: 400, system: SYS_ZONA,
        messages: [{ role: 'user', content: String(jogada.resposta) }],
      })
      const zt = z.content.find((b) => b.type === 'text')?.text ?? ''
      const zj = zt.match(/\{[\s\S]*\}/)
      if (zj) Object.assign(jogada, JSON.parse(zj[0]))
    }
    resultado.fonteB.push(jogada)
  } catch (e) { console.error('B', l.id, String(e).slice(0, 80)) }
}
console.log('fonte B destilada:', resultado.fonteB.length)

writeFileSync(OUT, JSON.stringify(resultado, null, 1))

// Zona proibida na fonte B: a jogada continua válida, mas não pode ser gravada
// sozinha — vai parqueada no digest pro Aldo decidir (skill destilar-enviar-info).
const parquear = (x) => Boolean(x.zona_proibida_motivo || x.contem_fone_ou_url || x.contem_valor_taxa_prazo)
const jogadas = resultado.fonteB.filter((x) => x.vale_como_jogada)
const aParquear = jogadas.filter(parquear)

const resumo = {
  correcoes: resultado.fonteA.filter((x) => x.tipo === 'correcao_de_conduta').length,
  fatos_novos: resultado.fonteA.filter((x) => x.tipo === 'fato_novo').length,
  zonas_proibidas: resultado.fonteA.filter((x) => x.tipo === 'zona_proibida').length,
  pontuais: resultado.fonteA.filter((x) => x.tipo === 'caso_pontual').length,
  jogadas: jogadas.length,
  jogadas_livres: jogadas.length - aParquear.length,
  jogadas_a_parquear: aParquear.length,
}
console.log('RESUMO:', JSON.stringify(resumo))
for (const x of aParquear) {
  const motivos = [
    x.zona_proibida_motivo,
    x.contem_fone_ou_url ? 'contem_fone_ou_url' : null,
    x.contem_valor_taxa_prazo ? 'contem_valor_taxa_prazo' : null,
  ].filter(Boolean).join(', ')
  console.log(`  ⏸️ PARQUEAR — ${x.nome} | ${x.tema} | ${motivos}`)
  if (x.trecho) console.log(`     trecho: "${String(x.trecho).slice(0, 160)}"`)
}
setTimeout(() => process.exit(0), 800).unref()
