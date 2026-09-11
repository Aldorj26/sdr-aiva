// Rodada do destilador 2026-09-11 — grava na curadoria o que passou na
// triagem (caps: 5 'ruim' + 5 'boa'; zonas proibidas ficam de fora, vão
// parqueadas no digest). Ver docs/destilador-enviar-info.log.
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const agora = new Date().toISOString()

const entradas = [
  // ── RUINS (correção do Nei reescrita na voz da VictorIA) ──────────────────
  {
    mensagem_id: '7d586ab5-2a1f-4b43-8b4c-d72939d4699a',
    lead_id: 'cebfb579-0cac-4d6a-9d91-65189093df0f',
    avaliacao: 'ruim',
    pergunta: 'Só apareceu isso [print da tela "Obrigado pelo interesse!"]',
    resposta: 'Perfeito, Thiago! Essa tela de "Obrigado pelo interesse!" significa que você já CONCLUIU o cadastro completo — incluindo a biometria facial. O sistema registrou tudo certinho! Agora é só aguardar a análise final do time AIVA.',
    correcao: 'Opa, Thiago! Essa tela ainda NÃO é a de conclusão não — o cadastro não foi finalizado. Você precisa entrar no link de novo e seguir até o fim, porque a tela que confirma a conclusão é diferente dessa. Nunca dou o cadastro por concluído a partir de um print que eu não reconheço com certeza: se a tela não bate com a de conclusão, eu peço pro lojista tentar de novo e, na dúvida, aciono o time. Se travar em algum passo, me avisa que te ajudo! 😊',
  },
  {
    mensagem_id: 'cb9561e0-50b9-4c39-9083-fa1d690d4a31',
    lead_id: 'e5ae0244-4307-4cc2-946a-ac119870b2b4',
    avaliacao: 'ruim',
    pergunta: 'Já tentei de tudo',
    resposta: 'Entendi, Eliabe! Se já tentou atualizar, trocar navegador e dispositivo e a tela continua travada no endereço, é problema no sistema mesmo. Vou registrar o chamado pro time técnico verificar essa tela e te dou retorno assim que tiver solução, combinado? Me avisa se conseguir avançar antes disso!',
    correcao: 'Entendi, Eliabe! Pode me mandar um print da tela que tá travada? Assim eu vejo certinho o que está acontecendo e te ajudo — ou passo pro time técnico com o detalhe do erro. (Antes de concluir que "é problema no sistema" e abrir chamado, eu peço o print: sem ver o erro eu não tenho como afirmar que a falha é da plataforma.)',
  },
  // ── BOAS (jogadas que destravaram o lead) ─────────────────────────────────
  {
    mensagem_id: '387611ee-9920-4385-983f-84bc2731a067',
    lead_id: 'ba1ac626-9a1d-4d32-b74a-4e650dd231c1',
    avaliacao: 'boa',
    pergunta: 'Ou o que pretendendo ganhar ? [lead confuso sobre o que é "faturamento"]',
    resposta: 'É o faturamento atual da loja, Aluisio — o que você fatura hoje, por alto mesmo. Pode ser uma média anual aproximada, sem precisar ser exato.',
    correcao: null,
  },
  {
    mensagem_id: '0ed3a160-8782-4203-8f8e-b29c88767def',
    lead_id: '0a6e11de-d5b8-43cc-bc7e-757136afecd3',
    avaliacao: 'boa',
    pergunta: 'Email do sócio: NAO TEMOS',
    resposta: 'Tranquilo, Renan! Vou precisar só do e-mail pra concluir o cadastro — pode ser qualquer e-mail seu (Gmail, Hotmail, ou o que você usar). Qual você prefere usar?',
    correcao: null,
  },
  {
    mensagem_id: '739a12dd-6beb-4679-aa3a-d32b0ecf7c29',
    lead_id: 'cebfb579-0cac-4d6a-9d91-65189093df0f',
    avaliacao: 'boa',
    pergunta: 'Essa filial é bom colocar porque amiga?',
    resposta: 'Sim, Thiago! Vale a pena incluir a filial porque cada loja vai ter sua própria operação no sistema — vendas separadas, repasses separados, usuários próprios. Assim você consegue acompanhar o desempenho de cada unidade de forma independente, sem misturar os números. E quanto mais lojas ativas, maior o potencial de vendas no crediário! Se quiser incluir, é só confirmar que quer cadastrar o CNPJ da filial também.',
    correcao: null,
  },
  {
    mensagem_id: '0a5720ca-412d-466e-9745-04b73e09fc76',
    lead_id: '1400c929-1c22-4208-a68b-8617bd3ef794',
    avaliacao: 'boa',
    pergunta: 'Fiz tudo só não abriu essa parte [biometria facial]',
    resposta: 'Entendi, Paulo! Você preencheu todas as 7 etapas mas a parte da biometria facial não abriu no final, é isso? Isso pode acontecer por questão de navegador ou permissão de câmera. Tenta o seguinte: 1. Se tá no computador, abre o link no *celular* — a biometria funciona melhor pelo celular 2. Usa o navegador Chrome se ainda não tiver tentado 3. Quando pedir permissão pra usar a câmera, clica em "Permitir". Se mesmo assim não aparecer, me avisa que eu aciono o time técnico pra verificar, combinado?',
    correcao: null,
  },
]

for (const e of entradas) {
  const { error } = await sb.from('sdr_curadoria').upsert({ ...e, atualizado_em: agora }, { onConflict: 'mensagem_id' })
  console.log(error ? `ERRO ${e.mensagem_id}: ${error.message}` : `ok ${e.avaliacao} ${e.mensagem_id}`)
}
const { count: r } = await sb.from('sdr_curadoria').select('*', { count: 'exact', head: true }).eq('avaliacao', 'ruim').not('correcao', 'is', null)
const { count: b } = await sb.from('sdr_curadoria').select('*', { count: 'exact', head: true }).eq('avaliacao', 'boa').not('pergunta', 'is', null)
console.log(`fila agora: ruins com correção=${r} | boas com par=${b}`)
