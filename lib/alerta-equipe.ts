/**
 * lib/alerta-equipe.ts — avisa Aldo e Nei por DOIS caminhos ao mesmo tempo.
 *
 * Por quê dois: o texto livre (`alertHuman`) é o aviso completo, mas fora da janela de 24 h do
 * WhatsApp a Meta o descarta em silêncio (igual ao briefing-pipeline). O coringa (HSM 48,
 * "Olá {{1}}, {{2}}") atravessa a janela, só que o {{2}} é UMA linha curta — o "teaser".
 * Então cada alerta sai pelos dois: o teaser garante que chega, o detalhe explica.
 *
 * Por quê paralelo com prazo: o envio antigo era sequencial e sem timeout — um Evo pendurado no
 * primeiro número comia a rodada inteira (300 s) e o segundo nunca era avisado. Aqui as quatro
 * chamadas (2 pessoas x 2 caminhos) rodam em `Promise.allSettled`, cada uma com corrida de 20 s.
 * ⚠️ A corrida é contra PENDURADO, não contra erro: `alertHuman` nunca lança (devolve `{ok:false}`).
 *
 * Nunca lança: quem chama está num caminho de falha (pausa, rodada quebrada) e um alerta que
 * derruba o chamador esconde o problema original.
 */
import { supabaseAdmin } from './supabase'
import { alertHuman, sendTemplate } from './evotalks'

const PRAZO_MS = 20_000
/** Banco de dedupe (leitura + gravação da chave, e o soltar): `supabase-js` não tem timeout, e este módulo
 *  roda justamente quando o banco pode ser a causa do problema. Estourou = "ainda não avisado": envia. */
const PRAZO_DEDUPE_MS = 5_000
/** Garantia da rota: 5 s (dedupe) + 20 s (envios) + 5 s (soltar) = 30 s < 35 s. Nada aqui segura a função. */
const PRAZO_GERAL_MS = 35_000

export type OpcoesAviso = {
  /** Se informada, o aviso só sai se a mesma chave não foi usada nos últimos `janelaMs`
   *  (`sdr_avisos_chave`, o mesmo padrão do vigia). */
  chaveDedupe?: string
  janelaMs?: number
}

/** Resolve/rejeita com `p`, ou rejeita no prazo (20 s por padrão). O timer sempre é limpo (não segura o processo). */
function comPrazo<T>(p: Promise<T>, rotulo: string, ms = PRAZO_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const prazo = new Promise<never>((_, rejeita) => {
    timer = setTimeout(() => rejeita(new Error(`sem resposta em ${ms / 1000}s`)), ms)
  })
  return Promise.race([p, prazo]).catch((err) => {
    throw new Error(`${rotulo}: ${err instanceof Error ? err.message : String(err)}`)
  }).finally(() => clearTimeout(timer))
}

function destinatarios(): Array<{ nome: string; tel: string }> {
  const lista = [
    { nome: 'Aldo', tel: process.env.ALDO_WHATSAPP },
    { nome: 'Nei', tel: process.env.NEI_WHATSAPP },
  ].filter((d): d is { nome: string; tel: string } => !!d.tel)
  // mesmo número nas duas variáveis (ambiente de teste) não recebe em dobro
  return lista.filter((d, i) => lista.findIndex((x) => x.tel === d.tel) === i)
}

/** `true` = dentro da janela, NÃO envie. Falha de leitura deixa passar: avisar em dobro é melhor
 *  que calar — e o caso típico de uso é justamente o banco estar com problema. */
async function jaAvisadoNaJanela(chave: string, janelaMs: number): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.from('sdr_avisos_chave').select('ultimo_aviso').eq('chave', chave).maybeSingle()
    if (error) throw new Error(error.message)
    return !!data && Date.now() - Date.parse(data.ultimo_aviso) < janelaMs
  } catch (err) {
    console.error(`[alerta-equipe] dedupe ${chave}: leitura falhou — avisando mesmo assim:`, err)
    return false
  }
}

async function gravarAviso(chave: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave, ultimo_aviso: new Date().toISOString() }, { onConflict: 'chave' })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.error(`[alerta-equipe] dedupe ${chave}: gravação falhou:`, err)
  }
}

