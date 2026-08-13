/**
 * Chips das etiquetas da oportunidade no Evo Talks, replicadas no painel AIVA
 * (pedido do Aldo 2026-08-05). Nome e cores vêm do próprio Evo (getTagCatalog),
 * então renomear ou trocar a cor de uma etiqueta por lá reflete aqui sozinho.
 *
 * O fundo usa a cor do Evo com transparência (sufixo de alpha no hex) pra não
 * brigar com o tema escuro do painel — o texto e a borda ficam na cor cheia.
 */
export interface TagChip {
  id: number
  name: string
  bgcolor: string
  fgcolor: string
}

export default function TagChips({
  tags,
  max,
  size = 'sm',
}: {
  tags: TagChip[]
  /** Limita quantos chips aparecem; o excedente vira "+N". */
  max?: number
  size?: 'sm' | 'md'
}) {
  if (!tags || tags.length === 0) return null

  const visiveis = max ? tags.slice(0, max) : tags
  const resto = max ? tags.length - visiveis.length : 0
  const fonte = size === 'md' ? '0.72rem' : '0.68rem'
  const padding = size === 'md' ? '2px 7px' : '1px 5px'

  return (
    <>
      {visiveis.map((t) => (
        <span
          key={t.id}
          title={`Etiqueta do Evo: ${t.name}`}
          style={{
            fontSize: fonte,
            fontWeight: 700,
            background: `${t.bgcolor}22`,
            color: t.bgcolor,
            border: `1px solid ${t.bgcolor}55`,
            borderRadius: 4,
            padding,
            whiteSpace: 'nowrap',
            lineHeight: 1.4,
          }}
        >
          {t.name}
        </span>
      ))}
      {resto > 0 && (
        <span
          title={tags.map((t) => t.name).join(', ')}
          style={{
            fontSize: fonte,
            fontWeight: 700,
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding,
            whiteSpace: 'nowrap',
            lineHeight: 1.4,
          }}
        >
          +{resto}
        </span>
      )}
    </>
  )
}
