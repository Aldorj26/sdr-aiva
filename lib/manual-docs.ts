/**
 * lib/manual-docs.ts — integração com a planilha AIVA APROVAÇÃO via Apps Script
 * (chamados, repasses, atendimentos, senhas). O fluxo de cadastro manual pra
 * empresa sem sócio (docs → Drive + aba "Manual") foi REMOVIDO em 10/09/2026
 * (Aldo: sem sócio não precisa de informação nem de tag). As ações 'doc' e
 * 'linha' seguem existindo no Apps Script, mas ninguém mais as chama.
 *
 * Transporte: Google Apps Script Web App (mesmo padrão do sendToGoogleSheets).
 * Código do script: docs/apps-script-manual-docs.gs (deploy manual pelo Aldo).
 *
 * Best-effort: sem GOOGLE_MANUAL_WEBHOOK_URL configurada, loga e segue — os
 * documentos continuam visíveis no painel de qualquer forma.
 */

const SEGREDO = process.env.GOOGLE_MANUAL_WEBHOOK_SECRET ?? 'track2026manual'

async function postManual(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const url = process.env.GOOGLE_MANUAL_WEBHOOK_URL
  if (!url) {
    console.warn('[MANUAL_DOCS] GOOGLE_MANUAL_WEBHOOK_URL não configurada — pulando envio')
    return null
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segredo: SEGREDO, ...body }),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Apps Script manual → ${res.status}`)
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: true }
  }
}

/**
 * Registra um CHAMADO na aba "Chamados" da planilha AIVA APROVAÇÃO (pedido do
 * Aldo 2026-08-05): lojista reclamou de erro/problema no sistema AIVA → linha
 * com data/hora, loja, telefone, CNPJ e o problema relatado. A coluna F
 * (Resolvido) é preenchida manualmente pelo Edu/Nei com um X.
 */
export async function registrarChamado(params: {
  loja: string
  telefone: string
  cnpj?: string | null
  problema: string
}): Promise<boolean> {
  try {
    const resp = await postManual({ acao: 'chamado', ...params })
    return !!resp
  } catch (err) {
    console.error('[MANUAL_DOCS] Falha ao registrar chamado:', err)
    return false
  }
}

/**
 * Marca "sim" na coluna Resolvido (F) da aba "Chamados" quando o Nei clica
 * ✓ Resolver no painel (pedido do Aldo 08/09/2026). O Apps Script acha a
 * linha pelo telefone + início do problema (fallback: última linha não
 * resolvida do telefone). Ação 'chamado_resolvido' — Versão 14 do script.
 */
export async function resolverChamadoPlanilha(params: {
  telefone: string
  problema?: string | null
  observacao?: string | null
}): Promise<boolean> {
  try {
    const resp = await postManual({ acao: 'chamado_resolvido', ...params })
    return resp?.ok === true
  } catch (err) {
    console.error('[MANUAL_DOCS] Falha ao marcar chamado resolvido na planilha:', err)
    return false
  }
}

/**
 * Registra na aba "Repasses" da planilha AIVA APROVAÇÃO uma solicitação de
 * acesso ao painel de repasses lançada pela VictorIA (regra 03/09).
 * ⚠️ Requer a ação 'repasse' no Apps Script publicado (trecho no fim de
 * docs/apps-script-manual-docs.gs — o Aldo cola e reimplanta).
 */
export async function registrarRepasse(params: {
  loja: string
  telefone: string
  cnpj: string
  gmail: string
  form_ok: boolean
}): Promise<boolean> {
  try {
    const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const resp = await postManual({ acao: 'repasse', data_hora: dataHora, ...params })
    // resp truthy não basta: script sem a ação 'repasse' respondia {ok:false} e
    // gerava planilha_ok falso-positivo (aconteceu com as 24 primeiras em 03/09)
    return resp?.ok === true
  } catch (err) {
    console.error('[MANUAL_DOCS] Falha ao registrar na aba Repasses:', err)
    return false
  }
}

/**
 * Registra na aba "Atendimentos" da planilha AIVA APROVAÇÃO o momento em que os
 * CNPJs do lead foram disponibilizados pro pré-cadastro (pedido do Aldo
 * 2026-07-28): CNPJ matriz, adicionais e data/hora do envio.
 */
export async function registrarAtendimento(params: {
  loja: string
  telefone: string
  cnpj_matriz?: string | null
  cnpjs_adicionais?: string | null
  qtd?: number
  opportunity_id?: string | null
}): Promise<boolean> {
  try {
    const dataHora = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
    const resp = await postManual({ acao: 'atendimento', data_hora: dataHora, ...params })
    return !!resp
  } catch (err) {
    console.error('[MANUAL_DOCS] Falha ao registrar na aba Atendimentos:', err)
    return false
  }
}

/**
 * Registra um colaborador lançado no form de acesso na aba "Senhas" da
 * planilha AIVA APROVAÇÃO (pedido do Aldo 2026-07-28). Colunas:
 * Nome do Varejo | CNPJ da Loja | Nome | CPF | Email | Telefone | Senha | Enviado
 * — Senha e Enviado ficam em branco (a senha quem gera é a AIVA; o time marca
 * o envio quando repassa ao lojista).
 */
export async function registrarSenhaColab(params: {
  loja: string
  cnpj_loja: string
  nome: string
  cpf: string
  email: string
  telefone: string
}): Promise<boolean> {
  try {
    const resp = await postManual({ acao: 'senha', ...params })
    return !!resp
  } catch (err) {
    console.error('[MANUAL_DOCS] Falha ao registrar na aba Senhas:', err)
    return false
  }
}

