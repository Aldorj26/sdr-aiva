/**
 * avisos-painel-calc.ts — avisos do robô que pedem ação do Nei, por loja, mostrados no topo
 * do /atendimento (Aldo 05/10/2026). Os digests de WhatsApp ("3 lojas sem concluir a biometria…")
 * passavam batido no meio dos outros alertas; aqui cada loja vira uma linha com botão "Resolvido".
 * Parte PURA (catálogo + regra de aviso velho); IO em lib/avisos-painel.ts.
 */

export type TipoAviso = 'pre_cadastro_nao_chegou' | 'biometria_negada' | 'biometria' | 'formulario' | 'treinamento' | 'cadastro_recebido' | 'fase3_destravada' | 'senha_pendente'
  | 'senha_usuario' | 'portal_reprovado_conferir' | 'cnpj_irregular' | 'cnpj_invalido'

export const CATALOGO: Record<TipoAviso, { titulo: string; oque: string; acao: string; ordem: number }> = {
  pre_cadastro_nao_chegou: {
    titulo: '📮 Pré-cadastro não chegou à AIVA',
    oque: 'o CNPJ foi marcado como enviado em Registros AIVA há mais de 24h e não aparece no portal — o formulário não foi enviado (o "Abrir form" marca no clique)',
    acao: 'Abrir Registros AIVA e enviar o formulário de pré-cadastro de novo. O card anda sozinho quando a AIVA registrar.',
    ordem: -1,
  },
  biometria_negada: {
    titulo: '🚫 Biometria negada pela AIVA',
    oque: 'o lojista fez o reconhecimento facial e a AIVA não aprovou (a análise sai depois — ele acha que concluiu)',
    acao: 'Avisar o lojista e pedir pra refazer: lugar claro, sem boné/óculos, documento original. Se o link só abrir a tela de concluído, pedir um link novo pra AIVA (Mauricio/Edu).',
    ordem: 0,
  },
  biometria: {
    titulo: '🪪 Biometria não concluída',
    oque: 'link do reconhecimento facial enviado 3× e a loja não fez',
    acao: 'Ligar: costuma ser dificuldade com a câmera ou com o documento.',
    ordem: 1,
  },
  cadastro_recebido: {
    titulo: '🧩 Cadastro Recebido com dado faltando',
    oque: '3 cobranças automáticas e ainda faltam dados',
    acao: 'Pegar o que falta direto com o lojista.',
    ordem: 2,
  },
  fase3_destravada: {
    titulo: '🔓 Cadastro completo que não fechou sozinho',
    oque: 'o lead já deu todos os dados, mas parou de falar antes de a conclusão rodar',
    acao: 'Lançar o CNPJ em Registros AIVA.',
    ordem: 3,
  },
  formulario: {
    titulo: '📋 Formulário da AIVA sem preencher',
    oque: '4 cobranças (D+1/3/7/14) e o formulário segue pendente no portal',
    acao: 'Contato direto ou descartar o card no Evo — o robô parou de cobrar.',
    ordem: 4,
  },
  treinamento: {
    titulo: '🎓 Treinamento sem resposta',
    oque: 'perguntamos várias vezes se fez o treinamento e não houve resposta',
    acao: 'Contato direto ou reavaliar a etapa do card.',
    ordem: 5,
  },
  senha_pendente: {
    titulo: '🔑 Senha não enviada pela AIVA',
    oque: 'acesso do sócio pedido e a AIVA ainda não mandou (prazo vencido)',
    acao: 'Cobrar a AIVA (Mauricio/Edu). Some sozinho quando a senha sair.',
    ordem: 6,
  },
  // ── vieram da tela de Exceções (Aldo 06/10/2026 — a tela saiu do menu) ──
  senha_usuario: {
    titulo: '👤 Senha de vendedor/gerente não veio',
    oque: 'o lojista pediu usuário de equipe e a AIVA não mandou o acesso',
    acao: 'Cobrar a AIVA (Mauricio/Edu). Reenviar a senha do SÓCIO não resolve — não cria usuário de equipe.',
    ordem: 7,
  },
  portal_reprovado_conferir: {
    titulo: '🔎 Reprovado no portal, mas a loja opera',
    oque: 'a AIVA marcou o cadastro como reprovado, mas a loja tem ID ou já vende — o card não foi mexido',
    acao: 'Confirmar com a AIVA (Mauricio/Edu) se a loja segue liberada. Se não seguir, mover o card pra 95.',
    ordem: 8,
  },
  cnpj_irregular: {
    titulo: '🧾 CNPJ irregular na Receita',
    oque: 'a checagem da AIVA achou o CNPJ inapto, baixado ou suspenso',
    acao: 'Avisar o lojista que precisa regularizar na Receita; sem isso a AIVA não libera. Some sozinho quando regularizar.',
    ordem: 9,
  },
  cnpj_invalido: {
    titulo: '🔢 CNPJ do cadastro não confere',
    oque: 'o CNPJ no portal da AIVA tem dígito errado ou não consta na Receita',
    acao: 'Confirmar o CNPJ certo com o lojista e pedir a correção do cadastro à AIVA. Some sozinho quando corrigir.',
    ordem: 10,
  },
}

export const TIPOS = Object.keys(CATALOGO) as TipoAviso[]

const TERMINAIS = ['DESCARTADO', 'OPT_OUT', 'NAO_QUALIFICADO']

/**
 * Aviso velho = a situação andou sem ninguém clicar em "Resolvido": o lead mudou de etapa
 * (fez a biometria, preencheu o formulário…) ou saiu do funil. Sem isso a lista só cresce e
 * o Nei liga pra loja que já resolveu.
 */
/**
 * Avisos que valem enquanto o MARCADOR existir no lead, não enquanto a etapa for a mesma: CNPJ
 * irregular continua irregular quando a loja passa de Treinar pra Vendendo. Fecham quando o
 * marcador sai (o espelho desmarca ao regularizar) ou o lead sai do funil.
 */
export const PELO_MARCADOR: Partial<Record<TipoAviso, string>> = {
  senha_usuario: 'SENHA_USUARIO_NAO_CHEGOU',
  portal_reprovado_conferir: 'PORTAL_REPROVADO_CONFERIR',
  cnpj_irregular: 'CNPJ_IRREGULAR_AIVA',
  cnpj_invalido: 'CNPJ_PORTAL_INVALIDO',
}

export function avisoVelho(statusNoAviso: string | null, statusAtual: string | null, tipo?: TipoAviso, observacoes?: string | null): string | null {
  if (!statusAtual) return null
  if (TERMINAIS.includes(statusAtual)) return 'auto: lead saiu do funil'
  const marcador = tipo ? PELO_MARCADOR[tipo] : undefined
  if (marcador) return (observacoes ?? '').includes(`[${marcador}`) ? null : 'auto: marcador saiu (situação resolvida)'
  if (statusNoAviso && statusNoAviso !== statusAtual) return `auto: etapa mudou (${statusNoAviso} → ${statusAtual})`
  return null
}

/** Linha que vai no fim do digest de WhatsApp, apontando o painel. */
export const RODAPE_PAINEL = '\n\n📌 Também está no painel, no topo do Atendimento: https://sdr-aiva.vercel.app/atendimento'
