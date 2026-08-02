-- ============================================================================
-- Migração: infraestrutura de Web Push (parte que dá pra rodar sem CLI)
--
-- Guarda a inscrição de push do navegador (endpoint + chaves públicas de
-- criptografia) de cada conta logada, pra um Edge Function futuro poder
-- mandar notificação de verdade em segundo plano — diferente da
-- Notification API sozinha, que só dispara com a aba aberta.
--
-- Esta migração NÃO manda nenhum push — só guarda/apaga inscrição. O envio
-- de verdade depende de um Edge Function (supabase/functions/send-push/,
-- já escrito no repo) que precisa ser implantado via Supabase CLI/Dashboard
-- com a chave privada VAPID como secret — isso exige acesso que só você
-- tem, não dá pra fazer só com SQL Editor.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
-- Nenhuma policy pro navegador: só as duas RPCs abaixo (e o painel admin,
-- via hc_e_admin) leem/escrevem aqui.
revoke all on public.push_subscriptions from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'push_subscriptions'
      and policyname = 'painel_total'
  ) then
    create policy painel_total on public.push_subscriptions for all
      to authenticated
      using (public.hc_e_admin())
      with check (public.hc_e_admin());
  end if;
end $$;

-- Salva (ou atualiza, se o navegador já tinha uma inscrição com o mesmo
-- endpoint) a inscrição de push da conta logada.
create or replace function public.hc_salvar_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Você precisa estar logado.';
  end if;

  insert into push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth;
end $$;

revoke all on function public.hc_salvar_push_subscription(text, text, text) from public, anon;
grant execute on function public.hc_salvar_push_subscription(text, text, text) to authenticated;

-- Remove a inscrição (usuário desativou notificação, ou o navegador achou
-- a assinatura inválida). Só apaga a própria — nunca a de outra conta.
create or replace function public.hc_remover_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke all on function public.hc_remover_push_subscription(text) from public, anon;
grant execute on function public.hc_remover_push_subscription(text) to authenticated;
