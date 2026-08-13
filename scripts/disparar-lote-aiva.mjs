#!/usr/bin/env node
/**
 * Disparo em lote da campanha AIVA (send-initial) em chunks pequenos,
 * pra não estourar o timeout da função serverless.
 *
 * - Normaliza (só dígitos), dedupa, descarta inválidos (len != 11) e lixo
 *   (dígitos repetidos), prefixa 55.
 * - POST em lotes de CHUNK pro endpoint de produção.
 * - Agrega o resumo (sucesso / inválidos / bloqueados / falha).
 *
 * Uso: node scripts/disparar-lote-aiva.mjs [--dry]
 */
const PROD = 'https://sdr-aiva.vercel.app/api/sdr/send-initial'
const CHUNK = 5
const DRY = process.argv.includes('--dry')

const RAW = `
71997208373
71997217937
71997396800
71997403161
71998614350
71999019646
71999124536
71999129792
71999157689
71999169057
71999169057
71999211107
71999334000
71999385903
71999386688
71999456087
71999802095
71999853917
71999951811
71999999999
73981079512
73981245864
73981360591
73981426111
73981792315
73981801575
73981803201
73981828410
73981848888
73981894009
73981908927
73982069828
73982330129
73982519702
73988138632
73988138632
73988230668
73988231423
73988330403
73988750016
73988893671
73991318430
73991413246
73991429469
73991789720
73991859971
73991919245
73998203429
73998295007
73998532663
73998549343
73999117568
73999202349
73999386913
73999471168
73999500888
73999560921
73999634504
73999649238
73999671530
73999729748
73999920001
73999933666
74981000884
74981476600
74988060425
74988060425
74988116600
74988119742
74988244363
74988249823
74988273361
74988350592
74988366415
74988397100
74988414898
74988416521
74988427314
74988454881
74988616816
74988703385
74988735772
74988736424
74988736424
74991027255
74991202854
74991219461
74991340494
74991412852
74991432275
74991972196
74998065530
74998195764
74999070662
74999088206
74999106280
74999292989
74999398787
74999408421
74999485948
74999509078
74999640287
74999659199
74999744943
74999971488
75981063814
75981073165
75981073165
75981146690
75981158969
75981209788
75981248764
75981440009
75981472151
75981474555
75981717011
75981733655
75981885117
75981903580
75981910957
75982008707
75982108345
75982337827
75982366292
75982418179
75982432177
75982610321
75982644748
75982799339
75982842983
75983047011
75983310141
75983360234
75983372251
75983390635
75983603105
75988043939
75988043939
75988146707
75988146707
75988167541
75988623034
75988695396
75988751574
75988840586
75991007064
75991013500
75991052870
75991144358
`

const ehLixo = (n) => /^(\d)\1+$/.test(n) // todos os dígitos iguais
const limpos = [...new Set(
  RAW.split('\n').map((l) => l.replace(/\D/g, '')).filter(Boolean),
)]
const validos = limpos.filter((n) => n.length === 11 && !ehLixo(n))
const descartados = limpos.filter((n) => !(n.length === 11 && !ehLixo(n)))

console.log(`Total bruto (linhas com dígito): ${RAW.split('\n').filter((l)=>l.replace(/\D/g,'')).length}`)
console.log(`Únicos: ${limpos.length} | Válidos: ${validos.length} | Descartados: ${descartados.length}`)
if (descartados.length) console.log(`Descartados (inválido/lixo): ${descartados.join(', ')}`)

const leads = validos.map((n) => ({ nome: `Lead ${n}`, telefone: `55${n}` }))
const chunks = []
for (let i = 0; i < leads.length; i += CHUNK) chunks.push(leads.slice(i, i + CHUNK))

const totais = { sucesso: 0, invalidos: 0, bloqueados: 0, falha: 0 }
const detalhes = { invalidos: [], bloqueados: [], falha: [] }

if (DRY) {
  console.log(`\n[DRY] ${leads.length} leads em ${chunks.length} lotes de ${CHUNK}. Nada enviado.`)
  process.exit(0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i]
  try {
    const res = await fetch(PROD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: chunk }),
    })
    const json = await res.json()
    totais.sucesso += json.sucesso ?? 0
    totais.invalidos += json.invalidos ?? 0
    totais.bloqueados += json.bloqueados ?? 0
    totais.falha += json.falha ?? 0
    for (const r of json.resultados ?? []) {
      if (r.ok) continue
      if (r.erro === 'numero_sem_whatsapp') detalhes.invalidos.push(r.telefone)
      else if (String(r.erro).startsWith('bloqueado')) detalhes.bloqueados.push(`${r.telefone} (${r.erro})`)
      else detalhes.falha.push(`${r.telefone}: ${r.erro}`)
    }
    console.log(`Lote ${i + 1}/${chunks.length}: HTTP ${res.status} → ok ${json.sucesso ?? 0}, inval ${json.invalidos ?? 0}, bloq ${json.bloqueados ?? 0}, falha ${json.falha ?? 0}`)
  } catch (e) {
    console.log(`Lote ${i + 1}/${chunks.length}: ERRO ${e.message}`)
    detalhes.falha.push(`lote ${i + 1}: ${e.message}`)
  }
  await sleep(1500)
}

console.log(`\n===== RESUMO =====`)
console.log(`Disparados com sucesso: ${totais.sucesso}`)
console.log(`Sem WhatsApp (inválidos): ${totais.invalidos}`)
console.log(`Bloqueados (já no funil): ${totais.bloqueados}`)
console.log(`Falhas: ${totais.falha}`)
if (detalhes.invalidos.length) console.log(`\nSem WhatsApp: ${detalhes.invalidos.join(', ')}`)
if (detalhes.bloqueados.length) console.log(`\nBloqueados: ${detalhes.bloqueados.join(', ')}`)
if (detalhes.falha.length) console.log(`\nFalhas: ${detalhes.falha.join(', ')}`)
