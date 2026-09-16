#!/usr/bin/env node
/** Enriquece os 82 CNPJs (clientes Track já na AIVA, fora do funil) na Receita (BrasilAPI). TEMPORÁRIO — só leitura. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const S = process.env.SAIDA
const rows = JSON.parse(readFileSync(S + '/form-varejo-pendente.json', 'utf8'))
const lista = rows.filter((o) => String(o.origem ?? '').startsWith('nunca esteve no nosso funil')).map((o) => String(o.cnpj).replace(/\D/g, ''))
console.log('CNPJs:', lista.length)
const cache = existsSync(S + '/receita-82.json') ? JSON.parse(readFileSync(S + '/receita-82.json', 'utf8')) : {}
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))
for (const c of lista) {
  if (cache[c]?.ok) continue
  for (let tent = 1; tent <= 4; tent++) {
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${c}`, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'sdr-aiva/1.0' } })
      if (res.status === 429 || res.status === 403) { await dorme(4000 * tent); continue }
      if (!res.ok) { cache[c] = { ok: false, http: res.status }; break }
      const j = await res.json()
      cache[c] = {
        ok: true, razao: j.razao_social, fantasia: j.nome_fantasia, situacao: j.descricao_situacao_cadastral, abertura: j.data_inicio_atividade,
        municipio: j.municipio, uf: j.uf, tel1: [j.ddd_telefone_1].filter(Boolean).join(''), tel2: [j.ddd_telefone_2].filter(Boolean).join(''), email: j.email,
        cnae: j.cnae_fiscal_descricao, porte: j.porte, socios: (j.qsa ?? []).map((s) => s.nome_socio).slice(0, 3),
      }
      break
    } catch (e) { if (tent === 4) cache[c] = { ok: false, erro: String(e).slice(0, 80) }; await dorme(2000 * tent) }
  }
  writeFileSync(S + '/receita-82.json', JSON.stringify(cache, null, 1))
  await dorme(900)
}
const ok = lista.filter((c) => cache[c]?.ok)
console.log('Receita ok:', ok.length, '· falhas:', lista.length - ok.length, lista.filter((c) => !cache[c]?.ok).map((c) => `${c}:${cache[c]?.http ?? cache[c]?.erro ?? '?'}`).join(' '))
const sit = {}; for (const c of ok) sit[cache[c].situacao] = (sit[cache[c].situacao] ?? 0) + 1
console.log('situação:', sit)
const tel = (t) => String(t ?? '').replace(/\D/g, '')
const comTel = ok.filter((c) => tel(cache[c].tel1).length >= 10)
const celular = ok.filter((c) => /^\d{2}9\d{8}$/.test(tel(cache[c].tel1)) || /^\d{2}9\d{8}$/.test(tel(cache[c].tel2)))
console.log('com telefone:', comTel.length, '· parece celular (DDD+9):', celular.length, '· com e-mail:', ok.filter((c) => cache[c].email).length)
const idade = (d) => Math.floor((Date.now() - new Date(d)) / (365.25 * 86400000))
console.log('menos de 1 ano:', ok.filter((c) => idade(cache[c].abertura) < 1).length)
// já existe no nosso banco? (telefone ou CNPJ)
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const tels = [...new Set(ok.flatMap((c) => [cache[c].tel1, cache[c].tel2]).map(tel).filter((t) => t.length >= 10).map((t) => (t.startsWith('55') ? t : '55' + t)))]
const { data: dup } = await sb.from('sdr_leads').select('telefone, nome, status').in('telefone', tels)
console.log('telefones da Receita que JÁ são leads nossos:', (dup ?? []).length, (dup ?? []).map((d) => `${d.nome} (${d.status})`).join(' · '))
const { data: reg } = await sb.from('sdr_registros_cnpj').select('cnpj').in('cnpj', lista)
console.log('CNPJs já em sdr_registros_cnpj:', (reg ?? []).length)
process.exit(0)
