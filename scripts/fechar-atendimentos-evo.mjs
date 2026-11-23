// Fecha atendimentos da fila 10 abertos antes do corte. Uso: node --env-file=.env.local scripts/fechar-atendimentos-evo.mjs <arquivoIds> <log> [limite] [--dry]
import fs from 'node:fs'
const [, , arqIds, arqLog, limArg] = process.argv
const DRY = process.argv.includes('--dry')
const BASE = process.env.EVO_TALKS_BASE_URL
const body0 = { queueId: Number(process.env.EVO_TALKS_QUEUE_ID), apiKey: process.env.EVO_TALKS_QUEUE_API_KEY }
const CORTE = Date.parse(process.env.CORTE ?? '2026-11-16T03:00:00Z')
const OBS = process.env.OBS ?? 'Encerrado +7d (ordem do Aldo 23/11)'
const ids = [...fs.readFileSync(arqIds, 'utf8').matchAll(/"chathistory__id":\s*(\d+)/g)].map(m => Number(m[1]))
const lista = limArg && !limArg.startsWith('--') ? ids.slice(0, Number(limArg)) : ids
const cont = { fechado: 0, ja_fechado: 0, pulado_recente: 0, outra_fila: 0, erro: 0 }
const log = fs.createWriteStream(arqLog, { flags: 'a' })
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body0, ...body }) })
  const t = await r.text()
  let j = null; try { j = JSON.parse(t) } catch {}
  return { status: r.status, j, t }
}
let erros5xx = 0
async function um(id) {
  try {
    const d = await post('/int/getChatDetail', { chatId: id })
    if (d.status === 404) { cont.outra_fila++; log.write(`${id}\tnao_encontrado_fila10\n`); return }
    if (d.status >= 500) erros5xx++
    if (d.status !== 200 || !d.j) { cont.erro++; log.write(`${id}\terro_detail\t${d.status}\t${d.t.slice(0, 120)}\n`); return }
    const st = d.j.status, bt = Date.parse(d.j.beginTime ?? d.j.begintime ?? '')
    if (DRY) { log.write(`${id}\tdry\tstatus=${st}\tbegin=${d.j.beginTime}\tchaves=${Object.keys(d.j).join(',')}\n`); return }
    if (st !== 1) { cont.ja_fechado++; log.write(`${id}\tja_fechado\n`); return }
    if (!(bt < CORTE)) { cont.pulado_recente++; log.write(`${id}\tpulado_recente\t${d.j.beginTime}\n`); return }
    const e = await post('/int/endChat', { chatId: id, reason: OBS, endReason: 'ATENDIMENTO FINALIZADO' })
    if (e.status >= 500) erros5xx++
    if (e.status === 200) { cont.fechado++; log.write(`${id}\tfechado\n`) }
    else { cont.erro++; log.write(`${id}\terro_end\t${e.status}\t${e.t.slice(0, 120)}\n`) }
  } catch (err) { cont.erro++; erros5xx++; log.write(`${id}\texcecao\t${String(err).slice(0, 120)}\n`) }
}
let i = 0
async function worker() {
  while (i < lista.length) {
    if (erros5xx >= 10) return // Evo instável: para tudo
    const id = lista[i++]
    await um(id)
    if (i % 250 === 0) console.log(new Date().toISOString(), i, '/', lista.length, JSON.stringify(cont))
  }
}
await Promise.all(Array.from({ length: 5 }, worker))
console.log('FIM', i, '/', lista.length, JSON.stringify(cont), erros5xx >= 10 ? 'INTERROMPIDO por erros 5xx' : '')
log.end()
