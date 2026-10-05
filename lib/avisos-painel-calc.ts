/**
 * avisos-painel-calc.ts — avisos do robô que pedem ação do Nei, por loja, mostrados no topo
 * do /atendimento (Aldo 05/10/2026). Os digests de WhatsApp ("3 lojas sem concluir a biometria…")
 * passavam batido no meio dos outros alertas; aqui cada loja vira uma linha com botão "Resolvido".
 * Parte PURA (catálogo + regra de aviso velho); IO em lib/avisos-painel.ts.
 */

export type TipoAviso = 'biometria' | 'formulario' | 'treinamento' | 'cadastro_recebido' | 'fase3_destravada' | 'senha_pendente'

export const CATALOGO: Record<TipoAviso, { titulo: string; oque: string; acao: string; ordem: number }> = {
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
}

export const TIPOS = Object.keys(CATALOGO) as TipoAviso[]

const TERMINAIS = ['DESCARTADO', 'OPT_OUT', 'NAO_QUALIFICADO']

/**
 * Aviso velho = a situação andou sem ninguém clicar em "Resolvido": o lead mudou de etapa
 * (fez a biometria, preencheu o formulário…) ou saiu do funil. Sem isso a lista só cresce e
 * o Nei liga pra loja que já resolveu.
 */
export function avisoVelho(statusNoAviso: string | null, statusAtual: string | null): string | null {
  if (!statusAtual) return null
  if (TERMINAIS.includes(statusAtual)) return 'auto: lead saiu do funil'
  if (statusNoAviso && statusNoAviso !== statusAtual) return `auto: etapa mudou (${statusNoAviso} → ${statusAtual})`
  return null
}

/** Linha que vai no fim do digest de WhatsApp, apontando o painel. */
export const RODAPE_PAINEL = '\n\n📌 Também está no painel, no topo do Atendimento: https://sdr-aiva.vercel.app/atendimento'
