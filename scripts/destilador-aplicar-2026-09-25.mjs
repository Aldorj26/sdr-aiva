// Rodada do destilador 2026-09-25 — grava na curadoria o que passou na triagem.
// 2 entradas 'boa' (caps 5+5 longe): a fonte A trouxe 24 mensagens manuais, 23
// vazias ("[Info pendente]"/templates) e 1 que não é correção de conduta (Nei
// encerrando lead que esgotou a cobrança). Da fonte B, 10 jogadas: 7 parquearam
// (taxa/prazo/telefone/links fixos da agenda antiga), 2 de tema já na curadoria
// (print pra destravar, biometria) e estas 2 passaram. Ver docs/destilador-enviar-info.log.
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const agora = new Date().toISOString()

const entradas = [
  // ── BOA — moreiratech cell (Celso), avançou pra PRE_APROVACAO em 25/09 ──────
  // Bate com a política (CNPJ ≥ 1 ano + ATIVA) e com a seção EMPRESA SEM SÓCIO/QSA.
  {
    mensagem_id: 'c2dc6b7c-47db-46df-a570-981ab335a097',
    lead_id: '74831637-4c3c-4bf2-95c2-535c28caa16a',
    avaliacao: 'boa',
    pergunta: 'Meu CNPJ é MEI, não tem problema, né? Pode ser, né?',
    resposta:
      'Pode sim, Celso! MEI não tem problema nenhum — a gente trabalha com MEI, ME, LTDA, todos os tipos. O importante é que o CNPJ tenha pelo menos 1 ano de abertura e esteja ativo na Receita. Me manda o número do CNPJ aí? (são 14 dígitos)',
    correcao: null,
  },
  // ── BOA — L a informática (Luiz Alberto), 16/09, hoje vendendo ──────────────
  // ⚠️ Cortei a última frase do original ("a biometria facial do cadastro é só pra
  // confirmar sua identidade uma vez — depois disso não precisa fazer de novo"):
  // não tenho como confirmar e exemplo congela fato. O domínio vendas.flexfone.com.br
  // está na whitelist do prompt.
  {
    mensagem_id: '124147e6-df08-4517-a4ed-dea291250cde',
    lead_id: 'b74dc12d-2509-4240-b4c4-efd6bfffb331',
    avaliacao: 'boa',
    pergunta:
      'Gostaria de saber se o aplicativo vai funcionar só no meu celular ou posso instalar em outro celular? Porque eu não fico sempre na loja, né? Sempre eu saio.',
    resposta:
      'Ótima pergunta, Luiz Alberto! O sistema AIVA funciona pelo navegador (vendas.flexfone.com.br/login) — não é app pra instalar, então você consegue acessar de qualquer dispositivo: celular, computador, tablet. É só fazer o login com seu usuário e senha em qualquer aparelho que tiver à mão.',
    correcao: null,
  },
]

// confere que as mensagens originais existem e são da VictorIA (não manuais)
for (const e of entradas) {
  const { data: m } = await sb.from('sdr_mensagens').select('id, direcao, conteudo').eq('id', e.mensagem_id).maybeSingle()
  if (!m || m.direcao !== 'out' || /manual via painel/i.test(m.conteudo)) {
    console.error('ABORTADO: mensagem original não confere', e.mensagem_id, '— nada gravado.')
    process.exit(1)
  }
}

for (const e of entradas) {
  const { error } = await sb.from('sdr_curadoria').upsert({ ...e, atualizado_em: agora }, { onConflict: 'mensagem_id' })
  console.log(error ? `ERRO ${e.mensagem_id}: ${error.message}` : `ok ${e.avaliacao} ${e.mensagem_id}`)
}
const { count: r } = await sb.from('sdr_curadoria').select('*', { count: 'exact', head: true }).eq('avaliacao', 'ruim').not('correcao', 'is', null)
const { count: b } = await sb.from('sdr_curadoria').select('*', { count: 'exact', head: true }).eq('avaliacao', 'boa').not('pergunta', 'is', null)
console.log(`fila agora: ruins com correção=${r} | boas com par=${b}`)
