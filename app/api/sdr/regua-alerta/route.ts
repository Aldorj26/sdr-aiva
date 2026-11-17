/**
 * regua-alerta/route.ts — régua de ativação em cima dos alertas da AIVA (Aldo 17/11/2026).
 * Proposta: docs/Proposta-regua-ativacao-alertas-2026-11-17.md. Regra: lib/regua-alerta-calc.ts
 * (`npm run test:regua`).
 *
 * Quem: toda loja que a AIVA lista em /retailers/attention (novo_sem_engajamento,
 * antigo_sem_engajamento, baixa_performance), cruzada com a coluna do quadro pra virar TRILHA
 * (A fechar a venda · B reconquista · C primeira venda · D primeira consulta). PERMANENTE: loja que
 * entra no alerta recebe o toque 1; loja que sai recebe um reconhecimento e a régua zera.
 *
 * ⛔ TRAVA DE ENVIO (decisão do Aldo 17/11): só sai por template de UTILIDADE — 87 (pendência) e
 * 86 (etapa concluída), IDs do Evo na fila 10 (padrão no código; `AIVA_TPL_PENDENCIA_ID` /
 * `AIVA_TPL_ETAPA_ID` só se um dia mudarem). Nunca usa o coringa 48.
 * CRON (18/11/2026): `0,30 12-14 * * 1-5` UTC = 9h, 9h30, 10h, 10h30, 11h e 11h30 BRT, seg–sex. Seis rodadas de
 * até 45 = 270/manhã: esvazia a fila inicial (~236) numa manhã; depois as rodadas saem quase vazias (só
 * loja que entrou no alerta, toque seguinte vencido ou reconhecimento).
 * LIGA/DESLIGA NO BANCO (18/11/2026, o Aldo estava sem acesso à Vercel): a régua só envia se existir
 * a chave `regua_alerta_ativa` em `sdr_avisos_chave` (mesmo padrão do `silencio_templates`). Sem a
 * chave — ou se a leitura falhar — a rota responde SEMPRE em simulação, mesmo chamada sem ?dry.
 *   ligar:    insert into sdr_avisos_chave (chave, ultimo_aviso) values ('regua_alerta_ativa', now())
 *   desligar: delete from sdr_avisos_chave where chave = 'regua_alerta_ativa'
 *
 * ⚠️ Lista de alerta vazia ou API fora = rodada RECUSADA. Lista vazia não é "todo mundo saiu do
 * alerta": tratar assim mandaria reconhecimento pra base inteira.
 *
 * ?dry → mostra o que faria (trilhas, motivos, fila, amostra dos textos) sem enviar nada.
 * ?max=N → limita o lote. ?force → ignora o horário comercial.
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'
import { flag } from '@/lib/req-flags'
import { listarOnboardingsApi } from '@/lib/portal-aiva'
import { leadsBloqueadosPorLimite } from '@/lib/limite-originacao'
import { listarAlertasApi } from '@/lib/regua-alerta'
import {
  classificar, trilhaDoLead, lerMarcadores, decidir, camposToque, camposReconhecimento, renderToque, renderReconhecimento,
  gravarEstado, encerrarEstado, limparCampo, PRIORIDADE, NOME_TRILHA, ROTULO_TOQUE, ROTULO_RECONHECIMENTO,
  RESPIRO_RESPOSTA_DIAS, RESPIRO_OUTRO_TEMPLATE_DIAS, type Trilha, type Reconhecimento,
} from '@/lib/regua-alerta-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TPL_PENDENCIA = Number(process.env.AIVA_TPL_PENDENCIA_ID) || 87
const TPL_ETAPA = Number(process.env.AIVA_TPL_ETAPA_ID) || 86
const CHAVE_ATIVA = 'regua_alerta_ativa'

/** A régua está ligada? Chave em `sdr_avisos_chave`. Falha de leitura = DESLIGADA (nunca envia no escuro). */
async function reguaAtiva(): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.from('sdr_avisos_chave').select('chave').eq('chave', CHAVE_ATIVA).maybeSingle()
    if (error) throw new Error(error.message)
    return !!data
  } catch (e) {
    console.error('[regua-alerta] não consegui ler a chave de ativação — tratando como DESLIGADA:', e)
    return false
  }
}
const MAX_POR_RODADA = 45
const TETO_MS = 240_000
const STATUS_ALVO = ['LOGIN', 'LOJA_FINALIZADA_E_VENDENDO', 'TREINAR']
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '')

type Lead = { id: string; nome: string; telefone: string; status: string; observacoes: string | null; acionar_humano: boolean | null }

