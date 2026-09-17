#!/usr/bin/env node
/**
 * Backfill dos CNPJs de quem travou na Fase 3 do fluxo ANTIGO (12 campos).
 *
 * O QUE ACONTECEU (diagnóstico de 17/09): o bloco do webhook que espelha os
 * CNPJs em sdr_registros_cnpj roda DENTRO da conclusão da Fase 3, e a conclusão
 * só acontece quando `camposObrigatorios` está completo. No fluxo antigo isso
 * incluía faturamento_anual, valor_boleto_mensal e localizacao_lojas — campos
 * que o Aldo tirou em 16/09 justamente porque afastavam o lojista.
 *
 * Esses leads deram o e-mail e sumiram no faturamento. A conclusão nunca rodou,
 * então o CNPJ nunca virou linha no /registros e o Nei nunca teve o que lançar.
 * Ficaram em "Cadastro Recebido" de 20 a 57 dias esperando uma ação que ninguém
 * sabia que existia.
 *
 * O corte de 16/09 desbloqueia todos eles — mas só na PRÓXIMA mensagem que o
 * lojista mandar, e 4 dos 6 estão com [COBRANCA_ESGOTADA] (ninguém mais fala com
 * eles). Por isso o backfill: cria o registro que a conclusão teria criado.
 *
 * NÃO manda mensagem, NÃO move card, NÃO muda status. Só cria a linha no painel.
 *
 * Uso: node --env-file=.env.local scripts/backfill-registros-fase3-travada-2026-09-17.mjs [--gravar]
 */
import { createClient } from '@supabase/supabase-js'

const GRAVAR = process.argv.includes('--gravar')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const OBRIGATORIOS = ['nome_socio', 'email_socio', 'telefone_socio', 'nome_varejo', 'cnpj_matriz', 'numero_lojas']
const ATIVOS = ['INTERESSADO', 'AGUARDANDO', 'CADASTRO_RECEBIDO', 'PRE_APROVACAO']

const parseDados = (obs) => {
  const m = (obs ?? '').match(/\[DADOS_COLETADOS:([^\]]*)\]/)
  if (!m) return {}
  const d = {}
  for (const par of m[1].split('|')) {
    const i = par.indexOf('=')
    if (i > 0) d[par.slice(0, i).trim()] = par.slice(i + 1).trim()
  }
  return d
}
/** Mesma extração do fluxo (lib/pre-cadastro-form): 14 dígitos, sem DV inválido óbvio. */
const extrairCnpjs = (txt) => [...String(txt ?? '').matchAll(/\d[\d./-]{12,}\d/g)]
  .map((m) => m[0].replace(/\D/g, '')).filter((c) => c.length === 14)

const leads = []
for (let de = 0; ; de += 1000) {
  const { data } = await sb.from('sdr_leads')
    .select('id,nome,telefone,status,observacoes').order('criado_em').range(de, de + 999)
  leads.push(...(data ?? []))
  if (!data || data.length < 1000) break
}

const alvos = leads.filter((l) => {
  if (!ATIVOS.includes(l.status)) return false
  if ((l.observacoes ?? '').includes('[CAD_ALERTADO]')) return false     // a conclusão já rodou
  const d = parseDados(l.observacoes)
  return OBRIGATORIOS.every((k) => String(d[k] ?? '').trim())            // completo pela regra NOVA
})

console.log(`${leads.length} leads lidos · ${alvos.length} travados na Fase 3 antiga com os 6 campos novos completos\n`)

const novos = []
for (const l of alvos) {
  const d = parseDados(l.observacoes)
  const matriz = extrairCnpjs(d.cnpj_matriz)
  const adicionais = extrairCnpjs(d.cnpjs_adicionais).filter((c) => !matriz.includes(c))
  const { data: jaTem } = await sb.from('sdr_registros_cnpj').select('cnpj').eq('lead_id', l.id)
  const existentes = new Set((jaTem ?? []).map((r) => String(r.cnpj).replace(/\D/g, '')))

  const linhas = [
    ...matriz.map((c) => ({ cnpj: c, tipo: 'matriz' })),
    ...adicionais.map((c) => ({ cnpj: c, tipo: 'adicional' })),
  ].filter((r) => !existentes.has(r.cnpj))
    .map((r) => ({ ...r, lead_id: l.id, loja: l.nome, telefone: l.telefone, status: 'informada' }))

  console.log(`• ${String(l.nome).slice(0, 30).padEnd(31)} ${l.status.padEnd(18)} ` +
    (linhas.length ? `cria ${linhas.map((r) => `${r.cnpj}(${r.tipo})`).join(', ')}` : 'já tinha registro — nada a fazer'))
  novos.push(...linhas)
}

if (!novos.length) { console.log('\nNada a criar.'); process.exit(0) }
if (!GRAVAR) { console.log(`\n${novos.length} registro(s) a criar. Rode com --gravar pra aplicar.`); process.exit(0) }

const { error } = await sb.from('sdr_registros_cnpj')
  .upsert(novos, { onConflict: 'lead_id,cnpj', ignoreDuplicates: true })
if (error) { console.error('falhou:', error.message); process.exit(1) }
console.log(`\n${novos.length} registro(s) criado(s) — aparecem em /registros como "🆕 informada" pro Nei lançar.`)
