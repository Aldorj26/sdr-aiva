import Link from 'next/link'
import { fetchClientes, type ClienteRow } from '@/lib/clientes'
import ClientesTable from './ClientesTable'
import LeadDrawer from '../_components/LeadDrawer'

// Cache 30s (igual ao Funil). Só leitura da Evo — não afeta VictorIA/crons.
export const revalidate = 30

export default async function ClientesPage() {
  let clientes: ClienteRow[] = []
  let erro: string | null = null
  try {
    clientes = await fetchClientes()
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e)
  }

  return (
    <main>
      <header style={{ marginBottom: '1.25rem' }}>
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
          <h1 style={{ margin: 0 }}>Clientes</h1>
        </div>
        <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          {erro
            ? '⚠️ Não consegui ler a Evo agora — tente recarregar em instantes.'
            : `${clientes.length.toLocaleString('pt-BR')} clientes com Qualificação Varejo preenchida · ao vivo da Evo`}
        </p>
      </header>

      {!erro && <ClientesTable clientes={clientes} />}
      <LeadDrawer />
    </main>
  )
}
