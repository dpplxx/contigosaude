-- ============================================================================
-- Migração: deixar o app reconhecer que a conta logada já é de fisio
--
-- Continuação direta da correção anterior (migration-bloquear-
-- autoavaliacao.sql): o backend já recusa uma conta-fisio criar pedido
-- como paciente, mas o frontend não sabia disso — a tela sempre abria (ou
-- voltava) na aba "Sou paciente" por padrão, então o próprio dono de um
-- cadastro de fisio caía do lado de paciente sem querer.
--
-- Esta função deixa o app perguntar "essa conta já é de fisio?" pra travar
-- direto na aba certa e nem mostrar a opção de virar paciente.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

create or replace function public.hc_sou_fisio()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from fisios where user_id = auth.uid());
$$;

revoke all on function public.hc_sou_fisio() from public, anon;
grant execute on function public.hc_sou_fisio() to authenticated;
