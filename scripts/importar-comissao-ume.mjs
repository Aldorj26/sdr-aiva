#!/usr/bin/env node
/**
 * Importa as planilhas de apuração da UME (Carteira e/ou FCDL) pra
 * ume_comissoes/ume_comissoes_meta — mesmo parser do painel /comissoes
 * (lib/comissoes.ts, compilado on-the-fly), mesmo efeito do botão
 * "Importar relatório", mas por linha de comando (usado pela conferência
 * automática mensal).
 *
 * Uso:
 *   node --env-file=.env.local scripts/importar-comissao-ume.mjs <arq1.xlsx> [arq2.xlsx] [--dry]
 *
 * A origem (carteira/fcdl) sai do NOME do arquivo (contém "FCDL" → fcdl) e o
 * mês sai da linha "Competência" dentro da planilha. Reimportar o mesmo
 * (mês, origem) substitui. Recusa planilha cuja soma das linhas divergir
 * muito do total declarado (proteção contra arquivo truncado).
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const arquivos = args.filter((a) => !a.startsWith('--'))
if (!arquivos.length) {
  console.error('Uso: node --env-file=.env.local scripts/importar-comissao-ume.mjs <arquivo.xlsx> [...] [--dry]')
  process.exit(1)
}

// compila lib/comissoes.ts pra require (scripts .mjs não importam TS direto)
rmSync('.tsc-tmp', { recursive: true, force: true })
execSync('npx tsc lib/comissoes.ts --outDir .tsc-tmp --module commonjs --target es2020 --esModuleInterop --skipLibCheck', { stdio: 'inherit' })
const { parsePlanilhaUme } = require(process.cwd() + '/.tsc-tmp/comissoes.js')

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
let algumErro = false
const meses = new Set()

for (const arq of arquivos) {
  try {
    if (!existsSync(arq)) throw new Error('arquivo não existe')
    const parsed = parsePlanilhaUme(readFileSync(arq), arq)
    meses.add(parsed.mes)
    console.log(`${parsed.origem} ${parsed.mes}: ${parsed.linhas.length} lojas | total declarado R$ ${parsed.meta.total_comissao?.toFixed(2)}${parsed.aviso ? `\n  ⚠️ ${parsed.aviso}` : ''}`)
    if (DRY) continue

    await sb.from('ume_comissoes').delete().eq('mes', parsed.mes).eq('origem', parsed.origem)
    const { error } = await sb.from('ume_comissoes').insert(
      parsed.linhas.map((l) => ({ mes: parsed.mes, origem: parsed.origem, ...l })),
    )
    if (error) throw new Error(`insert: ${error.message}`)
    const up = await sb.from('ume_comissoes_meta').upsert(
      { mes: parsed.mes, origem: parsed.origem, ...parsed.meta, arquivo: arq.split(/[\\/]/).pop(), importado_em: new Date().toISOString() },
      { onConflict: 'mes,origem' },
    )
    if (up.error) throw new Error(`meta: ${up.error.message}`)
    console.log('  ✓ gravado')
  } catch (err) {
    algumErro = true
    console.error(`  ✗ ${arq}: ${err.message}`)
  }
}

for (const mes of meses) {
  const { data: metas } = await sb.from('ume_comissoes_meta').select('origem,total_comissao').eq('mes', mes)
  const nf = (metas ?? []).reduce((s, m) => s + (Number(m.total_comissao) || 0), 0)
  console.log(`\nValor da NF ${mes} (${(metas ?? []).map((m) => m.origem).join(' + ')}): R$ ${nf.toFixed(2)}`)
  if ((metas ?? []).length < 2) console.log('  ⚠️ Só uma origem importada até agora — a NF completa precisa de Carteira + FCDL.')
}
rmSync('.tsc-tmp', { recursive: true, force: true })
// process.exit() explícito crasha no Windows (assertion uv async) com sockets
// do supabase-js ainda abertos — só força saída no caso de erro.
if (algumErro) process.exit(1)
setTimeout(() => process.exit(0), 800).unref()
