/**
 * aviso-turma-whitelist-2026-10-19.mjs — avisa da turma de SEGUNDA 19/10, 9h30, os 4 lojistas
 * que o Mauricio (AIVA) mandou na whitelist em 17/10 12:57 (pedido do Aldo, 17/10/2026).
 *
 * Mesma receita do aviso-turma-whitelist-2026-10-16.mjs, que saiu 4/4 e levou a Clinica do
 * Celular de "aprovada sem cadastro" a Primeiro acesso em ~12h.
 *
 * Os 4 estão em EM_ANALISE_AIVA (formulário do varejo pendente), então o texto NÃO promete
 * acesso: diz que o cadastro está em andamento e que ele já pode assistir ao treinamento.
 *
 * HSM 48 coringa (janela de 24h fechada). Grava em sdr_mensagens com o rótulo
 * 'aiva_aviso_turma_whitelist' pra VictorIA ter o contexto se o lojista responder.
 *
 * ⚠️ MB Celulares: o Mauricio mandou o telefone do sócio (5533998040641), mas a conversa viva
 * é outra (5533999959959, onde está o histórico e o nome do sócio). O envio vai pra CONVERSA —
 * mandar pro número novo abriria um chat do zero, sem contexto.
 *
 * Uso: node --env-file=.env.local scripts/aviso-turma-whitelist-2026-10-19.mjs [--enviar]
 */
import { createClient } from '@supabase/supabase-js'

const ENVIAR = process.argv.includes('--enviar')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const TEMPLATE = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 48)

const LINK = 'meet.google.com/vou-gpmy-rtp'
// {{2}} do HSM 48: UMA linha, sem \n (a Meta rejeita quebra em variável).
// O corpo já abre com "Oi {nome}, tudo bem?" e fecha com "É só responder essa mensagem. 😊".
const MIOLO = `Tem turma de treinamento da AIVA hoje às 9h30, online, no link ${LINK} — é lá que você vê como usar a plataforma e vender parcelado na sua loja. Seu cadastro ainda está em andamento, mas você já pode participar do treinamento desde já.`

// whitelist do Mauricio (17/10 12:57) — CNPJ só pra conferência; o envio é pelo telefone da conversa
const WHITELIST = [
  { cnpj: '46974368000151', telefone: '5549999226479' },
  { cnpj: '37437899000114', telefone: '5533999959959' }, // conversa viva (whitelist trouxe 5533998040641)
  { cnpj: '28456772000151', telefone: '5564993360041' },
  { cnpj: '46434733000135', telefone: '5533984467400' },
]

const dig = (v) => String(v ?? '').replace(/\D/g, '')
const variantes = (t) => {
  const d = dig(t), ddd = d.slice(2, 4), r = d.slice(4)
  const s = new Set([d])
  if (r.length === 9 && r[0] === '9') s.add(`55${ddd}${r.slice(1)}`)
  if (r.length === 8) s.add(`55${ddd}9${r}`)
  return [...s]
}

const alvo = []
for (const w of WHITELIST) {
  const { data } = await sb.from('sdr_leads').select('id,nome,telefone,status,observacoes').in('telefone', variantes(w.telefone))
  const lead = (data ?? [])[0] ?? null
  const socio = (lead?.observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1]?.trim().split(/\s+/)[0]
  const doLead = (lead?.nome ?? '').trim().split(/\s+/)[0] ?? ''
  const pessoa = socio ?? (doLead && /^[A-Za-zÀ-ú]{3,}$/.test(doLead) ? doLead : null)
  alvo.push({
    ...w,
    leadId: lead?.id ?? null,
    nome: lead?.nome ?? '(sem lead)',
    status: lead?.status ?? '-',
    nomeSaud: pessoa ? pessoa[0].toUpperCase() + pessoa.slice(1).toLowerCase() : 'lojista',
  })
}

for (const a of alvo) console.log(`- ${a.telefone} · ${a.nome} (${a.status})\n    Oi ${a.nomeSaud}, tudo bem?\n    ${MIOLO}`)
if (!ENVIAR) { console.log(`\nENSAIO: ${alvo.length} lojistas. Rode com --enviar.`); process.exit(0) }

let ok = 0
for (const a of alvo) {
  const r = await fetch(`${BASE}/int/sendWaTemplate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queueId: Number(process.env.EVO_TALKS_QUEUE_ID ?? 10),
      apiKey: process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY,
      number: a.telefone, templateId: TEMPLATE, data: [a.nomeSaud, MIOLO], openNewChat: true,
    }),
  })
  const body = await r.text()
  if (!r.ok) { console.log(`  FALHOU ${a.telefone}: ${r.status} ${body.slice(0, 120)}`); continue }
  if (a.leadId) await sb.from('sdr_mensagens').insert({ lead_id: a.leadId, direcao: 'out', conteudo: `Oi ${a.nomeSaud}, tudo bem?\n${MIOLO} É só responder essa mensagem. 😊`, template_hsm: 'aiva_aviso_turma_whitelist' })
  ok++; console.log(`  ✅ ${a.telefone} ${body.slice(0, 60)}`)
}
console.log(`\nENVIADOS: ${ok}/${alvo.length}`)
