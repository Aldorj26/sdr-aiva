// 19/10/2026 — abre à mão o ticket de painel financeiro que a VictorIA prometeu à POTER (RID 6178) às 11h10 e o
// webhook não abriu: a trava só aceitava e-mail escrito nas 4 últimas mensagens, e o Paulo mandou o Gmail em 03/09.
// Faz o que o webhook faria: abre o ticket, confirma ao lojista, grava a mensagem e o marcador [PAINEL_FIN_TICKET].
// Uso: npx tsx --env-file=.env.local scripts/abrir-ticket-painel-poter-2026-10-19.mts
import { abrirTicketPainel, mensagemLojista } from '../lib/painel-financeiro'
import { sendText } from '../lib/evotalks'
import { supabaseAdmin, saveMensagem } from '../lib/supabase'

const LEAD_ID = '5e09c44f-18b8-41e2-850a-3fbf7bcd86a0'
const RID = '6178'
const EMAIL = 'paulo.poter.pp@gmail.com'

const { data: lead } = await supabaseAdmin.from('sdr_leads').select('id,nome,telefone,evotalks_chat_id,observacoes').eq('id', LEAD_ID).single()
if (!lead) throw new Error('lead não encontrado')
if (/\[PAINEL_FIN_TICKET:/.test(lead.observacoes ?? '')) throw new Error('já tem ticket gravado: ' + lead.observacoes)

const r = await abrirTicketPainel(RID, EMAIL, `${lead.nome} (${lead.telefone})`)
console.log('resultado:', JSON.stringify(r))
if (r.tipo !== 'criado' && r.tipo !== 'ja_existe') process.exit(1)

const aviso = mensagemLojista(r, EMAIL)!
await sendText(lead.telefone, aviso, lead.evotalks_chat_id)
await saveMensagem(lead.id, 'out', aviso)
const obs = `${(lead.observacoes ?? '').trim()} [PAINEL_FIN_TICKET:${r.numero ?? '?'}|${EMAIL}|${new Date().toISOString()}]`.trim()
await supabaseAdmin.from('sdr_leads').update({ observacoes: obs }).eq('id', lead.id)
console.log('avisado e marcado. ticket', r.numero)