async function soltarAviso(chave: string): Promise<void> {
  try {
    await comPrazo(Promise.resolve(supabaseAdmin.from('sdr_avisos_chave').delete().eq('chave', chave)), `soltar ${chave}`, PRAZO_DEDUPE_MS)
  } catch (err) {
    console.error(`[alerta-equipe] dedupe ${chave}: não consegui soltar a chave:`, err)
  }
}

/** Leitura + reserva da chave. `true` = dentro da janela, NÃO envie. */
async function reservarChave(chave: string, janelaMs: number): Promise<boolean> {
  if (await jaAvisadoNaJanela(chave, janelaMs)) return true
  // reserva ANTES de enviar: duas rotas quebrando juntas não avisam em dobro
  await gravarAviso(chave)
  return false
}

export async function avisarEquipe(
  detalhe: string,
  teaser: string,
  opts: OpcoesAviso = {},
): Promise<{ enviados: number; falhas: number }> {
  try {
    return await comPrazo(avisar(detalhe, teaser, opts), 'avisarEquipe', PRAZO_GERAL_MS)
  } catch (err) {
    console.error('[alerta-equipe] falhou inesperadamente ou estourou o prazo geral:', err)
    return { enviados: 0, falhas: 1 }
  }
}

async function avisar(detalhe: string, teaser: string, opts: OpcoesAviso): Promise<{ enviados: number; falhas: number }> {
  const { chaveDedupe, janelaMs = 3_600_000 } = opts
  const alvos = destinatarios()
  if (!alvos.length) {
    // sem isso o alerta some sem rastro: o chamador só loga quando `falhas > 0`
    console.error('[alerta-equipe] ALDO_WHATSAPP e NEI_WHATSAPP vazios — ninguém para avisar')
    return { enviados: 0, falhas: 0 }
  }

  if (chaveDedupe) {
    const dentroDaJanela = await comPrazo(reservarChave(chaveDedupe, janelaMs), `dedupe ${chaveDedupe}`, PRAZO_DEDUPE_MS)
      .catch((err) => {
        console.error(`[alerta-equipe] dedupe ${chaveDedupe}: sem resposta do banco — tratando como "ainda não avisado":`, err instanceof Error ? err.message : err)
        return false
      })
    if (dentroDaJanela) return { enviados: 0, falhas: 0 }
  }

  const templateId = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
  if (!templateId) console.error('[alerta-equipe] AIVA_REATIVACAO_TEMPLATE_ID não configurado — só o texto livre será enviado (some fora da janela de 24 h)')

  const tarefas: Array<{ rotulo: string; coringa: boolean; run: () => Promise<boolean> }> = []
  for (const { nome, tel } of alvos) {
    tarefas.push({
      rotulo: `coringa→${nome}`,
      coringa: true,
      run: async () => {
        if (!templateId) throw new Error('AIVA_REATIVACAO_TEMPLATE_ID não configurado')
        await sendTemplate(tel, templateId, [nome, teaser])
        return true
      },
    })
    tarefas.push({
      rotulo: `texto→${nome}`,
      coringa: false,
      run: async () => {
        const r = await alertHuman(tel, detalhe)
        if (!r.ok) throw new Error(r.error ?? 'alertHuman devolveu ok=false')
        return true
      },
    })
  }

  // `run()` dentro do then: uma tarefa que lance de forma síncrona não pode escapar do allSettled
  const resultados = await Promise.allSettled(tarefas.map((t) => comPrazo(Promise.resolve().then(t.run), t.rotulo)))
  let enviados = 0
  let falhas = 0
  let coringasOk = 0
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      enviados++
      if (tarefas[i].coringa) coringasOk++
    } else {
      falhas++
      console.error('[alerta-equipe] aviso não entregue —', r.reason instanceof Error ? r.reason.message : r.reason)
    }
  })

  // Sem nenhum coringa entregue, a chave não pode calar a próxima tentativa: `alertHuman` "ok" só
  // quer dizer que o Evo aceitou o texto, e fora da janela de 24 h a Meta o descarta sem erro.
  // O coringa é o único canal que atravessa a janela.
  if (chaveDedupe && coringasOk === 0) await soltarAviso(chaveDedupe)
  return { enviados, falhas }
}
