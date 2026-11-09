/**
 * frescor-portal.ts — IO do frescor da coleta do portal AIVA. Regra pura (e o porquê de tudo isto)
 * em lib/frescor-portal-calc.ts (`npm run test:frescor`).
 *
 * Duas leituras baratas, as duas por `head: true` (só o count/1 linha, nenhum dado vem):
 *   - `max(data_ref)` de `aiva_portal_diario` — a idade do retrato mais novo;
 *   - existe linha de `mes` = mês corrente em `aiva_desempenho`? — o agregado que o painel e as dicas leem.
 *
 * ⚠️ FALHA DE LEITURA NÃO É "ESTÁ FRESCO". Devolver `ok: true` quando o banco não respondeu
 * recriaria o defeito que este módulo existe pra matar (silêncio com cara de tudo certo). Quem chama
 * recebe `erro` preenchido e decide: o vigia avisa que não conseguiu conferir, as dicas não falam
 * com o lojista sem saber a idade do número.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { hojeBrt } from '@/lib/portal-aiva'
import { avaliarFrescor, type Frescor } from '@/lib/frescor-portal-calc'

export type FrescorLido = { frescor: Frescor | null; erro: string | null; hoje: string }

export async function lerFrescorPortal(hoje = hojeBrt()): Promise<FrescorLido> {
  try {
    const mesCorrente = hoje.slice(0, 7)
    const [retrato, mes] = await Promise.all([
      supabaseAdmin.from('aiva_portal_diario').select('data_ref').order('data_ref', { ascending: false }).limit(1),
      supabaseAdmin.from('aiva_desempenho').select('*', { count: 'exact', head: true }).eq('mes', mesCorrente),
    ])
    if (retrato.error) throw new Error(`aiva_portal_diario: ${retrato.error.message}`)
    if (mes.error) throw new Error(`aiva_desempenho: ${mes.error.message}`)
    return {
      hoje,
      erro: null,
      frescor: avaliarFrescor({
        hoje,
        ultimoRetrato: retrato.data?.[0]?.data_ref ?? null,
        temMesCorrente: (mes.count ?? 0) > 0,
      }),
    }
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    console.error('[frescor-portal] não consegui ler o frescor:', erro)
    return { frescor: null, erro: erro.slice(0, 200), hoje }
  }
}
