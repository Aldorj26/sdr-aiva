/**
 * COLETOR do "Funil por Loja" (Data Studio Parceiros-AIVA, aba com filtro de período)
 * ────────────────────────────────────────────────────────────────────────────
 * O Looker Studio não tem export acessível por script, então a coleta é feita
 * lendo a tabela renderizada. Este snippet roda NO CONSOLE do Chrome e coleta
 * sozinho enquanto você rola a tabela.
 *
 * COMO USAR (1x por mês, ~2 minutos):
 *   1. Abra o relatório: https://datastudio.google.com/u/0/reporting/af540856-cd61-4ada-9b97-de85174d7cbd/page/p_q8g4rrvn3d
 *   2. Em "Selecionar período", escolha o mês fechado (ex.: 1 a 31 de julho).
 *   3. Aperte F12 → aba Console → cole este arquivo inteiro → Enter.
 *   4. NÃO PRECISA ROLAR (descoberta 03/09): cada página da tabela já rende as
 *      50 linhas inteiras no DOM. Basta clicar nas setinhas ‹ › passando por
 *      TODAS as páginas — o contador captura cada página inteira de uma vez.
 *      ⚠️ O contador pode fechar em total-1: o Looker repete a linha da
 *      fronteira entre páginas (ex.: 131/132 com a mesma loja idêntica nas
 *      páginas 2 e 3) — se os totais do importador baterem com os cards, ok.
 *   5. Clique no botão "⬇ Baixar JSON" do contador.
 *   6. Me mande o arquivo ou rode:
 *      node --env-file=.env.local scripts/importar-funil-loja.mjs --mes 2026-07 --arquivo "C:/Users/rocha/Downloads/funil-loja.json"
 */
(() => {
  const coleta = new Map()

  const coletar = () => {
    const tbl = document.querySelector('.lego-component.simple-table')
    if (!tbl) return
    for (const r of tbl.querySelectorAll('.tableBody .row')) {
      const cs = [...r.querySelectorAll('.cell')].map((c) => c.textContent.trim())
      // colunas: ID | CNPJ | Varejo | Loja | UF | Cidade | Status | Aprovados | Vendas | Conv% | Venda R$ | Ticket
      if (cs.length >= 12 && cs[0] && /^\d+$/.test(cs[0])) {
        // chave inclui a LOJA (corrigido 03/09): o mesmo id+cnpj pode ter
        // 2+ lojas (Multicell Loja 1/2/3) — sem isso elas colapsavam.
        coleta.set(cs[0] + '|' + cs[1] + '|' + cs[3], {
          id: cs[0], cnpj: cs[1], varejo: cs[2], loja: cs[3], uf: cs[4], cidade: cs[5],
          status: cs[6], aprovados: cs[7], vendas: cs[8], conv: cs[9], valor: cs[10], ticket: cs[11],
        })
      }
    }
    const total = tbl.parentElement?.textContent?.match(/\d+\s*-\s*\d+\s*\/\s*(\d+)/)?.[1] ?? '?'
    painel.firstChild.textContent = `Funil por Loja: ${coleta.size} / ${total} linhas`
    painel.style.background = String(coleta.size) === total ? '#16a34a' : '#1f2937'
  }

  const painel = document.createElement('div')
  painel.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:99999;background:#1f2937;color:#fff;' +
    'padding:10px 14px;border-radius:10px;font:13px/1.4 sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35)'
  painel.appendChild(document.createTextNode('coletando…'))
  const btn = document.createElement('button')
  btn.textContent = '⬇ Baixar JSON'
  btn.style.cssText = 'display:block;margin-top:6px;padding:4px 10px;border-radius:6px;border:0;cursor:pointer;font-weight:600'
  btn.onclick = () => {
    const blob = new Blob([JSON.stringify([...coleta.values()], null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'funil-loja.json'
    a.click()
  }
  painel.appendChild(btn)
  document.body.appendChild(painel)

  coletar()
  setInterval(coletar, 800) // captura os blocos que a tabela renderiza ao rolar
  console.log('Coletor ativo — role a tabela até o contador bater o total, depois clique em Baixar JSON.')
})()
