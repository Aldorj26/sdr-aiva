-- Disparo diário automático da AIVA (revisão final 11/10/2026, achado I-3):
-- liga a RLS em sdr_fila_disparo, que estava DESLIGADA.
--
-- Por quê: a chave anon do Supabase é pública (vai no bundle do navegador). Com a RLS
-- desligada ela lia os ~29 mil telefones da fila, marcava linhas como DISPARADO (tirando
-- a loja do disparo) e, pior, fazia INSERT de números que o cron — que roda sem ninguém
-- olhando — mandaria template WhatsApp.
--
-- Sem policy de propósito: todo leitor/escritor real (lib/disparo-diario.ts,
-- scripts/disparar-fila.mjs) usa supabaseAdmin / service_role, que ignora RLS.
-- A anon fica negada em leitura e escrita.

alter table sdr_fila_disparo enable row level security;
