#!/usr/bin/env node
/**
 * Reativação dos leads presos na Fase 3 — 18/08/2026.
 *
 * HSM 48 (coringa) "Olá {{1}}, {{2}}". Uma mensagem por lojista, texto único,
 * baseado no contexto real da conversa e nos campos que o EVO diz que faltam.
 *
 * NÃO cria oportunidade no CRM — todos os 21 já têm opp aberta no stage 49.
 * Salva o texto real em sdr_mensagens (não só um marcador) pra VictorIA ter
 * contexto quando o lojista responder.
 *
 * Idempotente: pula quem já tem [REATIV_FASE3] em observacoes.
 *
 * Uso: node --env-file=.env.local <este arquivo> [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const TEMPLATE_CORINGA = 48
const MARCADOR = '[REATIV_FASE3:'

// Guarda de horário comercial (8h–20h BRT), mesma regra do nudge.
const horaBrt = Number(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false,
}).format(new Date()))
if (horaBrt < 8 || horaBrt >= 20) {
  console.error(`ABORTADO: ${horaBrt}h BRT está fora do horário comercial (8h–20h).`)
  process.exit(1)
}

/** Meta rejeita param de template com \n, \t ou 2+ espaços (erro #132018). */
const sanitize = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()

const LEADS = [
  { tel: '5516992397921', nome: 'Renan', corpo: 'ficou faltando uma coisa só pra fechar seu cadastro: a RAS atende só em Ribeirão Preto ou tem loja em outra cidade também? Me responde isso que eu finalizo aqui.' },
  { tel: '5511958131443', nome: 'Margarete', corpo: 'a gente parou no meio do seu cadastro e falta pouco. Começando pelo mais simples: em qual cidade fica a TECHSMART? Depois te peço só mais uma coisinha e finalizo.' },
  { tel: '5518996003093', nome: 'Amanda', corpo: 'a gente parou no faturamento anual estimado da Lokatell. Pode ser um valor aproximado, só pra eu registrar. Me manda que eu sigo com o resto por aqui.' },
  { tel: '5561985396175', nome: 'Juliana', corpo: 'seu cadastro está quase fechando, faltam só alguns dados. O primeiro: qual o faturamento anual estimado da loja? Pode ser aproximado.' },
  { tel: '559491644655', nome: 'Michelly', corpo: 'você tinha me dito que ia organizar as informações pra dar continuidade — ainda está de pé. Começo pelo seu e-mail: qual o melhor pra contato?' },
  { tel: '5564981172862', nome: 'Francisca', corpo: 'a gente começou seu cadastro e parou logo no primeiro dado. Qual o melhor e-mail pra contato, o seu ou o da loja? Com ele eu retomo de onde paramos.' },
  { tel: '555185067545', nome: 'Andressa', corpo: 'a AS Imports já passou na análise da AIVA e faltam alguns dados pra liberar o crediário. Começo pelo mais rápido: qual o seu melhor e-mail?' },
  { tel: '556198717576', nome: 'Edvaldo', corpo: 'sei que te mandei várias mensagens sem retorno, desculpa a insistência. A Império Cell já passou na análise da AIVA e faltam alguns dados pra destravar o crediário. Começo pelo e-mail: qual o seu? Se não tiver mais interesse, responde ENCERRAR que eu paro de te chamar.' },
  { tel: '5569993550010', nome: 'Cleberson', corpo: 'a Reis dos Acessórios já passou na análise da AIVA e faltam alguns dados pra liberar o crediário nas suas 4 lojas. Começo pelo seu e-mail. Se preferir que eu pare de te chamar, responde ENCERRAR.' },
  { tel: '5592991759707', nome: 'Matheus', corpo: 'foram várias mensagens minhas sem resposta, então vou direto: a GT Cell passou na análise da AIVA e faltam alguns dados pra ligar o crediário. Me manda seu e-mail pra eu começar — ou responde ENCERRAR que eu não te procuro mais.' },
  { tel: '555491660134', nome: 'Marcos', corpo: 'desculpa a insistência das últimas semanas. A Click Virtual passou na análise da AIVA e faltam alguns dados pra destravar o crediário. Começo pelo seu e-mail — ou responde ENCERRAR, que eu paro por aqui.' },
  { tel: '5591991610278', nome: 'Mirian', corpo: 'já foram várias mensagens minhas sem retorno, então essa vai curta: sua loja passou na análise da AIVA e faltam alguns dados pra ligar o crediário. Me manda seu e-mail pra eu começar; se não quiser seguir, responde ENCERRAR.' },
  { tel: '5551985053171', nome: 'Mary', corpo: 'sei que te mandei bastante mensagem e não tive retorno. A ML Cell passou na análise da AIVA e faltam alguns dados pra liberar o crediário. Começo pelo seu e-mail — ou ENCERRAR, que eu encerro de vez.' },
  { tel: '5594991542152', nome: 'Edna', corpo: 'a Capistrano passou na análise da AIVA e faltam alguns dados pra liberar o crediário. Começo pelo seu e-mail. Se preferir que eu pare de te chamar, é só responder ENCERRAR.' },
  { tel: '5527998308839', nome: 'Geani', corpo: 'faz mais de um mês que te chamo sem retorno, então vou parar por aqui. Sua loja continua com o cadastro em aberto na AIVA — se em algum momento quiser retomar, é só me responder que eu sigo na hora.' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = 0, pulados = 0, falhas = 0
const erros = []

console.log(`${DRY ? '[DRY-RUN] ' : ''}Disparo Fase 3 — ${LEADS.length} lojistas, template ${TEMPLATE_CORINGA}\n`)

for (const l of LEADS) {
  const { data: lead } = await sb
    .from('sdr_leads')
    .select('id, nome, observacoes, status')
    .eq('telefone', l.tel)
    .maybeSingle()

  if (!lead) { console.log(`  SKIP  ${l.tel} ${l.nome} — lead não encontrado`); pulados++; continue }
  if ((lead.observacoes ?? '').includes(MARCADOR)) {
    console.log(`  SKIP  ${l.tel} ${l.nome} — já recebeu esta reativação`); pulados++; continue
  }
  if (['OPT_OUT', 'DESCARTADO', 'NAO_QUALIFICADO'].includes(lead.status)) {
    console.log(`  SKIP  ${l.tel} ${l.nome} — status ${lead.status}`); pulados++; continue
  }

  const vars = [sanitize(l.nome), sanitize(l.corpo)]
  if (DRY) {
    console.log(`  DRY   ${l.tel} ${l.nome}\n        "Olá ${vars[0]}, ${vars[1]}"`)
    ok++
    continue
  }

  try {
    const res = await fetch(`${BASE}/int/sendWaTemplate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queueId: QID, apiKey: KEY,
        number: l.tel, templateId: TEMPLATE_CORINGA, data: vars, openNewChat: true,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)

    const agora = new Date().toISOString()
    // Salva o TEXTO REAL (não só marcador) — stripInternalMarkers descartaria
    // uma linha "[...]" e a VictorIA perderia o contexto na resposta do lojista.
    await sb.from('sdr_mensagens').insert({
      lead_id: lead.id,
      direcao: 'out',
      conteudo: `Olá ${vars[0]}, ${vars[1]}`,
      template_hsm: 'aiva_coringa_48',
    })
    await sb.from('sdr_leads').update({
      data_ultimo_contato: agora,
      observacoes: `${lead.observacoes ?? ''} ${MARCADOR}${agora}]`.trim(),
    }).eq('id', lead.id)

    console.log(`  OK    ${l.tel} ${l.nome}`)
    ok++
  } catch (err) {
    console.log(`  FALHA ${l.tel} ${l.nome} — ${err.message}`)
    erros.push(`${l.tel} ${l.nome}: ${err.message}`)
    falhas++
  }

  await sleep(1500)
}

console.log(`\n──────────────────────────────`)
console.log(`enviados: ${ok} | pulados: ${pulados} | falhas: ${falhas}`)
if (erros.length) { console.log('\nErros:'); erros.forEach((e) => console.log('  ' + e)) }
