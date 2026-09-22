/**
 * "Descartados no pipeline" (o card vermelho do painel) — dá pra descartar mesmo?
 * Aldo, 22/09/2026.
 *
 * QUEM SÃO: leads com status DESCARTADO no nosso banco cujo TELEFONE ainda tem
 * card aberto no funil 15 do Evo. Ou seja: a nossa base diz "acabou" e o CRM diz
 * "está em andamento". Um dos dois está errado, e é isso que este script decide.
 *
 * COMO CONFERE (o ponto do pedido: CNPJ **e** telefone):
 *   - por TELEFONE: card em todos os funis (15 AIVA, 19 Odres, 17 Singlo, 20),
 *     outros leads com o mesmo número, histórico de conversa (quem falou por último).
 *   - por CNPJ: registro no /registros, cadastro no portal da AIVA (etapa, biometria,
 *     RID), desempenho (consultas/vendas) e base Odres.
 * A pergunta não é "o lead está descartado?", é "existe sinal de vida em ALGUMA
 * fonte?". Se existe, descartar é apagar oportunidade — e foi assim que a Diniz
 * Imports virou 3 cards duplicados.
 *
 * Só LÊ. Uso: npx tsx --env-file=.env.local scripts/conferir-descartados-pipeline-2026-09-22.mts
 */
import { listarOnboardingsApi, loginPortal, partnerIdTrack, buscarPerformance } from '../lib/portal-aiva'
import { supabaseAdmin } from '../lib/supabase'
import { getPipeOpportunities } from '../lib/evotalks'
import fs from 'node:fs'

const so = (c: unknown) => String(c ?? '').replace(/\D/g, '')
const chaveTel = (t: unknown) => { const d = so(t); return d.length >= 10 ? d.slice(-10) : '' }
const dias = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null)

const ETAPA: Record<number, string> = {
  66: 'Início', 47: 'Interessado', 53: 'Sem resposta', 54: 'Pré Aprovação', 49: 'Cadastro Recebido',
  50: 'Em Análise AIVA', 70: 'Treinar', 71: 'Login', 51: 'Vendendo', 69: 'Bot',
  93: 'Menos de 1 Ano', 94: 'CNPJ Irregular', 95: 'Descartada pela Aiva',
}
const FUNIL: Record<number, string> = { 15: 'AIVA (15)', 19: 'Odres/UME (19)', 17: 'Singlo (17)', 20: 'Funil 20' }
/** Etapas em que o card estar vivo CONTRADIZ o status DESCARTADO. */
const ETAPAS_VIVAS = [47, 54, 49, 50, 70, 71, 51]
/** Etapas que são o fim legítimo da jornada: card ali concorda com o descarte. */
const ETAPAS_MORTAS = [53, 93, 94, 95, 66]

// ─── leads DESCARTADO do produto AIVA ────────────────────────────────────────
type Lead = { id: string; nome: string | null; telefone: string; status: string; evotalks_opportunity_id: string | number | null; observacoes: string | null; cidade: string | null; data_disparo_inicial: string | null; criado_em: string }
const descartados: Lead[] = []
for (let de = 0; ; de += 1000) {
  const { data } = await supabaseAdmin.from('sdr_leads')
    .select('id,nome,telefone,status,evotalks_opportunity_id,observacoes,cidade,data_disparo_inicial,criado_em')
    .eq('status', 'DESCARTADO').eq('produto', 'AIVA').range(de, de + 999)
  descartados.push(...((data ?? []) as Lead[]))
  if (!data || data.length < 1000) break
}
console.log(`Leads DESCARTADO (AIVA): ${descartados.length}`)

// ─── cards do Evo nos 4 funis ────────────────────────────────────────────────
type Card = { funil: number; id: number; stage: number; titulo: string; tel: string }
const cards: Card[] = []
for (const pid of [15, 19, 17, 20]) {
  try {
    const opps = await getPipeOpportunities(pid)
    for (const o of opps) {
      const oo = o as unknown as Record<string, unknown>
      cards.push({ funil: pid, id: Number(oo.id), stage: Number(oo.fkStage), titulo: String(oo.title ?? ''), tel: chaveTel(oo.mainphone) })
    }
  } catch (e) { console.log(`Funil ${pid}: FALHOU — ${String(e).slice(0, 80)}`) }
}
const cardPorTel = new Map<string, Card[]>()
for (const c of cards) {
  if (!c.tel) continue
  if (!cardPorTel.has(c.tel)) cardPorTel.set(c.tel, [])
  cardPorTel.get(c.tel)!.push(c)
}
console.log(`Cards: ${cards.length} nos 4 funis`)

