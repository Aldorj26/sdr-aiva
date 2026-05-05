import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPipeOpportunities, alertHuman, PIPELINE_AIVA, STAGES } from '@/lib/evotalks'
import { isDiaUtil, rotuloHorario } from '@/lib/business-time'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Auditoria diária — cruza estado dos leads no Supabase com oportunidades
 * abertas no CRM Evo Talks pra detectar desincronização.
 *
 * Roda 1x/dia (madrugada). Quando acha discrepância: SÓ LOGA + alerta Aldo
 * via WhatsApp. Não auto-corrige nada — primeira rodada vai ter MUITA
 * discrepância acumulada e auto-correção em massa é arriscada.
 *
 * Discrepâncias detectadas:
 *   1. Lead INTERESSADO/AGUARDANDO/FORMULARIO_ENVIADO no Supabase
 *      mas opp no CRM está em SEM_RESPOSTA / BOT_DETECTADO / fechada.
 *   2. Lead FORMULARIO_ENVIADO no Supabase mas SEM opp aberta no CRM.
 *   3. Opp aberta no CRM (pipeline 15) com mainphone mas sem lead no Supabase.
 *
 * Auth: Bearer WEBHOOK_SECRET (igual outros crons)
 * Cron Vercel: agendar 1x/dia em vercel.json (sugerido 8h UTC = 5h BRT)
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const ts = new Date().toISOString()

  // Skip silencioso em fim de semana — auditoria so roda em dia util
  // (operacao Track e seg-sex; rodar dom/sab so polui WhatsApp do Aldo)
  if (!isDiaUtil()) {
    console.log(`[auditoria] skip: ${rotuloHorario()} (fim de semana)`)
    return NextResponse.json({ ok: true, ts, ignorado: 'fim_de_semana', quando: rotuloHorario() })
  }

  // 1. Pega oportunidades abertas no Evo Talks (pipeline 15 = Campanha AIVA)
  let opps
  try {
    opps = await getPipeOpportunities(PIPELINE_AIVA)
  } catch (err) {
    return NextResponse.json(
      { ok: false, ts, error: 'evotalks_unreachable', detail: String(err) },
      { status: 503 },
    )
  }

  // Index por telefone (limpo) — facilita lookup
  const oppByPhone = new Map<string, typeof opps[number]>()
  for (const o of opps) {
    const phone = (o.mainphone ?? '').replace(/\D/g, '')
    if (phone) oppByPhone.set(phone, o)
  }

  // 2. Pega leads "ativos" no Supabase
  const { data: leads, error: dbErr } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, evotalks_opportunity_id, criado_em')
    .in('status', ['INTERESSADO', 'AGUARDANDO', 'FORMULARIO_ENVIADO', 'DISPARO_REALIZADO'])

  if (dbErr) {
    return NextResponse.json({ ok: false, ts, error: 'supabase', detail: dbErr.message }, { status: 500 })
  }

  const leadsAtivos = leads ?? []

  // 3. Cruzamento — encontra discrepâncias
  const stageDead = new Set<number>([
    STAGES.SEM_RESPOSTA,
    STAGES.BOT_DETECTADO,
  ])

  type Discrepancia = {
    tipo:
      | 'opp_morta_lead_vivo'
      | 'lead_formulario_sem_opp'
      | 'opp_orfa'
      | 'zona_morta_aguardando_aprovacao'
      | 'zona_morta_cadastro_completo'
    leadId?: string
    nome?: string
    telefone?: string
    statusLead?: string
    oppId?: number
    oppStage?: number
    horasParado?: number
  }
  const discrepancias: Discrepancia[] = []

  // 3a. Leads "vivos" cuja opp já tá morta no CRM
  for (const lead of leadsAtivos) {
    const phone = (lead.telefone ?? '').replace(/\D/g, '')
    const opp = oppByPhone.get(phone)
    if (!opp) {
      // 3b. Lead em FORMULARIO_ENVIADO mas sem opp aberta no CRM
      if (lead.status === 'FORMULARIO_ENVIADO') {
        discrepancias.push({
          tipo: 'lead_formulario_sem_opp',
          leadId: lead.id,
          nome: lead.nome,
          telefone: lead.telefone,
          statusLead: lead.status,
        })
      }
      continue
    }
    if (stageDead.has(opp.fkStage)) {
      discrepancias.push({
        tipo: 'opp_morta_lead_vivo',
        leadId: lead.id,
        nome: lead.nome,
        telefone: lead.telefone,
        statusLead: lead.status,
        oppId: opp.id,
        oppStage: opp.fkStage,
      })
    }
  }

  // 3c. Opps órfãs — abertas no CRM, telefone sem lead correspondente
  const phonesLead = new Set(leadsAtivos.map((l) => (l.telefone ?? '').replace(/\D/g, '')))
  // Também checa leads "encerrados" pra evitar falso positivo
  const { data: leadsTodos } = await supabaseAdmin
    .from('sdr_leads')
    .select('telefone')
  for (const l of leadsTodos ?? []) {
    phonesLead.add((l.telefone ?? '').replace(/\D/g, ''))
  }
  for (const [phone, opp] of oppByPhone) {
    if (!phonesLead.has(phone)) {
      discrepancias.push({
        tipo: 'opp_orfa',
        telefone: phone,
        oppId: opp.id,
        oppStage: opp.fkStage,
      })
    }
  }

  // 3d. Zona morta — leads parados aguardando ação manual do time
  //   AGUARDANDO_APROVACAO > 48h → Eduardo não aprovou/reprovou ainda
  //   CADASTRO_COMPLETO    >  6h → Nei não moveu pra Em Análise CAF ainda
  const limite48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const limite6h = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

  const { data: leadsZonaMorta } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, data_ultimo_contato')
    .or(
      `and(status.eq.AGUARDANDO_APROVACAO,data_ultimo_contato.lt.${limite48h}),` +
      `and(status.eq.CADASTRO_COMPLETO,data_ultimo_contato.lt.${limite6h})`
    )
    .order('data_ultimo_contato', { ascending: true })

  for (const lead of leadsZonaMorta ?? []) {
    const msParado = Date.now() - new Date(lead.data_ultimo_contato).getTime()
    const horasParado = Math.floor(msParado / (1000 * 60 * 60))
    discrepancias.push({
      tipo: lead.status === 'AGUARDANDO_APROVACAO'
        ? 'zona_morta_aguardando_aprovacao'
        : 'zona_morta_cadastro_completo',
      leadId: lead.id,
      nome: lead.nome,
      telefone: lead.telefone,
      statusLead: lead.status,
      horasParado,
    })
  }

  // 4. Alerta Aldo + Nei se houver discrepância
  const aldoNumber = process.env.ALDO_WHATSAPP
  const neiNumber = process.env.NEI_WHATSAPP
  let alertaEnviado = false

  if (discrepancias.length > 0) {
    const cnt = {
      opp_morta_lead_vivo: discrepancias.filter((d) => d.tipo === 'opp_morta_lead_vivo').length,
      lead_formulario_sem_opp: discrepancias.filter((d) => d.tipo === 'lead_formulario_sem_opp').length,
      opp_orfa: discrepancias.filter((d) => d.tipo === 'opp_orfa').length,
      zona_morta_aguardando: discrepancias.filter((d) => d.tipo === 'zona_morta_aguardando_aprovacao').length,
      zona_morta_cadastro: discrepancias.filter((d) => d.tipo === 'zona_morta_cadastro_completo').length,
    }

    // Mensagem geral pra Aldo (discrepâncias CRM + zona morta)
    if (aldoNumber) {
      const linhas = [`[Auditoria SDR AIVA] ${discrepancias.length} divergência(s) encontradas:`]
      if (cnt.opp_morta_lead_vivo) linhas.push(`- ${cnt.opp_morta_lead_vivo} leads ativos com opp morta no CRM`)
      if (cnt.lead_formulario_sem_opp) linhas.push(`- ${cnt.lead_formulario_sem_opp} leads FORMULARIO_ENVIADO sem opp`)
      if (cnt.opp_orfa) linhas.push(`- ${cnt.opp_orfa} opps no CRM sem lead correspondente`)
      if (cnt.zona_morta_aguardando) linhas.push(`- ${cnt.zona_morta_aguardando} leads em AGUARDANDO_APROVACAO há mais de 48h (Eduardo não agiu)`)
      if (cnt.zona_morta_cadastro) linhas.push(`- ${cnt.zona_morta_cadastro} leads com CADASTRO_COMPLETO há mais de 6h (Nei não moveu pro CRM)`)
      const r = await alertHuman(aldoNumber, linhas.join('\n'))
      alertaEnviado = r.ok
    }

    // Alerta específico pra Nei sobre leads em zona morta que precisam de ação manual
    const zonaMortaNei: Discrepancia[] = discrepancias.filter(
      (d) => d.tipo === 'zona_morta_aguardando_aprovacao' || d.tipo === 'zona_morta_cadastro_completo'
    )
    if (zonaMortaNei.length > 0 && neiNumber) {
      const aguardando = zonaMortaNei.filter((d) => d.tipo === 'zona_morta_aguardando_aprovacao')
      const cadastro = zonaMortaNei.filter((d) => d.tipo === 'zona_morta_cadastro_completo')

      const linhasNei: string[] = [`⚠️ *Ação necessária — leads parados:*`]

      if (aguardando.length > 0) {
        linhasNei.push(`\n📋 *Aguardando aprovação Eduardo (${aguardando.length}):*`)
        for (const d of aguardando.slice(0, 5)) {
          linhasNei.push(`- ${d.nome} (${d.telefone}) — ${d.horasParado}h parado`)
        }
        if (aguardando.length > 5) linhasNei.push(`  ...e mais ${aguardando.length - 5}`)
      }

      if (cadastro.length > 0) {
        linhasNei.push(`\n✅ *Cadastro completo — mover p/ Em Análise CAF (${cadastro.length}):*`)
        for (const d of cadastro.slice(0, 5)) {
          linhasNei.push(`- ${d.nome} (${d.telefone}) — ${d.horasParado}h parado`)
        }
        if (cadastro.length > 5) linhasNei.push(`  ...e mais ${cadastro.length - 5}`)
      }

      try {
        await alertHuman(neiNumber, linhasNei.join('\n'))
      } catch (err) {
        console.error('[auditoria] falha ao alertar Nei sobre zona morta:', err)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ts,
    leadsAtivos: leadsAtivos.length,
    oppsAbertas: opps.length,
    discrepancias,
    zonaMorta: (leadsZonaMorta ?? []).length,
    alertaEnviado,
  })
}

// Vercel cron envia GET — aceita os dois
export async function GET(req: NextRequest) {
  return POST(req)
}
