/**
 * lib/descarte-calc.ts — "dá pra descartar esta conta?", uma regra só.
 *
 * POR QUE EXISTE: em 22/09/2026 saíram duas conferências de descarte no mesmo dia
 * (a lista de 230 CNPJs que a AIVA quer fora do pipe e os 64 "descartados no
 * pipeline" do painel). Cada script tinha a sua cópia da regra, e as cópias
 * divergiram: as duas listas se cruzavam em 36 lojas e **24 recebiam veredito
 * diferente** — a mesma loja era "PODE DESCARTAR" numa planilha e "CONFERIR" na
 * outra. O Aldo pegou na hora ("não são os mesmos leads?").
 *
 * É o mesmo defeito que o CLAUDE.md já avisa pro prompt da VictorIA: regra nova
 * convivendo com cópia antiga = comportamento alternado. Então a decisão mora
 * aqui, pura e testada, e os dois scripts só montam os sinais e perguntam.
 *
 * O QUE DIVERGIA, e como ficou:
 *   - "Em Análise AIVA" (etapa 50) e "Interessado" (47) contavam como etapa viva
 *     num script e não no outro. Resolvido separando ETAPAS_AVANCADAS (avanço
 *     real: trava) de ETAPAS_EM_CURSO (só conta junto com esforço investido).
 *   - "conversa viva" era 3 dias num e 7 no outro → 3 nos dois; de 4 a 30 dias é
 *     CONFERIR, porque a cobrança automática do formulário ainda está atuando.
 *   - só um dos scripts via a mensagem de encerramento enviada pelo painel → é o
 *     sinal mais importante da lista e agora vale nos dois.
 *
 * Resultado: das 36 lojas que aparecem nas DUAS listas, zero recebem veredito
 * diferente. Se alguém mexer nesta regra, conferir isso de novo é o teste que
 * importa — divergência entre as duas planilhas é o defeito que ela evita.
 */

/** Etapas que provam AVANÇO REAL da loja: o cadastro foi recebido e a jornada
 *  andou. Card aqui trava o descarte. */
export const ETAPAS_AVANCADAS = [49, 70, 71, 51]

/** Etapas EM CURSO — o card está numa fase intermediária, mas isso sozinho não
 *  prova nada. ⚠️ "Em Análise AIVA" (50) é o caso clássico: o card entra ali
 *  quando o cadastro vai pra AIVA e FICA ali até alguém mover. Lojista que
 *  começou o formulário e sumiu há 4 meses continua em 50. Tratar isso como
 *  trava marcava 151 dos 230 CNPJs como "não descartar", o que é o contrário do
 *  que a evidência diz. Aqui vira CONFERIR, não trava. */
export const ETAPAS_EM_CURSO = [47, 54, 50]

/** As duas juntas — o card não está num fim de jornada. */
export const ETAPAS_VIVAS = [...ETAPAS_AVANCADAS, ...ETAPAS_EM_CURSO]
/** Etapas que são fim de jornada: card ali CONCORDA com o descarte. */
export const ETAPAS_FINAIS = [53, 93, 94, 95, 66]
/** Status do lead que, por si só, dizem que a loja está andando. */
export const STATUS_VIVOS = ['LOJA_FINALIZADA_E_VENDENDO', 'TREINAR', 'LOGIN', 'CADASTRO_RECEBIDO']
/** Até aqui a conversa é viva de verdade. Acima disso vira "conferir", não trava. */
export const DIAS_CONVERSA_VIVA = 3
/** Janela em que a régua de cobrança ainda está trabalhando o lead. */
export const DIAS_CADENCIA_ATIVA = 30
/** Até aqui a conversa ainda é recente o bastante pra pesar numa decisão. */
export const DIAS_SILENCIO_RELEVANTE = 60

export type Sinais = {
  vendas?: number | null
  consultas?: number | null
  rid?: string | null
  registroAtiva?: boolean
  stagePortal?: string | null
  biometria?: string | null
  etapaCard?: number | null
  nomeEtapa?: string | null
  statusLead?: string | null
  silencioDias?: number | null
  /** recebeu "vou encerrar nossa conversa por aqui" pelo painel */
  despedidaEm?: string | null
  outraLojaAtiva?: string[]
  noFunil19?: string[]
  baseOdres?: boolean
  dvInvalido?: boolean
  temRegistro?: boolean
  achadoSoPorTelefone?: boolean
  temCard?: boolean
  senhaEnviada?: boolean
  enviosNossos?: number
  /** entregou CNPJ e dados de qualificação — esforço investido pelo lojista */
  deuOsDados?: boolean
}

export type Veredito = {
  recomendacao: 'NÃO DESCARTAR' | 'CONFERIR' | 'PODE DESCARTAR'
  motivos: string[]
  /** encerrado com o lojista, mas o card ficou numa etapa de andamento */
  cardPrecisaMover: boolean
}