// É este o recorte do painel: DESCARTADO **com card vivo no funil 15**.
const noPipe = descartados.filter((l) => (cardPorTel.get(chaveTel(l.telefone)) ?? []).some((c) => c.funil === 15))
console.log(`→ com card aberto no funil 15 (o número do painel): ${noPipe.length}`)

// ─── registros, portal, Odres ────────────────────────────────────────────────
type Reg = { cnpj: string; lead_id: string | null; rid: string | null; status: string | null; loja: string | null; telefone: string | null; tipo: string | null }
const regs: Reg[] = []
for (let de = 0; ; de += 1000) {
  const { data } = await supabaseAdmin.from('sdr_registros_cnpj').select('cnpj,lead_id,rid,status,loja,telefone,tipo').range(de, de + 999)
  regs.push(...((data ?? []) as Reg[]))
  if (!data || data.length < 1000) break
}
const regPorLead = new Map<string, Reg[]>()
const regPorTel = new Map<string, Reg[]>()
for (const r of regs) {
  if (r.lead_id) { if (!regPorLead.has(r.lead_id)) regPorLead.set(r.lead_id, []); regPorLead.get(r.lead_id)!.push(r) }
  const k = chaveTel(r.telefone)
  if (k) { if (!regPorTel.has(k)) regPorTel.set(k, []); regPorTel.get(k)!.push(r) }
}

const onbs = await listarOnboardingsApi()
const portalPorCnpj = new Map(onbs.map((o) => [so((o as { cnpj?: string }).cnpj), o as Record<string, unknown>]))
const portalPorTel = new Map<string, Record<string, unknown>>()
for (const o of onbs) {
  const k = chaveTel((o as { phone_number?: string }).phone_number)
  if (k && !portalPorTel.has(k)) portalPorTel.set(k, o as Record<string, unknown>)
}

const sessao = await loginPortal()
const perf = await buscarPerformance(sessao, await partnerIdTrack(sessao), null)
const perfPorCnpj = new Map<string, { vendas: number; consultas: number }>()
const perfPorRid = new Map<string, { vendas: number; consultas: number }>()
for (const p of perf) {
  const v = { vendas: Number(p.n_vendas ?? 0), consultas: Number(p.n_consultas ?? 0) }
  const rid = String(p.retailer_id)
  const ant = perfPorRid.get(rid)
  const soma = ant ? { vendas: ant.vendas + v.vendas, consultas: ant.consultas + v.consultas } : v
  perfPorRid.set(rid, soma)
  const c = so(p.cnpj)
  if (c) perfPorCnpj.set(c, soma)
}

const odres = new Set<string>()
for (let de = 0; ; de += 1000) {
  const { data } = await supabaseAdmin.from('aiva_base_cnpjs').select('cnpj').range(de, de + 999)
  for (const r of data ?? []) odres.add(so((r as { cnpj: string }).cnpj))
  if (!data || data.length < 1000) break
}

// ─── conversa: última entrada e quantas mensagens nossas ─────────────────────
const ultimaIn = new Map<string, string>()
const saidas = new Map<string, number>()
/** Recebeu a mensagem de encerramento ("vou encerrar nossa conversa por aqui")?
 *  Isso muda tudo: não é lead que sumiu, é lead que ALGUÉM fechou de propósito
 *  pelo painel. O descarte foi decisão humana; o que sobrou errado é o card. */
const despedida = new Map<string, string>()
for (const l of noPipe) {
  const { data: fim } = await supabaseAdmin.from('sdr_mensagens').select('enviado_em')
    .eq('lead_id', l.id).eq('direcao', 'out').ilike('conteudo', '%encerrar nossa conversa%')
    .order('enviado_em', { ascending: false }).limit(1)
  if (fim?.[0]) despedida.set(l.id, (fim[0] as { enviado_em: string }).enviado_em)
  const { data } = await supabaseAdmin.from('sdr_mensagens').select('enviado_em').eq('lead_id', l.id).eq('direcao', 'in').order('enviado_em', { ascending: false }).limit(1)
  if (data?.[0]) ultimaIn.set(l.id, (data[0] as { enviado_em: string }).enviado_em)
  const { count } = await supabaseAdmin.from('sdr_mensagens').select('id', { count: 'exact', head: true }).eq('lead_id', l.id).eq('direcao', 'out')
  saidas.set(l.id, count ?? 0)
}
console.log(`Receberam mensagem de encerramento pelo painel: ${despedida.size}/${noPipe.length}`)

