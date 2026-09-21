/**
 * Etapa LOGIN × sistema da AIVA: quem já recebeu a senha do sócio, quem não.
 * Só LÊ. Uso: npx tsx --env-file=.env.local scripts/login-conferencia-2026-09-21.mts
 */
import fs from 'node:fs'
import { supabaseAdmin } from '../lib/supabase'
import { loginPortal, rest, listarOnboardingsApi } from '../lib/portal-aiva'
import { getPipeOpportunities } from '../lib/evotalks'

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const DIA = 86400000

// 1) nossos leads em LOGIN + cards na etapa 71
const { data: leads } = await supabaseAdmin.from('sdr_leads')
  .select('id,nome,telefone,status,acionar_humano,observacoes,evotalks_opportunity_id,data_ultimo_contato')
  .eq('status', 'LOGIN')
const opps = await getPipeOpportunities(15)
const stageDe = new Map(opps.map((o) => [Number(o.id), Number(o.fkStage)]))
const cards71 = opps.filter((o) => Number(o.fkStage) === 71).length

const ids = (leads ?? []).map((l) => l.id)
const { data: regs } = await supabaseAdmin.from('sdr_registros_cnpj').select('lead_id,cnpj,rid,status,tipo').in('lead_id', ids)
const regDe = new Map<string, { cnpj: string; rid: string | null; status: string | null }[]>()
for (const r of regs ?? []) { if (!regDe.has(r.lead_id!)) regDe.set(r.lead_id!, []); regDe.get(r.lead_id!)!.push({ cnpj: so(r.cnpj), rid: r.rid ? String(r.rid) : null, status: r.status }) }

// última mensagem do lojista
const ultimaIn = new Map<string, string>()
for (let i = 0; i < ids.length; i += 100) {
  const { data } = await supabaseAdmin.from('sdr_mensagens').select('lead_id,enviado_em,conteudo').in('lead_id', ids.slice(i, i + 100)).eq('direcao', 'in').order('enviado_em', { ascending: false })
  for (const m of data ?? []) if (!ultimaIn.has(m.lead_id)) ultimaIn.set(m.lead_id, m.enviado_em)
}

// 2) portal
const s = await loginPortal()
const { data: ls } = await rest<any[]>(s, 'login_sends?select=retailer_id,store_id,permission_requested_at,credentials_sent_at&order=credentials_sent_at.desc')
const { data: pr } = await rest<any[]>(s, 'password_resends?select=retailer_id,sent_at,sent_phone,sent_by&order=sent_at.desc')
const { data: perf } = await rest<any[]>(s, 'retailer_performance?select=retailer_id,total_sales,sales_count&limit=2000').catch(() => ({ data: [] as any[] }))
const onbs = await listarOnboardingsApi()
const onbPorRid = new Map(onbs.filter((o) => o.retailer_id != null).map((o) => [String(o.retailer_id), o]))
const onbPorCnpj = new Map(onbs.map((o) => [so(o.cnpj), o]))
const lsPorRid = new Map<string, any[]>()
for (const l of ls ?? []) { const k = String(l.retailer_id); if (!lsPorRid.has(k)) lsPorRid.set(k, []); lsPorRid.get(k)!.push(l) }
const prPorRid = new Map<string, any[]>()
for (const p of pr ?? []) { const k = String(p.retailer_id); if (!prPorRid.has(k)) prPorRid.set(k, []); prPorRid.get(k)!.push(p) }
const vendeu = new Set((perf ?? []).filter((p) => Number(p.sales_count ?? p.total_sales ?? 0) > 0).map((p) => String(p.retailer_id)))

