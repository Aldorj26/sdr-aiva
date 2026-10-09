// Rodada do destilador 2026-10-09 (agendada, sexta) — grava na curadoria o que passou na triagem.
// Fonte A: 74 manuais do Nei (69 "[Info pendente]"/templates sem texto; 2 "correções"
// do classificador — a do Lucas/Original Importados era texto INVENTADO pelo modelo, o
// Nei só ofereceu explicar de novo; 3 "zonas proibidas" — 2 eram retomadas comuns e 1
// é real: Barba Variedades, Nei pediu documento com foto + selfie na mão depois de
// biometria com erro = coleta de dados, parqueada). Fonte B: 13 jogadas, 9 parquearam
// (12%/D+2/6x-9x-12x/2 min: Mundo do Celular Imports, Master Cell, Perfect Cell, Mult
// Cell, Nask Tech, Ponto Cell, GAP informática, RPcell; +55 21 4020-2024: MIX.COM),
// FlexCell = tema "não trabalho com crédito" já na fila (Lambari 04/09), JR Celulares e
// Mundo das Capas = respostas certas (Android/acessórios/NF, prompt l.412/l.1025) mas o
// lojista silenciou depois — sem prova de destrave, não entram. Ver docs/destilador-enviar-info.log.
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const agora = new Date().toISOString()

const entradas = [
  // ── RUIM — Joelcelularessm (Joel), 06/10, loja vendendo, "Oi pouca aprovacao" ───
  // Ela respondeu com 1.269 caracteres e 8 parágrafos (regra do prompt: máximo 3),
  // com "caso real: 185 consultas → 52 aprovados → 25 vendas", plano em 2 itens e
  // negrito em **markdown** (vira asterisco solto no WhatsApp). O Nei refez na mão
  // 4h depois, em 5 linhas, com UMA sugestão. ⚠️ Cortei da correção a frase do Nei
  // "geralmente aprovamos em torno de 30%" — número de aprovação = zona proibida.
  // Os números da própria loja (7 de 17, 3 vendas) ficam: são do bloco de desempenho.
  {
    mensagem_id: '78573640-c9d9-4fa7-8739-ea57fdf343c5',
    lead_id: 'e36d6d99-cc12-46f1-a566-fb34ffd734a2',
    avaliacao: 'ruim',
    pergunta: 'Oi pouca aprovacao',
    resposta:
      'Oi Joel! Entendi — pouca aprovação é a reclamação nº1 e eu te ajudo com isso.\n\nOlhando os números da sua loja: no mês passado vocês fizeram 17 consultas e tiveram 7 aprovados (41% de taxa) — taxa boa! Mas dessas 7 aprovações, só 3 viraram venda (43%). Ou seja: o gargalo não é aprovação baixa, é conversão — cliente que aprovou e não fechou.\n\nE agora em outubro só rolaram 2 consultas até agora, nenhuma aprovada. Isso é volume baixo demais — estatisticamente consulta vira venda (caso real: 185 consultas → 52 aprovados → 25 vendas).\n\nEntão as ações são duas:\n\n1️⃣ **AUMENTAR as consultas** — oferecer o crediário pra TODO cliente que entrar, pedir o CPF logo na abordagem. Quem consulta mais vende mais no fim do mês.\n\n2️⃣ **FECHAR os aprovados** — quando o cliente for aprovado, mostrar o aparelho certo dentro do limite dele e apresentar a PARCELA que cabe no bolso (não o total). E aproveitar cada real do limite: vender aparelho + combo de acessório (capa, película, fone).\n\nE tem um plus agora: quem se credencia pela Track tem AIVA e Odres no mesmo acesso — uma consulta só e o sistema devolve em qual das duas aprovou. Cliente que uma não pega, a outra pode pegar.\n\nMe conta: a equipe tá oferecendo o crediário pra todos, ou só quando o cliente pede parcelado?',
    correcao:
      'Entendo, Joel! Olhei seus números: no mês passado foram 7 aprovados em 17 consultas e 3 vendas fechadas — a aprovação tá boa, o que falta é volume. Minha sugestão: aborda o cliente oferecendo um benefício e pede o CPF logo de cara. Mais consultas, mais aprovados, mais vendas. 😉\n\n(Quando o lojista reclama de pouca aprovação, eu respondo CURTO: os números dele em uma linha, UMA sugestão concreta e pronto — sem aula de estatística, sem "caso real" de outra loja, sem lista numerada, sem negrito com asterisco duplo. Máximo 3 parágrafos, como manda a regra.)',
  },
  // ── BOA — Meu Celular (Ullysses), 09/10, retomada → "Vamos marcar pessoalmente" ──
  // Ela respondeu que o atendimento é por mensagem (a Track NÃO faz visita — prompt
  // l.686) e já emendou o CNPJ. Ele mandou o CNPJ 2 min depois e em 11 min deu os 5
  // dados → PRE_APROVACAO. Obs: o prompt manda "avisar o time" nesse caso e ela não
  // acionou por esse motivo — fica como nota, não muda o exemplo (que é só o texto).
  {
    mensagem_id: 'a8308c52-28f1-40d5-b42c-ac926a7c0ec7',
    lead_id: '71699e12-13b2-4035-9b0c-4b127dcd9e01',
    avaliacao: 'boa',
    pergunta: 'Vamos marca pessoalmente para eu entender melhor',
    resposta:
      'Ullysses, o nosso atendimento é todo por aqui por mensagem mesmo — a gente não faz visita presencial, mas consigo te explicar tudo certinho por aqui, no seu tempo. 😊 Pra eu já adiantar seu cadastro: qual o CNPJ da sua loja?',
    correcao: null,
  },
]

for (const e of entradas) {
  const { data: m } = await sb.from('sdr_mensagens').select('id, direcao, conteudo').eq('id', e.mensagem_id).maybeSingle()
  if (!m || m.direcao !== 'out' || /manual via painel/i.test(m.conteudo)) {
    console.error('ABORTADO: mensagem original não confere', e.mensagem_id, '— nada gravado.')
    process.exit(1)
  }
  if (!m.conteudo.startsWith(e.resposta.slice(0, 60))) {
    console.error('ABORTADO: texto gravado não bate com o começo da mensagem original', e.mensagem_id)
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