// ─── decisão ─────────────────────────────────────────────────────────────────
const linhas = noPipe.map((l) => {
  const k = chaveTel(l.telefone)
  const meusCards = cardPorTel.get(k) ?? []
  const c15 = meusCards.filter((c) => c.funil === 15).sort((a, b) => b.id - a.id)[0]
  const no19 = meusCards.filter((c) => c.funil === 19)
  const meusRegs = [...(regPorLead.get(l.id) ?? []), ...(regPorTel.get(k) ?? [])]
  const cnpjs = [...new Set(meusRegs.map((r) => so(r.cnpj)).filter(Boolean))]
  const onbDoTel = portalPorTel.get(k)
  const onbs2 = [...cnpjs.map((c) => portalPorCnpj.get(c)).filter(Boolean), ...(onbDoTel ? [onbDoTel] : [])] as Record<string, unknown>[]
  const onb = onbs2[0] ?? null
  const rid = meusRegs.find((r) => r.rid)?.rid ?? (onb?.retailer_id ? String(onb.retailer_id) : null)
  const desemp = cnpjs.map((c) => perfPorCnpj.get(c)).find(Boolean) ?? (rid ? perfPorRid.get(rid) ?? null : null)
  const obs = l.observacoes ?? ''
  const silencio = dias(ultimaIn.get(l.id))
  const envios = saidas.get(l.id) ?? 0
  const stage = String(onb?.stage ?? '')
  const bio = String(onb?.biometry_status ?? '')

  const motivos: string[] = []
  let rec = 'DESCARTE OK'
  const trava = (m: string) => { motivos.push(m); rec = 'NÃO DESCARTAR' }
  const olhar = (m: string) => { motivos.push(m); if (rec === 'DESCARTE OK') rec = 'CONFERIR' }

  if (desemp && desemp.vendas > 0) trava(`loja VENDENDO (${desemp.vendas} vendas no portal)`)
  else if (desemp && desemp.consultas > 0) trava(`loja operando (${desemp.consultas} consultas de crédito)`)
  if (rid) trava(`tem ID de loja na AIVA (RID ${rid})`)
  if (meusRegs.some((r) => r.status === 'ativa')) trava('registro marcado como ativa')
  if (bio === 'aprovado') trava('biometria APROVADA no portal')
  if (stage && stage !== 'dados_varejo') trava(`cadastro avançou no portal (${stage})`)
  // Card em etapa viva SÓ é trava se ninguém tiver encerrado a conversa. Com a
  // despedida enviada, o descarte foi decisão de gente — o que está errado é o
  // card parado numa etapa que diz "em andamento" e infla o funil.
  const seDespediu = despedida.has(l.id)
  if (c15 && ETAPAS_VIVAS.includes(c15.stage) && !seDespediu) trava(`card VIVO na etapa ${ETAPA[c15.stage]} e ninguém encerrou a conversa — o descarte não bate com o CRM`)
  if (silencio !== null && silencio <= 7) trava(`lojista falou há ${silencio} dia(s) — conversa viva`)

  if (seDespediu && c15 && ETAPAS_VIVAS.includes(c15.stage)) olhar(`encerramento enviado em ${despedida.get(l.id)!.slice(0, 10)}, mas o card segue em ${ETAPA[c15.stage]} — mover o card`)
  if (no19.length) olhar(`telefone também está no funil 19 Odres/UME (${no19.map((x) => `#${x.id}`).join(', ')})`)
  if (cnpjs.some((c) => odres.has(c))) olhar('CNPJ na base Odres')
  if (silencio !== null && silencio > 7 && silencio <= 60) olhar(`lojista respondeu há ${silencio} dias`)
  if (obs.includes('[SENHA_ENVIADA:')) olhar('senha do sócio já foi enviada pela AIVA')
  if (onb && !stage) olhar('tem cadastro no portal da AIVA')
  if (c15 && !ETAPAS_VIVAS.includes(c15.stage) && !ETAPAS_MORTAS.includes(c15.stage)) olhar(`card na etapa ${ETAPA[c15.stage] ?? c15.stage} (não é etapa final conhecida)`)

  if (rec === 'DESCARTE OK') {
    motivos.push(c15 ? `card em ${ETAPA[c15.stage] ?? c15.stage}, que é fim de jornada` : 'sem card vivo')
    motivos.push(silencio === null ? `nunca respondeu (${envios} mensagens nossas)` : `${silencio} dias em silêncio`)
  }

  const porQueDescartou = [
    obs.includes('[PORTAL_REPROVADO') ? 'reprovado pela AIVA' : '',
    obs.includes('[CNPJ_IRREGULAR_AIVA:') ? 'CNPJ irregular na Receita' : '',
    /\[CNPJ_RECEITA:[^\]]*idade=0/.test(obs) ? 'CNPJ com menos de 1 ano' : '',
    obs.includes('[COBRANCA_FORM_ESGOTADO]') ? 'cobrança do formulário esgotada' : '',
    obs.includes('[CHECK_TREINAMENTO_ESGOTADO]') ? 'check de treinamento esgotado' : '',
    obs.includes('[RETOM_INT_FIM]') ? 'retomada de interessado encerrada' : '',
  ].filter(Boolean).join(' · ') || 'sem marcador — provavelmente auto-descarte por silêncio'

  return {
    recomendacao: rec, motivos: motivos.join(' · '), por_que_descartou: porQueDescartou,
    loja: l.nome, telefone: l.telefone, cidade: l.cidade,
    cnpjs: cnpjs.join(', ') || null,
    card_15: c15 ? `#${c15.id} ${ETAPA[c15.stage] ?? c15.stage}` : null,
    etapa_15: c15 ? ETAPA[c15.stage] ?? String(c15.stage) : null,
    etapa_viva: !!(c15 && ETAPAS_VIVAS.includes(c15.stage)),
    outros_funis: meusCards.filter((c) => c.funil !== 15).map((c) => `${FUNIL[c.funil]}#${c.id}`).join(' | ') || null,
    no_funil_19: no19.length > 0,
    rid, vendas: desemp?.vendas ?? null, consultas: desemp?.consultas ?? null,
    no_portal: !!onb, stage_portal: stage || null, biometria: bio || null,
    base_odres: cnpjs.some((c) => odres.has(c)),
    nossas_mensagens: envios,
    ultima_msg_lojista: ultimaIn.get(l.id)?.slice(0, 10) ?? null,
    silencio_dias: silencio,
    despedida_em: despedida.get(l.id)?.slice(0, 10) ?? null,
    deu_dados: /\[DADOS_COLETADOS:[^\]]*cnpj_matriz=/.test(obs),
    card_precisa_mover: !!(seDespediu && c15 && ETAPAS_VIVAS.includes(c15.stage)),
    disparo: l.data_disparo_inicial?.slice(0, 10) ?? l.criado_em.slice(0, 10),
    lead_id: l.id, opp_lead: l.evotalks_opportunity_id ? String(l.evotalks_opportunity_id) : null,
  }
})

fs.writeFileSync('scripts/out-descartados-pipeline.json', JSON.stringify(linhas, null, 1), 'utf8')
const n = (f: (l: typeof linhas[0]) => boolean) => linhas.filter(f).length
console.log(`\n── RESULTADO (${linhas.length}) ──`)
for (const r of ['DESCARTE OK', 'CONFERIR', 'NÃO DESCARTAR']) console.log(`${r}: ${n((l) => l.recomendacao === r)}`)
console.log(`\nCard em etapa VIVA (contradiz o descarte): ${n((l) => l.etapa_viva)}`)
console.log(`Com loja ativa (RID) ou vendendo: ${n((l) => !!l.rid || (l.vendas ?? 0) > 0)}`)
console.log(`Telefone também no funil 19: ${n((l) => l.no_funil_19)}`)
console.log(`Respondeu nos últimos 30 dias: ${n((l) => l.silencio_dias !== null && l.silencio_dias <= 30)}`)
console.log(`Nunca respondeu: ${n((l) => l.silencio_dias === null)}`)
console.log(`Encerramento já enviado ao lojista: ${n((l) => !!l.despedida_em)}`)
console.log(`Chegaram a dar os dados (CNPJ coletado): ${n((l) => l.deu_dados)}`)
console.log(`CARD PRECISA SER MOVIDO (encerrado mas parado em etapa de andamento): ${n((l) => l.card_precisa_mover)}`)
const porEtapa = new Map<string, number>()
for (const l of linhas) { const e = l.etapa_15 ?? '(sem card)'; porEtapa.set(e, (porEtapa.get(e) ?? 0) + 1) }
console.log('\nEtapa do card:', [...porEtapa].sort((a, b) => b[1] - a[1]).map(([e, q]) => `${e}=${q}`).join(' · '))
