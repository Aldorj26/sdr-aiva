#!/usr/bin/env node
/** Os 105 "nunca foram nossos": busca ampla antes de afirmar. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const S = process.env.SAIDA
const norm = (c) => String(c ?? '').replace(/\D/g, '')

const rows = JSON.parse(readFileSync(S + '/form-varejo-pendente.json', 'utf8'))
const alvo = rows.filter((o) => o.origem === 'nunca esteve no nosso funil')
console.log('candidatos a "nunca foram nossos":', alvo.length)
const cnpjs = alvo.map((o) => o.cnpj)

// 1) busca AMPLA nas observações de TODOS os leads (pega cnpjs_adicionais, texto solto)
const leads = []
for (let de = 0; ; de += 1000) {
  const { data } = await supabase.from('sdr_leads').select('id,nome,telefone,status,observacoes,evotalks_opportunity_id').range(de, de + 999)
  if (!data?.length) break
  leads.push(...data); if (data.length < 1000) break
}
console.log('leads varridos:', leads.length)
const achadoObs = new Map()
for (const l of leads) {
  const digitos = norm(l.observacoes ?? '')
  if (!digitos) continue
  for (const c of cnpjs) if (digitos.includes(c)) achadoObs.set(c, l)
}
console.log('encontrados nas observações de algum lead:', achadoObs.size)

// 2) busca nas MENSAGENS (o lojista pode ter digitado o CNPJ no chat)
const achadoMsg = new Map()
for (let i = 0; i < cnpjs.length; i += 1) {
  const c = cnpjs[i]
  if (achadoObs.has(c)) continue
  const { data } = await supabase.from('sdr_mensagens').select('lead_id,conteudo').ilike('conteudo', `%${c}%`).limit(1)
  if (data?.length) achadoMsg.set(c, data[0].lead_id)
  // formato com máscara
  if (!data?.length) {
    const mask = `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    const { data: d2 } = await supabase.from('sdr_mensagens').select('lead_id,conteudo').ilike('conteudo', `%${mask}%`).limit(1)
    if (d2?.length) achadoMsg.set(c, d2[0].lead_id)
  }
}
console.log('encontrados em alguma mensagem de chat:', achadoMsg.size)

// 3) quando foram criados no portal
const porMes = {}
const porDia = {}
for (const o of alvo) {
  const m = (o.criado || '').slice(0, 7)
  porMes[m] = (porMes[m] || 0) + 1
  porDia[o.criado] = (porDia[o.criado] || 0) + 1
}
console.log('\ncriados no portal, por mês:', JSON.stringify(porMes))
const topDias = Object.entries(porDia).sort((a, b) => b[1] - a[1]).slice(0, 8)
console.log('dias com mais criações:', topDias.map(([d, n]) => `${d}=${n}`).join('  '))

// classificação final
const leadById = new Map(leads.map((l) => [l.id, l]))
let real = 0
for (const o of alvo) {
  const l = achadoObs.get(o.cnpj) ?? (achadoMsg.has(o.cnpj) ? leadById.get(achadoMsg.get(o.cnpj)) : null)
  if (l) {
    o.origem = `aparece no lead ${l.nome} (${l.telefone}, ${l.status}) — provável CNPJ adicional`
    o.lead_vinculado = `${l.nome} · ${l.telefone} · ${l.status}`
  } else {
    o.origem = 'nunca esteve no nosso funil (confirmado: sem registro, sem observação, sem mensagem)'
    real++
  }
}
console.log('\n── VEREDITO')
console.log('  vinculados a algum lead nosso (adicional/chat):', alvo.length - real)
console.log('  realmente nunca foram nossos:', real)
console.log('\nexemplos dos vinculados:')
for (const o of alvo.filter((x) => x.lead_vinculado).slice(0, 10)) console.log('   ' + o.cnpj + ' → ' + o.lead_vinculado)

writeFileSync(S + '/form-varejo-pendente.json', JSON.stringify(rows, null, 1))
