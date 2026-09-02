'use client'

import { useEffect, useRef, useState } from 'react'
import TagChips, { type TagChip } from './TagChips'

interface Lead {
  id: string
  nome: string
  telefone: string
  cidade: string | null
  produto: string
  status: string
  etapa_cadencia: number
  evotalks_chat_id: string | null
  evotalks_opportunity_id: string | null
  data_disparo_inicial: string | null
  data_proximo_followup: string | null
  data_ultimo_contato: string | null
  acionar_humano: boolean
  observacoes: string | null
  instrucao_silvia: string | null
  criado_em: string
  webhook_lock_at: string | null
}

interface Mensagem {
  id: string
  direcao: 'in' | 'out'
  conteudo: string
  template_hsm: string | null
  enviado_em: string
  avaliacao: 'boa' | 'ruim' | null
}

// Renderiza o conteúdo de uma mensagem. Marcadores de mídia (gravados pelo
// webhook com o fileId do Evo) viram imagem ou link de arquivo, resolvidos pelo
// proxy /api/leads/media/<fileId>. Qualquer outra coisa é texto normal.
function MensagemConteudo({ conteudo }: { conteudo: string }) {
  const img = conteudo.match(/^\[LEAD_ENVIOU_IMAGEM:(\d+)\]$/)
  if (img) {
    const src = `/api/leads/media/${img[1]}`
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
        <img
          src={src}
          alt="Imagem enviada pelo lojista"
          style={{ maxWidth: '100%', maxHeight: 320, borderRadius: '0.5rem', display: 'block' }}
        />
      </a>
    )
  }

  // [LEAD_ENVIOU_ARQUIVO:<id>:<mime>:<nome>] — o nome é opcional (marcadores
  // antigos não têm) e vai por último porque pode conter ':'.
  const arq = conteudo.match(/^\[LEAD_ENVIOU_ARQUIVO:(\d+):([^:\]]*):?([^\]]*)\]$/)
  if (arq) {
    const [, id, mime, nomeArq] = arq
    const isPdf = mime.includes('pdf')
    const rotulo = isPdf ? 'Abrir documento (PDF)' : 'Abrir arquivo'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <a
          href={`/api/leads/media/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent)', fontWeight: 600, textDecoration: 'underline' }}
        >
          {isPdf ? '📄' : '📎'} {rotulo}
        </a>
        {nomeArq && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
            {nomeArq}
          </span>
        )}
      </div>
    )
  }

  // Marcador antigo sem fileId (mídia recebida antes do fix) — não dá pra recuperar.
  if (conteudo === '[LEAD_ENVIOU_IMAGEM]') {
    return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>🖼️ imagem enviada (sem link — anterior à atualização)</span>
  }

  return <div>{conteudo}</div>
}

const STATUS_COLOR: Record<string, string> = {
  DISPARO_REALIZADO: '#64748b',
  INTERESSADO: '#16a34a',
  FORMULARIO_ENVIADO: '#2563eb',
  SEM_RESPOSTA: '#d97706',
  OPT_OUT: '#dc2626',
  NAO_QUALIFICADO: '#dc2626',
  AGUARDANDO: '#7c3aed',
  DESCARTADO: '#94a3b8',
}

// Textos prontos do "Enviar info" — os pedidos que o Nei mais repete.
// Desde 2026-07-31 vivem na tabela sdr_atalhos_info (editáveis pelo próprio
// painel: ajustar texto, criar atalho novo com link, excluir). Sem saudação:
// o envio frio (HSM) já prefixa "Olá [nome],".
interface AtalhoInfo {
  id: string
  rotulo: string
  texto: string
}

export default function LeadDrawer() {
  const [leadId, setLeadId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{
    lead: Lead; mensagens: Mensagem[]; totalMensagens?: number; etapaEvo?: string | null; tagsEvo?: TagChip[]
    lojas?: Array<{ cnpj: string; tipo: string; status: string; rid: string | null }>
    funcionarios?: Array<{ nome: string; cpf: string | null; telefone: string | null; email: string | null; cnpj_loja: string | null }>
  } | null>(null)

  // Abre a conversa já rolada no FIM (última mensagem à vista) — pedido do
  // Aldo 2026-07-31. Âncora + scrollIntoView: rola o ancestral certo, seja o
  // drawer inteiro ou só a área de mensagens. Só no primeiro carregamento de
  // cada lead: refreshs posteriores não puxam a tela do operador.
  const fimConversaRef = useRef<HTMLDivElement | null>(null)
  const ultimoLeadRolado = useRef<string | null>(null)
  useEffect(() => {
    if (!data?.lead?.id || data.mensagens.length === 0) return
    if (ultimoLeadRolado.current === data.lead.id) return
    ultimoLeadRolado.current = data.lead.id
    // Tentativas repetidas no ~1,5s inicial: mídias das mensagens (imagens do
    // Evo) carregam depois do render e crescem o conteúdo — um scroll único
    // rodava cedo demais e a conversa abria no topo.
    const rolar = () => fimConversaRef.current?.scrollIntoView({ block: 'end' })
    requestAnimationFrame(() => requestAnimationFrame(rolar))
    // sem cleanup de propósito: um refresh de data não pode cancelar os timers
    // (a âncora some ao fechar o drawer, então disparo tardio é no-op seguro)
    ;[150, 400, 800, 1500].forEach((ms) => setTimeout(rolar, ms))
  }, [data])
  const [busy, setBusy] = useState(false)

  // Estado do painel de resposta manual
  const [showReply, setShowReply] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replying, setReplying] = useState(false)

  // Estado do painel de "Enviar info pendente" (mensagem manual sem contexto/IA)
  const [showInfo, setShowInfo] = useState(false)
  const [infoText, setInfoText] = useState('')
  const [sendingInfo, setSendingInfo] = useState(false)
  const [infoAnexos, setInfoAnexos] = useState<File[]>([])

  // Atalhos de texto pronto (tabela sdr_atalhos_info) + modo edição
  const [atalhos, setAtalhos] = useState<AtalhoInfo[]>([])
  const [editAtalhos, setEditAtalhos] = useState(false)
  const [savingAtalho, setSavingAtalho] = useState(false)

  async function carregarAtalhos() {
    try {
      const res = await fetch('/api/atalhos-info')
      const j = await res.json()
      if (j.atalhos) setAtalhos(j.atalhos)
    } catch { /* atalhos são conveniência — falha não bloqueia o Enviar info */ }
  }

  async function salvarAtalho(a: AtalhoInfo) {
    if (!a.rotulo.trim() || !a.texto.trim()) return
    setSavingAtalho(true)
    try {
      await fetch('/api/atalhos-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id || undefined, rotulo: a.rotulo, texto: a.texto }),
      })
      await carregarAtalhos()
    } finally {
      setSavingAtalho(false)
    }
  }

  async function excluirAtalho(id: string) {
    if (!id) { setAtalhos((xs) => xs.filter((x) => x.id !== id)); return }
    setSavingAtalho(true)
    try {
      await fetch(`/api/atalhos-info?id=${id}`, { method: 'DELETE' })
      await carregarAtalhos()
    } finally {
      setSavingAtalho(false)
    }
  }

  // Estado do painel de edição
  const [showEdit, setShowEdit] = useState(false)
  const [editNome, setEditNome] = useState('')
  const [editCidade, setEditCidade] = useState('')
  const [editObs, setEditObs] = useState('')
  const [saving, setSaving] = useState(false)

  // Estado do painel de instrução para VictorIA
  const [showInstrucao, setShowInstrucao] = useState(false)
  const [instrucaoText, setInstrucaoText] = useState('')
  const [savingInstrucao, setSavingInstrucao] = useState(false)

  async function refreshDrawer() {
    if (!leadId) return
    const r = await fetch(`/api/leads/${leadId}/detail`)
    const json = await r.json()
    if (!json.error) setData(json)
  }

  async function runAction(body: object, confirmMsg?: string) {
    if (!leadId) return
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        // `detalhe` traz a explicação em português quando a rota tem uma
        // (ex.: card fora do funil AIVA no Evo) — sem isso o painel mostrava
        // só o código do erro, que não diz ao operador o que fazer.
        window.alert(json.detalhe ?? `Erro: ${json.error ?? 'desconhecido'}`)
        return
      }
      setLeadId(null)
      // força refresh da página pra atualizar contadores
      window.location.reload()
    } catch (err) {
      window.alert(`Erro: ${err}`)
    } finally {
      setBusy(false)
    }
  }

  async function sendManualReply() {
    if (!leadId || !replyText.trim()) return
    setReplying(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'send-manual', mensagem: replyText.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'janela_24h_fechada') {
          window.alert(`⚠️ Janela de 24h fechada — mensagem não enviada\n\n${json.motivo}`)
        } else {
          window.alert(`Erro: ${json.error ?? 'desconhecido'}`)
        }
        return
      }
      setReplyText('')
      setShowReply(false)
      await refreshDrawer()
    } catch (err) {
      window.alert(`Erro: ${err}`)
    } finally {
      setReplying(false)
    }
  }

  // Envia uma informação pendente — mensagem manual do operador, SEM contexto/IA.
  // Abre nova interação: texto livre se janela aberta; template HSM 21 se cliente frio.
  // Lê um File → base64 (sem o prefixo data:) + dimensões se for imagem.
  async function lerAnexo(file: File): Promise<{ fileName: string; mimeType: string; base64: string; width?: number; height?: number }> {
    const base64: string = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
      r.onerror = () => reject(new Error('falha ao ler arquivo'))
      r.readAsDataURL(file)
    })
    let width: number | undefined
    let height: number | undefined
    if (file.type.startsWith('image/')) {
      const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => resolve(null)
        img.src = URL.createObjectURL(file)
      })
      if (dims) { width = dims.w; height = dims.h }
    }
    return { fileName: file.name, mimeType: file.type || 'application/octet-stream', base64, width, height }
  }

  async function sendInfoPendente() {
    if (!leadId) return
    if (!infoText.trim() && infoAnexos.length === 0) return
    // Limite de segurança: o body vai em JSON pro serverless (teto ~4,5 MB no
    // Vercel) — cada arquivo até 3 MB e o CONJUNTO até 3 MB também.
    const grande = infoAnexos.find((f) => f.size > 3 * 1024 * 1024)
    if (grande) {
      window.alert(`"${grande.name}" é muito grande (máx. 3 MB por arquivo). Comprima ou envie direto pelo WhatsApp.`)
      return
    }
    const totalBytes = infoAnexos.reduce((s, f) => s + f.size, 0)
    if (totalBytes > 3 * 1024 * 1024) {
      window.alert('O conjunto de anexos passou de 3 MB. Envie em duas levas.')
      return
    }
    setSendingInfo(true)
    try {
      const body: Record<string, unknown> = { type: 'send-info', mensagem: infoText.trim() }
      if (infoAnexos.length > 0) body.anexos = await Promise.all(infoAnexos.map(lerAnexo))
      const res = await fetch(`/api/leads/${leadId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        window.alert(json.info ?? `Erro: ${json.error ?? 'desconhecido'}`)
        return
      }
      const via =
        json.modo === 'anexo'
          ? `com ${infoAnexos.length > 1 ? `os ${infoAnexos.length} anexos` : 'o anexo'} (janela aberta)`
          : json.modo === 'hsm'
            ? 'via template (cliente estava frio — a conversa foi reaberta)'
            : 'como texto livre (janela aberta)'
      window.alert(`✅ Informação enviada ${via}.`)
      setInfoText('')
      setInfoAnexos([])
      setShowInfo(false)
      await refreshDrawer()
    } catch (err) {
      window.alert(`Erro: ${err}`)
    } finally {
      setSendingInfo(false)
    }
  }

  async function runFollowupNow() {
    if (!leadId) return
    if (!window.confirm('Disparar follow-up agora? A VictorIA vai detectar se a janela 24h está aberta e mandar texto livre — caso contrário, dispara o template HSM de retomada.')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'force-followup' }),
      })
      const json = await res.json()
      if (!res.ok) {
        // `detalhe` traz a explicação em português quando a rota tem uma
        // (ex.: card fora do funil AIVA no Evo) — sem isso o painel mostrava
        // só o código do erro, que não diz ao operador o que fazer.
        window.alert(json.detalhe ?? `Erro: ${json.error ?? 'desconhecido'}`)
        return
      }
      // Feedback explícito do modo que rodou — operador precisa saber se foi
      // texto livre (janela 24h aberta) ou template HSM (janela fechada)
      const dbg = json.debug
        ? `\n\n[debug] ultimaIn=${json.debug.ultimaIn ?? 'null'} janelaAberta=${json.debug.janelaAberta} totalMsgs=${json.debug.totalMsgs}`
        : ''
      if (json.modo === 'agendado') {
        window.alert(`📅 Agendado\n\n${json.info ?? 'Follow-up agendado pro próximo cron'}${dbg}`)
      } else if (json.modo === 'contextual') {
        window.alert(`💬 Texto livre enviado (janela 24h aberta)\n\n${json.mensagem ?? ''}${dbg}`)
      } else if (json.modo === 'hsm_retomada') {
        window.alert(`📨 Template HSM "Follow Up Aiva" enviado (janela 24h fechada)\n\n${json.mensagem ?? ''}${dbg}`)
      }
      await refreshDrawer()
    } catch (err) {
      window.alert(`Erro: ${err}`)
    } finally {
      setBusy(false)
    }
  }

  function openEditPanel() {
    if (!data) return
    // Tira o flag de pausa do textarea pra não confundir o usuário
    // (ele é re-aplicado no save pelo backend)
    const obsLimpa = (data.lead.observacoes ?? '').replace(/\s*\[PAUSA_ATE:[^\]]+\]/, '').trim()
    setEditNome(data.lead.nome ?? '')
    setEditCidade(data.lead.cidade ?? '')
    setEditObs(obsLimpa)
    setShowEdit(true)
    setShowReply(false)
  }

  async function saveEdit() {
    if (!leadId) return
    if (!editNome.trim()) {
      window.alert('Nome nao pode ficar vazio')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'update-lead',
          nome: editNome,
          cidade: editCidade,
          observacoes: editObs,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        // `detalhe` traz a explicação em português quando a rota tem uma
        // (ex.: card fora do funil AIVA no Evo) — sem isso o painel mostrava
        // só o código do erro, que não diz ao operador o que fazer.
        window.alert(json.detalhe ?? `Erro: ${json.error ?? 'desconhecido'}`)
        return
      }
      setShowEdit(false)
      await refreshDrawer()
    } catch (err) {
      window.alert(`Erro: ${err}`)
    } finally {
      setSaving(false)
    }
  }

  // Avalia uma resposta da VictorIA (joia / não joia). A avaliação vai pra
  // tabela sdr_curadoria e a mensagem aparece na página /curadoria, onde se
  // escreve a correção. Update otimista — não bloqueia a UI.
  async function avaliarMensagem(mensagemId: string, avaliacao: 'boa' | 'ruim') {
    if (!data) return
    setData({
      ...data,
      mensagens: data.mensagens.map((m) =>
        m.id === mensagemId ? { ...m, avaliacao } : m,
      ),
    })
    try {
      await fetch('/api/curadoria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagem_id: mensagemId, lead_id: leadId, avaliacao }),
      })
    } catch {
      // silencioso — o estado otimista permanece; um refresh corrige se falhou
    }
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>
      setLeadId(ce.detail)
    }
    window.addEventListener('open-lead', handler)
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLeadId(null)
    }
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('open-lead', handler)
      window.removeEventListener('keydown', esc)
    }
  }, [])

  useEffect(() => {
    if (!leadId) {
      setData(null)
      setShowReply(false)
      setReplyText('')
      setShowEdit(false)
      setEditNome('')
      setEditCidade('')
      setEditObs('')
      setShowInstrucao(false)
      setInstrucaoText('')
      return
    }
    setLoading(true)
    fetch(`/api/leads/${leadId}/detail`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          setData(null)
          return
        }
        setData(json)
        setInstrucaoText((json.lead?.instrucao_silvia as string | null) ?? '')
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [leadId])

  if (!leadId) return null

  return (
    <div
      onClick={() => setLeadId(null)}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 100,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(700px, 90vw)',
          height: '100%',
          background: 'var(--bg)',
          borderLeft: '1px solid var(--border)',
          color: 'var(--text)',
          fontFamily: 'inherit',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ─── Cabeçalho fixo ─── */}
        <div
          style={{
            flexShrink: 0,
            padding: '1.5rem',
            borderBottom: '1px solid var(--border)',
            overflowY: 'auto',
            maxHeight: '62%',
          }}
        >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              {data?.lead.nome ?? (loading ? 'Carregando…' : 'Lead')}
            </h2>
            {/* Identidade fixa (pedido do Aldo 02/09): telefone, status da
                conversa, etapa do funil no Evo e etiquetas — sempre visíveis. */}
            {data && (
              <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <span style={{ whiteSpace: 'nowrap' }}>📞 {data.lead.telefone}</span>
                <span style={{ color: STATUS_COLOR[data.lead.status] ?? 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>{data.lead.status}</span>
                {data.etapaEvo && (
                  <span style={{ color: 'var(--text)', whiteSpace: 'nowrap' }} title="Etapa do card no funil do Evo Talks">
                    🧭 {data.etapaEvo}
                    {data.etapaEvo === 'Cadastro recebido' && data.lead.status === 'INTERESSADO' && (
                      <span style={{ color: 'var(--text-muted)' }}> · Fase 3 em coleta</span>
                    )}
                  </span>
                )}
                {data.tagsEvo && data.tagsEvo.length > 0 && <TagChips tags={data.tagsEvo} size="sm" />}
              </div>
            )}
          </div>
          <button
            onClick={() => setLeadId(null)}
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-muted)',
              padding: '0.25rem 0.75rem',
              borderRadius: '8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            ✕ Fechar
          </button>
        </div>

        {loading && !data && <p style={{ color: 'var(--text-muted)' }}>Carregando dados…</p>}

        {data && (
          <>
            {/* Lojas do lojista FIXAS no cabeçalho (pedido do Aldo 02/09) —
                visíveis mesmo rolando o histórico. */}
            {(data.lojas?.length ?? 0) > 0 && (
              <div style={{ marginTop: '0.55rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', fontSize: '0.73rem' }}>
                {data.lojas!.map((lj) => (
                  <span
                    key={lj.cnpj}
                    title={`${lj.tipo === 'matriz' ? 'Matriz' : 'Filial/adicional'} — ${lj.status === 'ativa' ? 'ativa' : lj.status === 'pre_cadastro_enviado' ? 'pré-cadastro enviado' : 'informada'}${lj.rid ? ` · RID ${lj.rid} (conta no funil Contas Fechadas MRR)` : ''}`}
                    style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '2px 7px', background: 'var(--bg-elev)', color: 'var(--text-dim)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}
                  >
                    {lj.tipo === 'matriz' ? '🏢' : '➕'} {lj.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')}{' '}
                    {lj.status === 'ativa' ? <span style={{ color: '#34d399' }}>✅{lj.rid ? ` RID ${lj.rid}` : ''}</span> : lj.status === 'pre_cadastro_enviado' ? '📤' : '🆕'}
                  </span>
                ))}
                {(data.funcionarios?.length ?? 0) > 0 && (
                  <span
                    title={data.funcionarios!.map((f) => `${f.nome}${f.telefone ? ` · ${f.telefone}` : ''}`).join('\n')}
                    style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '2px 7px', background: 'var(--bg-elev)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}
                  >
                    👥 {data.funcionarios!.length} funcionário{data.funcionarios!.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <ActionBtn
                disabled={busy || replying}
                onClick={() => { setShowReply((v) => !v); setReplyText('') }}
                color="#4ade80"
              >
                {showReply ? '✕ Cancelar' : '↩ Responder'}
              </ActionBtn>
              <ActionBtn
                disabled={busy || replying}
                onClick={() => runAction({ type: 'reprocess' }, 'Reprocessar a ultima mensagem com a VictorIA?')}
                color="#60a5fa"
              >
                ↺ Reprocessar
              </ActionBtn>
              <ActionBtn
                disabled={busy || replying || saving}
                onClick={() => (showEdit ? setShowEdit(false) : openEditPanel())}
                color="#fbbf24"
              >
                {showEdit ? '✕ Cancelar' : '✎ Editar'}
              </ActionBtn>
              <ActionBtn
                disabled={busy || replying}
                onClick={() => { setShowInstrucao((v) => !v); setShowReply(false); setShowEdit(false) }}
                color="#c084fc"
              >
                {showInstrucao ? '✕ Cancelar' : `🧠 Instrução${instrucaoText ? ' ●' : ''}`}
              </ActionBtn>
              <ActionBtn
                disabled={busy || replying}
                onClick={() => runAction({ type: 'pause', hours: 24 }, 'Pausar esse lead por 24h?')}
                color="#a78bfa"
              >
                ⏸ Pausar 24h
              </ActionBtn>
              <ActionBtn
                disabled={busy || replying}
                onClick={() => runAction({ type: 'pause', hours: 72 }, 'Pausar esse lead por 3 dias?')}
                color="#a78bfa"
              >
                ⏸ Pausar 3d
              </ActionBtn>
              {data.lead.observacoes?.includes('[PAUSA_ATE:') && (
                <ActionBtn
                  disabled={busy || replying}
                  onClick={() => runAction({ type: 'unpause' })}
                  color="#4ade80"
                >
                  ▶ Despausar
                </ActionBtn>
              )}
              <ActionBtn
                disabled={busy || replying}
                onClick={runFollowupNow}
                color="#60a5fa"
              >
                ⏩ Follow-up agora
              </ActionBtn>
              <ActionBtn
                disabled={busy || replying || sendingInfo}
                onClick={() => { setShowInfo((v) => !v); setShowReply(false); setShowEdit(false); setShowInstrucao(false); setInfoText(''); setEditAtalhos(false); carregarAtalhos() }}
                color="#a78bfa"
              >
                ✉️ Enviar info
              </ActionBtn>
              {data.lead.webhook_lock_at && (
                <ActionBtn
                  disabled={busy || replying}
                  onClick={() => runAction({ type: 'unlock' })}
                  color="#f59e0b"
                >
                  Liberar lock
                </ActionBtn>
              )}
              {data.lead.acionar_humano && (
                <ActionBtn
                  disabled={busy || replying}
                  onClick={() => runAction({ type: 'mark-atendido' }, 'Marcar como atendido? O lead sai da fila de atendimento humano e volta para a automação da VictorIA.')}
                  color="#4ade80"
                >
                  ✓ Atendido
                </ActionBtn>
              )}
              {data.lead.status === 'DESCARTADO' ? (
                <ActionBtn
                  disabled={busy || replying}
                  onClick={() =>
                    runAction(
                      { type: 'reativar' },
                      'Reativar esse lead? Ele sai de DESCARTADO e volta para a etapa em que o card está no Evo.',
                    )
                  }
                  color="#4ade80"
                >
                  ↺ Reativar
                </ActionBtn>
              ) : (
                <ActionBtn
                  disabled={busy || replying}
                  onClick={() => runAction({ type: 'mark-descartado' }, 'Marcar esse lead como DESCARTADO?')}
                  color="#ef4444"
                >
                  ✖ Descartar
                </ActionBtn>
              )}
            </div>

            {/* Painel de resposta manual */}
            {showReply && (
              <div
                style={{
                  marginTop: '0.75rem',
                  display: 'flex',
                  gap: '0.5rem',
                  alignItems: 'flex-start',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  padding: '0.75rem',
                }}
              >
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendManualReply()
                  }}
                  placeholder="Digite a mensagem... (Ctrl+Enter para enviar)"
                  rows={3}
                  style={{
                    flex: 1,
                    background: 'var(--bg-elev)',
                    border: '1px solid #bbf7d0',
                    color: 'var(--text)',
                    padding: '0.5rem 0.7rem',
                    borderRadius: 6,
                    fontFamily: 'inherit',
                    fontSize: '0.85rem',
                    resize: 'vertical',
                  }}
                />
                <button
                  onClick={sendManualReply}
                  disabled={replying || !replyText.trim()}
                  style={{
                    background: replying ? 'var(--border-strong)' : 'var(--green)',
                    border: 'none',
                    color: '#fff',
                    padding: '0.5rem 0.9rem',
                    borderRadius: 6,
                    cursor: replying || !replyText.trim() ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    opacity: !replyText.trim() ? 0.5 : 1,
                  }}
                >
                  {replying ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            )}

            {/* Painel de "Enviar info pendente" — mensagem manual sem IA/contexto */}
            {showInfo && (
              <div
                style={{
                  marginTop: '0.75rem',
                  background: '#f5f3ff',
                  border: '1px solid #ddd6fe',
                  borderRadius: 8,
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div style={{ color: '#6d28d9', fontSize: '0.78rem', fontWeight: 700 }}>
                  Enviar informação pendente (mensagem manual — sem IA/contexto)
                </div>
                <div style={{ color: '#7c6f9c', fontSize: '0.72rem' }}>
                  Cliente frio? Vai por template (vira “Olá [nome], [sua mensagem]” e reabre a conversa). Janela aberta? Vai como texto livre.
                </div>
                {/* Atalhos de texto pronto — clique preenche o campo. Editáveis
                    pelo ⚙️ (tabela sdr_atalhos_info): ajustar texto, criar novo
                    (com link), excluir. */}
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {atalhos.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setInfoText(a.texto)}
                      title={a.texto}
                      style={{
                        background: infoText === a.texto ? '#ede9fe' : 'var(--bg-elev)',
                        border: '1px solid #c4b5fd',
                        color: '#6d28d9',
                        padding: '0.25rem 0.55rem',
                        borderRadius: 999,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                      }}
                    >
                      {a.rotulo}
                    </button>
                  ))}
                  <button
                    onClick={() => setEditAtalhos((v) => !v)}
                    title="Editar atalhos (textos prontos)"
                    style={{
                      background: editAtalhos ? '#ede9fe' : 'transparent',
                      border: '1px dashed #c4b5fd',
                      color: '#7c6f9c',
                      padding: '0.25rem 0.55rem',
                      borderRadius: 999,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.72rem',
                    }}
                  >
                    ⚙️ {editAtalhos ? 'fechar edição' : 'editar atalhos'}
                  </button>
                </div>

                {/* Editor de atalhos — o Nei ajusta os textos, cria novos e exclui */}
                {editAtalhos && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', border: '1px dashed #c4b5fd', borderRadius: 8, padding: '0.6rem' }}>
                    <div style={{ color: '#7c6f9c', fontSize: '0.7rem' }}>
                      Edite o nome/texto e clique 💾 pra gravar (vale pra todos os leads). Links podem ir direto no texto.
                    </div>
                    {atalhos.map((a, i) => (
                      <div key={a.id || `novo-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <input
                            value={a.rotulo}
                            onChange={(e) => setAtalhos((xs) => xs.map((x, j) => (j === i ? { ...x, rotulo: e.target.value } : x)))}
                            placeholder="Nome do atalho (ex.: 🔗 Link novo)"
                            style={{ flex: 1, background: 'var(--bg-elev)', border: '1px solid #ddd6fe', color: 'var(--text)', padding: '0.3rem 0.5rem', borderRadius: 6, fontFamily: 'inherit', fontSize: '0.76rem', fontWeight: 600 }}
                          />
                          <button
                            onClick={() => salvarAtalho(a)}
                            disabled={savingAtalho || !a.rotulo.trim() || !a.texto.trim()}
                            title="Gravar atalho"
                            style={{ background: '#8b5cf6', border: 'none', color: '#fff', padding: '0.3rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600, opacity: savingAtalho || !a.rotulo.trim() || !a.texto.trim() ? 0.5 : 1 }}
                          >
                            💾
                          </button>
                          <button
                            onClick={() => excluirAtalho(a.id)}
                            disabled={savingAtalho}
                            title="Excluir atalho"
                            style={{ background: 'transparent', border: '1px solid #fca5a5', color: '#dc2626', padding: '0.3rem 0.55rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.76rem' }}
                          >
                            🗑
                          </button>
                        </div>
                        <textarea
                          value={a.texto}
                          onChange={(e) => setAtalhos((xs) => xs.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))}
                          placeholder="Texto da mensagem (sem 'Olá fulano' — a saudação entra sozinha no envio frio)"
                          rows={2}
                          style={{ background: 'var(--bg-elev)', border: '1px solid #ddd6fe', color: 'var(--text)', padding: '0.35rem 0.5rem', borderRadius: 6, fontFamily: 'inherit', fontSize: '0.76rem', resize: 'vertical' }}
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => setAtalhos((xs) => [...xs, { id: '', rotulo: '', texto: '' }])}
                      disabled={savingAtalho}
                      style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px dashed #c4b5fd', color: '#6d28d9', padding: '0.3rem 0.7rem', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.76rem', fontWeight: 600 }}
                    >
                      ＋ Novo atalho
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <textarea
                    value={infoText}
                    onChange={(e) => setInfoText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendInfoPendente()
                    }}
                    placeholder="Ex.: ficou pendente o comprovante de endereço da loja — pode me enviar por aqui? (Ctrl+Enter envia)"
                    rows={3}
                    style={{
                      flex: 1,
                      background: 'var(--bg-elev)',
                      border: '1px solid #ddd6fe',
                      color: 'var(--text)',
                      padding: '0.5rem 0.7rem',
                      borderRadius: 6,
                      fontFamily: 'inherit',
                      fontSize: '0.85rem',
                      resize: 'vertical',
                    }}
                  />
                  <button
                    onClick={sendInfoPendente}
                    disabled={sendingInfo || (!infoText.trim() && infoAnexos.length === 0)}
                    style={{
                      background: sendingInfo ? 'var(--border-strong)' : '#8b5cf6',
                      border: 'none',
                      color: '#fff',
                      padding: '0.5rem 0.9rem',
                      borderRadius: 6,
                      cursor: sendingInfo || (!infoText.trim() && infoAnexos.length === 0) ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      opacity: !infoText.trim() && infoAnexos.length === 0 ? 0.5 : 1,
                    }}
                  >
                    {sendingInfo ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>

                {/* Anexar arquivo — só entregue com a janela 24h aberta */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      cursor: 'pointer',
                      color: '#6d28d9',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      border: '1px dashed #c4b5fd',
                      borderRadius: 6,
                      padding: '0.35rem 0.6rem',
                    }}
                  >
                    📎 Anexar arquivos
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const novos = Array.from(e.target.files ?? [])
                        // Acumula com os já escolhidos (sem duplicar nome+tamanho)
                        setInfoAnexos((atual) => {
                          const chaves = new Set(atual.map((f) => `${f.name}|${f.size}`))
                          return [...atual, ...novos.filter((f) => !chaves.has(`${f.name}|${f.size}`))]
                        })
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {infoAnexos.map((f, i) => (
                    <span key={`${f.name}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text)', background: 'var(--bg-elev)', border: '1px solid #ddd6fe', borderRadius: 999, padding: '0.2rem 0.55rem' }}>
                      {f.type.startsWith('image/') ? '🖼️' : '📄'} {f.name}
                      <span style={{ color: 'var(--text-muted)' }}>({(f.size / 1024).toFixed(0)} KB)</span>
                      <button
                        onClick={() => setInfoAnexos((xs) => xs.filter((_, j) => j !== i))}
                        style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}
                        title="Remover anexo"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', width: '100%' }}>
                    Anexos só são entregues com a conversa aberta (lojista respondeu nas últimas 24h). O texto vai de legenda no primeiro arquivo. Máx. 3 MB no total.
                  </span>
                </div>
              </div>
            )}

            {/* Painel de edição do lead */}
            {showEdit && (
              <div
                style={{
                  marginTop: '0.75rem',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: 8,
                  padding: '0.9rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                }}
              >
                <div style={{ color: '#b45309', fontSize: '0.78rem', fontWeight: 700 }}>
                  Editar dados do lead
                </div>
                <EditField
                  label="Nome"
                  value={editNome}
                  onChange={setEditNome}
                  placeholder="Nome da loja ou contato"
                />
                <EditField
                  label="Cidade"
                  value={editCidade}
                  onChange={setEditCidade}
                  placeholder="Curitiba/PR"
                />
                <EditField
                  label="Observações"
                  value={editObs}
                  onChange={setEditObs}
                  placeholder="Notas internas (a flag de pausa, se houver, é preservada automaticamente)"
                  multiline
                />
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowEdit(false)}
                    disabled={saving}
                    style={{
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text-muted)',
                      padding: '0.45rem 0.9rem',
                      borderRadius: 6,
                      cursor: saving ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.82rem',
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={saving || !editNome.trim()}
                    style={{
                      background: saving ? 'var(--border-strong)' : '#d97706',
                      border: 'none',
                      color: '#fff',
                      padding: '0.45rem 1rem',
                      borderRadius: 6,
                      cursor: saving || !editNome.trim() ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      opacity: !editNome.trim() ? 0.5 : 1,
                    }}
                  >
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            )}
            {/* Painel de instrução para VictorIA */}
            {showInstrucao && (
              <div
                style={{
                  marginTop: '0.75rem',
                  background: '#160d20',
                  border: '1px solid #7e22ce',
                  borderRadius: 8,
                  padding: '0.75rem',
                }}
              >
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: '#c084fc' }}>
                  🧠 Instrução pontual para a VictorIA — injetada no prompt nas próximas respostas deste lead. Deixe vazio para remover.
                </p>
                <textarea
                  value={instrucaoText}
                  onChange={(e) => setInstrucaoText(e.target.value)}
                  placeholder='Ex: "Lead é dono de 3 lojas, foco em volume" ou "Já conhece a AIVA, pule o pitch básico"'
                  rows={3}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'var(--bg-elev)',
                    border: '1px solid #4a1272',
                    color: 'var(--text)',
                    padding: '0.5rem',
                    borderRadius: 6,
                    fontFamily: 'inherit',
                    fontSize: '0.85rem',
                    resize: 'vertical',
                  }}
                />
                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  {instrucaoText && (
                    <button
                      onClick={async () => {
                        setSavingInstrucao(true)
                        try {
                          await fetch(`/api/leads/${leadId}/action`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ type: 'update-instrucao', instrucao: '' }),
                          })
                          setInstrucaoText('')
                          await refreshDrawer()
                        } finally { setSavingInstrucao(false) }
                      }}
                      disabled={savingInstrucao}
                      style={{
                        background: 'transparent',
                        border: '1px solid #7e22ce',
                        color: '#c084fc',
                        padding: '0.4rem 0.8rem',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: '0.82rem',
                      }}
                    >
                      Limpar
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      setSavingInstrucao(true)
                      try {
                        const res = await fetch(`/api/leads/${leadId}/action`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ type: 'update-instrucao', instrucao: instrucaoText }),
                        })
                        const json = await res.json()
                        if (!res.ok) { window.alert(`Erro: ${json.error ?? 'desconhecido'}`); return }
                        setShowInstrucao(false)
                        await refreshDrawer()
                      } catch (err) {
                        window.alert(`Erro: ${err}`)
                      } finally { setSavingInstrucao(false) }
                    }}
                    disabled={savingInstrucao}
                    style={{
                      background: '#4a1272',
                      border: '1px solid #c084fc',
                      color: '#c084fc',
                      padding: '0.4rem 0.9rem',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      opacity: savingInstrucao ? 0.5 : 1,
                    }}
                  >
                    {savingInstrucao ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        </div>

        {/* ─── Conversa (rolável) — dados do lead + histórico ─── */}
        {data && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
            {/* Telefone/Status/Etapa/Etiquetas subiram pro cabeçalho fixo (02/09) */}
            <div style={{ fontSize: '0.85rem', lineHeight: 1.7, marginBottom: '0.5rem' }}>
              <Row label="Cidade" value={data.lead.cidade ?? '—'} />
              <Row label="Cadência" value={`D+${data.lead.etapa_cadencia}`} />
              <Row
                label="Último contato"
                value={
                  data.lead.data_ultimo_contato
                    ? new Date(data.lead.data_ultimo_contato).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                    : '—'
                }
              />
              <Row
                label="Próximo follow-up"
                value={
                  data.lead.data_proximo_followup
                    ? new Date(data.lead.data_proximo_followup).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                    : '—'
                }
              />
              <Row
                label="Acionar humano"
                value={
                  data.lead.acionar_humano ? (
                    <span style={{ color: '#d97706', fontWeight: 600 }}>SIM</span>
                  ) : (
                    'não'
                  )
                }
              />
              <Row
                label="Oportunidade CRM"
                value={data.lead.evotalks_opportunity_id ?? '—'}
              />
            </div>

            {/* Funcionários conhecidos pela conversa (02/09) — as lojas ficam
                em chips FIXOS no cabeçalho, junto dos botões. */}
            {(data.funcionarios?.length ?? 0) > 0 && (
              <div style={{ marginBottom: '0.9rem', border: '1px solid var(--border)', borderRadius: 8, padding: '0.55rem 0.75rem', fontSize: '0.8rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-dim)', marginBottom: '0.3rem' }}>👥 Funcionários conhecidos ({data.funcionarios!.length})</div>
                {data.funcionarios!.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', padding: '0.15rem 0', color: 'var(--text)' }}>
                    <span>{f.nome}</span>
                    {f.telefone && <span style={{ color: 'var(--text-muted)' }}>📱 {f.telefone}</span>}
                    {f.cnpj_loja && <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>loja {f.cnpj_loja}</span>}
                  </div>
                ))}
              </div>
            )}

            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: 'var(--text-dim)' }}>
              Histórico de mensagens ({data.totalMensagens ?? data.mensagens.length})
              {data.totalMensagens != null && data.totalMensagens > data.mensagens.length && (
                <span style={{ fontSize: '0.78rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                  — exibindo as {data.mensagens.length} mais recentes
                </span>
              )}
            </h3>
            <div>
              {data.mensagens.length === 0 && (
                <p style={{ color: 'var(--text-muted)' }}>Sem mensagens ainda.</p>
              )}
              {data.mensagens.map((m) => {
                const mine = m.direcao === 'out'
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      justifyContent: mine ? 'flex-end' : 'flex-start',
                      margin: '0.5rem 0',
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '75%',
                        background: mine ? '#fff3e9' : 'var(--bg-elev)',
                        border: `1px solid ${mine ? '#fdba74' : 'var(--border)'}`,
                        color: 'var(--text)',
                        padding: '0.6rem 0.9rem',
                        borderRadius: '0.75rem',
                        fontSize: '0.85rem',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {m.template_hsm && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: '0.25rem' }}>
                          📢 HSM: {m.template_hsm}
                        </div>
                      )}
                      <MensagemConteudo conteudo={m.conteudo} />
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: '0.3rem',
                          gap: '0.5rem',
                        }}
                      >
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                          {new Date(m.enviado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                        </span>
                        {/* Avaliação joia/não joia — só nas respostas de texto
                            livre da VictorIA (não em templates HSM) */}
                        {mine && !m.template_hsm && (
                          <span style={{ display: 'flex', gap: '0.25rem' }}>
                            <button
                              onClick={() => avaliarMensagem(m.id, 'boa')}
                              title="Resposta boa"
                              style={{
                                border: `1px solid ${m.avaliacao === 'boa' ? 'var(--green)' : 'var(--border)'}`,
                                background: m.avaliacao === 'boa' ? 'var(--green)' : 'var(--bg-elev)',
                                borderRadius: 6,
                                cursor: 'pointer',
                                fontSize: '0.78rem',
                                lineHeight: 1,
                                padding: '0.15rem 0.35rem',
                                filter: m.avaliacao === 'boa' ? 'none' : 'grayscale(0.6)',
                              }}
                            >
                              👍
                            </button>
                            <button
                              onClick={() => avaliarMensagem(m.id, 'ruim')}
                              title="Resposta ruim"
                              style={{
                                border: `1px solid ${m.avaliacao === 'ruim' ? 'var(--red)' : 'var(--border)'}`,
                                background: m.avaliacao === 'ruim' ? 'var(--red)' : 'var(--bg-elev)',
                                borderRadius: 6,
                                cursor: 'pointer',
                                fontSize: '0.78rem',
                                lineHeight: 1,
                                padding: '0.15rem 0.35rem',
                                filter: m.avaliacao === 'ruim' ? 'none' : 'grayscale(0.6)',
                              }}
                            >
                              👎
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {/* âncora do fim da conversa — alvo do auto-scroll de abertura */}
              <div ref={fimConversaRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ActionBtn({
  children,
  onClick,
  color,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  color: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'var(--bg-elev)',
        border: `1px solid ${color}`,
        color,
        padding: '0.35rem 0.7rem',
        borderRadius: '8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        fontSize: '0.8rem',
        fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0.35rem 0' }}>
      <span style={{ width: 160, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ flex: 1 }}>{value}</span>
    </div>
  )
}

function EditField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-elev)',
    border: '1px solid #fde68a',
    color: 'var(--text)',
    padding: '0.5rem 0.7rem',
    borderRadius: 6,
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    boxSizing: 'border-box',
    resize: multiline ? 'vertical' : undefined,
  }
  return (
    <div>
      <label
        style={{
          display: 'block',
          color: '#b45309',
          fontSize: '0.7rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: '0.25rem',
          fontWeight: 600,
        }}
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={inputStyle}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
        />
      )}
    </div>
  )
}
