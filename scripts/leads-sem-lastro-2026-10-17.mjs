/**
 * leads-sem-lastro-2026-10-17.mjs — só LEITURA.
 *
 * Caso Rosa Outlet Cell (17/10/2026): lead em TREINAR desde julho, sem oportunidade no Evo, sem
 * CNPJ em sdr_registros_cnpj e inexistente no portal da AIVA. Sem card e sem CNPJ o espelho nunca
 * a enxerga — e o espelho é quem corrige status. O status ficou congelado e ela seguiu recebendo
 * as automações da fase (comunicado, check de treinamento, reativação): HSM gasto numa loja que
 * não existe do lado da AIVA.
 *
 * Esta varredura procura o mesmo estado: status avançado (a loja deveria existir) sem nenhum
 * lastro — nem oportunidade, nem CNPJ registrado.
 *
 * Uso: node --env-file=.env.local scripts/leads-sem-lastro-2026-10-17.mjs
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const AVANCADOS = ['CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA', 'TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO']

const leads = []
for (let de = 0; ; de += 1000) {
  const { data, error } = await sb.from('sdr_leads')
    .select('id,nome,telefone,status,evotalks_opportunity_id,criado_em,data_ultimo_contato,observacoes')
    .in('status', AVANCADOS).order('id').range(de, de + 999)
  if (error) { console.error('erro:', error.message); process.exit(1) }
  if (!data?.length) break
  leads.push(...data); if (data.length < 1000) break
}

const comCnpj = new Set()
const ids = leads.map((l) => l.id)
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await sb.from('sdr_registros_cnpj').select('lead_id').in('lead_id', ids.slice(i, i + 200))
  for (const r of data ?? []) if (r.lead_id) comCnpj.add(r.lead_id)
}

const semLastro = leads.filter((l) => !l.evotalks_opportunity_id && !comCnpj.has(l.id))
const semOpp = leads.filter((l) => !l.evotalks_opportunity_id && comCnpj.has(l.id))
const semCnpj = leads.filter((l) => l.evotalks_opportunity_id && !comCnpj.has(l.id))

const porStatus = (arr) => {
  const m = {}
  for (const l of arr) m[l.status] = (m[l.status] ?? 0) + 1
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')
}

console.log(`leads em status avançado: ${leads.length}`)
console.log(`\nSEM LASTRO (sem opp E sem CNPJ): ${semLastro.length}  →  ${porStatus(semLastro)}`)
console.log(`sem opp mas com CNPJ: ${semOpp.length}  →  ${porStatus(semOpp)}`)
console.log(`com opp mas sem CNPJ: ${semCnpj.length}  →  ${porStatus(semCnpj)}`)

console.log('\n— os sem lastro, do mais antigo pro mais novo —')
for (const l of semLastro.sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)))) {
  const marcas = [...new Set((String(l.observacoes ?? '').match(/\[[A-Z_0-9]+[:\]]/g) ?? []).map((s) => s.replace(/[:\]]$/, '')))]
  console.log(`${String(l.criado_em).slice(0, 10)} | ${l.status.padEnd(26)} | ${String(l.nome).slice(0, 28).padEnd(28)} | ${l.telefone} | ult. contato ${String(l.data_ultimo_contato ?? '-').slice(0, 10)}`)
  console.log(`    ${marcas.join(' ') || '(sem marcadores)'}`)
}
