/**
 * backfill-cnpj-receita.mjs — consulta BrasilAPI pros CNPJs já coletados.
 *
 * Pega leads AIVA ativos (INTERESSADO → LOJA_FINALIZADA) com cnpj_matriz em
 * [DADOS_COLETADOS:] e sem [CNPJ_RECEITA:], consulta a Receita, grava o
 * marcador e reporta os casos com atenção (idade<1, situação != ATIVA, sem sócio).
 *
 * Uso: node scripts/backfill-cnpj-receita.mjs [--dry]
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const DRY = process.argv.includes('--dry')

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const STATUSES = 'INTERESSADO,PRE_APROVACAO,CADASTRO_RECEBIDO,EM_ANALISE_AIVA,TREINAR,LOGIN,LOJA_FINALIZADA_E_VENDENDO'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function consultarCNPJ(cnpj, tentativa = 1) {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { accept: 'application/json', 'user-agent': 'sdr-aiva/1.0 (backfill)' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 429 && tentativa <= 2) {
      await sleep(3000 * tentativa)
      return consultarCNPJ(cnpj, tentativa + 1)
    }
    if (!res.ok) return { erro: `HTTP ${res.status}` }
    const d = await res.json()
    const abertura = d.data_inicio_atividade ?? null
    let idade = null
    if (abertura) {
      const dt = new Date(`${abertura}T12:00:00Z`)
      if (!isNaN(dt)) idade = Math.round(((Date.now() - dt.getTime()) / (365.25 * 864e5)) * 10) / 10
    }
    return {
      abertura,
      idade,
      situacao: (d.descricao_situacao_cadastral ?? '').toUpperCase() || null,
      socios: Array.isArray(d.qsa) ? d.qsa.length : 0,
      razao: d.razao_social ?? null,
      cnae: d.cnae_fiscal_descricao ?? null,
    }
  } catch (e) {
    return { erro: e.message }
  }
}

// 1. Busca leads ativos com CNPJ coletado e sem consulta prévia
const url =
  `${SUPABASE_URL}/rest/v1/sdr_leads?select=id,nome,telefone,status,observacoes` +
  `&produto=eq.AIVA&status=in.(${STATUSES})` +
  `&observacoes=like.*cnpj_matriz%3D*&observacoes=not.like.*%5BCNPJ_RECEITA*`
const res = await fetch(url, { headers: H })
const leads = await res.json()
if (!Array.isArray(leads)) { console.error('Erro ao buscar leads:', leads); process.exit(1) }

console.log(`Leads ativos com CNPJ e sem consulta: ${leads.length}${DRY ? ' (DRY RUN)' : ''}`)

const flags = []
let ok = 0, erros = 0, invalidos = 0

for (const lead of leads) {
  const m = (lead.observacoes ?? '').match(/cnpj_matriz=(\d[\d./-]*)/)
  const cnpj = (m?.[1] ?? '').replace(/\D/g, '')
  if (cnpj.length !== 14) { invalidos++; continue }

  const info = await consultarCNPJ(cnpj)
  await sleep(700) // gentileza com a API pública

  if (info.erro) {
    erros++
    console.log(`  ✗ ${lead.nome} (${cnpj}): ${info.erro}`)
    continue
  }
  ok++

  const atencao = []
  if (info.idade != null && info.idade < 1) atencao.push(`CNPJ ${info.idade} ano`)
  if (info.situacao && info.situacao !== 'ATIVA') atencao.push(`situação ${info.situacao}`)
  if (info.socios === 0) atencao.push('SEM SÓCIO')
  if (atencao.length) {
    flags.push({ nome: lead.nome, telefone: lead.telefone, status: lead.status, cnpj, ...info, atencao })
  }

  if (!DRY) {
    const marker = `[CNPJ_RECEITA:cnpj=${cnpj}${info.abertura ? `|abertura=${info.abertura}` : ''}${info.idade != null ? `|idade=${info.idade}` : ''}${info.situacao ? `|situacao=${info.situacao}` : ''}|socios=${info.socios}]`
    const novaObs = `${(lead.observacoes ?? '').replace(/\s*\[CNPJ_RECEITA:[^\]]+\]\s*/g, ' ').trim()} ${marker}`.trim()
    const up = await fetch(`${SUPABASE_URL}/rest/v1/sdr_leads?id=eq.${lead.id}`, {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ observacoes: novaObs }),
    })
    if (!up.ok) console.log(`  ✗ update falhou pra ${lead.nome}: ${up.status}`)
  }
}

console.log(`\nConsultados: ${ok} | Erros API: ${erros} | CNPJ inválido: ${invalidos}`)
console.log(`\n=== CASOS COM ATENÇÃO (${flags.length}) ===`)
for (const f of flags) {
  console.log(`\n• ${f.nome} [${f.status}] ${f.telefone}`)
  console.log(`  CNPJ ${f.cnpj} — ${f.razao ?? '?'}`)
  console.log(`  Abertura: ${f.abertura ?? '?'} (${f.idade ?? '?'} anos) | Situação: ${f.situacao ?? '?'} | Sócios: ${f.socios}`)
  console.log(`  ⚠️ ${f.atencao.join(' | ')}`)
}
