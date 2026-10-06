/**
 * Desqualifica por CNPJ < 1 ano dois leads que passaram sem a checagem da Receita (Aldo 06/10/2026):
 * Luciano Celulares (CNPJ aberto 22/07/2026) e Nane Cell (27/03/2026).
 * Replica o desfecho do webhook: mensagem padrão ao lojista, nota na opp, card → 93, status NAO_QUALIFICADO.
 * Uso: node --env-file=.env.local scripts/desqualificar-menos-1-ano-2026-10-06.mts [--executar]
 */
import { createClient } from '@supabase/supabase-js'
import { sendText, addOpportunityNote, changeOpportunityStage, STAGES } from '../lib/evotalks.ts'

const EXEC = process.argv.includes('--executar')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const ALVOS = [
  { tel: '5586999687275', cnpj: '68145917000118', abertura: '22/07/2026' },
  { tel: '5547997053334', cnpj: '65948067000106', abertura: '27/03/2026' },
]
const MSG = `Obrigada pelas informações! 😊 Fiz a verificação aqui e o CNPJ informado tem menos de 1 ano de abertura — e hoje, pra cadastrar na AIVA, precisamos de CNPJ com pelo menos 1 ano.\n\n` +
  `Assim que a loja completar 1 ano de CNPJ, é só me chamar aqui que o nosso time retoma o cadastro com você, combinado? Vou deixar seu contato guardado! 🙌`

for (const a of ALVOS) {
  const { data: l } = await s.from('sdr_leads').select('id,nome,status,observacoes,evotalks_chat_id,evotalks_opportunity_id').eq('telefone', a.tel).single()
  console.log(`${l.nome} | ${l.status} | opp ${l.evotalks_opportunity_id} | CNPJ ${a.cnpj} aberto ${a.abertura}`)
  if (!EXEC) continue
  const opp = Number(l.evotalks_opportunity_id)
  await sendText(a.tel, MSG, l.evotalks_chat_id)
  await s.from('sdr_mensagens').insert({ lead_id: l.id, direcao: 'out', conteudo: MSG })
  if (opp) {
    await addOpportunityNote(opp, `Lead não qualificado: cnpj_menos_de_1_ano (CNPJ ${a.cnpj} aberto em ${a.abertura}) — desqualificado à mão em 06/10; a consulta à Receita não tinha rodado na pré-aprovação`)
    await changeOpportunityStage(opp, STAGES.MENOS_1_ANO)
  }
  const obs = `${l.observacoes ?? ''} cnpj_menos_de_1_ano [DESQUALIFICADO_MANUAL:cnpj_menos_de_1_ano:${new Date().toISOString()}]`
    .replace(/\s*\[PRE_CAD_NAO_CHEGOU:[^\]]*\]/g, '').trim()
  const { error } = await s.from('sdr_leads').update({ status: 'NAO_QUALIFICADO', acionar_humano: false, observacoes: obs, status_alterado_em: new Date().toISOString() }).eq('id', l.id)
  console.log('  ✓ mensagem enviada, nota, card → 93, status NAO_QUALIFICADO', error ? `ERRO status: ${error.message}` : '')
  await s.from('sdr_avisos_painel').update({ resolvido_em: new Date().toISOString(), resolvido_como: 'auto: desqualificado (CNPJ < 1 ano)' }).eq('lead_id', l.id).is('resolvido_em', null)
}
