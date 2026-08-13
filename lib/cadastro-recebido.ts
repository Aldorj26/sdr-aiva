/**
 * lib/cadastro-recebido.ts
 *
 * Fonte da verdade = ETAPA do Evo Talks (não o status interno do Supabase, que
 * diverge). Lista as oportunidades na etapa "Cadastro Recebido" (stage 49) lendo
 * o pipeline do Evo e cruza cada uma com o lead no Supabase (por telefone) pra
 * descobrir EXATAMENTE quais dados obrigatórios faltam.
 *
 * Usado por:
 *  - lib/admin-commands (/incompletos e conversa natural com a equipe)
 *  - app/api/sdr/cadastro-recebido-cobranca (cadência que cobra os dados faltantes)
 */
import { supabaseAdmin } from '@/lib/supabase'
import { fetchOpps } from '@/lib/pipeline-briefing'

const STAGE_CADASTRO_RECEBIDO = 49

// 11 dados obrigatórios pra completar o cadastro (cnpjs_adicionais é opcional).
const CAMPOS_OBRIGATORIOS: Array<[string, string]> = [
  ['nome_socio', 'nome do sócio'],
  ['telefone_socio', 'telefone do sócio'],
  ['nome_varejo', 'nome da loja'],
  ['cnpj_matriz', 'CNPJ'],
  ['regiao_varejo', 'região/cidade'],
  ['numero_lojas', 'nº de lojas'],
  ['possui_outra_financeira', 'outra financeira'],
  ['email_socio', 'email do sócio'],
  ['faturamento_anual', 'faturamento anual'],
  ['valor_boleto_mensal', 'valor boleto mensal'],
  ['localizacao_lojas', 'localização das lojas'],
]

function parseDados(obs: string | null): Record<string, string> {
  if (!obs) return {}
  const m = obs.match(/\[DADOS_COLETADOS:([^\]]+)\]/)
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const pair of m[1].split('|')) {
    const i = pair.indexOf('=')
    if (i > 0) {
      const k = pair.slice(0, i).trim()
      const v = pair.slice(i + 1).trim()
      if (k && v && v !== 'null') out[k] = v
    }
  }
  return out
}

export interface CadIncompleto {
  leadId: string | null
  nome: string
  telefone: string
  faltando: string[]       // labels legíveis
  faltandoKeys: string[]   // chaves
  horasNaEtapa: number
  observacoes: string | null
  dataUltimoContato: string | null
}

export interface CadResumo {
  total: number              // total na etapa Cadastro Recebido (Evo)
  incompletos: CadIncompleto[]
}

/**
 * Lista oportunidades em Cadastro Recebido (etapa Evo) que estão com dados faltando,
 * cruzando o telefone do card com o lead no Supabase. Casa pelo final do número
 * (últimos 8 dígitos) pra tolerar o 9º dígito.
 */
export async function listarCadastroRecebidoIncompletos(): Promise<CadResumo> {
  const opps = (await fetchOpps()).filter((o) => o.fkStage === STAGE_CADASTRO_RECEBIDO)
  const incompletos: CadIncompleto[] = []

  for (const opp of opps) {
    const tel = (opp.mainphone ?? '').replace(/\D/g, '')
    const last8 = tel.slice(-8)
    let lead: { id: string; nome: string; observacoes: string | null; data_ultimo_contato: string | null } | null = null
    if (last8.length === 8) {
      const { data } = await supabaseAdmin
        .from('sdr_leads')
        .select('id, nome, observacoes, data_ultimo_contato')
        .like('telefone', `%${last8}`)
        .limit(1)
      lead = (data && data[0]) ?? null
    }

    const dados = parseDados(lead?.observacoes ?? null)
    const faltando = CAMPOS_OBRIGATORIOS.filter(([k]) => !dados[k])
    if (faltando.length > 0) {
      incompletos.push({
        leadId: lead?.id ?? null,
        nome: lead?.nome || (opp.title || '').replace(/\s*—\s*AIVA\s*$/i, '').trim() || 'Sem nome',
        telefone: tel,
        faltando: faltando.map(([, label]) => label),
        faltandoKeys: faltando.map(([k]) => k),
        horasNaEtapa: opp.stagebegintime ? Math.floor((Date.now() / 1000 - opp.stagebegintime) / 3600) : 0,
        observacoes: lead?.observacoes ?? null,
        dataUltimoContato: lead?.data_ultimo_contato ?? null,
      })
    }
  }

  return { total: opps.length, incompletos }
}

/** Texto pro WhatsApp do admin: visão completa de Cadastro Recebido + o que falta. */
export async function formatarRelatorioIncompletos(): Promise<string> {
  const { total, incompletos } = await listarCadastroRecebidoIncompletos()
  if (total === 0) return 'Nenhuma oportunidade na etapa *Cadastro Recebido* no Evo Talks.'
  if (incompletos.length === 0) {
    return `Todas as ${total} oportunidades em *Cadastro Recebido* estão com os dados completos. ✅`
  }
  const linhas = incompletos
    .sort((a, b) => b.horasNaEtapa - a.horasNaEtapa)
    .map((c) => {
      const tempo = c.horasNaEtapa < 48 ? `${c.horasNaEtapa}h` : `${Math.floor(c.horasNaEtapa / 24)}d`
      return `• *${c.nome}* (${c.telefone}) — ${tempo} na etapa — faltam ${c.faltando.length}: ${c.faltando.join(', ')}`
    })
  return [
    `*Cadastro Recebido (Evo): ${total} — incompletos: ${incompletos.length}*`,
    '',
    ...linhas,
  ].join('\n')
}
