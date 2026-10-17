/**
 * varredura-ticket-prometido-2026-10-17.mjs — só LEITURA.
 *
 * Caso YourCase Avenida (14/10/2026): a VictorIA escreveu "vou abrir o pedido da filial na AIVA
 * agora mesmo", mas não devolveu o motivo_humano "abrir_ticket_filial: …". O bloco que abre o
 * ticket só é avaliado quando esse motivo vem, e o "se não abrir, vai pra fila" mora DENTRO dele —
 * então, sem o motivo, não abre ticket, não avisa o time e não escala. Silêncio.
 *
 * Esta varredura procura o mesmo padrão em todos os leads desde 13/10/2026 (quando o fluxo por
 * ticket entrou): mensagem NOSSA prometendo abrir pedido/ticket, e nenhum [TICKET_AIVA:…] no lead
 * depois disso.
 *
 * Uso: node --env-file=.env.local scripts/varredura-ticket-prometido-2026-10-17.mjs
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const DESDE = '2026-10-13T00:00:00Z'

// a promessa, como a VictorIA costuma escrever
const PROMESSA = /(vou|já|ja)\s+(abrir|abro)\b[^.]{0,60}(pedido|ticket|chamado|solicita)|abrir?\s+o\s+(pedido|ticket|chamado)\s+(da|de|do)\s+(filial|repasse|painel)|abro\s+o\s+pedido/i
const TICKET = /\[TICKET_AIVA:(\d+)\|/g

const msgs = []
for (let de = 0; ; de += 1000) {
  const { data, error } = await sb.from('sdr_mensagens')
    .select('lead_id, direcao, conteudo, enviado_em')
    .eq('direcao', 'out').gte('enviado_em', DESDE)
    .order('enviado_em').range(de, de + 999)
  if (error) { console.error('erro:', error.message); process.exit(1) }
  if (!data?.length) break
  msgs.push(...data); if (data.length < 1000) break
}

const promessas = new Map() // lead_id -> {quando, texto}
for (const m of msgs) {
  if (!m.lead_id || !PROMESSA.test(String(m.conteudo ?? ''))) continue
  if (!promessas.has(m.lead_id)) promessas.set(m.lead_id, { quando: m.enviado_em, texto: String(m.conteudo).slice(0, 120).replace(/\s+/g, ' ') })
}

const ids = [...promessas.keys()]
const leads = []
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await sb.from('sdr_leads').select('id,nome,telefone,status,observacoes').in('id', ids.slice(i, i + 200))
  leads.push(...(data ?? []))
}

const semTicket = []
const comTicket = []
for (const l of leads) {
  const p = promessas.get(l.id)
  const tickets = [...String(l.observacoes ?? '').matchAll(TICKET)].map((x) => x[1])
  if (tickets.length) comTicket.push({ ...l, ...p, tickets })
  else semTicket.push({ ...l, ...p })
}

console.log(`mensagens nossas desde 13/10: ${msgs.length}`)
console.log(`leads com promessa de abrir pedido/ticket: ${leads.length}`)
console.log(`  COM [TICKET_AIVA:] gravado: ${comTicket.length}`)
console.log(`  SEM ticket nenhum: ${semTicket.length}\n`)
for (const l of semTicket.sort((a, b) => String(a.quando).localeCompare(String(b.quando)))) {
  console.log(`- ${l.nome} (${l.telefone}) · ${l.status} · ${String(l.quando).slice(0, 16)}`)
  console.log(`    "${l.texto}"`)
}
