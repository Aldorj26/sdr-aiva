/**
 * lib/relatorio-loja.ts — o RELATÓRIO SEMANAL da loja ativa na AIVA (Aldo 20/10/2026), aberto
 * pelo lojista no celular pelo link /r/<token> que vai no HSM da rotina /api/sdr/dicas-desempenho.
 * Mesma mecânica do Farm Track da Parcelex; conteúdo 100% AIVA (firewall).
 *
 * O cálculo puro está em lib/relatorio-loja-calc.ts (testado); aqui é só banco + HTML.
 */
import { randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { desempenhoPorCnpjs } from '@/lib/desempenho-loja'
import { diagnosticar, pct, brl, diaMes, type RetratoDia, type Diagnostico, type MediaRede } from '@/lib/relatorio-loja-calc'

export const BASE_RELATORIO = (process.env.APP_URL ?? 'https://sdr-aiva.vercel.app') + '/r/'

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const novoToken = () => Array.from(randomBytes(16), (b) => ALFABETO[b % ALFABETO.length]).join('')

/** Link estável por lead: o mesmo toda semana (o lojista pode salvar). */
export async function linkDoLead(leadId: string, cnpjs: string[]): Promise<string> {
  const { data } = await supabaseAdmin.from('aiva_relatorio_link').select('token').eq('lead_id', leadId).maybeSingle()
  if (data?.token) return BASE_RELATORIO + data.token
  const token = novoToken()
  const { error } = await supabaseAdmin.from('aiva_relatorio_link').insert({ token, lead_id: leadId, cnpjs })
  if (error) {
    // corrida com outra execução: a outra gravou primeiro, usa a dela
    const { data: outra } = await supabaseAdmin.from('aiva_relatorio_link').select('token').eq('lead_id', leadId).maybeSingle()
    if (outra?.token) return BASE_RELATORIO + outra.token
    throw new Error(`link do relatório: ${error.message}`)
  }
  return BASE_RELATORIO + token
}

export interface Relatorio { nome: string; cnpjs: string[]; data: string; d: Diagnostico | null }

/** Retrato mais recente do portal e as taxas de todas as lojas nele. */
async function redeNoUltimoRetrato(): Promise<{ data: string; mes: string; rede: MediaRede }> {
  const { data: ult } = await supabaseAdmin.from('aiva_portal_diario').select('data_ref').order('data_ref', { ascending: false }).limit(1)
  const data = String(ult?.[0]?.data_ref ?? '').slice(0, 10)
  if (!data) throw new Error('aiva_portal_diario vazia')
  const mes = data.slice(0, 7) + '-01'
  const { data: rows } = await supabaseAdmin.from('aiva_portal_diario').select('consultas,aprovados,vendas').eq('data_ref', data).eq('mes', mes).limit(5000)
  let c = 0, a = 0, v = 0
  for (const r of rows ?? []) { c += Number(r.consultas || 0); a += Number(r.aprovados || 0); v += Number(r.vendas || 0) }
  return { data, mes, rede: { aprovacao: c > 0 ? a / c : null, conversao: a > 0 ? v / a : null } }
}

/** Lê o relatório de um token (e conta o acesso). null = token inexistente. */
export async function relatorioDoToken(token: string): Promise<Relatorio | null> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(token)) return null
  const { data: link } = await supabaseAdmin.from('aiva_relatorio_link').select('token, lead_id, cnpjs, acessos').eq('token', token).maybeSingle()
  if (!link) return null
  const cnpjs = link.cnpjs as string[]
  const [{ data: lead }, { data: topo, mes, rede }] = await Promise.all([
    supabaseAdmin.from('sdr_leads').select('nome, observacoes').eq('id', link.lead_id).maybeSingle(),
    redeNoUltimoRetrato(),
  ])
  const { data: rows } = cnpjs.length
    ? await supabaseAdmin.from('aiva_portal_diario').select('data_ref,nome_varejo,consultas,aprovados,vendas,valor_vendas').in('cnpj', cnpjs).eq('mes', mes).lte('data_ref', topo).limit(5000)
    : { data: [] as never[] }
  const serie: RetratoDia[] = (rows ?? []).map((r) => ({ data: String(r.data_ref).slice(0, 10), consultas: r.consultas, aprovados: r.aprovados, vendas: r.vendas, valor_vendas: r.valor_vendas }))
  const nomePortal = (rows ?? []).map((r) => r.nome_varejo).find(Boolean)
  const nomeVarejo = (lead?.observacoes ?? '').match(/nome_varejo=([^|\]]+)/)?.[1]?.trim()
  const nome = String(nomePortal || nomeVarejo || lead?.nome || 'Sua loja')
  // segmento das semanas fechadas: distingue "nunca consultou" de "vendia e parou"
  const seg = await desempenhoPorCnpjs(cnpjs).then((r) => r?.segmento ?? null).catch(() => null)
  // loja que ainda não apareceu no portal este mês: retrato zerado, pra página não ficar em branco
  const d = diagnosticar(serie.length ? serie : [{ data: topo, consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 }], seg, rede)
  await supabaseAdmin.from('aiva_relatorio_link').update({ acessos: Number(link.acessos || 0) + 1, ultimo_acesso: new Date().toISOString() }).eq('token', token)
  return { nome, cnpjs, data: topo, d }
}

