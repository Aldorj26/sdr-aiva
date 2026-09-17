/**
 * senha-pendente/route.ts (AIVA) — passo 6 da Fase 1 (Aldo 16/09/2026)
 *
 * A loja pediu o acesso à AIVA e a senha nunca saiu. O portal registra isso em
 * `login_sends` (permission_requested_at preenchido, credentials_sent_at nulo) e
 * ninguém olhava: em 16/09 eram 25 lojas, a mais antiga de 19/08. O lojista fica
 * esperando, a loja não opera e o card não anda.
 *
 * O cron cruza essas lojas com os nossos leads (RID do registro → CNPJ do
 * onboarding), avisa Nei + Aldo depois de 2 dias ÚTEIS sem senha (prazo do Edu,
 * 14/09), reavisa a cada 7 dias enquanto continuar pendente e marca o lead com
 * [SENHA_PENDENTE_DESDE] — a VictorIA usa isso quando o lojista cobra a senha
 * (bloco de fase em lib/claude.ts: não manda checar spam de um SMS que a AIVA
 * ainda não enviou). Quando a senha sai, o marcador é limpo sozinho.
 *
 * Não fala com o lojista: é alerta interno + contexto pra VictorIA.
 *
 * ⚠️ Loja SEM lead nosso (não casa por RID nem por CNPJ) entra no alerta do mesmo
 * jeito, mas a memória do aviso não cabe em observacoes — vai pra
 * `sdr_avisos_chave` (chave "senha_pendente:<rid>"). Sem isso ela voltava no
 * digest TODO dia útil: era o caso do RID 6413 desde 16/09 (achado de 17/09).
 *
 * Regras puras: lib/senha-pendente-calc.ts (`npm run test:senha`).
 * Params: ?dry (aceita 1/true/sim — lib/req-flags)
 * Schedule (vercel.json): `0 14 * * 1-5` UTC = 11h BRT, seg–sex. GET obrigatório.
 */
