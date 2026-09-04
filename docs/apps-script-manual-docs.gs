/**
 * Apps Script — Fluxo de Cadastro Manual AIVA (documentos + aba Manual)
 *
 * ONDE INSTALAR: na planilha "AIVA APROVAÇÂO"
 * (https://docs.google.com/spreadsheets/d/1lTB9LvptQejFd_WLygGAKDE6UDVlzvfLEDGhcdSRmQU)
 * → Extensões → Apps Script → cole este código → Implantar → Nova implantação
 * → tipo "App da Web" → Executar como: você / Acesso: "Qualquer pessoa"
 * → copie a URL do app da web e me passe (vira a env GOOGLE_MANUAL_WEBHOOK_URL).
 *
 * O que faz:
 *  - acao="doc":   salva o arquivo (base64) na pasta do Drive
 *                  "AIVA - Documentos Cadastro Manual", numa subpasta por loja
 *                  ("LOJA — CNPJ"), e devolve a URL do arquivo.
 *  - acao="linha": adiciona uma linha na aba "Manual" com os dados do lead
 *                  (colunas na ordem da aba; o que faltar vai vazio).
 */

var PASTA_DOCS_ID = '1yAtSYdjDISW2SX965f925KjMBTMHD2gp'; // AIVA - Documentos Cadastro Manual
var ABA_MANUAL = 'Manual';
var SEGREDO = 'track2026manual';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.segredo !== SEGREDO) {
      return saida({ ok: false, erro: 'unauthorized' });
    }

    if (body.acao === 'doc') {
      var pastaRaiz = DriveApp.getFolderById(PASTA_DOCS_ID);
      var nomeSub = ((body.loja || 'Loja') + ' — ' + (body.cnpj || body.telefone || 's-cnpj')).substring(0, 100);
      var sub = obterOuCriarSubpasta(pastaRaiz, nomeSub);
      var blob = Utilities.newBlob(
        Utilities.base64Decode(body.base64),
        body.mimeType || 'application/octet-stream',
        body.nomeArquivo || ('documento-' + new Date().getTime())
      );
      var arquivo = sub.createFile(blob);
      return saida({ ok: true, url: arquivo.getUrl(), pasta: sub.getUrl() });
    }

    if (body.acao === 'linha') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var aba = ss.getSheetByName(ABA_MANUAL);
      // Ordem das colunas da aba Manual:
      // A SIGNER_NAME | B SIGNER_EMAIL | C RAZÃO SOCIAL | D ENDEREÇO | E CNPJ |
      // F MDR | G DATA DO CONTRATO | H NOME DO VAREJO | I NOME COMPLETO | J CPF |
      // K ISENÇÃO | L FANTASIA | M ID Varejo | N (vazio) | O Código Banco |
      // P Agência | Q Conta | R Dígito da Conta | S Link Assinatura | T Docs (Drive)
      aba.appendRow([
        body.signer_name || '',
        body.signer_email || '',
        body.razao_social || '',
        body.endereco || '',
        body.cnpj || '',
        '12%',                      // MDR padrão
        '',                         // DATA DO CONTRATO (preenchida na assinatura)
        body.nome_varejo || '',
        body.nome_completo || body.signer_name || '',
        body.cpf || '',             // J — CPF (coletado no chat pela VictorIA)
        '',                         // ISENÇÃO
        body.fantasia || '',
        '',                         // ID Varejo
        '',
        body.banco_codigo || '',    // O — Código Banco
        body.banco_agencia || '',   // P — Agência
        body.banco_conta || '',     // Q — Conta
        body.banco_digito || '',    // R — Dígito da Conta
        '',                         // Link Assinatura
        body.link_pasta || ''       // T — link da pasta de documentos no Drive
      ]);
      return saida({ ok: true });
    }

    return saida({ ok: false, erro: 'acao_desconhecida' });
  } catch (err) {
    return saida({ ok: false, erro: String(err) });
  }
}

function obterOuCriarSubpasta(raiz, nome) {
  var it = raiz.getFoldersByName(nome);
  return it.hasNext() ? it.next() : raiz.createFolder(nome);
}

function saida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ─── AÇÃO 'repasse' — JÁ NO SCRIPT PUBLICADO (Versão 13, 04/09/2026) ────────
// A aba "Repasses" já existia na planilha com cabeçalho próprio:
//   A=ID VAREJO | B=NOME DA LOJA | C=CNPJ | D=EMAIL | E=TELEFONE | F=DATA/HORA | G=LANCADO NO FORM?
// (E–G adicionados por nós em 04/09). O trecho implantado segue essa ordem —
// CNPJ com apóstrofo pra preservar zeros à esquerda:
//    if (body.acao === 'repasse') {
//      var ssR = SpreadsheetApp.openById(PLANILHA_ID);
//      var abaR = ssR.getSheetByName('Repasses');
//      if (!abaR) { abaR = ssR.insertSheet('Repasses');
//        abaR.appendRow(['ID VAREJO', 'NOME DA LOJA', 'CNPJ', 'EMAIL', 'TELEFONE', 'DATA/HORA', 'LANCADO NO FORM?']); }
//      abaR.appendRow(['', body.loja || '', "'" + String(body.cnpj || ''), body.gmail || '',
//        body.telefone || '', body.data_hora || '', body.form_ok ? 'SIM' : 'NAO - lancar manual']);
//      return saida({ ok: true });
//    }
