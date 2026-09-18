/**
 * Monta as filiais no MODELO NOVO da AIVA (aba do Mauricio, 15 colunas) a partir do
 * controle interno (controle_filiais.csv).
 *
 * O modelo pede endereço completo (CEP, logradouro, número, complemento, bairro) —
 * dado que a gente não coleta no chat. Ele vem da RECEITA pelo CNPJ da FILIAL
 * (BrasilAPI, mesma fonte da validação do fluxo), então ninguém digita endereço na mão.
 * O ID VAREJO vem da API da AIVA quando a loja já existe lá.
 *
 * Só LÊ. Uso: npx tsx --env-file=.env.local scripts/filiais-modelo-aiva.mts <csv>
 */
import fs from 'node:fs'
import { listarOnboardingsApi } from '../lib/portal-aiva'

const csv = process.argv[2] ?? 'C:/Users/rocha/Downloads/controle_filiais.csv'
const so = (s: unknown) => String(s ?? '').replace(/\D/g, '')

function parseCsv(txt: string): Record<string, string>[] {
  const linhas = txt.split(/\r?\n/).filter((l) => l.trim())
  const cab = linhas[0].split(';').map((c) => c.trim())
  return linhas.slice(1).map((l) => {
    // respeita aspas (as pendências têm ; dentro)
    const campos: string[] = []
    let atual = '', dentro = false
    for (const ch of l) {
      if (ch === '"') { dentro = !dentro; continue }
      if (ch === ';' && !dentro) { campos.push(atual); atual = ''; continue }
      atual += ch
    }
    campos.push(atual)
    return Object.fromEntries(cab.map((c, i) => [c, (campos[i] ?? '').trim()]))
  })
}

type Receita = { cep?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string; municipio?: string; uf?: string; razao_social?: string; nome_fantasia?: string; descricao_situacao_cadastral?: string }
const cache = new Map<string, Receita | null>()
async function receita(cnpj: string): Promise<Receita | null> {
  if (cache.has(cnpj)) return cache.get(cnpj)!
  let out: Receita | null = null
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { accept: 'application/json', 'user-agent': 'sdr-aiva/1.0' }, signal: AbortSignal.timeout(12_000) })
    if (r.ok) out = (await r.json()) as Receita
    else console.error(`  ⚠️ Receita ${r.status} para ${cnpj}`)
  } catch (e) { console.error(`  ⚠️ Receita falhou para ${cnpj}: ${String(e).slice(0, 60)}`) }
  cache.set(cnpj, out)
  await new Promise((s) => setTimeout(s, 1500))   // BrasilAPI é gratuita: sem pressa
  return out
}

const onbs = await listarOnboardingsApi()
const ridPorCnpj = new Map<string, string>()
const nomePortal = new Map<string, string>()
for (const o of onbs) {
  const c = so(o.cnpj)
  if (o.retailer_id) ridPorCnpj.set(c, String(o.retailer_id))
  if (o.legal_name) nomePortal.set(c, String(o.legal_name))
}

const linhas = parseCsv(fs.readFileSync(csv, 'utf8'))
const saida: Record<string, string>[] = []
const conferir: Record<string, string>[] = []

for (const l of linhas) {
  const filial = so(l['CNPJ da Filial'])
  const matriz = so(l['CNPJ da Matriz'])
  const r = filial.length === 14 ? await receita(filial) : null
  const tel = so(l['Telefone'])
  const rid = ridPorCnpj.get(filial) ?? ''
  const nome = l['Loja'] && !l['Loja'].startsWith('(nome') ? l['Loja'] : (r?.nome_fantasia || r?.razao_social || '')
  saida.push({
    'ID VAREJO': rid,
    'NOME DA LOJA': nome,
    'CEP': so(r?.cep),
    'LOGRADOURO': r?.logradouro ?? '',
    'NÚMERO': String(r?.numero ?? ''),
    'COMPLEMENTO': r?.complemento ?? '',
    'BAIRRO': r?.bairro ?? '',
    'CIDADE': r?.municipio ?? (l['Cidade/UF'] ?? '').split('/')[0] ?? '',
    'UF': r?.uf ?? (l['Cidade/UF'] ?? '').split('/')[1] ?? '',
    'CNPJ DA FILIAL': filial,
    'CNPJ DA MATRIZ': matriz,
    'NOME COMPLETO': l['Operador'] ?? '',
    'CPF (SÓ NUMEROS)': so(l['CPF']),
    'EMAIL': l['E-mail'] ?? '',
    'TELEFONE (FORMATADO 55DDDTELEFONE)': tel,
  })
  const avisos: string[] = []
  if (!r) avisos.push('Receita não respondeu / CNPJ não encontrado — endereço em branco')
  if (r && (r.descricao_situacao_cadastral ?? '').toUpperCase() !== 'ATIVA') avisos.push(`situação na Receita: ${r?.descricao_situacao_cadastral}`)
  if (!l['Operador']) avisos.push('sem operador')
  if (so(l['CPF']).length !== 11) avisos.push('CPF não tem 11 dígitos')
  if (!(tel.length === 12 || tel.length === 13) || !tel.startsWith('55')) avisos.push(`telefone fora do formato 55DDD… (${tel})`)
  if (!rid) avisos.push('sem ID VAREJO na API da AIVA (loja ainda não existe lá)')
  if (nomePortal.get(matriz)) avisos.push(`matriz no portal: ${nomePortal.get(matriz)}`)
  if (l['Pendencias']) avisos.push(`controle interno: ${l['Pendencias']}`)
  if (r && l['Cidade/UF'] && !(l['Cidade/UF'] ?? '').toLowerCase().startsWith((r.municipio ?? '').toLowerCase().slice(0, 5))) {
    avisos.push(`cidade do controle (${l['Cidade/UF']}) ≠ Receita (${r.municipio}/${r.uf})`)
  }
  conferir.push({ Loja: nome || filial, 'CNPJ DA FILIAL': filial, Operador: l['Operador'] ?? '', Avisos: avisos.join(' · ') })
}

fs.writeFileSync('scripts/out-filiais-modelo.json', JSON.stringify({ saida, conferir }, null, 1), 'utf8')
console.log(`${saida.length} linha(s) montadas no modelo da AIVA.`)
for (const c of conferir) console.log(`• ${c.Loja} — ${c.Avisos || 'ok'}`)