import { NextRequest, NextResponse } from 'next/server'
import { alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { loginPortal, listarSenhasPendentes, onboardingsPorRetailer } from '@/lib/portal-aiva'
import { decidir, lerPendenteDesde, lerUltimoAviso, linhaAlerta, remontarObs, DIAS_UTEIS_PRAZO } from '@/lib/senha-pendente-calc'
import { flag } from '@/lib/req-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const soDigitos = (c: unknown) => String(c ?? '').replace(/\D/g, '')
const brt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

async function executar(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dry = flag(new URL(req.url).searchParams, 'dry')
  const agora = Date.now()

  // 1) portal: quem pediu acesso e não recebeu senha
  let pendentes, porRetailer
  try {
    const s = await loginPortal()
    pendentes = await listarSenhasPendentes(s)
    porRetailer = await onboardingsPorRetailer(s)
  } catch (e) {
    return NextResponse.json({ ok: false, erro: `portal: ${String(e).slice(0, 160)}` }, { status: 502 })
  }
  // uma linha por loja: fica o pedido MAIS ANTIGO de cada retailer
  const porRid = new Map<string, string>()
  for (const p of pendentes) {
    const rid = String(p.retailer_id)
    const atual = porRid.get(rid)
    if (!atual || p.permission_requested_at < atual) porRid.set(rid, p.permission_requested_at)
  }

  // 2) nossos leads: por RID do registro, com fallback pelo CNPJ do onboarding
  const { data: regs } = await supabaseAdmin.from('sdr_registros_cnpj').select('lead_id, cnpj, rid').not('lead_id', 'is', null)
  const leadPorRid = new Map<string, { leadId: string; cnpj: string }>()
  const leadPorCnpj = new Map<string, string>()
  for (const r of regs ?? []) {
    const cnpj = soDigitos(r.cnpj)
    if (r.rid) leadPorRid.set(String(r.rid), { leadId: r.lead_id!, cnpj })
    if (cnpj) leadPorCnpj.set(cnpj, r.lead_id!)
  }
  type Alvo = { rid: string; pedido: string; leadId: string | null; cnpj: string | null; loja: string }
  const alvos: Alvo[] = []
  for (const [rid, pedido] of porRid) {
    const onb = porRetailer.get(rid)
    const cnpj = onb ? soDigitos(onb.cnpj) : null
    const leadId = leadPorRid.get(rid)?.leadId ?? (cnpj ? leadPorCnpj.get(cnpj) ?? null : null)
    alvos.push({ rid, pedido, leadId, cnpj, loja: onb?.legal_name ?? `RID ${rid}` })
  }

  const ids = alvos.map((a) => a.leadId).filter((x): x is string => !!x)
  const { data: leads } = ids.length
    ? await supabaseAdmin.from('sdr_leads').select('id, nome, telefone, observacoes').in('id', ids)
    : { data: [] }
  const leadDe = (id: string | null) => (id ? (leads ?? []).find((l) => l.id === id) ?? null : null)

  // 2b) memória das lojas SEM lead nosso.
  //     O marcador [SENHA_PENDENTE_AVISO] mora em sdr_leads.observacoes; sem lead
  //     não há onde gravar, e até 17/09/2026 essas lojas voltavam no alerta TODO
  //     dia útil (era o caso do RID 6413, avisado desde 16/09). A regra de reaviso
  //     de 7 dias agora vale pra elas também, guardada em sdr_avisos_chave.
  const chaveDe = (rid: string) => `senha_pendente:${rid}`
  const ridsSemLead = alvos.filter((a) => !leadDe(a.leadId)).map((a) => chaveDe(a.rid))
  const avisoPorChave = new Map<string, number>()
  if (ridsSemLead.length) {
    const { data: memoria } = await supabaseAdmin.from('sdr_avisos_chave').select('chave, ultimo_aviso').in('chave', ridsSemLead)
    for (const m of memoria ?? []) {
      const ms = Date.parse(m.ultimo_aviso)
      if (Number.isFinite(ms)) avisoPorChave.set(m.chave, ms)
    }
  }

  // 3) decisão por loja
  const avisar: Array<{ alvo: Alvo; diasUteis: number; reaviso: boolean }> = []
  const semLead: string[] = []
  let silenciosos = 0
  for (const a of alvos) {
    const lead = leadDe(a.leadId)
    if (!lead) { semLead.push(`${a.loja} (RID ${a.rid})`) }
    const avisoMs = lead ? lerUltimoAviso(lead.observacoes) : avisoPorChave.get(chaveDe(a.rid)) ?? null
    const d = decidir({ pedidoMs: Date.parse(a.pedido), avisoMs }, agora)
    if (d.acao === 'nada') { silenciosos++; continue }
    avisar.push({ alvo: a, diasUteis: d.diasUteis, reaviso: d.acao === 'reavisar' })
  }
  avisar.sort((x, y) => y.diasUteis - x.diasUteis)

  // 4) quem JÁ recebeu a senha perde o marcador (o espelho move o card pra Login)
  const ridsPendentes = new Set(porRid.keys())
  const { data: marcados } = await supabaseAdmin.from('sdr_leads').select('id, nome, observacoes').like('observacoes', '%[SENHA_PENDENTE_DESDE:%')
  const resolvidos = (marcados ?? []).filter((m) => {
    const reg = (regs ?? []).find((r) => r.lead_id === m.id && r.rid && ridsPendentes.has(String(r.rid)))
    return !reg
  })

  const resumo = {
    pendentes_portal: porRid.size,
    sem_lead_nosso: semLead.length,
    avisar: avisar.length,
    reavisos: avisar.filter((a) => a.reaviso).length,
    dentro_do_prazo: silenciosos,
    resolvidos: resolvidos.length,
  }
  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, ...resumo,
      lista: avisar.map((a) => ({ loja: a.alvo.loja, rid: a.alvo.rid, cnpj: a.alvo.cnpj, dias_uteis: a.diasUteis, pedido: brt(a.alvo.pedido), lead: leadDe(a.alvo.leadId)?.nome ?? null, reaviso: a.reaviso })),
      sem_lead: semLead.slice(0, 20),
      resolvidos_nomes: resolvidos.map((r) => r.nome).slice(0, 20),
    })
  }

  // 5) marca os leads (pendente desde / aviso de agora) e limpa os resolvidos
  const agoraISO = new Date().toISOString()
  for (const a of avisar) {
    const lead = leadDe(a.alvo.leadId)
    if (!lead) {
      // sem lead: a memória do aviso vai pra tabela de chaves (senão reavisa todo dia)
      await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave: chaveDe(a.alvo.rid), ultimo_aviso: agoraISO }, { onConflict: 'chave' })
      continue
    }
    const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
    await supabaseAdmin.from('sdr_leads')
      .update({ observacoes: remontarObs(fresco?.observacoes ?? lead.observacoes, { desde: new Date(a.alvo.pedido).toISOString(), aviso: agoraISO }) })
      .eq('id', lead.id)
  }
  // senha chegou → a chave some junto com o pendente (o próximo pedido começa limpo).
  // Varre TODAS as chaves do assunto, não só as carregadas: quem saiu da lista de
  // pendentes não aparece em `alvos` e nunca seria lido de volta.
  {
    const { data: todas } = await supabaseAdmin.from('sdr_avisos_chave').select('chave').like('chave', 'senha_pendente:%')
    const vivas = new Set(alvos.map((a) => chaveDe(a.rid)))
    const mortas = (todas ?? []).map((r) => r.chave).filter((k) => !vivas.has(k))
    if (mortas.length) await supabaseAdmin.from('sdr_avisos_chave').delete().in('chave', mortas)
  }
  for (const r of resolvidos) {
    const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', r.id).maybeSingle()
    await supabaseAdmin.from('sdr_leads').update({ observacoes: remontarObs(fresco?.observacoes ?? r.observacoes, { limpar: true }) }).eq('id', r.id)
  }

  // 6) digest ao time
  if (avisar.length) {
    const linhas = avisar.map((a) => linhaAlerta({
      loja: a.alvo.loja, telefone: leadDe(a.alvo.leadId)?.telefone ?? null, cnpj: a.alvo.cnpj, rid: a.alvo.rid, diasUteis: a.diasUteis, pedidoBrt: brt(a.alvo.pedido),
    }))
    const novos = avisar.filter((a) => !a.reaviso).length
    const texto =
      `🔑 *SENHA NÃO ENVIADA PELA AIVA — ${avisar.length} loja(s)*\n` +
      `(acesso solicitado e senha ainda não saiu; prazo do Edu é ${DIAS_UTEIS_PRAZO} dias úteis)\n` +
      `${novos} nova(s) · ${avisar.length - novos} já avisada(s) antes\n\n` +
      linhas.slice(0, 25).join('\n') + (linhas.length > 25 ? `\n… +${linhas.length - 25}` : '') +
      `\n\nCobrar no Live Chat da AIVA. Reaviso a cada 7 dias enquanto continuar pendente.`
    for (const tel of [process.env.NEI_WHATSAPP, process.env.ALDO_WHATSAPP].filter(Boolean) as string[]) {
      try { await alertHuman(tel, texto) } catch (e) { console.error('[senha-pendente] alerta falhou:', e) }
    }
  }

  console.log(`[senha-pendente] portal=${porRid.size} avisados=${avisar.length} resolvidos=${resolvidos.length} sem_lead=${semLead.length}`)
  return NextResponse.json({ ok: true, ...resumo })
}

export const GET = executar
export const POST = executar
