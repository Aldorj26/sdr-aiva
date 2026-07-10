# VictorIA Analista — widget de chat interno do painel AIVA

**Data:** 2026-07-10 · **Aprovado por:** Aldo

## Objetivo

Aldo e Nei perguntam à VictorIA, dentro do próprio painel, qualquer coisa sobre a
operação AIVA: contagens por etapa ("quantos leads em CADASTRO_RECEBIDO?"),
o que aconteceu numa conversa específica com um lead, leads parados, métricas
de disparo etc. **Somente consulta** — nenhuma ação sobre o funil nesta fase.

## Formato (decisão do Aldo)

Não é página separada: é um **widget flutuante** no painel.

- Botão flutuante (avatar VictorIA) no canto inferior direito, presente em todas
  as telas protegidas do painel (Pipeline, Clientes, Funil, Campanhas, Métricas, Curadoria).
- Clique → abre um **slide-over de chat** por cima da tela atual (sem navegação).
- Conversa sobrevive à navegação entre telas (estado no layout); zera ao recarregar.
- **Não** aparece em `/login` nem em `/chat` (simulador de lead, público).

## Arquitetura

### Frontend
- `app/_components/AssistenteWidget.tsx` (client component) montado no
  `app/layout.tsx`, escondido por pathname em `/login` e `/chat`.
- Visual seguindo o padrão do painel (dark, bolhas estilo `/chat`).
- Indicador de "digitando" enquanto a API responde.

### Backend — `POST /api/assistente`
- Protegido pelo middleware (adicionar `/api/assistente` ao matcher).
- Loop de tool-use com Claude API (mesmo cliente de `lib/claude.ts`), máx. ~8 iterações.
- System prompt novo (`prompts/assistente.ts`): persona analista (não vendedora),
  schema de `sdr_leads`/`sdr_mensagens`/`sdr_metricas`, significado dos status,
  contexto da operação. Responde em PT-BR citando números exatos; não inventa dado.

### Ferramentas
1. `contar_leads` — contagem por status, com filtro opcional de período.
2. `buscar_lead` — por telefone (parcial) ou nome (`ilike`); retorna dados + status.
3. `historico_conversa` — últimas N mensagens de um lead (a VictorIA resume).
4. `consulta_sql` — SQL livre **somente leitura**: executa via RPC Postgres
   (`assistente_sql`) que roda em transação `READ ONLY` — mutação é impossível
   mesmo com SQL malicioso/errado. Validação adicional na aplicação (só SELECT/WITH).

### Guarda-corpos
- Resultados limitados (~50 linhas por consulta; truncar payloads grandes).
- Erro de SQL volta pro modelo reformular (dentro do limite de iterações).
- `max_tokens` limitado na resposta final.

## Fora de escopo (fase 2)
- Ações (mudar status, reengajar, enviar mensagem a lead)
- Histórico persistente entre sessões
- Acesso via WhatsApp