// ── HTML ────────────────────────────────────────────────────────────────────────────────
// Página solta (sem o layout do painel): vai aberta no navegador do WhatsApp. Sem JS —
// nada depende de script pra aparecer (regra dos HTML de celular do workspace).

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const cnpjFmt = (c: string) => c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c
const sinal = (v: number) => (v > 0 ? `+${v}` : `${v}`)

export function htmlRelatorio(r: Relatorio): string {
  const d = r.d!
  const etapas = [
    ['Consultas de CPF', String(d.consultas), `${sinal(d.semana.consultas)} na semana`],
    ['Aprovados', String(d.aprovados), d.txAprovacao != null ? `${pct(d.txAprovacao)} das consultas` : ''],
    ['Vendas', String(d.vendas), `${sinal(d.semana.vendas)} na semana`],
    ['Valor vendido', brl(d.valor), d.vendas > 0 && d.txConversao != null ? `${pct(d.txConversao)} dos aprovados viraram venda` : ''],
  ]
  const eventos = d.eventos.map((e) => {
    const partes = [e.aprovacoes ? `${e.aprovacoes} ${e.aprovacoes === 1 ? 'aprovação' : 'aprovações'}` : '', e.vendas ? `${e.vendas} ${e.vendas === 1 ? 'venda' : 'vendas'}` : ''].filter(Boolean)
    return `<li><b>${diaMes(e.data)}</b> — ${partes.join(' e ')}</li>`
  }).join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Seu relatório AIVA</title>
<style>
:root{--bg:#f4f6f8;--card:#fff;--tx:#14202b;--mut:#5b6b78;--pri:#5b21b6;--pribg:#f3effb;--bd:#e3e8ec}
*{box-sizing:border-box}html,body{overflow-x:hidden}
body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
main{max-width:560px;margin:0 auto;padding:20px 16px 40px}
header h1{font-size:22px;margin:0 0 4px}header p{margin:0;color:var(--mut);font-size:14px}
.loja{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:18px 16px;margin-top:18px}
h2{font-size:19px;margin:0}.cnpj{margin:2px 0 14px;color:var(--mut);font-size:13px}
h3{font-size:16px;margin:18px 0 8px}
.funil{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.etapa{background:var(--bg);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;min-width:0}
.etapa .t{font-size:13px;color:var(--mut)}.etapa .v{font-size:24px;font-weight:700}.etapa .s{font-size:12px;color:var(--mut)}
.gargalo{border-left:4px solid var(--pri);background:var(--pribg);border-radius:8px;padding:10px 12px;margin-top:14px}
.gargalo h3{margin:0 0 4px}.gargalo p{margin:0;font-size:15px}
.dicas,.eventos{padding-left:20px;margin:0}.dicas li,.eventos li{margin:6px 0;font-size:15px}
footer{margin-top:22px;color:var(--mut);font-size:13px;text-align:center}
</style></head><body><main>
<header><h1>📊 Seu relatório AIVA</h1><p>Acumulado de ${d.mes}, dados do portal da AIVA até ${diaMes(r.data)}.</p></header>
<section class="loja">
  <h2>${esc(r.nome)}</h2><p class="cnpj">${r.cnpjs.map(cnpjFmt).join(' · ')}</p>
  <div class="funil">${etapas.map(([t, v, s]) => `<div class="etapa"><span class="t">${t}</span><span class="v">${v}</span>${s ? `<span class="s">${s}</span>` : ''}</div>`).join('')}</div>
  <div class="gargalo g-${d.gargalo}"><h3>🎯 ${esc(d.titulo)}</h3><p>${esc(d.explicacao)}</p></div>
  <h3>O que fazer esta semana</h3>
  <ol class="dicas">${d.dicas.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
  ${eventos ? `<h3>Quando saíram as aprovações e vendas</h3><ul class="eventos">${eventos}</ul>` : ''}
</section>
<footer>Dúvidas? Responda a mensagem no WhatsApp — a VictorIA te ajuda.<br>Track · parceira AIVA</footer>
</main></body></html>`
}

export function htmlNaoEncontrado(): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Relatório AIVA</title>
<style>body{margin:0;background:#f4f6f8;font:16px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#14202b}main{max-width:560px;margin:0 auto;padding:40px 16px}</style></head>
<body><main><h1>Relatório não encontrado</h1><p>Este link não está mais válido. O relatório novo chega na próxima mensagem semanal; se precisar antes, responda a mensagem no WhatsApp.</p></main></body></html>`
}
