/**
 * Turmas de treinamento — parte PURA (sem rede): fallback, formatação e o bloco do
 * prompt. A leitura do portal fica em lib/turmas-treinamento.ts.
 */

export type Turma = { startsAt: string; inviteId: string; link: string; label: string | null }
export type Fonte = 'portal' | 'cache' | 'fallback'

/** Última agenda publicada pela AIVA (16/09/2026): seg/qua/sex 9h30 BRT, um link. Só entra se o portal não responder. */
export const REGRA_FALLBACK = { diasSemana: [1, 3, 5], horaUtc: '12:30', inviteId: 'vou-gpmy-rtp' } as const
const DURACAO_MIN = 60
/** Turma que começou há menos de 90 min ainda conta como "atual" (a live dura 1h). */
export const TOLERANCIA_MS = 90 * 60 * 1000

export const linkMeet = (inviteId: string) => `https://meet.google.com/${inviteId}`

export function gerarFallback(agora: Date, n: number, regra = REGRA_FALLBACK): Turma[] {
  const out: Turma[] = []
  const [hh, mm] = regra.horaUtc.split(':').map(Number)
  for (let add = 0; add <= 21 && out.length < n; add++) {
    const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + add, hh, mm))
    if (d.getTime() < agora.getTime() - TOLERANCIA_MS) continue
    if (!(regra.diasSemana as readonly number[]).includes(d.getUTCDay())) continue
    out.push({ startsAt: d.toISOString(), inviteId: regra.inviteId, link: linkMeet(regra.inviteId), label: null })
  }
  return out
}

export const futuras = (turmas: Turma[], agora: Date, n: number) =>
  turmas.filter((t) => Date.parse(t.startsAt) >= agora.getTime() - TOLERANCIA_MS).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, n)

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const brt = (iso: string) => new Date(Date.parse(iso) - 3 * 60 * 60 * 1000)
export const diaSemana = (t: Turma) => DIAS[brt(t.startsAt).getUTCDay()]
export const dataCurta = (t: Turma) => `${String(brt(t.startsAt).getUTCDate()).padStart(2, '0')}/${String(brt(t.startsAt).getUTCMonth() + 1).padStart(2, '0')}`
export const hora = (t: Turma) => { const d = brt(t.startsAt); return `${d.getUTCHours()}h${String(d.getUTCMinutes()).padStart(2, '0')}` }
/** "segunda 21/09, 9h30" */
export const rotulo = (t: Turma) => `${diaSemana(t)} ${dataCurta(t)}, ${hora(t)}`

/** "segunda, quarta e sexta" — dias distintos das turmas, na ordem em que aparecem. */
export function resumoDias(turmas: Turma[]): string {
  const dias = [...new Set(turmas.map(diaSemana))]
  if (!dias.length) return 'nos dias da agenda'
  if (dias.length === 1) return dias[0]
  return `${dias.slice(0, -1).join(', ')} e ${dias[dias.length - 1]}`
}

/** Link do Google Calendar pra turma (1h). */
export function calendarLink(t: Turma): string {
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const ini = Date.parse(t.startsAt)
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Treinamento AIVA')}&dates=${fmt(ini)}/${fmt(ini + DURACAO_MIN * 60000)}&details=${encodeURIComponent(`Link da reunião: ${t.link}`)}&location=${encodeURIComponent(t.link)}`
}

/** Linhas "🔗 segunda 21/09, 9h30 👉 meet.google.com/xxx" (sem https — o WhatsApp mostra melhor). */
export function linhasTurmas(turmas: Turma[]): string[] {
  return turmas.map((t) => `🔗 ${rotulo(t)} 👉 ${t.link.replace('https://', '')}`)
}

/** Bloco pro prompt dinâmico (fora do cache). */
export function blocoTurmasPrompt(turmas: Turma[], fonte: Fonte): string {
  const linhas = turmas.map((t) => `- ${rotulo(t)} (Brasília) → ${t.link}`).join('\n')
  return `## 🎓 TURMAS DE TREINAMENTO AO VIVO — agenda oficial da AIVA${fonte === 'fallback' ? ' (última agenda conhecida; portal indisponível agora)' : ''}

${linhas || '- (nenhuma turma publicada — diga que o time confirma a próxima data)'}

Regras: estes são os ÚNICOS dias e links válidos — use-os exatamente como estão (cada turma
tem o link listado; pode ser o mesmo pra várias). Duração: 1 hora a partir do horário. NÃO cite
dias ou links de memória, do histórico ou de correções antigas ("segundas e quintas", links
antigos): a agenda mudou e só este bloco vale. "Quando é o próximo treinamento?" → a primeira
turma acima. Se o lojista disser que vai em um dia específico, mande o link daquela turma.
Os dias da semana deste bloco já vêm calculados e são oficiais — pode citá-los (a proibição
de deduzir dia da semana vale só para datas que NÃO estão aqui).
O login do SÓCIO sai em leva após cada treinamento desta agenda (não diga "segunda e quinta").`
}
