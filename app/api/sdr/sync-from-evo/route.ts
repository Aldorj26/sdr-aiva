/**
 * sync-from-evo/route.ts
 *
 * Cron diário de backup: sincroniza Supabase com o estado atual do funil
 * Evo Talks AIVA (pipeline 15). Evo é a fonte da verdade.
 *
 * Pra cada opp aberta no Evo, busca o lead correspondente no Supabase e
 * atualiza o status. Também migra leads em status legacy (caso algum tenha
 * escapado dos refactor anteriores).
 *
 * Real-time: o webhook /opportunity-stage cobre 99% dos casos quando alguém
 * move card no kanban. Esse cron é a "rede de segurança" pra 1% que escapa
 * (falha de rede, deploy, bug, etc).
 *
 * Schedule: diário 7h BRT (antes dos crons da cadência às 10h+).
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isDiaUtil, rotuloHorario } from '@/lib/business-time'
import { statusFromOpp } from '@/lib/evotalks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const EVO_BASE = process.env.EVO_TALKS_BASE_URL!
const QUEUE_ID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const GLOBAL_KEY = process.env.EVO_TALKS_GLOBAL_API_KEY ?? '2e8a5e207d7ea31ce4cd4430d3ee7c98'
const PIPELINE_AIVA = 15
// Pipeline de lojas ativas / pós-venda — gerido 100% manual no Evo, SEPARADO
// da campanha. Leads que migram pra cá saem do controle do SDR (deletados do
// Supabase). Decisão de Aldo em 29/05/2026: não misturar pipeline 19 com o 15.
const PIPELINE_POSVENDA = 19

// Stage Evo → Status Supabase: mapa compartilhado em lib/evotalks.ts
// (usado também pela checagem em tempo real do webhook).

// Status legacy → novos (caso algum tenha escapado das migrações)
const LEGACY_TO_NEW: Record<string, string> = {
  DISPARO_REALIZADO: 'INICIO',
  CADASTRO_COMPLETO: 'CADASTRO_RECEBIDO',
  AGUARDANDO_APROVACAO: 'PRE_APROVACAO',
  COLETANDO_COMPLEMENTO: 'INTERESSADO',
  FORMULARIO_ENVIADO: 'CADASTRO_RECEBIDO',
  ANALISE_AIVA: 'EM_ANALISE_AIVA',
  TREINAMENTO: 'TREINAR',
}

interface OppFromEvo {
  id: number
  fkStage: number
  mainphone: string
  formsdata?: Record<string, string | null> | null
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const okAuth =
    auth === `Bearer ${process.env.WEBHOOK_SECRET}` ||
    auth === `Bearer ${process.env.CRON_SECRET}`
  if (!okAuth) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const ts = new Date().toISOString()

  // Skip silencioso em fim de semana
  if (!isDiaUtil()) {
    return NextResponse.json({ ok: true, ts, ignorado: 'fim_de_semana', quando: rotuloHorario() })
  }

  const inicio = Date.now()

  try {
    // ─── 1. Busca todas as opps no funil AIVA ──────────────────────────────
    const evoRes = await fetch(`${EVO_BASE}/int/getPipeOpportunities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queueId: QUEUE_ID, apiKey: GLOBAL_KEY, pipelineId: PIPELINE_AIVA }),
    })
    if (!evoRes.ok) {
      const text = await evoRes.text()
      return NextResponse.json(
        { ok: false, ts, erro: `getPipeOpportunities → ${evoRes.status}: ${text.slice(0, 200)}` },
        { status: 502 }
      )
    }
    const opps: OppFromEvo[] = await evoRes.json()

    // ─── 2. Carrega TODOS os leads AIVA do Supabase de uma vez (paginado) ──
    const leadsMap = new Map<string, { id: string; status: string; descartadoManual: boolean }>()
    {
      let from = 0
      const page = 1000
      while (true) {
        const { data, error } = await supabaseAdmin
          .from('sdr_leads')
          .select('id, status, evotalks_opportunity_id, observacoes')
          .eq('produto', 'AIVA')
          .not('evotalks_opportunity_id', 'is', null)
          .range(from, from + page - 1)
        if (error) throw error
        for (const l of data ?? []) {
          if (l.evotalks_opportunity_id) {
            leadsMap.set(l.evotalks_opportunity_id, {
              id: l.id,
              status: l.status,
              descartadoManual: (l.observacoes ?? '').includes('[DESCARTADO_MANUAL'),
            })
          }
        }
        if (!data || data.length < page) break
        from += page
      }
    }

    // ─── 3. Match Evo ↔ Supabase em memória e atualiza só os que diferem ─
    let updated = 0
    let skipped = 0
    let notInDb = 0
    let unmapped = 0
    const erros: string[] = []
    const idsParaUpdate: Record<string, string[]> = {} // status → [lead ids]

    for (const opp of opps) {
      // statusFromOpp trata o stage 49 (Cadastro Recebido) pela completude real
      // da Fase 3 — incompleto vira INTERESSADO em vez de CADASTRO_RECEBIDO falso.
      const novoStatus = statusFromOpp(opp)
      if (!novoStatus) { unmapped++; continue }

      const lead = leadsMap.get(String(opp.id))
      if (!lead) { notInDb++; continue }
      if (lead.status === novoStatus) { skipped++; continue }
      // Descarte MANUAL (botão do painel) é definitivo: o sync NÃO revive o
      // lead só porque o card ficou parado no funil. Reverter = mover o card
      // no Evo (webhook de stage) ou ajuste manual (2026-08-03).
      if (lead.descartadoManual && lead.status === 'DESCARTADO') { skipped++; continue }

      if (!idsParaUpdate[novoStatus]) idsParaUpdate[novoStatus] = []
      idsParaUpdate[novoStatus].push(lead.id)
    }

    // Status em que "aguardando atendimento humano" não faz sentido: o lead saiu
    // do funil ativo (ou é um bot). O webhook já ignora esses status por completo,
    // então manter a flag só polui o filtro do painel.
    //
    // Bug 2026-07-20: o sync trocava só o status e deixava o acionar_humano antigo
    // pendurado — 39 leads apareceram como "BOT_DETECTADO + humano" no painel logo
    // depois de um sync. A flag vinha de quando o lead ainda estava ativo.
    const STATUS_SEM_HUMANO = ['BOT_DETECTADO', 'DESCARTADO', 'OPT_OUT', 'NAO_QUALIFICADO']

    // Update em batch por status
    for (const [status, ids] of Object.entries(idsParaUpdate)) {
      const patch: Record<string, unknown> = { status }
      if (STATUS_SEM_HUMANO.includes(status)) patch.acionar_humano = false
      const { error } = await supabaseAdmin
        .from('sdr_leads')
        .update(patch)
        .in('id', ids)
      if (error) {
        erros.push(`batch ${status} (${ids.length} leads): ${error.message}`)
        continue
      }
      updated += ids.length
    }

    // ─── 3. Migração legacy ────────────────────────────────────────────────
    const legacyMigrated: Record<string, number> = {}
    for (const [oldName, newName] of Object.entries(LEGACY_TO_NEW)) {
      const { data } = await supabaseAdmin
        .from('sdr_leads')
        .update({ status: newName })
        .eq('produto', 'AIVA')
        .eq('status', oldName)
        .select('id')
      legacyMigrated[`${oldName}→${newName}`] = data?.length ?? 0
    }

    // ─── 4. Detecta migrações pro pipeline 19 (pós-venda) e REMOVE da campanha ─
    // Leads que migraram pro pipeline de lojas ativas saem do controle do SDR.
    // Pipeline 19 é gerido 100% manual no Evo — não deve poluir o briefing
    // nem entrar em followup/nudge. Decisão de Aldo (29/05/2026).
    let posVendaRemovidos = 0
    try {
      const pvRes = await fetch(`${EVO_BASE}/int/getPipeOpportunities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId: QUEUE_ID, apiKey: GLOBAL_KEY, pipelineId: PIPELINE_POSVENDA }),
      })
      if (pvRes.ok) {
        const pvOpps: OppFromEvo[] = await pvRes.json()
        const pvOppIds = pvOpps.map((o) => String(o.id))
        if (pvOppIds.length > 0) {
          // Acha leads AIVA vinculados a essas opps
          const { data: paraRemover } = await supabaseAdmin
            .from('sdr_leads')
            .select('id')
            .eq('produto', 'AIVA')
            .in('evotalks_opportunity_id', pvOppIds)
          const ids = (paraRemover ?? []).map((l) => l.id)
          if (ids.length > 0) {
            await supabaseAdmin.from('sdr_mensagens').delete().in('lead_id', ids)
            const { data: del } = await supabaseAdmin
              .from('sdr_leads')
              .delete()
              .in('id', ids)
              .select('id')
            posVendaRemovidos = del?.length ?? 0
          }
        }
      }
    } catch (err) {
      erros.push(`pos-venda check: ${err instanceof Error ? err.message : String(err)}`)
    }

    return NextResponse.json({
      ok: true,
      ts,
      quando: rotuloHorario(),
      duracao_ms: Date.now() - inicio,
      opps_total: opps.length,
      sync: { updated, skipped, notInDb, unmapped },
      legacy: legacyMigrated,
      pos_venda_removidos: posVendaRemovidos,
      erros: erros.slice(0, 10),
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, ts, erro: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

// O Vercel Cron dispara GET. Sem este handler a rota respondia 405 e o sync
// diário nunca rodava — origem das divergências de status entre Supabase e Evo
// (leads presos em PRE_APROVACAO/DESCARTADO com o card já em outra etapa).
export async function GET(req: NextRequest) {
  return POST(req)
}
