#!/usr/bin/env node
/**
 * Importa o "Funil por Loja" (Data Studio, filtrado pela SEMANA fechada seg-dom)
 * pra tabela aiva_desempenho_semanal — alimenta o pulso semanal (regra 31/08).
 *
 * O JSON vem do MESMO coletor mensal (scripts/coletor-funil-loja.js), só que
 * com o período do relatório filtrado pra semana (segunda a domingo).
 *
 * Uso:
 *   node --env-file=.env.local scripts/importar-desempenho-semanal.mjs --semana 2026-08-24 [--arquivo <json>] [--dry]
 *
 * --semana = a SEGUNDA-FEIRA da semana coletada. Reimportar substitui o snapshot.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const pega = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }

const semana = pega('--semana')
if (!/^\d{4}-\d{2}-\d{2}$/.test(semana ?? '')) {
  console.error('Uso: ... --semana YYYY-MM-DD (segunda-feira da semana coletada) [--arquivo <json>] [--dry]')
  process.exit(1)
}
if (new Date(semana + 'T12:00:00Z').getUTCDay() !== 1) {
  console.error(`${semana} não é segunda-feira — passe a segunda da semana coletada.`)
  process.exit(1)
}

let arquivo = pega('--arquivo')
if (!arquivo) {
  const dl = join(homedir(), 'Downloads')
  const cand = readdirSync(dl)
    .filter((f) => /^funil-loja.*\.json$/i.test(f))
    .map((f) => ({ f: join(dl, f), t: statSync(join(dl, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  if (!cand.length) { console.error('Nenhum funil-loja*.json em Downloads.'); process.exit(1) }
  arquivo = cand[0].f
  console.log(`arquivo: ${arquivo} (baixado há ${Math.round((Date.now() - cand[0].t) / 60000)} min)`)
}

const bruto = JSON.parse(readFileSync(arquivo, 'utf-8'))
if (!Array.isArray(bruto) || !bruto.length || !bruto[0].cnpj) {
  console.error('Arquivo não parece export do coletor (esperado: array com id/cnpj/loja/vendas...).')
  process.exit(1)
}

const num = (s) => {
  const d = String(s ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(d)
  return Number.isFinite(n) ? n : null
}
const int = (s) => parseInt(String(s ?? '').replace(/\D/g, ''), 10) || 0

// agrega por cnpj — o relatório é por LOJA e o mesmo CNPJ pode ter 2+ lojas
// (ex.: "Loja Principal" e "Loja 2"). Sobrescrever perderia as vendas de uma
// delas e mandaria "você não vendeu" pra quem vendeu. Soma sempre.
const porCnpj = new Map()
for (const l of bruto) {
  const cnpj = String(l.cnpj).replace(/\D/g, '').padStart(14, '0')
  const ap = int(l.aprovados), vd = int(l.vendas), vl = num(l.valor) ?? 0
  const atual = porCnpj.get(cnpj)
  if (!atual) {
    porCnpj.set(cnpj, {
      semana, cnpj, rid: String(l.id ?? '') || null,
      nome_varejo: l.varejo || null, loja: l.loja || null, uf: l.uf || null, cidade: l.cidade || null,
      aprovados: ap, vendas: vd, valor_vendas: vl,
    })
    continue
  }
  // fica com o nome da loja que mais vendeu (a mais representativa do CNPJ)
  if (vd > atual.vendas) atual.loja = l.loja || atual.loja
  atual.aprovados += ap
  atual.vendas += vd
  atual.valor_vendas += vl
}
const rows = [...porCnpj.values()]
const tot = rows.reduce((a, r) => ({ ap: a.ap + r.aprovados, vd: a.vd + r.vendas }), { ap: 0, vd: 0 })
console.log(`semana ${semana}: ${rows.length} lojas | ${tot.ap} aprovados | ${tot.vd} vendas`)
console.log('(confere com os cards do relatório — se não bater, a coleta ficou incompleta)')

if (DRY) { console.log('DRY - nada gravado.'); process.exit(0) }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
await sb.from('aiva_desempenho_semanal').delete().eq('semana', semana)
const { error } = await sb.from('aiva_desempenho_semanal').insert(rows)
if (error) { console.error('ERRO ao gravar:', error.message); process.exit(1) }
console.log(`OK - snapshot da semana ${semana} gravado (${rows.length} lojas).`)
setTimeout(() => process.exit(0), 800).unref()
