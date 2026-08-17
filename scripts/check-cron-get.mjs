#!/usr/bin/env node
/**
 * Hook PostToolUse — guarda de cron.
 *
 * Crons da Vercel chamam a rota por GET. Rota de cron sem `export GET`
 * responde 405 e o cron morre em silencio — ja derrubou /followup e
 * /auto-descarte por meses (ver CLAUDE.md e commit 53af053).
 *
 * Este hook roda depois de todo Edit/Write. Se o arquivo editado for uma
 * rota listada em vercel.json > crons e nao exportar GET, ele reclama
 * (exit 2 devolve o stderr pro Claude corrigir na hora).
 *
 * Entrada: JSON do hook via stdin ({ tool_input: { file_path } }).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk

let payload
try {
  payload = JSON.parse(raw)
} catch {
  process.exit(0) // sem payload utilizavel: nao atrapalha
}

const file = payload?.tool_input?.file_path
if (typeof file !== 'string' || !file) process.exit(0)

// .../app/api/sdr/nudge/route.ts  ->  /api/sdr/nudge
const m = file.replace(/\\/g, '/').match(/\/app\/api\/(.+)\/route\.ts$/)
if (!m) process.exit(0)
const routePath = `/api/${m[1]}`

let crons
try {
  crons = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')).crons ?? []
} catch {
  process.exit(0) // sem vercel.json legivel: nada a validar
}

const cron = crons.find((c) => c.path === routePath)
if (!cron) process.exit(0)

let src
try {
  src = readFileSync(file, 'utf8')
} catch {
  process.exit(0)
}

const TEM_GET = /export\s+(?:async\s+)?function\s+GET\b/.test(src) ||
  /export\s+const\s+GET\b/.test(src) ||
  /export\s*\{[^}]*\bGET\b[^}]*\}/.test(src)

if (!TEM_GET) {
  console.error(
    `CRON QUEBRADO: ${routePath} esta agendado em vercel.json ("${cron.schedule}"), ` +
    `mas ${file} nao exporta GET.\n` +
    `A Vercel chama cron por GET — sem esse handler a rota responde 405 e o cron ` +
    `morre em silencio (ja aconteceu com /followup e /auto-descarte).\n` +
    `Corrija: exporte GET nessa rota (pode delegar pro POST) ou remova o cron do vercel.json.`
  )
  process.exit(2)
}

process.exit(0)
