/**
 * fase3-destravada/route.ts (AIVA) — item 2 do plano de 18/09/2026 (Aldo)
 *
 * O PROBLEMA (diagnóstico de 17/09): a conclusão da Fase 3 mora DENTRO do
 * webhook e só é avaliada quando chega mensagem do lojista. Se uma regra muda e
 * passa a desbloquear quem já parou de falar, esse lead fica preso pra sempre —
 * o turno que destravaria nunca vem.
 *
 * Foi exatamente o que aconteceu com o corte de 16/09 (12 → 7 campos): 6 leads
 * tinham dado o e-mail e sumido no faturamento, que deixou de ser obrigatório.
 * A conclusão nunca rodou, o CNPJ nunca chegou ao /registros e eles ficaram de
 * 20 a 57 dias em Cadastro Recebido esperando uma ação que ninguém sabia existir.
 *
 * ESTE CRON é a rede de segurança: varre quem JÁ satisfaz os campos obrigatórios
 * de hoje e nunca teve a conclusão rodada ([CAD_ALERTADO] ausente), cria o
 * registro do CNPJ que faltou e avisa o time UMA vez.
 *
 * ⚠️ NÃO finge a conclusão completa (HubSpot, planilha, mudança de status): isso
 * é do webhook, com a trava atômica dele. Aqui a gente só destrava o que impede o
 * Nei de trabalhar — o CNPJ no painel — e põe o caso na frente de um humano.
 *
 * Marcador: [FASE3_DESTRAVADA:ISO] — idempotente, avisa uma vez por lead.
 * Params: ?dry
 * Schedule (vercel.json): `0 19 * * 1-5` UTC = 16h BRT, seg–sex. GET obrigatório.
 */
import { NextRequest, NextResponse } from 'next/server'
import { alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { flag } from '@/lib/req-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Os mesmos campos que o webhook exige hoje (camposObrigatorios, pós-corte 16/09). */
const OBRIGATORIOS = ['nome_socio', 'email_socio', 'telefone_socio', 'nome_varejo', 'cnpj_matriz', 'numero_lojas'] as const
/** Status em que ainda faz sentido concluir. Pós-cadastro já passou disso. */
const ATIVOS = ['INTERESSADO', 'AGUARDANDO', 'CADASTRO_RECEBIDO', 'PRE_APROVACAO']
const MARCADOR = 'FASE3_DESTRAVADA'

const soDigitos = (c: unknown) => String(c ?? '').replace(/\D/g, '')
const extrairCnpjs = (txt: unknown): string[] =>
  [...String(txt ?? '').matchAll(/\d[\d./-]{12,}\d/g)].map((m) => m[0].replace(/\D/g, '')).filter((c) => c.length === 14)

function parseDados(obs: string | null): Record<string, string> {
  const m = (obs ?? '').match(/\[DADOS_COLETADOS:([^\]]*)\]/)
  if (!m) return {}
  const d: Record<string, string> = {}
  for (const par of m[1].split('|')) {
    const i = par.indexOf('=')
    if (i > 0) d[par.slice(0, i).trim()] = par.slice(i + 1).trim()
  }
  return d
}

async function executar(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dry = flag(new URL(req.url).searchParams, 'dry')

  // paginado: o PostgREST corta em 1.000 e a base passa de 8.400 leads
  type Lead = { id: string; nome: string | null; telefone: string; status: string; observacoes: string | null }
  const leads: Lead[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabaseAdmin
      .from('sdr_leads').select('id, nome, telefone, status, observacoes')
      .in('status', ATIVOS).order('criado_em', { ascending: true }).range(de, de + 999)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    leads.push(...((data ?? []) as Lead[]))
    if (!data || data.length < 1000) break
  }

  const presos = leads.filter((l) => {
    const obs = l.observacoes ?? ''
    if (obs.includes('[CAD_ALERTADO]')) return false          // a conclusão já rodou
    const d = parseDados(l.observacoes)
    return OBRIGATORIOS.every((k) => String(d[k] ?? '').trim())
  })
  const novos = presos.filter((l) => !(l.observacoes ?? '').includes(`[${MARCADOR}:`))

  // CNPJs que deveriam estar no /registros
  const acriar: Array<{ lead_id: string; loja: string | null; telefone: string; cnpj: string; tipo: string; status: string }> = []
  for (const l of presos) {
    const d = parseDados(l.observacoes)
    const matriz = extrairCnpjs(d.cnpj_matriz)
    const adicionais = extrairCnpjs(d.cnpjs_adicionais).filter((c) => !matriz.includes(c))
    const { data: jaTem } = await supabaseAdmin.from('sdr_registros_cnpj').select('cnpj').eq('lead_id', l.id)
    const existentes = new Set((jaTem ?? []).map((r) => soDigitos(r.cnpj)))
    for (const [cnpj, tipo] of [...matriz.map((c) => [c, 'matriz'] as const), ...adicionais.map((c) => [c, 'adicional'] as const)]) {
      if (!existentes.has(cnpj)) acriar.push({ lead_id: l.id, loja: l.nome, telefone: l.telefone, cnpj, tipo, status: 'informada' })
    }
  }

  const resumo = { ativos: leads.length, presos: presos.length, novos: novos.length, registros_a_criar: acriar.length }
  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, ...resumo,
      lista: presos.slice(0, 30).map((l) => ({ loja: l.nome, telefone: l.telefone, status: l.status, ja_avisado: (l.observacoes ?? '').includes(`[${MARCADOR}:`) })),
    })
  }

  if (acriar.length) {
    const { error } = await supabaseAdmin.from('sdr_registros_cnpj').upsert(acriar, { onConflict: 'lead_id,cnpj', ignoreDuplicates: true })
    if (error) console.error('[fase3-destravada] registros não criados:', error.message)
  }

  const agoraISO = new Date().toISOString()
  for (const l of novos) {
    const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', l.id).maybeSingle()
    const obs = (fresco?.observacoes ?? l.observacoes ?? '').replace(new RegExp(`\\s*\\[${MARCADOR}:[^\\]]*\\]`, 'g'), '').trim()
    await supabaseAdmin.from('sdr_leads').update({ observacoes: `${obs} [${MARCADOR}:${agoraISO}]`.trim() }).eq('id', l.id)
  }

  if (novos.length) {
    const texto =
      `🔓 *CADASTRO COMPLETO QUE NÃO FECHOU SOZINHO* (${novos.length} loja(s))\n\n` +
      novos.slice(0, 20).map((l) => `• ${l.nome} (${l.telefone}) — ${l.status}`).join('\n') +
      (novos.length > 20 ? `\n… +${novos.length - 20}` : '') +
      `\n\nEsses leads já têm TODOS os dados obrigatórios, mas a conclusão nunca rodou — ` +
      `ela só é avaliada quando o lojista manda mensagem, e eles pararam de falar.\n` +
      `Os CNPJs deles já foram colocados no painel pra lançar: https://sdr-aiva.vercel.app/registros`
    for (const tel of [process.env.NEI_WHATSAPP, process.env.ALDO_WHATSAPP].filter(Boolean) as string[]) {
      try { await alertHuman(tel, texto) } catch (e) { console.error('[fase3-destravada] aviso falhou:', e) }
    }
  }

  console.log(`[fase3-destravada] presos=${presos.length} novos=${novos.length} registros=${acriar.length}`)
  return NextResponse.json({ ok: true, ...resumo })
}

export const GET = executar
export const POST = executar
