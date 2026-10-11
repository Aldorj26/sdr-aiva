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

export type OpcoesAviso = {
  /** Se informada, o aviso só sai se a mesma chave não foi usada nos últimos `janelaMs`
   *  (`sdr_avisos_chave`, o mesmo padrão do vigia). */
  chaveDedupe?: string
  janelaMs?: number
}

/** Resolve/rejeita com `p`, ou rejeita aos 20 s. O timer sempre é limpo (não segura o processo). */
function comPrazo<T>(p: Promise<T>, rotulo: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const prazo = new Promise<never>((_, rejeita) => {
    timer = setTimeout(() => rejeita(new Error(`sem resposta em ${PRAZO_MS / 1000}s`)), PRAZO_MS)
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
    await supabaseAdmin.from('sdr_avisos_chave').delete().eq('chave', chave)
  } catch (err) {
    console.error(`[alerta-equipe] dedupe ${chave}: não consegui soltar a chave:`, err)
  }
}

export async function avisarEquipe(
  detalhe: string,
  teaser: string,
  opts: OpcoesAviso = {},
): Promise<{ enviados: number; falhas: number }> {
  const { chaveDedupe, janelaMs = 3_600_000 } = opts
  try {
    if (chaveDedupe) {
      if (await jaAvisadoNaJanela(chaveDedupe, janelaMs)) return { enviados: 0, falhas: 0 }
      // reserva ANTES de enviar: duas rotas quebrando juntas não avisam em dobro
      await gravarAviso(chaveDedupe)
    }

    const templateId = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
    const tarefas: Array<{ rotulo: string; run: () => Promise<boolean> }> = []
    for (const { nome, tel } of destinatarios()) {
      tarefas.push({
        rotulo: `coringa→${nome}`,
        run: async () => {
          if (!templateId) throw new Error('AIVA_REATIVACAO_TEMPLATE_ID não configurado')
          await sendTemplate(tel, templateId, [nome, teaser])
          return true
        },
      })
      tarefas.push({
        rotulo: `texto→${nome}`,
        run: async () => {
          const r = await alertHuman(tel, detalhe)
          if (!r.ok) throw new Error(r.error ?? 'alertHuman devolveu ok=false')
          return true
        },
      })
    }

    // `run()` dentro do try: uma tarefa que lance de forma síncrona não pode escapar do allSettled
    const resultados = await Promise.allSettled(tarefas.map((t) => comPrazo(Promise.resolve().then(t.run), t.rotulo)))
    let enviados = 0
    let falhas = 0
    for (const r of resultados) {
      if (r.status === 'fulfilled') enviados++
      else {
        falhas++
        console.error('[alerta-equipe] aviso não entregue —', r.reason instanceof Error ? r.reason.message : r.reason)
      }
    }

    // nada saiu por nenhum caminho: não deixa a chave calar a próxima tentativa
    if (chaveDedupe && enviados === 0) await soltarAviso(chaveDedupe)
    return { enviados, falhas }
  } catch (err) {
    console.error('[alerta-equipe] falhou inesperadamente:', err)
    return { enviados: 0, falhas: 1 }
  }
}
