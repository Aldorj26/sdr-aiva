/**
 * POST /api/comissoes/importar — recebe os xlsx de apuração da UME
 * (Carteira e/ou FCDL) e grava em ume_comissoes / ume_comissoes_meta.
 *
 * Multipart: campo(s) "arquivos". Reimportar o mesmo (mes, origem) substitui.
 * Auth: middleware do painel (cookie) — a rota está no matcher.
 *
 * Spec: docs/superpowers/specs/2026-08-26-painel-comissoes-design.md
 */
import { NextRequest, NextResponse } from 'next/server'
import { parsePlanilhaUme } from '@/lib/comissoes'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 2 * 1024 * 1024

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const arquivos = form.getAll('arquivos').filter((f): f is File => f instanceof File)
  if (!arquivos.length) {
    return NextResponse.json({ error: 'Nenhum arquivo enviado (campo "arquivos").' }, { status: 400 })
  }

  const resultados: Array<{
    arquivo: string
    ok: boolean
    mes?: string
    origem?: string
    linhas?: number
    total_comissao?: number | null
    aviso?: string | null
    erro?: string
  }> = []

  for (const f of arquivos) {
    try {
      if (!/\.xlsx$/i.test(f.name)) throw new Error('Só aceito .xlsx (a planilha original do email da UME).')
      if (f.size > MAX_BYTES) throw new Error(`Arquivo maior que ${MAX_BYTES / 1024 / 1024} MB.`)

      const parsed = parsePlanilhaUme(await f.arrayBuffer(), f.name)

      // substitui o (mes, origem) inteiro — reimport é idempotente
      const del = await supabaseAdmin.from('ume_comissoes').delete().eq('mes', parsed.mes).eq('origem', parsed.origem)
      if (del.error) throw new Error(`Falha ao limpar import anterior: ${del.error.message}`)

      const ins = await supabaseAdmin.from('ume_comissoes').insert(
        parsed.linhas.map((l) => ({ mes: parsed.mes, origem: parsed.origem, ...l })),
      )
      if (ins.error) throw new Error(`Falha ao gravar linhas: ${ins.error.message}`)

      const up = await supabaseAdmin.from('ume_comissoes_meta').upsert(
        {
          mes: parsed.mes,
          origem: parsed.origem,
          ...parsed.meta,
          arquivo: f.name,
          importado_em: new Date().toISOString(),
        },
        { onConflict: 'mes,origem' },
      )
      if (up.error) throw new Error(`Falha ao gravar meta: ${up.error.message}`)

      resultados.push({
        arquivo: f.name, ok: true, mes: parsed.mes, origem: parsed.origem,
        linhas: parsed.linhas.length, total_comissao: parsed.meta.total_comissao, aviso: parsed.aviso,
      })
    } catch (err) {
      resultados.push({ arquivo: f.name, ok: false, erro: err instanceof Error ? err.message : String(err) })
    }
  }

  const algumOk = resultados.some((r) => r.ok)
  return NextResponse.json({ ok: algumOk, resultados }, { status: algumOk ? 200 : 422 })
}
