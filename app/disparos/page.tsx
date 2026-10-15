/**
 * /disparos — estado do disparo D+0 e os três botões, pensada pro navegador do celular
 * (15/10/2026, Aldo). Em 14/10 o disparo ficou pausado o dia todo porque o `/retomar` no
 * WhatsApp virou "/retornar" no corretor do celular; aqui é um toque.
 *
 * Leitura BARATA (`fotoRapida`): só banco, sem medir a entrega na Evo — a página tem que abrir na
 * hora em 4G. O diagnóstico da entrega, quando ela causou a pausa, já está no motivo da pausa.
 * ⚠️ Página do painel: tem que estar no matcher do `middleware.ts`, senão nasce pública.
 */
import { fotoRapida } from '@/lib/disparo-diario'
import { guardaBarata, TETO_DIA, JANELA } from '@/lib/disparo-diario-calc'
import Acoes from './Acoes'

export const dynamic = 'force-dynamic'

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const RELOGIO: Record<string, string> = {
  fim_de_semana: 'Fim de semana — o disparo só roda de segunda a sexta.',
  feriado: 'Feriado — o disparo não roda hoje.',
  fora_da_janela: `Fora da janela — o disparo roda de ${JANELA.de}h às ${JANELA.ate}h (horário de Brasília).`,
}

const card: React.CSSProperties = {
  background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 12,
  padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
}
const rotulo: React.CSSProperties = { fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }
const numero: React.CSSProperties = { fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.1 }

export default async function DisparosPage() {
  const agora = Date.now()
  const { estado, saiuHoje, restante, filaPendente } = await fotoRapida(agora)
  // Mesma função que o cron usa, com `pausado: false` pra isolar só o relógio (a pausa tem faixa própria).
  const relogio = guardaBarata({ agoraMs: agora, pausado: false })
  const pct = Math.min(100, Math.round((saiuHoje / TETO_DIA) * 100))

  return (
    <main style={{ padding: '1rem', maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h1 style={{ fontSize: '1.3rem', margin: 0 }}>Disparo diário</h1>

      {/* Faixa de estado: a informação que faltou no dia 14/10 */}
      <div
        style={{
          borderRadius: 12, padding: '0.9rem 1rem',
          background: estado.pausado ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.1)',
          border: `1px solid ${estado.pausado ? 'var(--red, #dc2626)' : 'var(--green, #16a34a)'}`,
        }}
      >
        <strong style={{ fontSize: '1.05rem' }}>
          {estado.pausado ? '🔴 PAUSADO' : '🟢 ATIVO'}
        </strong>
        {estado.pausado ? (
          <div style={{ fontSize: '0.85rem', marginTop: 4 }}>
            <div>{estado.motivo ?? 'sem motivo registrado'}</div>
            <div style={{ color: 'var(--text-muted)' }}>desde {dataBr(estado.pausado_em)} — nada sai até alguém destravar</div>
          </div>
        ) : (
          <div style={{ fontSize: '0.85rem', marginTop: 4, color: 'var(--text-muted)' }}>
            {relogio ? RELOGIO[relogio] ?? relogio : `Na janela: o cron manda um lote a cada 5 min até as ${JANELA.ate}h.`}
            {estado.retomado_em ? ` · último retomar: ${dataBr(estado.retomado_em)}` : ''}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.7rem' }}>
        <div style={card}>
          <span style={rotulo}>Saíram hoje</span>
          <span style={numero}>{saiuHoje} <span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--text-muted)' }}>de {TETO_DIA}</span></span>
          <div style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', marginTop: 4 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
        </div>
        <div style={card}>
          <span style={rotulo}>Falta no teto</span>
          <span style={numero}>{restante}</span>
        </div>
        <div style={card}>
          <span style={rotulo}>Fila pendente</span>
          <span style={numero}>{filaPendente}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>lojas esperando</span>
        </div>
      </div>

      <Acoes pausado={estado.pausado} />

      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
        “Disparar agora” destrava a pausa (se tiver) e manda 5 lojas na hora, pra você ver que está saindo.
        O resto dos {TETO_DIA} continua saindo sozinho de 5 em 5 min até as {JANELA.ate}h. Em fim de semana,
        feriado ou fora da janela nada é enviado, e se a entrega da Meta cair o robô pausa de novo e avisa.
      </p>
    </main>
  )
}