const hoje = Date.now()
const linhas = (leads ?? []).map((l) => {
  const rs = regDe.get(l.id) ?? []
  const matriz = rs.find((r) => r.rid) ?? rs[0]
  const rid = (matriz?.rid ?? (matriz ? String(onbPorCnpj.get(matriz.cnpj)?.retailer_id ?? '') : '')) || ''
  const onb = rid ? onbPorRid.get(rid) : (matriz ? onbPorCnpj.get(matriz.cnpj) : undefined)
  const sends = rid ? (lsPorRid.get(rid) ?? []) : []
  const enviado = sends.find((x) => x.credentials_sent_at)
  const pedido = sends[0]
  const reenvios = rid ? (prPorRid.get(rid) ?? []) : []
  const obs = l.observacoes ?? ''
  const etapa = l.evotalks_opportunity_id ? stageDe.get(Number(l.evotalks_opportunity_id)) : null
  const ult = ultimaIn.get(l.id)
  const telAiva = so(onb?.phone_number)
  const situacao =
    !rid ? 'SEM RID — loja não existe na AIVA (não tem como ter login)'
    : enviado ? 'SENHA ENVIADA'
    : pedido ? 'PEDIDO FEITO, SENHA NÃO ENVIADA'
    : 'SEM PEDIDO DE ACESSO no portal'
  return {
    Loja: l.nome, Telefone: l.telefone, CNPJ: matriz?.cnpj ?? '', RID: rid,
    'Etapa do card': etapa === 71 ? 'Login (71)' : etapa ? String(etapa) : '(sem card)',
    'Situação na AIVA': situacao,
    'Pedido de acesso': pedido?.permission_requested_at?.slice(0, 10) ?? '',
    'Senha enviada em': enviado?.credentials_sent_at?.slice(0, 10) ?? '',
    'Dias desde o envio': enviado ? Math.floor((hoje - Date.parse(enviado.credentials_sent_at)) / DIA) : '',
    'Reenvios': reenvios.length,
    'Último reenvio': reenvios[0]?.sent_at?.slice(0, 10) ?? '',
    'Reenvio por': reenvios[0] ? (reenvios[0].sent_by ? 'painel (Nei)' : 'VictorIA') : '',
    'Tel. cadastro AIVA': telAiva,
    'Tel. diferente da conversa': telAiva && telAiva !== so(l.telefone) ? 'SIM' : '',
    'Já vendeu': rid && vendeu.has(rid) ? 'SIM' : '',
    'Stage portal': onb?.stage ?? '',
    'Última msg do lojista': ult?.slice(0, 10) ?? '',
    'Silêncio (dias)': ult ? Math.floor((hoje - Date.parse(ult)) / DIA) : '',
    'Fila humana': l.acionar_humano ? 'SIM' : '',
    'Marcadores': ['SENHA_ENVIADA', 'SENHA_PENDENTE_DESDE', 'SENHA_REENVIADA', 'CHECK_TREINAMENTO_ESGOTADO'].filter((m) => obs.includes(`[${m}`)).join(' '),
  }
})
fs.writeFileSync('scripts/out-login-conferencia.json', JSON.stringify({ cards71, linhas }, null, 1), 'utf8')
const c = (f: (x: any) => boolean) => linhas.filter(f).length
console.log(`leads em LOGIN: ${linhas.length} · cards na etapa 71: ${cards71}`)
console.log('SENHA ENVIADA:', c((x) => x['Situação na AIVA'] === 'SENHA ENVIADA'))
console.log('PEDIDO FEITO, NÃO ENVIADA:', c((x) => x['Situação na AIVA'].startsWith('PEDIDO')))
console.log('SEM PEDIDO:', c((x) => x['Situação na AIVA'].startsWith('SEM PEDIDO')))
console.log('SEM RID:', c((x) => x['Situação na AIVA'].startsWith('SEM RID')))
console.log('já vendeu (mas está em LOGIN):', c((x) => x['Já vendeu'] === 'SIM'))
console.log('tel. cadastro ≠ conversa:', c((x) => x['Tel. diferente da conversa'] === 'SIM'))
console.log('com reenvio:', c((x) => x['Reenvios'] > 0))
