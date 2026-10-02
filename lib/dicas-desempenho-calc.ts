/**
 * dicas-desempenho-calc.ts — dica de vendas com os números da loja (Aldo 02/10/2026).
 * Substitui a consultoria-vendas (4 toques fixos, sem número nenhum, resposta caindo de 27% pra 11%).
 *
 * Cadência: 1ª dica 7 dias depois de a loja entrar em LOJA_FINALIZADA_E_VENDENDO
 * ([CONSULTORIA_INICIO], gravado pelo /opportunity-stage); depois SEMANAL pra quem vende ou
 * aprova e QUINZENAL pra quem está parado (intervaloDias do desempenho-loja-calc). Sem fim:
 * a série não "acaba" — quem para de vender continua recebendo, só que a cada 15 dias.
 * Entrega: HSM 48 ("Olá {{1}}, {{2}}"), {{2}} em UMA linha, sem \n e sem link.
 */
import { intervaloDias, type Resumo, type Segmento } from './desempenho-loja-calc.ts'

const DIA = 24 * 60 * 60 * 1000
export const ROTULO = 'aiva_dicas_desempenho'
/** Lojista falou com a gente há menos que isso → a conversa está viva, a VictorIA já está nela. */
export const CONVERSA_VIVA_HORAS = 48
/** Não encosta numa loja que levou a consultoria antiga há menos que isso (transição). */
export const RESPIRO_CONSULTORIA_DIAS = 7

export type Marcadores = {
  inicio: number | null
  ultima: number | null
  count: number
  consultoriaUltima: number | null
  optout: boolean
  pausaAte: number | null
  semAcesso: boolean        // senha pendente ou cadastro aberto: não dá pra cobrar venda
  reprovado: boolean
}

export function lerMarcadores(obs: string | null | undefined): Marcadores {
  const o = obs ?? ''
  const data = (re: RegExp) => { const m = o.match(re); const t = m ? Date.parse(m[1]) : NaN; return Number.isNaN(t) ? null : t }
  return {
    inicio: data(/\[CONSULTORIA_INICIO:([^\]]+)\]/),
    ultima: data(/\[DICAS_ULTIMA:([^\]]+)\]/),
    count: Number(o.match(/\[DICAS_COUNT:(\d+)\]/)?.[1] ?? 0),
    consultoriaUltima: data(/\[CONSULTORIA_ULTIMA:([^\]]+)\]/),
    optout: o.includes('[CONSULTORIA_OPTOUT]') || o.includes('[DICAS_OPTOUT]'),
    pausaAte: data(/\[PAUSA_ATE:([^\]]+)\]/),
    semAcesso: o.includes('[SENHA_PENDENTE_DESDE:') || o.includes('[ONB_ETAPA:'),
    reprovado: o.includes('[PORTAL_REPROVADO'),
  }
}

export type Decisao = { acao: 'enviar' } | { acao: 'nada'; motivo: string }

export function decidir(m: Marcadores, seg: Segmento, ultimaFalaLojista: number | null, agora = Date.now()): Decisao {
  if (m.optout) return { acao: 'nada', motivo: 'optout' }
  if (m.reprovado) return { acao: 'nada', motivo: 'reprovado' }
  if (m.semAcesso) return { acao: 'nada', motivo: 'sem_acesso' }
  if (m.pausaAte && m.pausaAte > agora) return { acao: 'nada', motivo: 'pausa' }
  if (ultimaFalaLojista && agora - ultimaFalaLojista < CONVERSA_VIVA_HORAS * 3600_000) return { acao: 'nada', motivo: 'conversa_viva' }
  if (m.consultoriaUltima && agora - m.consultoriaUltima < RESPIRO_CONSULTORIA_DIAS * DIA) return { acao: 'nada', motivo: 'consultoria_recente' }
  if (m.ultima === null) {
    // 1ª dica: 7 dias depois de entrar na etapa. Loja sem a data (entrou antes do marcador
    // existir) é antiga — está liberada.
    if (m.inicio !== null && agora - m.inicio < 7 * DIA) return { acao: 'nada', motivo: 'menos_de_7_dias_na_etapa' }
    return { acao: 'enviar' }
  }
  // folga de 12h: o cron roda em hora fixa e o envio de ontem saiu alguns minutos depois
  return agora - m.ultima >= intervaloDias(seg) * DIA - 12 * 3600_000 ? { acao: 'enviar' } : { acao: 'nada', motivo: 'aguardando_intervalo' }
}

