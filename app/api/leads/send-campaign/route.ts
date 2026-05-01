import { NextRequest, NextResponse } from 'next/server'
import { isDiaUtil, rotuloHorario } from '@/lib/business-time'

/**
 * Rota protegida pelo painel (middleware valida cookie dash_auth).
 * Aceita 2 formatos no body:
 *   1) Legacy:   { telefones: "string com telefones", nome, cidade, produto }
 *   2) Novo:     { leads: [{ nome, telefone, cidade }], nome, cidade, produto }
 * Em ambos: normaliza, deduplica, e delega pro /api/sdr/send-initial.
 */
export async function POST(req: NextRequest) {
  // Bloqueia disparo de campanha em fim de semana (sáb/dom BRT).
  // Webhook de resposta continua rodando normal — lojista fala a qualquer hora.
  if (!isDiaUtil()) {
    console.log(`[send-campaign] bloqueado: ${rotuloHorario()} (fim de semana)`)
    return NextResponse.json(
      {
        error: 'disparo_bloqueado_fim_de_semana',
        info: `Disparos de campanha só acontecem de segunda a sexta. Hoje é ${rotuloHorario()}.`,
      },
      { status: 400 }
    )
  }

  let body: {
    telefones?: unknown
    leads?: unknown
    nome?: unknown
    cidade?: unknown
    produto?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload invalido' }, { status: 400 })
  }

  const nomeDefault = typeof body.nome === 'string' && body.nome.trim() ? body.nome.trim() : 'Loja'
  const cidadeDefault = typeof body.cidade === 'string' && body.cidade.trim() ? body.cidade.trim() : undefined
  const produto = typeof body.produto === 'string' ? body.produto.toUpperCase() : 'AIVA'

  // Normaliza um número cru: extrai dígitos, adiciona 55 se faltar, valida tamanho.
  // Retorna null se inválido.
  function normalizaTelefone(raw: unknown): string | null {
    if (typeof raw !== 'string') return null
    const digitos = raw.replace(/\D/g, '')
    if (!digitos) return null
    const comDdi = digitos.startsWith('55') ? digitos : `55${digitos}`
    if (comDdi.length < 12 || comDdi.length > 13) return null
    return comDdi
  }

  type LeadPayload = { nome: string; telefone: string; cidade?: string }
  const leadsMap = new Map<string, LeadPayload>() // dedup por telefone

  // Formato 1: array estruturado de leads (novo)
  if (Array.isArray(body.leads)) {
    for (const item of body.leads as Array<Record<string, unknown>>) {
      if (!item || typeof item !== 'object') continue
      const telefone = normalizaTelefone(item.telefone)
      if (!telefone || leadsMap.has(telefone)) continue

      const nomeRaw = typeof item.nome === 'string' && item.nome.trim() ? item.nome.trim() : nomeDefault
      const cidadeRaw =
        typeof item.cidade === 'string' && item.cidade.trim()
          ? item.cidade.trim()
          : cidadeDefault

      leadsMap.set(telefone, { nome: nomeRaw, telefone, cidade: cidadeRaw })
    }
  }

  // Formato 2: string solta de telefones (legacy)
  if (typeof body.telefones === 'string' && body.telefones.trim()) {
    for (const raw of body.telefones.split(/[\s,;]+/)) {
      const telefone = normalizaTelefone(raw)
      if (!telefone || leadsMap.has(telefone)) continue
      leadsMap.set(telefone, { nome: nomeDefault, telefone, cidade: cidadeDefault })
    }
  }

  if (leadsMap.size === 0) {
    return NextResponse.json({ error: 'Nenhum telefone valido encontrado' }, { status: 400 })
  }

  const leads = Array.from(leadsMap.values())

  const comNome = leads.filter((l) => l.nome && l.nome !== nomeDefault).length
  const comCidade = leads.filter((l) => l.cidade && l.cidade !== cidadeDefault).length
  console.log(
    `[send-campaign] disparo requisitado: ${leads.length} leads, ` +
      `${comNome} com nome custom, ${comCidade} com cidade custom, produto=${produto}`
  )

  // Chama o endpoint de disparo interno usando o secret
  const origin = new URL(req.url).origin
  try {
    const res = await fetch(`${origin}/api/sdr/send-initial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // O send-initial nao exige header, mas enviamos por seguranca caso seja restrito no futuro
        'x-internal-secret': process.env.WEBHOOK_SECRET ?? '',
      },
      body: JSON.stringify({ leads, produto }),
    })

    const data = await res.json()
    return NextResponse.json({
      ok: res.ok,
      total: leads.length,
      sucesso: data.sucesso ?? 0,
      falha: data.falha ?? 0,
      invalidos: data.invalidos ?? 0,
      resultados: data.resultados ?? [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Erro ao disparar: ${msg}` }, { status: 500 })
  }
}
