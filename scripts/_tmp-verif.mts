import { createClient } from '@supabase/supabase-js'
import { soRespostaAutomatica } from '../lib/resposta-automatica.ts'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const desde = process.argv[2]
const { data: ins } = await sb.from('sdr_mensagens').select('lead_id,conteudo,enviado_em').eq('direcao', 'in').gte('enviado_em', desde)
const ids = [...new Set(ins!.map((m) => m.lead_id))]
const { data: leads } = await sb.from('sdr_leads').select('id,nome,status,observacoes').in('id', ids)
const { data: todas } = await sb.from('sdr_mensagens').select('lead_id,conteudo').eq('direcao', 'in').in('lead_id', ids)
const por = new Map<string, string[]>(); for (const m of todas!) { const a = por.get(m.lead_id) ?? []; a.push(m.conteudo); por.set(m.lead_id, a) }
const robo = leads!.filter((l) => soRespostaAutomatica(por.get(l.id) ?? []) && !(l.observacoes ?? '').includes('[DADOS_COLETADOS:'))
const cont: Record<string, number> = {}; for (const l of robo) cont[l.status] = (cont[l.status] ?? 0) + 1
console.log(`leads que escreveram desde ${desde}: ${ids.length} | só robô: ${robo.length}`, cont)
for (const l of robo.filter((l) => l.status === 'INTERESSADO').slice(0, 5)) console.log('  INTERESSADO mesmo assim:', l.nome, '|', (por.get(l.id) ?? []).join(' // ').slice(0, 120))
