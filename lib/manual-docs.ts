/**
 * lib/manual-docs.ts — integração do fluxo de cadastro manual (empresa sem sócio).
 *
 * Fluxo (definido pelo Aldo 2026-07-27): quando a Receita mostra que o CNPJ não
 * tem quadro societário, a VictorIA pede 5 itens (contrato social, e-mail p/
 * assinatura, selfie, RG/CNH, dados bancários). Este módulo encaminha:
 *   - ARQUIVOS  → pasta compartilhada no Google Drive ("AIVA - Documentos
 *                 Cadastro Manual", compartilhada com Nei e Edu)
 *   - DADOS     → aba "Manual" da planilha AIVA APROVAÇÃO
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
 * Envia um documento do lead pra pasta do Drive (subpasta "LOJA — CNPJ").
 * Retorna a URL do arquivo no Drive, ou null se indisponível/falha.
 */
export async function enviarDocParaDrive(params: {
  loja: string
  cnpj: string
  telefone: string
  nomeArquivo: string
  mimeType: string
  base64: string
}): Promise<string | null> {
  try {
    const resp = await postManual({ acao: 'doc', ...params })
    const url = resp?.url
    return typeof url === 'string' ? url : null
  } catch (err) {
    console.error('[MANUAL_DOCS] Falha ao enviar doc pro Drive:', err)
    return null
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

/**
 * Registra a linha do lead na aba "Manual" da planilha AIVA APROVAÇÃO.
 * Campos seguem as colunas da aba; o que não tivermos vai vazio (Edu completa
 * a partir dos documentos na pasta do Drive).
 */
export async function enviarLinhaManual(params: {
  signer_name?: string | null
  signer_email?: string | null
  razao_social?: string | null
  endereco?: string | null
  cnpj?: string | null
  nome_varejo?: string | null
  nome_completo?: string | null
  fantasia?: string | null
  telefone?: string | null
  link_pasta?: string | null
  // Coletados no chat pela VictorIA (2026-07-31) — colunas J e O-R da aba Manual
  cpf?: string | null
  banco_codigo?: string | null
  banco_agencia?: string | null
  banco_conta?: string | null
  banco_digito?: string | null
}): Promise<boolean> {
  try {
    const resp = await postManual({ acao: 'linha', ...params })
    return !!resp
  } catch (err) {
    console.error('[MANUAL_DOCS] Falha ao enviar linha pra aba Manual:', err)
    return false
  }
}
