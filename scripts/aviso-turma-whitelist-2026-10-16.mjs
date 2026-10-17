/**
 * aviso-turma-whitelist-2026-10-16.mjs — avisa da turma de HOJE 9h30 os 4 lojistas que o
 * Mauricio (AIVA) mandou na whitelist em 15/10 23h08 e 16/10 08h29 (pedido do Aldo, 16/10/2026).
 *
 * ⚠️ Fora do fluxo normal: estes 4 NÃO estão aprovados nem cadastrados no portal — a AIVA
 * liberou pra assistir o treinamento mesmo assim. Por isso o texto NÃO promete acesso nem
 * senha: diz que o cadastro está em finalização. Decisão do Aldo, 16/10/2026.
 *
 * HSM 48 coringa (janela de 24h fechada). Grava em sdr_mensagens com o rótulo
 * 'aiva_aviso_turma_whitelist' quando o telefone já é um lead, pra VictorIA ter o contexto.
 *
 * Uso: node --env-file=.env.local scripts/aviso-turma-whitelist-2026-10-16.mjs [--enviar]
 */
import { createClient } from '@supabase/supabase-js'

const ENVIAR = process.argv.includes('--enviar')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const BASE = process.env.EVO_TALKS_BASE_URL
const TEMPLATE = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 48)

const LINK = 'meet.google.com/vou-gpmy-rtp'
// whitelist do Mauricio — CNPJ só pra conferência/log; o envio é por telefone
const WHITELIST = [
  { cnpj: '61043930000117', telefone: '5546999002194' },
  { cnpj: '55817303000193', telefone: '5581986676950' },
  { cnpj: '53100900000177', telefone: '5551996277992' },
  { cnpj: '37824279000138', telefone: '5584998964231' },
]

// {{2}} do HSM 48: UMA linha, sem \n (a Meta rejeita quebra em variável).
// O corpo já abre com "Oi {nome}, tudo bem?" e fecha com "É só responder essa mensagem. 😊".
const MIOLO = `Tem turma de treinamento da AIVA hoje às 9h30, online, no link ${LINK} — é lá que você vê como usar a plataforma e vender parcelado na sua loja. Seu cadastro ainda está sendo finalizado do nosso lado, então o acesso chega depois, mas você já pode participar do treinamento.`

// o mesmo celular aparece com e sem o nono dígito (a whitelist manda com, o CRM às vezes sem)
const variantes = (t) => {
  const d = dig(t), ddd = d.slice(2, 4), resto = d.slice(4)
  const set = new Set([d])
  if (resto.length === 9 && resto[0] === '9') set.add(`55${ddd}${resto.slice(1)}`)
  if (resto.length === 8) set.add(`55${ddd}9${resto}`)
  return [...set]
}

// nome do sócio, quando o telefone já é um lead nosso
const alvo = []
for (const w of WHITELIST) {
  const { data: achados } = await sb.from('sdr_leads').select('id,nome,telefone,observacoes').in('telefone', variantes(w.telefone))
  const data = (achados ?? [])[0] ?? null
  const socio = (data?.observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1]?.trim().split(/\s+/)[0]
  const doLead = (data?.nome ?? '').trim().split(/\s+/)[0] ?? ''
  const pessoa = socio ?? (doLead && /^[A-Za-zÀ-ú]{3,}$/.test(doLead) ? doLead : null)
  alvo.push({
    ...w,
    leadId: data?.id ?? null,
    nome: data?.nome ?? '(sem lead no sdr_leads)',
    nomeSaud: pessoa ? pessoa[0].toUpperCase() + pessoa.slice(1).toLowerCase() : 'lojista',
  })
}

for (const a of alvo) console.log(`- ${a.telefone} · CNPJ ${a.cnpj} · ${a.nome}\n    Oi ${a.nomeSaud}, tudo bem?\n    ${MIOLO}`)
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
