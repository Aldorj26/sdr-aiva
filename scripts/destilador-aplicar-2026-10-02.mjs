// Rodada do destilador 2026-10-02 — grava na curadoria o que passou na triagem.
// Fonte A: 17 manuais, todas "[Info pendente]"/templates — nenhuma correção de
// conduta. Fonte B: 10 jogadas; 7 parquearam (12%/D+2/2 min, CNPJ+site da Track,
// link do onboarding), GL UP Store é cópia literal da frase-modelo PayJoy do
// prompt (l.676, nada a ensinar) e estas 2 passaram. Ver docs/destilador-enviar-info.log.
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const agora = new Date().toISOString()

const entradas = [
  // ── BOA — Mobile Cell (Lucas), 30/09, loja vendendo ─────────────────────────
  // Reprovação nas primeiras consultas é a objeção que faz loja nova parar de
  // consultar. Bate com o check-in de vendas ("primeiras reprovarem é normal")
  // e com a frase-modelo AIVA+Odres do prompt.
  {
    mensagem_id: 'a0775ee2-ee2c-4d21-896c-85b9cc7242ed',
    lead_id: '6962407d-cc37-45a0-adf2-00edd5c9edda',
    avaliacao: 'boa',
    pergunta: 'Quando aparece que nenhum aparelho está disponível para a pessoa, quer dizer que não foi aprovado?',
    resposta:
      'Isso mesmo, Lucas! Quando aparece que nenhum aparelho está disponível, é porque o cliente não foi aprovado naquela consulta — o limite dele não foi suficiente ou o perfil de crédito não passou na análise.\n\nMas ó: isso é SUPER normal, viu? A aprovação depende do perfil de cada cliente que você consulta. Primeiras reprovações acontecem e NÃO significam que "a AIVA não aprova".\n\nA regra de ouro é: consultar TODO cliente, sem pré-julgar — quem oferece pra todos vende mais no fim do mês. E lembra que vocês têm AIVA e Odres no mesmo acesso: uma consulta só e o sistema testa nas duas financeiras. Se uma não pegar, ainda tem a outra! 😊\n\nComo tão indo as primeiras vendas aí? Já conseguiu fechar alguma?',
    correcao: null,
  },
  // ── BOA — MF iPhones (Leonardo), 29/09, travado na tela branca do endereço ──
  // "no anônima deu certo. finalizei o cadastro" 8 min depois.
  // ⚠️ Cortei do original "já registrei pro time técnico... vou cobrar e te
  // retorno" (promessa de retorno — proibida desde 21/09) e o link do onboarding
  // (URL em exemplo parqueia). O que fica é só a jogada: aba anônima.
  {
    mensagem_id: '410af863-5d83-4f5e-a912-eface08cfe9d',
    lead_id: '15c272c6-2965-40bc-80c9-85f4afd45d1d',
    avaliacao: 'boa',
    pergunta: 'Só fiz até o endereço, quando coloco o endereço ele já não aparece a próxima etapa, a tela fica branca (já tentei mais de um dispositivo)',
    resposta:
      'Entendi, Leonardo! A tela tá travando no endereço e não avança pro próximo passo. Tenta abrir o link do cadastro em uma aba anônima do navegador (modo privado) — às vezes resolve esse tipo de trava. Me avisa se funcionou!',
    correcao: null,
  },
]

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
