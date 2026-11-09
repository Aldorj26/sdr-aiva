import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const c = async (t, f) => { const { count, error } = await f; console.log(t, error ? 'ERRO '+error.message : count) }
await c('desempenho mes=2026-11:', sb.from('aiva_desempenho').select('*',{count:'exact',head:true}).eq('mes','2026-11'))
await c('desempenho mes=2026-10:', sb.from('aiva_desempenho').select('*',{count:'exact',head:true}).eq('mes','2026-10'))
await c('diario data_ref>=2026-10-27:', sb.from('aiva_portal_diario').select('*',{count:'exact',head:true}).gte('data_ref','2026-10-27'))
const { data: d } = await sb.from('aiva_desempenho').select('mes').order('mes',{ascending:false}).limit(500)
console.log('meses distintos:', [...new Set((d??[]).map(r=>r.mes))].slice(0,6))
