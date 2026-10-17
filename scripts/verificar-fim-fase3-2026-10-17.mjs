/**
 * verificar-fim-fase3-2026-10-17.mjs — confere os efeitos do deploy que acabou com a FASE 3.
 *
 * Só LEITURA: não escreve nada, pode rodar quantas vezes quiser.
 *
 * O que mede:
 *  1) destravamento (opção A): leads com os 4 campos que estavam parados só por e-mail ou
 *     nº de lojas — quantos já viraram CADASTRO_RECEBIDO e quantos ainda estão atrás.
 *  2) limpeza do marcador [FASE3_DESDE:] pelo sync-from-evo.
 *  3) [CAD_BLOQUEIO:n] vivos — o ramo que revertia CADASTRO_RECEBIDO pra INTERESSADO. Em 3
 *     turnos seguidos ele dispara alerta de card travado; depois do deploy não deve crescer.
 *
 * Uso: node --env-file=.env.local scripts/verificar-fim-fase3-2026-10-17.mjs
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const QUATRO = ['nome_socio', 'telefone_socio', 'nome_varejo', 'cnpj_matriz']
const ANTIGOS = ['email_socio', 'numero_lojas']

const dados = (obs) => {
  const m = (obs ?? '').match(/\[DADOS_COLETADOS:([^\]]*)\]/)
  if (!m) return {}
  const o = {}
  for (const p of m[1].split('|')) {
    const i = p.indexOf('=')
    if (i > 0) { const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim(); if (k && v && v !== 'null') o[k] = v }
  }
  return o
}

const leads = []
for (let de = 0; ; de += 1000) {
  const { data, error } = await sb.from('sdr_leads')
    .select('id,nome,status,observacoes')
    .in('status', ['INTERESSADO', 'CADASTRO_RECEBIDO', 'AGUARDANDO'])
    .order('id').range(de, de + 999)
  if (error) { console.error('erro:', error.message); process.exit(1) }
  if (!data?.length) break
  leads.push(...data); if (data.length < 1000) break
}

let destravados = 0, aindaAtras = 0
const pendentes = []
for (const l of leads) {
  const d = dados(l.observacoes)
  if (!QUATRO.every((k) => String(d[k] ?? '').trim())) continue
  if (!ANTIGOS.some((k) => !String(d[k] ?? '').trim())) continue
  if (l.status === 'CADASTRO_RECEBIDO') destravados++
  else { aindaAtras++; if (pendentes.length < 10) pendentes.push(`${l.nome} (${l.status})`) }
}

const marcador = leads.filter((l) => (l.observacoes ?? '').includes('[FASE3_DESDE:')).length
const bloqueios = leads.filter((l) => /\[CAD_BLOQUEIO:(\d+)/.test(l.observacoes ?? ''))
const bloq3 = bloqueios.filter((l) => Number((l.observacoes ?? '').match(/\[CAD_BLOQUEIO:(\d+)/)?.[1] ?? 0) >= 3)

console.log(`analisados: ${leads.length} leads (INTERESSADO/CADASTRO_RECEBIDO/AGUARDANDO)`)
console.log(`1) destravados (já em CADASTRO_RECEBIDO): ${destravados}`)
console.log(`   ainda atrás (esperando sync ou mensagem): ${aindaAtras}`)
pendentes.forEach((p) => console.log(`     - ${p}`))
console.log(`2) marcador [FASE3_DESDE:] restante: ${marcador}  (era 20 antes do deploy)`)
console.log(`3) [CAD_BLOQUEIO:] vivos: ${bloqueios.length} — no limite de 3+: ${bloq3.length}`)
if (bloq3.length) console.log('   ⚠️ esses podem gerar alerta de card travado no primeiro turno')
