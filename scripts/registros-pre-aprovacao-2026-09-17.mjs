#!/usr/bin/env node
/**
 * Backfill do pré-cadastro na Pré Aprovação (Aldo 17/09/2026).
 *
 * A partir de hoje o webhook cria o registro do CNPJ matriz assim que o lead
 * entra em Pré Aprovação — mas quem JÁ estava em 54 antes do deploy não tem
 * registro nenhum e continuaria invisível no /registros. Este script traz esses
 * leads pra tela.
 *
 * Sem --gravar só mostra, sem tocar em nada. Nunca move card em hipótese alguma:
 * mover é do clique do Nei no /registros.
 *
 * Uso: node --env-file=.env.local scripts/registros-pre-aprovacao-2026-09-17.mjs [--gravar]
 */
import { createClient } from '@supabase/supabase-js'

const GRAVAR = process.argv.includes('--gravar')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const soDigitos = (c) => String(c ?? '').replace(/\D/g, '')

const { data: leads } = await sb
  .from('sdr_leads')
  .select('id, nome, telefone, observacoes, evotalks_opportunity_id')
  .eq('status', 'PRE_APROVACAO')

console.log(`${leads.length} lead(s) em Pré Aprovação\n`)

const novos = []
for (const l of leads) {
  const cnpj = soDigitos((l.observacoes ?? '').match(/cnpj_matriz=([^|\]\n]+)/)?.[1] ?? '')
  const { data: jaTem } = await sb.from('sdr_registros_cnpj').select('id').eq('lead_id', l.id).limit(1)
  const opp = Number(l.evotalks_opportunity_id ?? NaN)
  const status =
    jaTem?.length ? 'já tem registro'
    : cnpj.length !== 14 ? 'SEM CNPJ matriz nas observações'
    : 'vai criar'
  console.log(
    `• ${l.nome} — CNPJ ${cnpj || '(nenhum)'} · opp ${opp || '(SEM OPP: o clique não vai mover nada)'} · ${status}`,
  )
  if (status === 'vai criar') novos.push({ lead_id: l.id, loja: l.nome, telefone: l.telefone, cnpj, tipo: 'matriz', status: 'informada' })
}

if (!novos.length) { console.log('\nNada a criar.'); process.exit(0) }
if (!GRAVAR) { console.log(`\n${novos.length} registro(s) a criar. Rode com --gravar pra aplicar.`); process.exit(0) }

const { error } = await sb.from('sdr_registros_cnpj').upsert(novos, { onConflict: 'lead_id,cnpj', ignoreDuplicates: true })
if (error) { console.error('falhou:', error.message); process.exit(1) }
console.log(`\n${novos.length} registro(s) criado(s) — aparecem agora em /registros como "🆕 informada".`)
