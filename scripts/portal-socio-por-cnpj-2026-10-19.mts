// Lê no portal da AIVA o cadastro de UM CNPJ (sócio, razão social, telefone, etapa) — só leitura.
// Uso: npx tsx --env-file=.env.local scripts/portal-socio-por-cnpj-2026-10-19.mts <cnpj>
// 19/10/2026: pra preencher o formulário da opp #29936 (TeamVL) sem inventar o nome do sócio.
import { loginPortal, rest } from '../lib/portal-aiva'

const cnpj = (process.argv[2] ?? '').replace(/\D/g, '')
if (!cnpj) { console.error('uso: <cnpj>'); process.exit(1) }
const s = await loginPortal()
const { data } = await rest<Array<Record<string, unknown>>>(
  s, `onboardings?select=id,cnpj,legal_name,partner_owner_name,phone_number,stage,retailer_id&or=(cnpj.eq.${cnpj},phone_number.eq.5551992091968,phone_number.like.*51992091968,retailer_id.eq.5063)`,
)
console.log(JSON.stringify(data, null, 2))
