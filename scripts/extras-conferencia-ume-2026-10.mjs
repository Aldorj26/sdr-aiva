import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'
const dig=(v)=>String(v??'').replace(/\D/g,'')
const cnpj14=(v)=>{const d=dig(v);return d?d.padStart(14,'0').slice(-14):null}
const J = JSON.parse(readFileSync('scripts/out-conferencia-ume-2026-10.json','utf8'))
const ridOut = new Set(J.relatorioLinhas.map(l=>String(l.rid)))
const porRidOut = new Map(J.relatorioLinhas.map(l=>[String(l.rid),l]))
const nossosRids = new Set(J.lojas.flatMap(l=>l.rids))
const nomeDe = new Map(); for (const l of J.lojas) for (const r of l.rids) nomeDe.set(r, l.nomes?.[0] ?? null)

// setembro
const relSet=[]
{ const wb = XLSX.readFile('scripts/ume-outros-varejos-set2026.xlsx')
  for (const aba of wb.SheetNames) { const rows=XLSX.utils.sheet_to_json(wb.Sheets[aba],{header:1,raw:true,defval:null})
    const iH=rows.findIndex(r=>String(r?.[0]??'').trim().toUpperCase()==='RETAILER ID'); if(iH<0) continue
    if (String(rows[iH][4]??'').trim().toUpperCase()==='ISSUER') continue
    for (const r of rows.slice(iH+1)){ if(r?.[0]==null||r[0]==='')continue; const rid=Number(r[0]); if(!Number.isFinite(rid))continue
      const d=r.slice(4); relSet.push({rid:String(rid),cnpj:cnpj14(r?.[1]),varejo:String(r?.[2]??'').trim(),grupo:String(r?.[3]??'').trim(),
        contratos:Number(d[0])||0,originacao:Number(d[1])||0,mdr:Number(d[2])||0,comissao:Number(d[3])||0}) } } }
const churn = relSet.filter(l=>!porRidOut.has(l.rid)).map(l=>({...l, nossa: nossosRids.has(l.rid)}))
  .sort((a,b)=>b.comissao-a.comissao)

// onboardings vivos
const onb=[]; { let c=null; do { const q=new URLSearchParams({limit:'500'}); if(c)q.set('cursor',c)
  const r=await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`,{headers:{'x-api-key':process.env.AIVA_PORTAL_API_KEY}})
  const d=await r.json(); onb.push(...(d.records??[])); c=d.next_cursor??null } while(c) }
const pvFora = onb.filter(o=>o.board_column==='primeira_venda' && o.retailer_id && !ridOut.has(String(o.retailer_id)))
  .map(o=>({rid:String(o.retailer_id), cnpj:cnpj14(o.cnpj), nome:o.retailer_name ?? o.legal_name ?? nomeDe.get(String(o.retailer_id)) ?? '',
    desde:String(o.board_column_since??'').slice(0,10), nossa: nossosRids.has(String(o.retailer_id)),
    setembro: relSet.find(x=>x.rid===String(o.retailer_id))?.comissao ?? 0 }))
  .sort((a,b)=> (b.desde||'').localeCompare(a.desde||''))
const calib = {}
for (const o of onb.filter(o=>o.board_column==='primeira_venda'&&o.retailer_id)) {
  const m=String(o.board_column_since??'').slice(0,7); calib[m] ??= {total:0,dentro:0}
  calib[m].total++; if (ridOut.has(String(o.retailer_id))) calib[m].dentro++ }
writeFileSync('scripts/out-extras-2026-10.json', JSON.stringify({churn, pvFora, calib}, null, 1))
console.log('churn=%d (nossas %d) | primeira_venda fora do relatorio=%d | nov=%d',
  churn.length, churn.filter(c=>c.nossa).length, pvFora.length, pvFora.filter(p=>p.desde.startsWith('2026-11')).length)
console.log(JSON.stringify(calib))
