/**
 * Conferência dos 230 CNPJs que a AIVA quer tirar do pipe — por CNPJ **E por
 * TELEFONE** (Aldo, 22/09/2026).
 *
 * POR QUE REFAZER: o levantamento de 18/09 procurou só pelo CNPJ, em
 * `sdr_registros_cnpj`. Isso deixa dois buracos conhecidos:
 *   1. `sdr_leads` NÃO é histórico: o sync APAGA o lead quando o card vai pro
 *      funil 19 (Odres/UME). Um CNPJ "sem nada nosso" pode ser um lojista que
 *      a gente prospectou, conversou e barrou — e isso só existe no Evo.
 *   2. Filial: o CNPJ da lista pode ser o 2º CNPJ de um lojista cuja MATRIZ
 *      está vendendo. Descartar o CNPJ é uma coisa; sumir com o lojista é outra.
 * Por isso aqui o telefone é chave de busca de primeira classe: sai do nosso
 * registro, do lead, do cadastro no portal da AIVA e do card do Evo, e é
 * procurado nos funis 15 (AIVA), 19 (Odres), 17 (Singlo) e 20.
 *
 * Só LÊ. Não move card, não marca lead, não fala com ninguém.
 * Uso: npx tsx --env-file=.env.local scripts/conferir-descartados-2026-09-22.mts
 */
import { listarOnboardingsApi, loginPortal, rest, partnerIdTrack, buscarPerformance } from '../lib/portal-aiva'
import { supabaseAdmin } from '../lib/supabase'
import { getPipeOpportunities } from '../lib/evotalks'
import fs from 'node:fs'