async function todas<T>(q: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await q(de, de + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const t0 = Date.now()
  const sp = new URL(req.url).searchParams
  const envioLiberado = await reguaAtiva()
  const dry = flag(sp, 'dry') || !envioLiberado
  const force = flag(sp, 'force')
  const max = Math.min(Number(sp.get('max')) || MAX_POR_RODADA, MAX_POR_RODADA)

  const horaBrt = (new Date().getUTCHours() + 21) % 24
  if (!dry && !force && (horaBrt < 9 || horaBrt >= 18)) return NextResponse.json({ ok: true, ignorado: 'fora_horario_comercial', horaBrt })

  // ── portal: alerta + quadro ───────────────────────────────────────────────────────────
  let alertas, onbs
  try {
    ;[alertas, onbs] = await Promise.all([listarAlertasApi(), listarOnboardingsApi()])
  } catch (e) {
    console.error('[regua-alerta] rodada RECUSADA: portal indisponível:', e)
    return NextResponse.json({ ok: true, ignorado: 'portal_indisponivel', erro: String(e).slice(0, 160), fila: 0 })
  }
  if (!alertas.length || !onbs.length) {
    console.error(`[regua-alerta] rodada RECUSADA: lista vazia (alertas ${alertas.length}, cadastros ${onbs.length})`)
    return NextResponse.json({ ok: true, ignorado: 'lista_vazia', alertas: alertas.length, cadastros: onbs.length, fila: 0 })
  }
  // CNPJ → retailer / coluna do quadro. Só CNPJ com retailer_id conhecido serve pra dizer "saiu do alerta".
  const porRid = new Map<string, { cnpj: string; col: string | null; acesso: string | null }>()
  for (const o of onbs) {
    const rid = o.retailer_id != null && String(o.retailer_id) !== '' ? String(o.retailer_id) : null
    const cnpj = dig(o.cnpj)
    if (!rid || cnpj.length !== 14) continue
    porRid.set(rid, { cnpj, col: (o.board_column as string | null) ?? null, acesso: (o.primeiro_acesso_em as string | null) ?? null })
  }
  const trilhaPorCnpj = new Map<string, Trilha>()
  const porAlerta: Record<string, number> = {}
  let semCadastro = 0
  for (const a of alertas) {
    porAlerta[a.alerta] = (porAlerta[a.alerta] ?? 0) + 1
    const o = porRid.get(a.retailerId)
    if (!o) { semCadastro++; continue }
    trilhaPorCnpj.set(o.cnpj, classificar(a.alerta, o.col, o.acesso))
  }
  const colPorCnpj = new Map<string, string | null>()
  for (const o of porRid.values()) colPorCnpj.set(o.cnpj, o.col)

  // ── leads ─────────────────────────────────────────────────────────────────────────────
  const leads = await todas<Lead>((de, ate) => supabaseAdmin.from('sdr_leads').select('id, nome, telefone, status, observacoes, acionar_humano').in('status', STATUS_ALVO).eq('produto', 'AIVA').range(de, ate))
  const candidatos = leads.filter((l) => l.telefone && !l.telefone.startsWith('000'))
  const ids = candidatos.map((l) => l.id)
  const regs: { lead_id: string; cnpj: string }[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const lote = ids.slice(i, i + 300)
    regs.push(...await todas<{ lead_id: string; cnpj: string }>((de, ate) => supabaseAdmin.from('sdr_registros_cnpj').select('lead_id,cnpj').in('lead_id', lote).range(de, ate)))
  }
  const cnpjsPorLead = new Map<string, Set<string>>()
  for (const l of candidatos) {
    const s = new Set<string>()
    const m = dig((l.observacoes ?? '').match(/cnpj_matriz=([0-9./-]+)/)?.[1])
    if (m.length === 14) s.add(m)
    cnpjsPorLead.set(l.id, s)
  }
  for (const r of regs) { const c = dig(r.cnpj); if (c.length === 14) cnpjsPorLead.get(r.lead_id)?.add(c) }

  // só interessa quem está em alerta HOJE ou carrega a marca da régua (pode ter saído)
  const alvo = candidatos.filter((l) => (l.observacoes ?? '').includes('[REGUA_ALERTA:') || [...(cnpjsPorLead.get(l.id) ?? [])].some((c) => trilhaPorCnpj.has(c)))
  const alvoIds = alvo.map((l) => l.id)
  const desdeFala = new Date(Date.now() - RESPIRO_RESPOSTA_DIAS * 86400_000).toISOString()
  const desdeTpl = new Date(Date.now() - RESPIRO_OUTRO_TEMPLATE_DIAS * 86400_000).toISOString()
  const falas: { lead_id: string; enviado_em: string }[] = []
  const tpls: { lead_id: string; enviado_em: string; template_hsm: string | null }[] = []
  for (let i = 0; i < alvoIds.length; i += 300) {
    const lote = alvoIds.slice(i, i + 300)
    const [f, t] = await Promise.all([
      todas<{ lead_id: string; enviado_em: string }>((de, ate) => supabaseAdmin.from('sdr_mensagens').select('lead_id,enviado_em').in('lead_id', lote).eq('direcao', 'in').gte('enviado_em', desdeFala).range(de, ate)),
      todas<{ lead_id: string; enviado_em: string; template_hsm: string | null }>((de, ate) => supabaseAdmin.from('sdr_mensagens').select('lead_id,enviado_em,template_hsm').in('lead_id', lote).eq('direcao', 'out').not('template_hsm', 'is', null).gte('enviado_em', desdeTpl).range(de, ate)),
    ])
    falas.push(...f); tpls.push(...t)
  }
  const ultimaFala = new Map<string, number>()
  for (const f of falas) ultimaFala.set(f.lead_id, Math.max(ultimaFala.get(f.lead_id) ?? 0, Date.parse(f.enviado_em)))
  const ultimoTpl = new Map<string, number>()
  for (const t of tpls) {
    if (t.template_hsm === ROTULO_TOQUE) continue // o intervalo da própria régua já é controlado pela marca
    ultimoTpl.set(t.lead_id, Math.max(ultimoTpl.get(t.lead_id) ?? 0, Date.parse(t.enviado_em)))
  }
  let bloqueados = new Set<string>()
  try { bloqueados = await leadsBloqueadosPorLimite() } catch (e) { console.warn('[regua-alerta] limite de originação indisponível (segue sem a trava):', String(e).slice(0, 120)) }

  // ── decisão ───────────────────────────────────────────────────────────────────────────
  type Item =
    | { tipo: 'toque'; lead: Lead; trilha: Trilha; toque: number; ligar: boolean }
    | { tipo: 'reconhecer'; lead: Lead; variante: Reconhecimento; novaTrilha: Trilha | null }
  const fila: Item[] = []
  const silenciosos: { lead: Lead; obs: string }[] = []
  const motivos: Record<string, number> = {}
  const porTrilha: Record<string, number> = {}
  for (const l of alvo) {
    const cs = [...(cnpjsPorLead.get(l.id) ?? [])]
    const trilhaAtual = trilhaDoLead(cs.map((c) => trilhaPorCnpj.get(c)).filter((t): t is Trilha => !!t))
    if (trilhaAtual) porTrilha[trilhaAtual] = (porTrilha[trilhaAtual] ?? 0) + 1
    // "saiu do alerta" só vale se a gente ENXERGA a loja no portal (CNPJ com retailer_id) — senão é ponto cego, não saída
    const visivel = cs.some((c) => colPorCnpj.has(c))
    if (!trilhaAtual && !visivel) { motivos.sem_retrato_no_portal = (motivos.sem_retrato_no_portal ?? 0) + 1; continue }
    const cols = cs.map((c) => colPorCnpj.get(c)).filter(Boolean) as string[]
    const boardColumn = cols.includes('primeira_venda') ? 'primeira_venda' : cols[0] ?? null
    const m = lerMarcadores(l.observacoes)
    const d = decidir(m, { trilhaAtual, boardColumn, ultimaFalaLojista: ultimaFala.get(l.id) ?? null, ultimoOutroTemplate: ultimoTpl.get(l.id) ?? null, filaHumana: !!l.acionar_humano, bloqueadaLimite: bloqueados.has(l.id) })
    if (d.acao === 'nada') { motivos[d.motivo] = (motivos[d.motivo] ?? 0) + 1; continue }
    if (d.acao === 'encerrar') { silenciosos.push({ lead: l, obs: encerrarEstado(l.observacoes, null) }); continue }
    if (d.acao === 'trocar_trilha') { silenciosos.push({ lead: l, obs: gravarEstado(l.observacoes, d.trilha, 0, m.estado?.ultima != null ? new Date(m.estado.ultima) : null) }); continue }
    if (d.acao === 'reconhecer') fila.push({ tipo: 'reconhecer', lead: l, variante: d.variante, novaTrilha: d.novaTrilha })
    else fila.push({ tipo: 'toque', lead: l, trilha: d.trilha, toque: d.toque, ligar: d.ligar })
  }
  // reconhecimento primeiro (é boa notícia e é pouco), depois A → B → C → D, toque mais baixo antes
  const ordem = (i: Item) => (i.tipo === 'reconhecer' ? -1 : PRIORIDADE[i.trilha])
  fila.sort((a, b) => ordem(a) - ordem(b) || (a.tipo === 'toque' && b.tipo === 'toque' ? a.toque - b.toque : 0))

  const nomeDe = (l: Lead) => {
    const socio = (l.observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1]?.trim()
    return limparCampo((socio ? normalizaNome(socio) : normalizaNome(l.nome)) || 'lojista', 40)
  }
  const lojaDe = (l: Lead) => limparCampo((l.observacoes ?? '').match(/nome_varejo=([^|\]]+)/)?.[1]?.trim() || l.nome || 'sua loja')
  const montar = (i: Item) => {
    const nome = nomeDe(i.lead), loja = lojaDe(i.lead)
    if (i.tipo === 'toque') {
      const c = camposToque(i.trilha, i.toque)
      return { template: TPL_PENDENCIA, vars: [nome, loja, c.pendencia, c.prazo], texto: renderToque(nome, loja, c), rotulo: ROTULO_TOQUE }
    }
    const c = camposReconhecimento(i.variante)
    return { template: TPL_ETAPA, vars: [nome, loja, c.etapa, c.situacao], texto: renderReconhecimento(nome, loja, c), rotulo: ROTULO_RECONHECIMENTO }
  }

  const filaPorTrilha: Record<string, number> = {}
  for (const i of fila) { const k = i.tipo === 'reconhecer' ? `reconhecimento_${i.variante}` : `${i.trilha}_toque${i.toque}`; filaPorTrilha[k] = (filaPorTrilha[k] ?? 0) + 1 }
  const ligar = fila.filter((i) => i.tipo === 'toque' && i.ligar).length

  if (dry) {
    const amostra: Record<string, string> = {}
    for (const i of fila) {
      const k = i.tipo === 'reconhecer' ? `reconhecimento (${i.variante})` : `${i.trilha} — ${NOME_TRILHA[i.trilha]}, toque ${i.toque}`
      if (!amostra[k]) amostra[k] = montar(i).texto
    }
    return NextResponse.json({
      ok: true, dry: true,
      envio_liberado: envioLiberado,
      trava: envioLiberado ? null : `simulação forçada: régua DESLIGADA (sem a chave ${CHAVE_ATIVA} em sdr_avisos_chave)`,
      alertas_no_portal: alertas.length, por_alerta: porAlerta, alertas_sem_cadastro_na_listagem: semCadastro,
      lojistas_em_alerta: Object.values(porTrilha).reduce((a, b) => a + b, 0), por_trilha: porTrilha,
      fila: fila.length, fila_detalhe: filaPorTrilha, nesta_rodada: Math.min(fila.length, max), para_ligar: ligar,
      ajustes_silenciosos: silenciosos.length, motivos, amostra,
    })
  }

  // ── envio ─────────────────────────────────────────────────────────────────────────────
  for (const s of silenciosos) await supabaseAdmin.from('sdr_leads').update({ observacoes: s.obs }).eq('id', s.lead.id)
  const enviados: { loja: string; o_que: string }[] = []
  const falhas: { loja: string; erro: string }[] = []
  let cortadoPorTempo = false
  for (const i of fila.slice(0, max)) {
    if (Date.now() - t0 > TETO_MS) { cortadoPorTempo = true; break }
    const msg = montar(i)
    try {
      await sendTemplate(i.lead.telefone, msg.template, msg.vars)
      const agora = new Date()
      const obs = i.tipo === 'toque'
        ? gravarEstado(i.lead.observacoes, i.trilha, i.toque, agora)
        : i.novaTrilha
          ? gravarEstado(i.lead.observacoes, i.novaTrilha, 0, agora)   // voltou a consultar: toque 1 da trilha nova daqui a 7 dias
          : encerrarEstado(i.lead.observacoes, agora)                  // saiu do alerta: a régua zera
      await supabaseAdmin.from('sdr_leads').update({ observacoes: obs, data_ultimo_contato: agora.toISOString() }).eq('id', i.lead.id)
      await supabaseAdmin.from('sdr_mensagens').insert({ lead_id: i.lead.id, direcao: 'out', conteudo: msg.texto, template_hsm: msg.rotulo })
      enviados.push({ loja: i.lead.nome, o_que: i.tipo === 'toque' ? `${i.trilha} toque ${i.toque}` : `reconhecimento ${i.variante}` })
    } catch (e) {
      falhas.push({ loja: i.lead.nome, erro: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: true, alertas_no_portal: alertas.length, por_trilha: porTrilha, fila: fila.length, enviados: enviados.length, falhas, cortado_por_tempo: cortadoPorTempo, para_ligar: ligar, motivos, detalhe: enviados })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
