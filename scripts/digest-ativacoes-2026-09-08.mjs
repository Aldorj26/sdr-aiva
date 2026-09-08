import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const post = async (p, b) => { const r = await fetch(`${BASE}${p}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({queueId:QID,apiKey:KEY,...b})}); if(!r.ok) throw new Error(`${p} HTTP ${r.status}`); return r.json() }
const { data } = await sb.from('sdr_registros_cnpj').select('loja,cnpj,rid,ativa_em').eq('status','ativa').gte('ativa_em','2026-09-08T00:00:00Z').order('loja')
const linhas = data.map(r=>`• ${r.loja} (RID ${r.rid ?? '?'})`)
const texto = `🆕 *Lojas novas ATIVARAM (snapshot 2026-08-31)* — lista completa\n\n_Correção: o digest anterior saiu cortado e listou só a Redcell. Foram ${data.length} ativações nesta segunda:_\n\n${linhas.join('\n')}\n\nTodas já com status 'ativa' e conta criada no funil 11 (Contas Fechadas MRR).`
console.log(texto)
if (process.argv.includes('--send')) {
  for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean)) {
    try {
      const aberto = await post('/int/getClientOpenChats', { number: tel }).catch(()=>null)
      const chatId = aberto?.chats?.[0]?.chatId
      if (chatId) await post('/int/sendMessageToChat', { chatId: Number(chatId), text: texto })
      else await post('/int/openChat', { number: tel, message: texto })
      console.log('enviado para', tel)
    } catch(e) { console.error('falhou', tel, String(e).slice(0,120)) }
  }
}
setTimeout(()=>process.exit(0),800).unref()
