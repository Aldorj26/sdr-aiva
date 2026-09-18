// Rodada do destilador 2026-09-18 — grava na curadoria o que passou na triagem.
// Só 1 entrada nesta rodada (caps 5+5 não chegaram perto): a fonte A não trouxe
// correção de conduta (as 55 mensagens manuais do Nei na janela são o template de
// cobrança de cadastro repetido + templates de follow-up), e das 11 jogadas da
// fonte B, 9 parquearam por taxa/prazo/valor/URL e 1 (HS Imports) foi REPROVADA na
// conferência manual — era o erro da tela "Obrigado pelo interesse!" de novo, não
// uma jogada; virou regra de prompt. Ver docs/destilador-enviar-info.log.
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const agora = new Date().toISOString()

const entradas = [
  // ── BOA — Laura Acessórios (Jhonata), avançou pra LOGIN em 17/09 ────────────
  // ⚠️ O texto original dela dizia "(segunda ou quinta)" e citava o link da turma.
  // Removi os dois: a agenda virou dinâmica (lib/turmas-treinamento) e já existe
  // entrada 'ruim' de 16/09 ensinando que dias/links vêm SEMPRE do bloco dinâmico.
  // Exemplo com dia fixo aqui reintroduziria exatamente o erro que aquela corrige.
  {
    mensagem_id: '4e8f7832-0000-0000-0000-000000000000', // trocado em runtime
    lead_id: '0b44d5f0-c211-46ad-8acf-f5020eb3f483',
    avaliacao: 'boa',
    pergunta: 'se eu assistir o video da pasta o o login chega ?',
    resposta:
      'Não, Jhonata — o login chega automático depois do treinamento ao vivo, independente de você assistir o vídeo ou não. O vídeo Curso_Treinamento serve pra você *adiantar todo o aprendizado* e chegar na live já sabendo tudo, só tirando dúvidas. Mas o login do sócio é liberado em leva pela AIVA sempre depois das turmas ao vivo. Então funciona assim: você estuda pelo vídeo agora, entra na próxima turma (presença não é obrigatória) e o login chega depois dela.',
    correcao: null,
  },
]

// o id real da mensagem vencedora (prefixo 4e8f7832) — confere antes de gravar
const { data: msg } = await sb
  .from('sdr_mensagens')
  .select('id, conteudo')
  .eq('lead_id', entradas[0].lead_id)
  .eq('direcao', 'out')
  .ilike('conteudo', '%o login chega automático depois dos treinamentos ao vivo%')
  .order('enviado_em', { ascending: false })
  .limit(1)
if (!msg?.length) {
  console.error('ABORTADO: não achei a mensagem original da jogada — nada gravado.')
  process.exit(1)
}
entradas[0].mensagem_id = msg[0].id
console.log('mensagem original:', msg[0].id)

for (const e of entradas) {
  const { error } = await sb.from('sdr_curadoria').upsert({ ...e, atualizado_em: agora }, { onConflict: 'mensagem_id' })
  console.log(error ? `ERRO ${e.mensagem_id}: ${error.message}` : `ok ${e.avaliacao} ${e.mensagem_id}`)
}
const { count: r } = await sb.from('sdr_curadoria').select('*', { count: 'exact', head: true }).eq('avaliacao', 'ruim').not('correcao', 'is', null)
const { count: b } = await sb.from('sdr_curadoria').select('*', { count: 'exact', head: true }).eq('avaliacao', 'boa').not('pergunta', 'is', null)
console.log(`fila agora: ruins com correção=${r} | boas com par=${b}`)
