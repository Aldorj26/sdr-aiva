const BASE=process.env.EVO_TALKS_BASE_URL, KEY=process.env.EVO_TALKS_API_KEY
const g=async(id)=>{const r=await fetch(BASE+'/int/getOpportunity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({queueId:10,apiKey:KEY,id})});return r.json()}
// [apaga (sync, sem telefone), fica (com telefone)]
const pares=[[10443,12989],[10448,13005],[15815,12898],[15333,13023],[15332,12931],[15337,12950],[10438,13002],[15331,12904],[15335,12908]]
for (const [del, keep] of pares) {
  const [oDel,oKeep]=[await g(del), await g(keep)]
  if (!oKeep.mainphone) { console.log('⚠️ PULADO #'+keep,'nao tem telefone — nao apago o par'); continue }
  const ridDel=(oDel.description??'').match(/UME_RID:\s*(\d+)/i)?.[1]
  const cnpjDel=(oDel.description??'').match(/CNPJ:\s*(\d{14})/i)?.[1]
  const temRid=/UME_RID:\s*\d+/i.test(oKeep.description??'')
  const temCnpjCru=new RegExp('CNPJ:\s*'+cnpjDel).test((oKeep.description??''))
  const pedacos=[String(oKeep.description??'').trim()||null, (!temCnpjCru&&cnpjDel)?`CNPJ: ${cnpjDel}`:null, (!temRid&&ridDel)?`UME_RID: ${ridDel}`:null].filter(Boolean)
  if (pedacos.length>1 || !oKeep.description) {
    const nova=pedacos.join(' | ')
    await fetch(BASE+'/int/updateOpportunity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({queueId:10,apiKey:KEY,id:keep,description:nova})})
    await new Promise(r=>setTimeout(r,1000))
    const v=await g(keep)
    if (ridDel && !(v.description??'').includes('UME_RID: '+ridDel) && !temRid) { console.log('✗ #'+keep,'nao herdou o RID — par NAO apagado'); continue }
  }
  console.log(`  fica #${keep} "${oKeep.title.slice(0,34)}" (tel ${oKeep.mainphone})`)
  console.log(`  herda: ${!temRid&&ridDel?'RID '+ridDel:'—'} ${!temCnpjCru&&cnpjDel?'CNPJ '+cnpjDel:''}`)
  console.log(`  APAGAR → #${del} "${oDel.title.slice(0,34)}"`)
}
