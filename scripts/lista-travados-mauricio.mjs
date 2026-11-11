#!/usr/bin/env node
/**
 * A lista dos 577 cadastros que a AIVA aceitou e que nunca viraram loja —
 * para mandar ao Mauricio (pedido do Aldo, 09/11/2026).
 *
 * O recorte: CNPJ que a Track enviou, que tem onboarding no portal da AIVA e
 * que NÃO tem retailer_id. Sem retailer ID não existe venda registrada nem
 * comissão possível, por mais que o nosso funil conte como negócio ganho.
 *
 * A lista é para o Mauricio AGIR, então cada linha traz o que ele precisa:
 * onde travou (coluna do quadro + status do formulário e da biometria), há
 * quanto tempo, e o contato do lojista para o caso de precisarem falar direto.
 *
 * Os dados do portal vêm da API pública de onboardings (chave própria), que
 * continua funcionando — o login por e-mail/senha foi desligado pela AIVA em
 * 26/10 e `retailer_performance` está inacessível desde então.
 *
 * Uso: node --env-file=.env.local scripts/lista-travados-mauricio.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const HOJE = '2026-11-09'
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const cnpj14 = (v) => { const d = dig(v); return d ? d.padStart(14, '0').slice(-14) : null }
const so10 = (d) => (d ? String(d).slice(0, 10) : '')
const diasAte = (d) => (d ? Math.round((new Date(HOJE) - new Date(String(d).slice(0, 10))) / 864e5) : null)

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

const [regs, leads] = await Promise.all([
  todos('sdr_registros_cnpj', 'cnpj,loja,telefone,tipo,status,rid,criado_em,enviado_em,origem,cidade,lead_id'),
  todos('sdr_leads', 'id,nome,telefone,status,observacoes,data_ultimo_contato'),
])
const onb = []
{
  let c = null
  do {
    const q = new URLSearchParams({ limit: '500' })
    if (c) q.set('cursor', c)
    const r = await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, {
      headers: { 'x-api-key': process.env.AIVA_PORTAL_API_KEY }, signal: AbortSignal.timeout(20_000),
    })
    const d = await r.json()
    onb.push(...(d.records ?? []))
    c = d.next_cursor ?? null
  } while (c)
}

// CNPJs que NÓS enviamos (um registro por CNPJ; matriz ganha do adicional)
const regPorCnpj = new Map()
for (const r of regs) {
  const c = cnpj14(r.cnpj); if (!c) continue
  const atual = regPorCnpj.get(c)
  if (!atual || (r.tipo === 'matriz' && atual.tipo !== 'matriz')) regPorCnpj.set(c, r)
}
const leadPorId = new Map(leads.map((l) => [l.id, l]))
const campo = (obs, nome) => {
  const bloco = String(obs ?? '').match(/\[DADOS_COLETADOS:([^\]]*)\]/)?.[1] ?? ''
  return bloco.split('|').find((p) => p.startsWith(nome + '='))?.slice(nome.length + 1)?.trim() || ''
}

// quem do mesmo grupo (raiz do CNPJ) JÁ é loja — muda a conversa: não é
// prospect parado, é filial de lojista que já opera.
const lojaPorRaiz = new Map()
for (const o of onb) {
  const c = cnpj14(o.cnpj)
  if (c && o.retailer_id) {
    const raiz = c.slice(0, 8)
    if (!lojaPorRaiz.has(raiz)) lojaPorRaiz.set(raiz, new Set())
    lojaPorRaiz.get(raiz).add(`${c} = retailer ${o.retailer_id}`)
  }
}

const ONDE = {
  dados_varejo: 'Formulário do varejo pendente',
  biometria_pendente: 'Biometria pendente',
  biometria_aprovada: 'Biometria aprovada, loja não criada',
  not_approved: 'Recusado pela AIVA',
  pre_cadastro: 'Pré-cadastro, ainda não aprovado',
  cadastro_finalizado: 'Cadastro finalizado SEM retailer ID',
  treinamento_agendado: 'Treinamento agendado, loja não criada',
}

// ⚠️ O mesmo CNPJ pode ter MAIS DE UM onboarding no portal (reenvio de
// pré-cadastro cria linha nova). Se qualquer um deles já virou loja, o CNPJ não
// está travado — olhar só o registro da vez infla a lista (581 em vez de 577).
const cnpjComLoja = new Set(onb.filter((o) => o.retailer_id).map((o) => cnpj14(o.cnpj)).filter(Boolean))
const jaListado = new Set()

const linhas = []
for (const o of onb) {
  const c = cnpj14(o.cnpj)
  if (!c) continue
  if (o.retailer_id || cnpjComLoja.has(c)) continue   // já virou loja — fora do recorte
  if (jaListado.has(c)) continue                      // um CNPJ, uma linha
  const reg = regPorCnpj.get(c)
  if (!reg) continue                     // não foi a Track que mandou
  jaListado.add(c)
  const lead = reg.lead_id ? leadPorId.get(reg.lead_id) : null
  const irmas = [...(lojaPorRaiz.get(c.slice(0, 8)) ?? [])]
  const diasPortal = diasAte(o.created_at)
  const diasNossos = diasAte(reg.enviado_em ?? reg.criado_em)
  linhas.push({
    ondeTravou: ONDE[o.board_column] ?? (o.board_column ?? '(sem coluna)'),
    quadro: o.board_column ?? '',
    cnpj: c,
    loja: o.retailer_name || o.legal_name || o.cnpj_official_name || reg.loja || lead?.nome || '',
    socio: campo(lead?.observacoes, 'nome_socio') || reg.loja || '',
    telefone: dig(reg.telefone || lead?.telefone || o.phone_number || ''),
    email: o.email || campo(lead?.observacoes, 'email_socio') || '',
    cidade: campo(lead?.observacoes, 'regiao_varejo') || reg.cidade || '',
    tipo: reg.tipo ?? '',
    formulario: o.formulario_status ?? '',
    biometria: o.biometry_status ?? '',
    preCadastroStatus: o.pre_cadastro_status ?? '',
    cnpjSituacao: o.cnpj_situacao ?? '',
    cnpjCheck: o.cnpj_check_status ?? '',
    criadoNoPortal: so10(o.created_at),
    diasNoPortal: diasPortal,
    naColunaDesde: so10(o.board_column_since),
    diasNaColuna: diasAte(o.board_column_since),
    enviadoPelaTrack: so10(reg.enviado_em ?? reg.criado_em),
    diasDesdeEnvio: diasNossos,
    primeiroAcesso: so10(o.primeiro_acesso_em),
    grupoJaELoja: irmas.length ? 'sim' : 'nao',
    irmasNaAiva: irmas.join(' · '),
    statusLead: lead?.status ?? '',
    ultimoContato: so10(lead?.data_ultimo_contato),
  })
}

// ordem: onde travou (maior grupo primeiro) e, dentro dele, quem espera há mais tempo
const tamanho = {}
for (const l of linhas) tamanho[l.ondeTravou] = (tamanho[l.ondeTravou] ?? 0) + 1
linhas.sort((a, b) => (tamanho[b.ondeTravou] - tamanho[a.ondeTravou])
  || a.ondeTravou.localeCompare(b.ondeTravou)
  || (b.diasNoPortal ?? 0) - (a.diasNoPortal ?? 0))

// ─────────── o grupo IRMÃO: mandamos e a AIVA nem abriu cadastro ───────────
// Pior que travar: o CNPJ não existe no portal em coluna nenhuma. Não dá para
// cobrar o lojista (ele não tem onde entrar) nem acompanhar — some.
const cnpjNoPortal = new Set(onb.map((o) => cnpj14(o.cnpj)).filter(Boolean))
const naoChegaram = []
for (const [c, reg] of regPorCnpj) {
  if (cnpjNoPortal.has(c)) continue
  const lead = reg.lead_id ? leadPorId.get(reg.lead_id) : null
  const irmas = [...(lojaPorRaiz.get(c.slice(0, 8)) ?? [])]
  naoChegaram.push({
    cnpj: c,
    loja: reg.loja || lead?.nome || '',
    socio: campo(lead?.observacoes, 'nome_socio'),
    telefone: dig(reg.telefone || lead?.telefone || ''),
    email: campo(lead?.observacoes, 'email_socio'),
    cidade: campo(lead?.observacoes, 'regiao_varejo') || reg.cidade || '',
    tipo: reg.tipo ?? '',
    statusRegistro: reg.status ?? '',
    origem: reg.origem ?? '',
    enviadoPelaTrack: so10(reg.enviado_em ?? reg.criado_em),
    diasDesdeEnvio: diasAte(reg.enviado_em ?? reg.criado_em),
    grupoJaELoja: irmas.length ? 'sim' : 'nao',
    irmasNaAiva: irmas.join(' · '),
    statusLead: lead?.status ?? '',
    ultimoContato: so10(lead?.data_ultimo_contato),
  })
}
naoChegaram.sort((a, b) => (b.diasDesdeEnvio ?? 0) - (a.diasDesdeEnvio ?? 0))

writeFileSync('scripts/out-travados-mauricio.json', JSON.stringify(linhas, null, 1))
writeFileSync('scripts/out-nao-chegaram-aiva.json', JSON.stringify(naoChegaram, null, 1))
console.log('\nmandamos e a AIVA NEM ABRIU CADASTRO: %d', naoChegaram.length)
console.log('   marcadas como "ativa" no nosso registro: %d', naoChegaram.filter((l) => l.statusRegistro === 'ativa').length)
console.log('   com lead em status de loja criada: %d', naoChegaram.filter((l) => ['TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO'].includes(l.statusLead)).length)

console.log('cadastros da Track no portal SEM retailer ID: %d', linhas.length)
console.log('\npor onde travou:')
for (const [k, v] of Object.entries(tamanho).sort((a, b) => b[1] - a[1])) console.log('   %s  %d', k.padEnd(40), v)
const f = (p) => linhas.filter(p).length
console.log('\nformulário: pendente %d | preenchido %d', f((l) => l.formulario === 'pending'), f((l) => l.formulario === 'completed'))
console.log('biometria: pendente %d | negada %d | outras %d', f((l) => l.biometria === 'pendente'), f((l) => l.biometria === 'negado'), f((l) => !['pendente', 'negado'].includes(l.biometria)))
console.log('CNPJ com situação ≠ ATIVA: %d', f((l) => l.cnpjSituacao && l.cnpjSituacao !== 'ATIVA'))
console.log('de grupo que já é loja na AIVA: %d', f((l) => l.grupoJaELoja === 'sim'))
console.log('com telefone do lojista: %d | com e-mail: %d', f((l) => l.telefone), f((l) => l.email))
const d = linhas.map((l) => l.diasNoPortal).filter((x) => x != null).sort((a, b) => a - b)
console.log('\nespera no portal: mediana %d dias | mais antigo %d dias', d[Math.floor(d.length / 2)], d[d.length - 1])
console.log('   0-30 %d | 31-60 %d | 61-90 %d | 90+ %d',
  d.filter((x) => x <= 30).length, d.filter((x) => x > 30 && x <= 60).length,
  d.filter((x) => x > 60 && x <= 90).length, d.filter((x) => x > 90).length)
console.log('\ndump: scripts/out-travados-mauricio.json')
setTimeout(() => process.exit(0), 500).unref()