export function decidirDescarte(s: Sinais): Veredito {
  const motivos: string[] = []
  let rec: Veredito['recomendacao'] = 'PODE DESCARTAR'
  const trava = (m: string) => { motivos.push(m); rec = 'NÃO DESCARTAR' }
  const olhar = (m: string) => { motivos.push(m); if (rec === 'PODE DESCARTAR') rec = 'CONFERIR' }

  const sil = s.silencioDias ?? null
  /** respondeu em tempo que ainda conta como relacionamento vivo */
  const silencioCurto = sil !== null && sil <= DIAS_SILENCIO_RELEVANTE
  const etapa = s.etapaCard ?? null
  const etapaAvancada = etapa !== null && ETAPAS_AVANCADAS.includes(etapa)
  const etapaEmCurso = etapa !== null && ETAPAS_EM_CURSO.includes(etapa)
  const etapaViva = etapaAvancada || etapaEmCurso
  const nomeEtapa = s.nomeEtapa ?? (etapa !== null ? String(etapa) : '')
  const seDespediu = !!s.despedidaEm
  const cardPrecisaMover = seDespediu && etapaViva

  // ── travas: sinal concreto de que a loja está viva ─────────────────────────
  if ((s.vendas ?? 0) > 0) trava(`loja VENDENDO no portal (${s.vendas} vendas)`)
  else if ((s.consultas ?? 0) > 0) trava(`loja operando: ${s.consultas} consultas de crédito`)
  if (s.rid) trava(`tem ID de loja na AIVA (RID ${s.rid})`)
  if (s.registroAtiva) trava('registro marcado como ativa')
  if (s.biometria === 'aprovado') trava('biometria APROVADA — esperando só a AIVA criar a loja')
  if (s.stagePortal && s.stagePortal !== 'dados_varejo') trava(`cadastro avançou no portal (${s.stagePortal})`)
  if (s.statusLead && STATUS_VIVOS.includes(s.statusLead)) trava(`lead em ${s.statusLead}`)
  // Avanço real trava. Etapa em curso só pede conferência (bloco abaixo), porque
  // card parado em "Em Análise AIVA" é o estado natural de quem começou e sumiu.
  // Em qualquer caso, com a despedida enviada o descarte já foi decisão de gente
  // — o que está errado é o card, e isso é "mover o card", não "não descartar".
  if (etapaAvancada && !seDespediu) trava(`card em ${nomeEtapa} — a loja avançou na jornada`)
  if (s.silencioDias !== null && s.silencioDias !== undefined && s.silencioDias <= DIAS_CONVERSA_VIVA) {
    trava(`conversa VIVA — lojista falou há ${s.silencioDias} dia(s)`)
  }
  if (s.outraLojaAtiva?.length) trava(`é 2º CNPJ de lojista com loja ativa (${s.outraLojaAtiva.join(', ')})`)

  // ── conferir: precisa de decisão humana ────────────────────────────────────
  if (cardPrecisaMover) olhar(`encerramento enviado em ${s.despedidaEm!.slice(0, 10)}, mas o card segue em ${nomeEtapa} — mover o card`)
  if (s.noFunil19?.length) olhar(`telefone está no funil 19 Odres/UME (${s.noFunil19.join(', ')})`)
  if (s.baseOdres) olhar('CNPJ consta na base Odres')
  if (s.dvInvalido) olhar('CNPJ com dígito verificador inválido — erro de digitação na origem')
  if (s.silencioDias !== null && s.silencioDias !== undefined
      && s.silencioDias > DIAS_CONVERSA_VIVA && s.silencioDias <= DIAS_CADENCIA_ATIVA) {
    olhar(`lojista respondeu há ${s.silencioDias} dias e a cobrança automática ainda atua nele`)
  }
  // ⚠️ Card em etapa em curso NÃO vale sozinho. Na lista dos 230 CNPJs isso
  // marcava 166 de 230 como "conferir" — e card parado em "Em Análise AIVA" é
  // justamente a DEFINIÇÃO daquela lista, não um sinal que separa alguém.
  // Só pesa quando veio junto de esforço investido: o lojista entregou os dados
  // (CNPJ, sócio, e-mail) ou falou com a gente em tempo razoável. Esse é o
  // lojista que vale um segundo olhar antes de matar; o resto é nome frio.
  if (etapaEmCurso && !seDespediu && (s.deuOsDados || silencioCurto)) {
    olhar(`card parado em ${nomeEtapa}${s.deuOsDados ? ' e o lojista já tinha entregado os dados' : ''} — conferir antes de matar`)
  }
  if (s.deuOsDados && !etapaEmCurso && !seDespediu && silencioCurto) olhar('o lojista chegou a entregar CNPJ e dados de qualificação')
  if (s.senhaEnviada) olhar('senha do sócio já foi enviada pela AIVA')
  if (s.achadoSoPorTelefone) olhar('sem registro deste CNPJ, mas o telefone é lead nosso')
  if (s.statusLead === 'DESCARTADO' && s.silencioDias !== null && s.silencioDias !== undefined
      && s.silencioDias <= DIAS_CADENCIA_ATIVA) {
    olhar('lead DESCARTADO na base mas o lojista respondeu recentemente — contradição')
  }
  if (etapa !== null && !ETAPAS_VIVAS.includes(etapa) && !ETAPAS_FINAIS.includes(etapa)) {
    olhar(`card em ${nomeEtapa}, que não é etapa final conhecida`)
  }

  if (rec === 'PODE DESCARTAR') {
    if (!s.temRegistro && !s.temCard) motivos.push('não é oportunidade nossa: sem registro, sem lead e sem card em nenhum funil')
    else if ((s.enviosNossos ?? 0) === 0) motivos.push(`nunca trabalhado: nenhuma mensagem nossa${s.stagePortal ? ` (portal: ${s.stagePortal})` : ''}`)
    else {
      const onde = etapa !== null ? `card em ${nomeEtapa}` : (s.stagePortal || 'fora do portal')
      motivos.push(`sem avanço: ${onde}, ${s.enviosNossos} mensagens nossas e ${s.silencioDias === null || s.silencioDias === undefined ? 'nenhuma resposta dele' : `${s.silencioDias} dias em silêncio`}`)
    }
  }

  return { recomendacao: rec, motivos, cardPrecisaMover }
}