const so = (c: unknown) => String(c ?? '').replace(/\D/g, '')
/** Últimos 10 dígitos: é como telefone brasileiro casa entre fontes (com/sem 55, com/sem o 9). */
const chaveTel = (t: unknown) => { const d = so(t); return d.length >= 10 ? d.slice(-10) : '' }
const dvOk = (c: string) => {
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
  const calc = (base: string, pesos: number[]) => {
    const s = base.split('').reduce((a, d, i) => a + Number(d) * pesos[i], 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = calc(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return c[12] === String(d1) && c[13] === String(d2)
}
const dias = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null)

const cnpjs = [...new Set(fs.readFileSync('scripts/cnpjs-fora-2026-09-18.txt', 'utf8').split('\n').map(so).filter((c) => c.length === 14))]
console.log(`Lista: ${cnpjs.length} CNPJs únicos`)

const ETAPA: Record<number, string> = {
  66: 'Início', 47: 'Interessado', 53: 'Sem resposta', 54: 'Pré Aprovação', 49: 'Cadastro Recebido',
  50: 'Em Análise AIVA', 70: 'Treinar', 71: 'Login', 51: 'Vendendo', 69: 'Bot',
  93: 'Menos de 1 Ano', 94: 'CNPJ Irregular', 95: 'Descartada pela Aiva',
}
const FUNIL: Record<number, string> = { 15: 'AIVA (15)', 19: 'Odres/UME (19)', 17: 'Singlo (17)', 20: 'Funil 20' }

// ─── 1. PORTAL DA AIVA ───────────────────────────────────────────────────────
const onbs = await listarOnboardingsApi()
const portalPorCnpj = new Map(onbs.map((o) => [so((o as { cnpj?: string }).cnpj), o as Record<string, unknown>]))
console.log(`Portal: ${onbs.length} cadastros`)

const sessao = await loginPortal()
const partnerId = await partnerIdTrack(sessao)
const perf = await buscarPerformance(sessao, partnerId, null)
// desempenho por CNPJ e por retailer_id (a loja pode casar por qualquer um dos dois)
const perfPorCnpj = new Map<string, { vendas: number; consultas: number; ativo: boolean; nome: string | null; rid: string }>()
const perfPorRid = new Map<string, { vendas: number; consultas: number; ativo: boolean; nome: string | null; rid: string }>()
for (const p of perf) {
  const rid = String(p.retailer_id)
  const reg = { vendas: Number(p.n_vendas ?? 0), consultas: Number(p.n_consultas ?? 0), ativo: true, nome: p.retailer_name, rid }
  const ant = perfPorRid.get(rid)
  const soma = ant ? { ...reg, vendas: ant.vendas + reg.vendas, consultas: ant.consultas + reg.consultas } : reg
  perfPorRid.set(rid, soma)
  const c = so(p.cnpj)
  if (c) perfPorCnpj.set(c, soma)
}
console.log(`Portal desempenho: ${perfPorRid.size} lojas com histórico`)

// ─── 2. BASE ODRES ───────────────────────────────────────────────────────────
const odres = new Set<string>()
for (let de = 0; ; de += 1000) {
  const { data } = await supabaseAdmin.from('aiva_base_cnpjs').select('cnpj').range(de, de + 999)
  for (const r of data ?? []) odres.add(so((r as { cnpj: string }).cnpj))
  if (!data || data.length < 1000) break
}
console.log(`Base Odres: ${odres.size} CNPJs`)

// ─── 3. NOSSOS REGISTROS ─────────────────────────────────────────────────────
type Reg = { cnpj: string; lead_id: string | null; rid: string | null; status: string | null; loja: string | null; telefone: string | null; tipo: string | null }
const regs: Reg[] = []
for (let de = 0; ; de += 1000) {
  const { data } = await supabaseAdmin.from('sdr_registros_cnpj').select('cnpj,lead_id,rid,status,loja,telefone,tipo').range(de, de + 999)
  regs.push(...((data ?? []) as Reg[]))
  if (!data || data.length < 1000) break
}
const regPorCnpj = new Map<string, Reg[]>()
const regPorLead = new Map<string, Reg[]>()
for (const r of regs) {
  const c = so(r.cnpj)
  if (!regPorCnpj.has(c)) regPorCnpj.set(c, [])
  regPorCnpj.get(c)!.push(r)
  if (r.lead_id) {
    if (!regPorLead.has(r.lead_id)) regPorLead.set(r.lead_id, [])
    regPorLead.get(r.lead_id)!.push(r)
  }
}
console.log(`Registros: ${regs.length}`)

// ─── 4. LEADS (todos — índice por telefone, não só pelo vínculo do registro) ──
type Lead = { id: string; nome: string | null; telefone: string; status: string; evotalks_opportunity_id: string | number | null; observacoes: string | null; cidade: string | null; data_ultimo_contato: string | null }
const leads: Lead[] = []
for (let de = 0; ; de += 1000) {
  const { data } = await supabaseAdmin.from('sdr_leads').select('id,nome,telefone,status,evotalks_opportunity_id,observacoes,cidade,data_ultimo_contato').range(de, de + 999)
  leads.push(...((data ?? []) as Lead[]))
  if (!data || data.length < 1000) break
}
const leadPorId = new Map(leads.map((l) => [l.id, l]))
const leadPorTel = new Map<string, Lead[]>()
for (const l of leads) {
  const k = chaveTel(l.telefone)
  if (!k) continue
  if (!leadPorTel.has(k)) leadPorTel.set(k, [])
  leadPorTel.get(k)!.push(l)
}
console.log(`Leads: ${leads.length}`)

// ─── 5. CARDS DO EVO nos 4 funis, indexados por TELEFONE ─────────────────────
type Card = { funil: number; id: number; stage: number; titulo: string; tel: string }
const cards: Card[] = []
for (const pid of [15, 19, 17, 20]) {
  try {
    const opps = await getPipeOpportunities(pid)
    for (const o of opps) {
      const oo = o as unknown as Record<string, unknown>
      cards.push({ funil: pid, id: Number(oo.id), stage: Number(oo.fkStage), titulo: String(oo.title ?? ''), tel: chaveTel(oo.mainphone) })
    }
    console.log(`Funil ${pid}: ${opps.length} cards`)
  } catch (e) { console.log(`Funil ${pid}: FALHOU — ${String(e).slice(0, 80)}`) }
}
const cardPorTel = new Map<string, Card[]>()
const cardPorId = new Map<number, Card>()
for (const c of cards) {
  cardPorId.set(c.id, c)
  if (!c.tel) continue
  if (!cardPorTel.has(c.tel)) cardPorTel.set(c.tel, [])
  cardPorTel.get(c.tel)!.push(c)
}

// ─── 6. última mensagem DO LOJISTA por lead (só dos leads que vamos citar) ────
/** Quantas vezes NÓS falamos com esse lead. Separa "oportunidade desperdiçada"
 *  de "nome numa lista que nunca foi trabalhado". */
async function saidasPorLead(leadIds: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  for (const id of leadIds) {
    const { count } = await supabaseAdmin.from('sdr_mensagens').select('id', { count: 'exact', head: true }).eq('lead_id', id).eq('direcao', 'out')
    m.set(id, count ?? 0)
  }
  return m
}

async function ultimaEntrada(leadIds: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  for (let i = 0; i < leadIds.length; i += 100) {
    const { data } = await supabaseAdmin.from('sdr_mensagens').select('lead_id,enviado_em')
      .eq('direcao', 'in').in('lead_id', leadIds.slice(i, i + 100)).order('enviado_em', { ascending: false }).limit(5000)
    for (const r of (data ?? []) as { lead_id: string; enviado_em: string }[]) if (!m.has(r.lead_id)) m.set(r.lead_id, r.enviado_em)
  }
  return m
}

// ─── 7. cruza tudo, CNPJ a CNPJ ──────────────────────────────────────────────
type Linha = ReturnType<typeof montar> extends Promise<infer T> ? T : never
function telefonesDo(c: string): { tel: string; cheio: string; origem: string }[] {
  // `tel` é a CHAVE de cruzamento (10 dígitos); `cheio` é o número como está
  // gravado, que é o que o Nei precisa pra ligar/abrir a conversa.
  const out: { tel: string; cheio: string; origem: string }[] = []
  const add = (t: unknown, origem: string) => {
    const k = chaveTel(t)
    if (k && !out.some((x) => x.tel === k)) out.push({ tel: k, cheio: so(t), origem })
  }
  for (const r of regPorCnpj.get(c) ?? []) {
    add(r.telefone, 'registro')
    if (r.lead_id) add(leadPorId.get(r.lead_id)?.telefone, 'lead do registro')
  }
  add((portalPorCnpj.get(c) as { phone_number?: string } | undefined)?.phone_number, 'cadastro AIVA')
  // nenhuma das fontes acima tem telefone? o card do Evo tem (é o caso dos que
  // só existem no funil 19, cujo lead o sync apagou)
  if (!out.length) {
    for (const cd of cards.filter((x) => x.titulo && so(x.titulo) === c)) add(cd.tel, `card ${FUNIL[cd.funil]}`)
  }
  return out
}

const preLinhas = cnpjs.map((c) => {
  const rs = regPorCnpj.get(c) ?? []
  const rPrinc = rs.find((x) => x.lead_id) ?? rs[0] ?? null
  const leadDoRegistro = rPrinc?.lead_id ? leadPorId.get(rPrinc.lead_id) ?? null : null
  const tels = telefonesDo(c)
  // leads e cards achados PELO TELEFONE (inclui o que o registro não aponta)
  const leadsTel = tels.flatMap((t) => leadPorTel.get(t.tel) ?? [])
  const cardsTel = tels.flatMap((t) => cardPorTel.get(t.tel) ?? [])
  const lead = leadDoRegistro ?? leadsTel[0] ?? null
  return { c, rs, rPrinc, lead, tels, leadsTel, cardsTel }
})
const idsParaMsg = [...new Set(preLinhas.flatMap((p) => [p.lead?.id, ...p.leadsTel.map((l) => l.id)].filter(Boolean) as string[]))]
const ultimaMsg = await ultimaEntrada(idsParaMsg)
const nossosEnvios = await saidasPorLead(idsParaMsg)

async function montar(p: typeof preLinhas[0]) {
  const { c, rs, rPrinc, lead, tels, leadsTel, cardsTel } = p
  const onb = portalPorCnpj.get(c) as Record<string, unknown> | undefined
  const obs = lead?.observacoes ?? ''
  const ridReg = rs.find((r) => r.rid)?.rid ?? null
  const ridPortal = onb?.retailer_id ? String(onb.retailer_id) : null
  const rid = ridPortal ?? ridReg
  const desempenho = perfPorCnpj.get(c) ?? (rid ? perfPorRid.get(rid) ?? null : null)

  // card do funil 15 pelo opp do lead + qualquer card achado pelo telefone
  const oppLead = lead?.evotalks_opportunity_id ? Number(lead.evotalks_opportunity_id) : null
  const cardLead = oppLead ? cardPorId.get(oppLead) ?? null : null
  const todosCards = [...new Set([...(cardLead ? [cardLead] : []), ...cardsTel].map((x) => x.id))].map((id) => cardPorId.get(id)!).filter(Boolean)
  const noFunil19 = todosCards.filter((x) => x.funil === 19)
  const no15 = todosCards.find((x) => x.funil === 15) ?? null

  // OUTRAS lojas do mesmo lojista (mesmo telefone), por CNPJ
  const outrosCnpjs = [...new Set(leadsTel.flatMap((l) => (regPorLead.get(l.id) ?? []).map((r) => so(r.cnpj))))].filter((x) => x && x !== c)
  const outraAtiva = outrosCnpjs.filter((oc) => {
    const d = perfPorCnpj.get(oc)
    const regs2 = regPorCnpj.get(oc) ?? []
    return (d && (d.vendas > 0 || d.consultas > 0)) || regs2.some((r) => r.rid || r.status === 'ativa')
  })

  const msgIso = [lead?.id, ...leadsTel.map((l) => l.id)].filter(Boolean).map((id) => ultimaMsg.get(id as string)).filter(Boolean).sort().reverse()[0] ?? null
  const idsDele = [lead?.id, ...leadsTel.map((l) => l.id)].filter(Boolean) as string[]
  const envios = idsDele.reduce((a, id) => a + (nossosEnvios.get(id) ?? 0), 0)
  const silencio = dias(msgIso)

  // ── decisão ──────────────────────────────────────────────────────────────
  const motivos: string[] = []
  let rec = 'PODE DESCARTAR'
  const trava = (m: string) => { motivos.push(m); rec = 'NÃO DESCARTAR' }
  const olhar = (m: string) => { motivos.push(m); if (rec === 'PODE DESCARTAR') rec = 'CONFERIR' }

  if (desempenho && desempenho.vendas > 0) trava(`loja VENDENDO no portal (${desempenho.vendas} vendas)`)
  else if (desempenho && desempenho.consultas > 0) trava(`loja operando: ${desempenho.consultas} consultas de crédito`)
  if (rid) trava(`tem ID de loja na AIVA (RID ${rid})`)
  if (rs.some((r) => r.status === 'ativa')) trava('registro marcado como ativa')
  const stage = String(onb?.stage ?? '')
  const bio = String(onb?.biometry_status ?? '')
  if (stage && stage !== 'dados_varejo') trava(`cadastro avançou no portal (${stage}${bio ? `, biometria ${bio}` : ''})`)
  if (bio === 'aprovado') trava('biometria APROVADA — esperando só a AIVA criar a loja')
  if (no15 && [51, 71, 70, 49].includes(no15.stage)) trava(`card em ${ETAPA[no15.stage]} no funil 15`)
  if (lead && ['LOJA_FINALIZADA_E_VENDENDO', 'TREINAR', 'LOGIN', 'CADASTRO_RECEBIDO'].includes(lead.status)) trava(`lead em ${lead.status}`)
  // 3 dias, não 7: "conversa viva" tem que significar viva mesmo. Quem falou na
  // semana passada e sumiu está na régua de cobrança — isso é CONFERIR, não trava.
  if (silencio !== null && silencio <= 3) trava(`conversa VIVA — lojista falou há ${silencio} dia(s)`)
  if (outraAtiva.length) trava(`é 2º CNPJ de lojista com loja ativa (${outraAtiva.join(', ')})`)

  if (noFunil19.length) olhar(`telefone está no funil 19 Odres/UME (${noFunil19.map((x) => `#${x.id}`).join(', ')})`)
  if (odres.has(c)) olhar('CNPJ consta na base Odres')
  if (!dvOk(c)) olhar('CNPJ com dígito verificador inválido — erro de digitação na origem')
  if (!rs.length && leadsTel.length) olhar(`sem registro deste CNPJ, mas o telefone é lead nosso (${leadsTel[0].status})`)
  if (!rs.length && !leadsTel.length && todosCards.length) olhar(`sem lead nosso, mas tem card no Evo (${todosCards.map((x) => FUNIL[x.funil]).join(', ')})`)
  if (silencio !== null && silencio > 3 && silencio <= 30) olhar(`lojista respondeu há ${silencio} dias e a cobrança automática do formulário ainda está atuando nele`)
  if (lead?.status === 'DESCARTADO' && silencio !== null && silencio <= 30) olhar('lead está DESCARTADO na nossa base mas o lojista respondeu recentemente — contradição, vale olhar a conversa')
  if (obs.includes('[SENHA_ENVIADA:')) olhar('senha do sócio já foi enviada pela AIVA')

  if (rec === 'PODE DESCARTAR') {
    if (!rs.length && !leadsTel.length && !todosCards.length) motivos.push('não é oportunidade nossa: sem registro, sem lead e sem card em nenhum funil')
    else if (envios === 0) motivos.push(`nunca trabalhado: a gente nunca mandou mensagem pra esse lojista${stage ? ` (portal: ${stage})` : ''}`)
    else motivos.push(`sem avanço: ${stage || 'não está no portal'}, ${envios} mensagens nossas e ${silencio === null ? 'nenhuma resposta dele' : `${silencio} dias em silêncio`}`)
  }

  return {
    cnpj: c, recomendacao: rec, motivos: motivos.join(' · '),
    dv_valido: dvOk(c),
    loja: lead?.nome ?? rPrinc?.loja ?? (onb?.legal_name as string | undefined) ?? null,
    razao_portal: (onb?.legal_name as string | undefined) ?? null,
    telefones: tels.map((t) => `${t.cheio || t.tel} (${t.origem})`).join(' | '),
    cidade: lead?.cidade ?? null,
    status_lead: lead?.status ?? null,
    lead_por_telefone: !rPrinc?.lead_id && leadsTel.length > 0,
    etapa_15: no15 ? ETAPA[no15.stage] ?? String(no15.stage) : null,
    cards_evo: todosCards.map((x) => `${FUNIL[x.funil]}#${x.id}`).join(' | ') || null,
    no_funil_19: noFunil19.length > 0,
    rid, rid_origem: ridPortal ? 'portal' : ridReg ? 'registro' : null,
    vendas: desempenho?.vendas ?? null, consultas: desempenho?.consultas ?? null,
    no_portal: !!onb, stage_portal: stage || null, biometria: bio || null,
    formulario: (onb?.formulario_status as string | undefined) ?? null,
    pre_cadastro: (onb?.pre_cadastro_status as string | undefined) ?? null,
    criado_portal: String(onb?.created_at ?? '').slice(0, 10) || null,
    base_odres: odres.has(c),
    outros_cnpjs_do_lojista: outrosCnpjs.join(', ') || null,
    outra_loja_ativa: outraAtiva.join(', ') || null,
    nossas_mensagens: envios,
    nunca_trabalhado: envios === 0,
    ultima_msg_lojista: msgIso ? msgIso.slice(0, 10) : null,
    silencio_dias: silencio,
    tipo_registro: rPrinc?.tipo ?? null,
    temos_registro: rs.length > 0,
    marcadores: [
      obs.includes('[PORTAL_REPROVADO') ? 'REPROVADO_AIVA' : '',
      obs.includes('[CNPJ_IRREGULAR_AIVA:') ? 'CNPJ_IRREGULAR' : '',
      obs.includes('[IMPORTADO_PORTAL:') ? 'IMPORTADO' : '',
      obs.includes('[SENHA_ENVIADA:') ? 'SENHA_ENVIADA' : '',
      obs.includes('[COBRANCA_FORM_ESGOTADO]') ? 'COBRANCA_ESGOTADA' : '',
    ].filter(Boolean).join(' ') || null,
  }
}

const linhas = [] as Awaited<ReturnType<typeof montar>>[]
for (const p of preLinhas) linhas.push(await montar(p))
fs.writeFileSync('scripts/out-descartados-conferidos.json', JSON.stringify(linhas, null, 1), 'utf8')

const n = (f: (l: Linha) => boolean) => linhas.filter(f).length
console.log(`\n── RESULTADO ──`)
for (const r of ['PODE DESCARTAR', 'CONFERIR', 'NÃO DESCARTAR']) console.log(`${r}: ${n((l) => l.recomendacao === r)}`)
console.log(`\nAchados só pelo TELEFONE (o levantamento por CNPJ não via): ${n((l) => l.lead_por_telefone)}`)
console.log(`No funil 19 (Odres/UME): ${n((l) => l.no_funil_19)}`)
console.log(`Com loja ativa/vendendo: ${n((l) => (l.vendas ?? 0) > 0 || !!l.rid)}`)
console.log(`2º CNPJ de lojista com outra loja ativa: ${n((l) => !!l.outra_loja_ativa)}`)
console.log(`Sem NADA nosso (nem card no Evo): ${n((l) => !l.temos_registro && !l.cards_evo)}`)
console.log(`Nunca trabalhados (zero mensagem nossa): ${n((l) => l.nunca_trabalhado)}`)
console.log(`Nunca responderam nada: ${n((l) => l.silencio_dias === null)}`)
