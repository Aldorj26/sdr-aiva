// Mostra o que a API pública da AIVA (a fonte do espelho) devolve pra UM CNPJ — só leitura.
// Uso: npx tsx --env-file=.env.local scripts/onb-api-por-cnpj-2026-10-19.mts <cnpj>
import { listarOnboardingsApi } from '../lib/portal-aiva'
const alvo = (process.argv[2] ?? '').replace(/\D/g, '')
const tudo = await listarOnboardingsApi()
console.log(JSON.stringify(tudo.filter((o) => String(o.cnpj ?? '').replace(/\D/g, '') === alvo), null, 2))
