-- Bloqueio de força bruta no login: 5 tentativas de senha errada pro mesmo
-- email bloqueiam novas tentativas por 15 minutos.
-- Cole isto no SQL Editor do Supabase e rode uma vez.
--
-- Por que via RPC e não um recurso pronto do Supabase: o rate limit nativo
-- do Supabase Auth é por IP/tempo geral da API, não por conta — não cobre
-- "5 erros nesse email específico". A checagem roda ANTES da tentativa de
-- login (por isso os RPCs abaixo aceitam chamada de anon: quem está
-- tentando entrar ainda não tem sessão).
--
-- Trade-off conhecido desse tipo de proteção: alguém mal-intencionado pode
-- travar a conta de outra pessoa de propósito, errando a senha dela 5
-- vezes. Mesmo assim, contra tentativa de adivinhar senha por força bruta
-- (o problema que isso resolve), vale mais que não ter nada.

create table if not exists public.tentativas_login (
  email text primary key,
  tentativas int not null default 0,
  bloqueado_ate timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table public.tentativas_login enable row level security;
-- Sem policy nenhuma pra anon/authenticated: só as funções abaixo (security
-- definer) tocam essa tabela.

create or replace function public.hc_checar_bloqueio_login(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_bloqueado_ate timestamptz;
begin
  select bloqueado_ate into v_bloqueado_ate
  from public.tentativas_login
  where email = v_email;

  if v_bloqueado_ate is not null and v_bloqueado_ate > now() then
    return jsonb_build_object(
      'bloqueado', true,
      'minutos_restantes', greatest(1, ceil(extract(epoch from (v_bloqueado_ate - now())) / 60))
    );
  end if;

  return jsonb_build_object('bloqueado', false);
end $$;

create or replace function public.hc_registrar_falha_login(p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_existente record;
  v_novas_tentativas int;
begin
  select * into v_existente from public.tentativas_login where email = v_email for update;

  if v_existente is null then
    v_novas_tentativas := 1;
    insert into public.tentativas_login (email, tentativas, atualizado_em)
    values (v_email, v_novas_tentativas, now());
  else
    -- Se o bloqueio anterior já expirou, a contagem recomeça do zero em vez
    -- de bloquear de novo na primeira tentativa.
    if v_existente.bloqueado_ate is not null and v_existente.bloqueado_ate < now() then
      v_novas_tentativas := 1;
    else
      v_novas_tentativas := v_existente.tentativas + 1;
    end if;

    update public.tentativas_login
    set tentativas = v_novas_tentativas,
        bloqueado_ate = case
          when v_novas_tentativas >= 5 then now() + interval '15 minutes'
          else v_existente.bloqueado_ate
        end,
        atualizado_em = now()
    where email = v_email;
  end if;
end $$;

create or replace function public.hc_limpar_tentativas_login(p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.tentativas_login where email = lower(trim(p_email));
end $$;

revoke all on function public.hc_checar_bloqueio_login(text) from public;
revoke all on function public.hc_registrar_falha_login(text) from public;
revoke all on function public.hc_limpar_tentativas_login(text) from public;

grant execute on function public.hc_checar_bloqueio_login(text) to anon, authenticated;
grant execute on function public.hc_registrar_falha_login(text) to anon, authenticated;
grant execute on function public.hc_limpar_tentativas_login(text) to anon, authenticated;
