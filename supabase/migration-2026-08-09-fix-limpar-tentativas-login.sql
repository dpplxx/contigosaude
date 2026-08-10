-- Corrige hc_limpar_tentativas_login (migration-2026-08-07-bloqueio-login.sql):
-- estava concedida pra `anon` e aceitava qualquer email como parâmetro —
-- qualquer visitante sem sessão nenhuma podia zerar o contador de tentativas
-- de QUALQUER conta só chamando a RPC direto, tornando o bloqueio de força
-- bruta inofensivo (o atacante zera o próprio bloqueio a cada 5 tentativas).
--
-- A função só é chamada em src/lib/api.js → entrar(), DEPOIS de um
-- signInWithPassword bem-sucedido — o chamador sempre tem sessão própria
-- nesse ponto. Não precisa mais receber o email por parâmetro: usa o da
-- própria sessão (auth.jwt()), então só consegue zerar a própria conta.
--
-- Cole este arquivo no SQL Editor do Supabase e rode uma vez.

drop function if exists public.hc_limpar_tentativas_login(text);

create or replace function public.hc_limpar_tentativas_login()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.tentativas_login
  where email = lower(trim((select auth.jwt() ->> 'email')));
end $$;

revoke all on function public.hc_limpar_tentativas_login() from public, anon;
grant execute on function public.hc_limpar_tentativas_login() to authenticated;