/** Ordem da fila: onde a dica rende mais primeiro (aprovado que não fecha é venda pronta). */
export const PRIORIDADE: Record<Segmento, number> = { aprova_nao_vende: 0, vende_pouco: 1, parou: 2, vende_firme: 3, sem_uso: 4 }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** {{2}} do HSM 48. Varia pelo número de dicas já enviadas. */
export function textoDica(r: Resumo, count: number): string {
  const s0 = r.semanas[0]
  const v2 = pl(r.vendas2, 'venda', 'vendas')
  const a2 = pl(r.aprovados2, 'cliente aprovado', 'clientes aprovados')
  const op: Record<Segmento, string[]> = {
    vende_firme: [
      `na semana de ${ddmm(s0.semana)} sua loja fez ${pl(s0.vendas, 'venda', 'vendas')} pela AIVA (${brl(s0.valor_vendas)}) 👏 Dica pra subir o ticket: venda dentro do limite aprovado e complete com capa, película e fone. Quer que eu te passe como a equipe pode oferecer isso?`,
      `sua loja segue firme na AIVA: ${v2} nas últimas 2 semanas 💪 Dica da semana: ofereça o crediário pra TODO cliente que entra, até pra quem veio só olhar — quem consulta mais, vende mais. Como está o movimento aí?`,
      `${v2} nas últimas 2 semanas, parabéns! 🎉 Lembrete pra motivar o time: a AIVA paga R$ 10 por venda pro vendedor, via Pix na chave CPF. Seus vendedores já estão cadastrados pra receber?`,
    ],
    vende_pouco: [
      `nas últimas 2 semanas sua loja teve ${a2} e ${v2} pela AIVA. Dica rápida: quando aprovar, mostre o aparelho que cabe no limite e fale da parcela, não do preço cheio. Quer mais umas dicas pra fechar esses aprovados?`,
      `vi que a loja já vende pela AIVA (${v2} nas últimas 2 semanas) 👏 Dica de hoje: consulte o CPF logo no começo do atendimento, antes de mostrar aparelho — aí você já oferece o que cabe no limite. Tem funcionado assim aí?`,
      `${v2} nas últimas 2 semanas — dá pra crescer! Uma placa "Parcelamos seu celular" no balcão e na vitrine faz o cliente perguntar sozinho. Vocês já têm alguma sinalização na loja?`,
    ],
    aprova_nao_vende: [
      `nas últimas 2 semanas sua loja teve ${a2} pela AIVA, mas nenhuma venda fechou. Esse cliente já está com o crédito liberado — dá pra converter! Quer que eu te conte o que costuma travar nessa hora e como resolver?`,
      `${a2} nas últimas 2 semanas e nenhuma venda: o crédito está saindo, a venda é que não fecha. Dica: mostre o aparelho dentro do limite e pergunte "prefere 9x ou 12x?" em vez de "quer levar?". O que o cliente costuma dizer quando desiste?`,
      `sua loja continua aprovando cliente na AIVA (${a2} nas últimas 2 semanas) — falta fechar. Deixar claro logo no começo que a entrada é de 25% evita a desistência no final. Quer conversar sobre como abordar?`,
    ],
    parou: [
      `faz umas semanas que não vejo venda da sua loja pela AIVA no portal — está tudo certo por aí? Se travou alguma coisa (acesso, sistema, aprovação), me conta que eu te ajudo a destravar.`,
      `sentimos falta das vendas da sua loja pela AIVA 😊 Dica pra retomar: consulte o CPF de todo cliente que pedir preço, até de quem diz que vai pagar à vista — muitos acabam parcelando. Quer outras ideias?`,
      `sua loja já vendeu pela AIVA e pode voltar a vender! Se o que travou foi vendedor sem acesso, o cadastro agora é por formulário e eu te mando o link. Como estão as coisas aí?`,
    ],
    sem_uso: [
      `sua loja já está liberada na AIVA, mas ainda não vi venda pelo portal. Ficou alguma dúvida no primeiro uso? Se quiser, te explico o passo a passo da primeira consulta — é rapidinho.`,
      `a primeira venda pela AIVA é a que mais demora — depois embala 😊 Dica: escolha hoje 1 cliente que pediu preço e faça a consulta do CPF com ele na hora. Quer que eu te ajude no passo a passo?`,
      `passando pra saber se está tudo certo com o acesso da loja na AIVA — ainda não vi vendas por aqui. Se o login, a senha ou o cadastro dos vendedores travou, me conta que eu te mostro o caminho.`,
    ],
  }
  const lista = op[r.segmento]
  return lista[count % lista.length]
}

export function remontarObs(obs: string | null | undefined, count: number, seg: Segmento, agora = new Date()): string {
  const base = (obs ?? '')
    .replace(/\s*\[DICAS_(COUNT|ULTIMA|SEG):[^\]]*\]/g, '')
    .trim()
  return `${base} [DICAS_COUNT:${count}] [DICAS_ULTIMA:${agora.toISOString()}] [DICAS_SEG:${seg}]`.trim()
}
