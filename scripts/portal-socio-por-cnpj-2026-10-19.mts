// Lê no portal da AIVA o cadastro de UM CNPJ (sócio, razão social, telefone, etapa) — só leitura.
// Uso: npx tsx --env-file=.env.local scripts/portal-socio-por-cnpj-2026-10-19.mts <cnpj>
// 19/10/2026: pra preencher o formulário da opp #29936 (TeamVL) sem inventar o nome do sócio.
import { loginPortal, rest } from '../lib/portal-aiva'

const cnpj = (process.argv[2] ?? '').replace(/\D/g, '')
if (!cnpj) { console.error('uso: <cnpj>'); process.exit(1) }
const s = await loginPortal()
const { data } = await rest<Array<Record<string, unknown>>>(
  s, `onboardings?select=id,cnpj,legal_name,partner_owner_name,phone_number,stage,retailer_id,biometry_status,pre_cadastro_status,created_at,updated_at&or=(cnpj.eq.${cnpj},cnpj.eq.${cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')})`,
)
console.log(JSON.stringify(data, null, 2))
