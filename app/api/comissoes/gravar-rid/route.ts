/**
 * POST /api/comissoes/gravar-rid — grava o Retailer ID da UME na descrição
 * de uma oportunidade do funil 11 ("UME_RID: n"), preservando o texto atual.
 *
 * Body: { opportunityId: number, retailerId: number }
 * 409 se a descrição já tem UME_RID com valor diferente (conflito → manual).
 * Auth: middleware do painel (cookie) — a rota está no matcher.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getOpportunity, updateOpportunityDescription } from '@/lib/evotalks'
import { parseDescricaoOpp } from '@/lib/comissoes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { opportunityId?: unknown; retailerId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  const opportunityId = Number(body.opportunityId)
  const retailerId = Number(body.retailerId)
  if (!Number.isInteger(opportunityId) || opportunityId <= 0 || !Number.isInteger(retailerId) || retailerId <= 0) {
    return NextResponse.json({ error: 'opportunityId e retailerId devem ser inteiros positivos.' }, { status: 400 })
  }

  const opp = await getOpportunity(opportunityId)
  const descAtual = String(opp.description ?? '').trim()
  const { umeRid } = parseDescricaoOpp(descAtual)

  if (umeRid != null && umeRid !== retailerId) {
    return NextResponse.json(
      { error: `A oportunidade #${opportunityId} já tem UME_RID: ${umeRid} — conflito com ${retailerId}. Resolva no Evo.` },
      { status: 409 },
    )
  }
  if (umeRid === retailerId) {
    return NextResponse.json({ ok: true, jaGravado: true })
  }

  const novaDesc = descAtual ? `${descAtual} | UME_RID: ${retailerId}` : `UME_RID: ${retailerId}`
  await updateOpportunityDescription(opportunityId, novaDesc)
  console.log(`[COMISSOES] UME_RID ${retailerId} gravado na opp #${opportunityId}`)
  return NextResponse.json({ ok: true, description: novaDesc })
}
