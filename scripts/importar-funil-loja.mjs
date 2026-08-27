#!/usr/bin/env node
/**
 * Importa o "Funil por Loja" (Data Studio Parceiros-AIVA, filtrado por mês)
 * pra tabela aiva_desempenho — é o que alimenta a contraprova 🔴 do painel
 * /comissoes e a coluna Data Studio.
 *
 * O arquivo JSON vem do coletor scripts/coletor-funil-loja.js (cole no console
 * do Chrome com o relatório aberto e o período filtrado — instruções lá).
 *
 * Uso:
 *   node --env-file=.env.local scripts/importar-funil-loja.mjs --mes 2026-07 [--arquivo <caminho>] [--dry]
 *
 * - --mes é OBRIGATÓRIO e deve ser o mesmo período filtrado no relatório
 *   (proteção: o script pede confirmação implícita mostrando os totais antes
 *   de gravar; use --dry pra só conferir).
 * - --arquivo: default = o funil-loja*.json mais recente em ~/Downloads.
 * - Reimportar o mesmo mês SUBSTITUI o snapshot daquele mês.
 *
 * Criado 27/08/2026 (pedido do Aldo) depois da conferência de julho — a
 * primeira rodada provou que dá pra validar mês fechado: 27 lojas venderam
 * em julho e todas estavam no relatório de comissão da UME.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const pega = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

const mes = pega('--mes')
if (!/^\d{4}-\d{2}$/.test(mes ?? '')) {
  console.error('Uso: node --env-file=.env.local scripts/importar-funil-loja.mjs --mes YYYY-MM [--arquivo <json>] [--dry]')
  process.exit(1)
}

// arquivo: o indicado, ou o funil-loja*.json mais recente do Downloads
let arquivo = pega('--arquivo')
if (!arquivo) {
  const dl = join(homedir(), 'Downloads')
  const candidatos = readdirSync(dl)
    .filter((f) => /^funil-loja.*\.json$/i.test(f))
    .map((f) => ({ f: join(dl, f), t: statSync(join(dl, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  if (!candidatos.length) {
    console.error('Nenhum funil-loja*.json em Downloads — baixe pelo coletor (scripts/coletor-funil-loja.js) ou passe --arquivo.')
    process.exit(1)
  }
  arquivo = candidatos[0].f
  const idadeMin = Math.round((Date.now() - candidatos[0].t) / 60000)
  console.log(`arquivo: ${arquivo} (baixado há ${idadeMin} min)`)
  if (idadeMin > 24 * 60) console.warn('⚠️ Arquivo tem mais de 1 dia — confere se é mesmo o export do mês certo.')
}

const bruto = JSON.parse(readFileSync(arquivo, 'utf-8'))
if (!Array.isArray(bruto) || !bruto.length || !bruto[0].cnpj) {
  console.error('Arquivo não parece um export do coletor (esperado: array com id/cnpj/loja/vendas...).')
  process.exit(1)
}

// números BR: "R$ 18.418,40" → 18418.40 | "26,4%" → 26.4
const num = (s) => {
  const d = String(s ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(d)
  return Number.isFinite(n) ? n : null
}
const int = (s) => parseInt(String(s ?? '').replace(/\D/g, ''), 10) || 0

const rows = bruto.map((l) => ({
  mes,
  cnpj: String(l.cnpj).replace(/\D/g, '').padStart(14, '0'),
  nome_varejo: l.varejo || null,
  loja: l.loja || null,
  uf: l.uf || null,
  cidade: l.cidade || null,
  status_consulta: l.status || null,
  aprovados: int(l.aprovados),
  vendas: int(l.vendas),
  conversao: (num(l.conv) ?? 0) / 100,
  valor_vendas: num(l.valor),
  ticket_medio: num(l.ticket),
  sem_venda: int(l.vendas) === 0,
  sem_consulta: int(l.aprovados) === 0,
  sem_operador: false,
  telefone: null,
  atualizado_em: new Date().toISOString(),
}))

const tot = {
  lojas: rows.length,
  aprovados: rows.reduce((s, r) => s + r.aprovados, 0),
  vendas: rows.reduce((s, r) => s + r.vendas, 0),
  valor: rows.reduce((s, r) => s + (r.valor_vendas ?? 0), 0),
}
console.log(`mês ${mes}: ${tot.lojas} lojas | ${tot.aprovados} aprovados | ${tot.vendas} vendas | R$ ${tot.valor.toFixed(2)}`)
console.log('(confere com os cards do relatório antes de seguir — se não bater, a coleta ficou incompleta)')

if (DRY) {
  console.log('\nDRY — nada gravado.')
  process.exit(0)
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
await sb.from('aiva_desempenho').delete().eq('mes', mes)
const { error } = await sb.from('aiva_desempenho').insert(rows)
if (error) {
  console.error('ERRO ao gravar:', error.message)
  process.exit(1)
}
console.log(`\n✓ snapshot ${mes} gravado (${rows.length} lojas). A contraprova do /comissoes pra esse mês já funciona.`)
