#!/usr/bin/env node
/**
 * ONDE ESTÁ O FURO — lojas que a Track fechou, que estão vendendo, e que nunca
 * entraram num fechamento de comissão da Ume. Pedido do Aldo, 09/11/2026:
 * "o lojista manda vídeo de várias vendas que fez e nunca chegou comissão".
 *
 * O raciocínio: se o lojista VENDE pelo AIVA, a loja existe do lado da Ume —
 * com retailer ID e tudo. Se mesmo assim ela não aparece no nosso relatório, o
 * vínculo dela com a Track é que não existe, e a comissão está indo para outro
 * lugar. Não dá para ver isso pelo portal (ele já vem filtrado pelo partner_id
 * da Track: o que não é nosso simplesmente não aparece).
 *
 * Então a prova de venda vem de onde ela sempre esteve e nunca foi usada: a
 * CONVERSA. O lojista conta que vendeu, pede ajuda com uma venda, manda vídeo.
 * Este script varre as mensagens RECEBIDAS das lojas que fechamos e que não
 * estão no fechamento, e separa as que falam de venda feita.
 *
 * Classificação da evidência:
 *   ALTA  — o lojista afirma venda realizada ("vendi", "fiz uma venda", "primeira venda")
 *   MEDIA — fala de venda/financiamento sem deixar claro que já aconteceu
 *   (as duas entram na planilha; a leitura final é humana, com o texto à vista)
 *
 * Uso: node --env-file=.env.local scripts/furo-comissao-lojas-vendendo.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const cnpj14 = (v) => { const d = dig(v); return d ? d.padStart(14, '0').slice(-14) : null }
const so10 = (d) => (d ? String(d).slice(0, 10) : '')

const todos = async (tabela, select, filtro = (q) => q) => {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(sb.from(tabela).select(select)).range(de, de + 999)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

const J = JSON.parse(readFileSync('scripts/out-conferencia-ume-2026-10.json', 'utf8'))

// ─────────── 1. as lojas que fechamos e que NÃO estão no fechamento ───────────
// "fechada" = funil 11 (contas fechadas MRR) ou lead em status de loja criada.
const fechadas = J.lojas.filter((l) => l.fontes.some((f) => /funil 11|VENDENDO|LOGIN|TREINAR|funil 15/.test(f)))
const fora = fechadas.filter((l) => !l.noRelatorio)
console.log('lojas que a Track fechou (todas as fontes): %d', fechadas.length)
console.log('  dessas, FORA do fechamento de outubro: %d', fora.length)

// ─────────── 2. de cada uma, os lead_id possíveis ───────────
const [registros, leads] = await Promise.all([
  todos('sdr_registros_cnpj', 'cnpj,loja,telefone,status,rid,criado_em,lead_id'),
  todos('sdr_leads', 'id,nome,telefone,status,status_alterado_em,observacoes,data_ultimo_contato'),
])
const leadPorId = new Map(leads.map((l) => [l.id, l]))
const leadsPorTel = new Map()
for (const l of leads) { const t = dig(l.telefone); if (t) leadsPorTel.set(t, l) }

const alvo = []   // { loja, leadIds[] }
for (const l of fora) {
  const ids = new Set()
  for (const r of registros) if (cnpj14(r.cnpj) === l.cnpj && r.lead_id) ids.add(r.lead_id)
  for (const x of leads) if (l.cnpj && String(x.observacoes ?? '').includes(l.cnpj)) ids.add(x.id)
  const porTel = l.telefone && leadsPorTel.get(dig(l.telefone))
  if (porTel) ids.add(porTel.id)
  if (ids.size) alvo.push({ loja: l, leadIds: [...ids] })
}
console.log('  com conversa rastreável (lead_id encontrado): %d', alvo.length)

// ─────────── 3. mensagens RECEBIDAS que falam de venda ───────────
const PADROES = ['%vendi%', '%venda%', '%vendas%', '%vendendo%', '%financi%', '%aprovou%', '%aprovada%', '%parcelou%']
const todosIds = [...new Set(alvo.flatMap((a) => a.leadIds))]
const msgs = []
for (let i = 0; i < todosIds.length; i += 40) {
  const lote = todosIds.slice(i, i + 40)
  const { data, error } = await sb.from('sdr_mensagens')
    .select('lead_id,direcao,conteudo,enviado_em')
    .in('lead_id', lote).eq('direcao', 'in')
    .or(PADROES.map((p) => `conteudo.ilike.${p}`).join(','))
    .order('enviado_em', { ascending: false })
  if (error) throw new Error(`sdr_mensagens: ${error.message}`)
  msgs.push(...(data ?? []))
}
console.log('  mensagens recebidas falando de venda: %d', msgs.length)

// último contato de cada lead (mesmo sem falar de venda), pra saber se ainda conversa
const ultimo = new Map()
for (let i = 0; i < todosIds.length; i += 40) {
  const { data } = await sb.from('sdr_mensagens').select('lead_id,enviado_em')
    .in('lead_id', todosIds.slice(i, i + 40)).eq('direcao', 'in')
    .order('enviado_em', { ascending: false })
  for (const m of data ?? []) if (!ultimo.has(m.lead_id)) ultimo.set(m.lead_id, m.enviado_em)
}

// ─────────── 4. força da evidência ───────────
// Três níveis. O que separa um do outro é só o texto do lojista — por isso o
// trecho vai junto na planilha: a leitura final é humana.
//
// RECLAMOU é o nível mais forte e o mais barato de provar: o lojista diz que
// vendeu E que a venda não apareceu. É a própria descrição do furo, na voz de
// quem vendeu, com data.
const RECLAMOU = /\b(n[ãa]o\s+(consta|aparec|apareceu|est[áa]\s+(a)?mostrando|mostrou|caiu|entrou|foi\s+pago|recebi))\b/i
// AFIRMA: venda concluída, no passado.
const AFIRMA = /\b(j[áa]\s+vendi|vendi|vendemos|fiz\s+(uma|duas|tr[êe]s|v[áa]rias|\d+)\s+vendas?|fechamos?\s+(a\s+)?(primeira\s+)?venda|fechei\s+(uma\s+)?venda|venda\s+(feita|aprovada|realizada|conclu[íi]da)|sa[íi]u\s+a\s+venda|consegui\s+vender|tivemos\s+\d*\s*venda)\b/i
// INTENÇÃO/NEGAÇÃO: derruba para MEDIA. Sem isto a lista enche de "estou
// tentando fazer a primeira venda" e perde a credibilidade justamente com quem
// vai cobrar a Ume.
const NEGA = /\b(n[ãa]o\s+(consigo|consegui|deu|vendi|vendeu)|ainda\s+n[ãa]o|vou\s+vender|vai\s+ser\s+(a\s+)?primeira|quero\s+vender|pretendo\s+vender|se\s+eu\s+vender|como\s+(eu\s+)?(vendo|fa[çc]o)|pra\s+vender|tentando\s+(fazer|vender)|tento\s+fazer|gostaria\s+de\s+saber|quantos\s+eu\s+recebo|d[úu]vida|como\s+que\s+(fica|funciona))\b/i
// Venda em OUTRA financeira não é furo nosso — e citar uma dessas numa cobrança
// à Ume queima a lista inteira.
// ⚠️ `\b` antes de "à" não funciona: à não é caractere de palavra em regex JS
// sem /u, e a alternativa some. Por isso a âncora fica só no fim.
const OUTRA = /(pay\s?joy|credi[áa]rio\s+(pr[óo]prio|meu)|n[ãa]o\s+na\s+aiva|na\s+(payjoy|cr[ée]dito\s+direto)|[àa]\s?vista\b)/i
// Eco do nosso próprio robô gravado como mensagem recebida (o texto traz os
// check-ins da VictorIA). Entra como "venda" e não é venda de ninguém.
const ECO = /(✅|Recebi aqui|S[óo] falta me passar)/

const porLead = new Map()
for (const m of msgs) {
  if (!porLead.has(m.lead_id)) porLead.set(m.lead_id, [])
  porLead.get(m.lead_id).push(m)
}

const linhas = []
for (const { loja, leadIds } of alvo) {
  const ms = leadIds.flatMap((id) => porLead.get(id) ?? [])
    .sort((a, b) => String(b.enviado_em).localeCompare(String(a.enviado_em)))
  if (!ms.length) continue
  const limpas = ms.filter((m) => !OUTRA.test(m.conteudo ?? '') && !ECO.test(m.conteudo ?? ''))
  const afirma = limpas.filter((m) => AFIRMA.test(m.conteudo ?? '') && !NEGA.test(m.conteudo ?? ''))
  const reclama = afirma.filter((m) => RECLAMOU.test(m.conteudo ?? ''))
  const forca = reclama.length ? 'RECLAMOU' : afirma.length ? 'ALTA' : 'MEDIA'
  const lead = leadIds.map((id) => leadPorId.get(id)).find(Boolean) ?? {}
  const reg = registros.find((r) => cnpj14(r.cnpj) === loja.cnpj) ?? {}
  const ultimoIn = leadIds.map((id) => ultimo.get(id)).filter(Boolean).sort().pop()
  const amostra = (reclama.length ? reclama : afirma.length ? afirma : ms).slice(0, 3)
  linhas.push({
    forca,
    soOutraFinanceira: limpas.length === 0 ? 'sim' : 'nao',
    cnpj: loja.cnpj,
    loja: loja.nomes[0] ?? reg.loja ?? lead.nome ?? '',
    telefone: dig(loja.telefone || reg.telefone || lead.telefone),
    rid: loja.rids.join('/'),
    temRid: loja.rids.length ? 'sim' : 'nao',
    statusLead: lead.status ?? '',
    statusRegistro: reg.status ?? '',
    preCadastroEm: so10(reg.criado_em),
    fontes: loja.fontes.join(' · '),
    msgsVenda: ms.length,
    msgsVendaAfirmada: afirma.length,
    msgsReclamando: reclama.length,
    primeiraFala: so10(ms[ms.length - 1]?.enviado_em),
    ultimaFala: so10(ms[0]?.enviado_em),
    ultimoContato: so10(ultimoIn),
    trechos: amostra.map((m) => `${so10(m.enviado_em)}: ${String(m.conteudo ?? '').replace(/\s+/g, ' ').slice(0, 220)}`).join('\n'),
  })
}

const ordem = { RECLAMOU: 0, ALTA: 1, MEDIA: 2 }
linhas.sort((a, b) => ordem[a.forca] - ordem[b.forca]
  || b.msgsVendaAfirmada - a.msgsVendaAfirmada
  || String(b.ultimaFala).localeCompare(String(a.ultimaFala)))

// a população inteira: toda loja fechada que não está no fechamento, com ou
// sem conversa. É o tamanho do problema; a lista acima é a parte provável.
const comEvidencia = new Set(linhas.map((l) => l.cnpj))
const populacao = fora.map((l) => {
  const reg = registros.find((r) => cnpj14(r.cnpj) === l.cnpj) ?? {}
  const ids = alvo.find((a) => a.loja.cnpj === l.cnpj)?.leadIds ?? []
  const lead = ids.map((id) => leadPorId.get(id)).find(Boolean) ?? {}
  return {
    cnpj: l.cnpj, loja: l.nomes[0] ?? reg.loja ?? '', telefone: dig(l.telefone || reg.telefone || lead.telefone),
    rid: l.rids.join('/'), temRid: l.rids.length ? 'sim' : 'nao',
    statusLead: lead.status ?? '', statusRegistro: reg.status ?? '', preCadastroEm: so10(reg.criado_em),
    temConversa: ids.length ? 'sim' : 'nao',
    falouDeVenda: comEvidencia.has(l.cnpj) ? 'sim' : 'nao',
    forca: linhas.find((x) => x.cnpj === l.cnpj)?.forca ?? '',
    ultimoContato: so10(ids.map((id) => ultimo.get(id)).filter(Boolean).sort().pop()),
    fontes: l.fontes.join(' · '),
  }
}).sort((a, b) => (b.falouDeVenda).localeCompare(a.falouDeVenda) || a.loja.localeCompare(b.loja))

writeFileSync('scripts/out-furo-comissao.json', JSON.stringify({ linhas, populacao }, null, 1))
console.log('\nlojas fechadas, fora do fechamento, que FALARAM de venda: %d', linhas.length)
console.log('   RECLAMOU (vendeu E a venda não apareceu): %d', linhas.filter((l) => l.forca === 'RECLAMOU').length)
console.log('   ALTA (afirma venda feita): %d', linhas.filter((l) => l.forca === 'ALTA').length)
console.log('   MEDIA (fala de venda sem confirmar): %d', linhas.filter((l) => l.forca === 'MEDIA').length)
console.log('   dessas, COM retailer ID conhecido: %d', linhas.filter((l) => l.temRid === 'sim').length)
console.log('dump: scripts/out-furo-comissao.json')
setTimeout(() => process.exit(0), 500).unref()
