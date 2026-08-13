import Link from 'next/link'
import { selectAllAivaLeads } from '@/lib/supabase'
import { fetchOpps } from '@/lib/pipeline-briefing'
import { STAGE_TO_STATUS } from '@/lib/evotalks'
import FunilBoard, { type LeadCard } from './FunilBoard'
import LeadDrawer from '../_components/LeadDrawer'

// Cache curto (30s): a página lê o pipeline da Evo (mesma fonte do briefing das 5h).
// Não fica batendo na Evo a cada refresh, mas mantém praticamente em tempo real.
// SÓ LEITURA — não escreve em lugar nenhum, não interfere na VictorIA nem nos crons.
export const revalidate = 30

const MAX_CARDS_POR_ETAPA = 45 // contagem é total; cards são amostra (igual ao "+N ver todos")

/** Forma canônica do telefone BR pra casar Evo (mainphone) ↔ Supabase (telefone). */
function canonFone(raw: string | null | undefined): string {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.startsWith('55')) d = d.slice(2)
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3) // remove 9º dígito
  return d
}

export default async function FunilPage() {
  // FONTE DA VERDADE = Evo, pipeline 15 (mesma do briefing). Fail-soft: se a Evo
  // falhar, a página mostra aviso em vez de quebrar — a operação segue intacta.
  let opps: Awaited<ReturnType<typeof fetchOpps>> = []
  let erroEvo: string | null = null
  try {
    opps = await fetchOpps()
  } catch (e) {
    erroEvo = e instanceof Error ? e.message : String(e)
  }

  // Mapa telefone→lead do Supabase: só pra deixar o card clicável (abrir o drawer).
  // Não afeta contagem/etapas — essas vêm 100% da Evo.
  // Pagina TODOS os leads (PostgREST corta em 1000; .limit não vence) — senão os
  // cards de leads além dos 1000 primeiros não abriam ao clicar.
  const leadsRaw = await selectAllAivaLeads<{ id: string; telefone: string; cidade: string | null; importante: boolean; acionar_humano: boolean }>('id, telefone, cidade, importante, acionar_humano')
  const mapa = new Map<string, { id: string; cidade: string | null; importante: boolean; acionar_humano: boolean }>()
  for (const l of leadsRaw) {
    mapa.set(canonFone(l.telefone), {
      id: l.id,
      cidade: l.cidade ?? null,
      importante: !!l.importante,
      acionar_humano: !!l.acionar_humano,
    })
  }

  const counts: Record<string, number> = {}
  const mostrados: Record<string, number> = {}
  const leads: LeadCard[] = []
  // Mais tempo na etapa primeiro (prioriza quem está parado) — igual ao briefing.
  const ordenadas = [...opps].sort((a, b) => (a.stagebegintime || 0) - (b.stagebegintime || 0))

  for (const o of ordenadas) {
    const status = STAGE_TO_STATUS[o.fkStage]
    if (!status) continue // etapa fora do mapa conhecido — ignora
    counts[status] = (counts[status] ?? 0) + 1
    if ((mostrados[status] ?? 0) >= MAX_CARDS_POR_ETAPA) continue
    mostrados[status] = (mostrados[status] ?? 0) + 1
    const m = mapa.get(canonFone(o.mainphone))
    leads.push({
      id: m?.id ?? '',
      nome: (o.title || '').replace(/\s*—\s*AIVA\s*$/i, '').trim() || 'Sem nome',
      telefone: o.mainphone || '',
      cidade: m?.cidade ?? null,
      status,
      // tempo NA ETAPA (stagebegintime) — é o que a Evo mostra como "parado".
      data_ultimo_contato: o.stagebegintime ? new Date(o.stagebegintime * 1000).toISOString() : null,
      importante: m?.importante ?? false,
      acionar_humano: m?.acionar_humano ?? false,
    })
  }

  const total = opps.length

  return (
    <main>
      <header style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            href="/"
            style={{
              color: 'var(--text-dim)',
              textDecoration: 'none',
              fontSize: '0.85rem',
              padding: '0.35rem 0.6rem',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--bg-elev)',
            }}
          >
            ← Voltar
          </Link>
          <h1 style={{ margin: 0 }}>Funil AIVA</h1>
        </div>
        <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          {erroEvo
            ? '⚠️ Não consegui ler a Evo agora — tente recarregar em instantes.'
            : `${total.toLocaleString('pt-BR')} oportunidades no funil (ao vivo da Evo · pipeline 15) · clique num card pra abrir o lead`}
        </p>
      </header>

      <FunilBoard counts={counts} leads={leads} />
      <LeadDrawer />
    </main>
  )
}
