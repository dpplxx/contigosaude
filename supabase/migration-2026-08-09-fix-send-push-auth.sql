-- Corrige send-push: a Edge Function aceitava { userId, titulo, corpo, url }
-- de QUALQUER chamador com a anon key (que é pública, vai pro navegador de
-- todo mundo) sem checar se quem está chamando tem qualquer relação com
-- esse userId. Mitigado hoje porque nenhuma RPC pública vaza user_id, mas é
-- um gap de autorização real — a function não tinha como saber se a chamada
-- veio do trigger do banco (confiável) ou de um script batendo direto nela.
--
-- Fix: hc_disparar_push manda um segredo compartilhado no header
-- x-internal-secret, que a Edge Function confere antes de fazer qualquer
-- coisa (ver supabase/functions/send-push/index.ts).
--
-- JÁ APLICADO em produção em 09/08/2026 (rodado direto no SQL Editor).
--
-- Nota: a primeira versão deste arquivo usava `alter database postgres set
-- app.push_internal_secret = ...` — o Supabase hospedado NEGA esse comando
-- pro role padrão (ERROR 42501: permission denied to set parameter). Por
-- isso o segredo mora numa tabela normal (public.config_interna) protegida
-- por RLS sem nenhuma policy — só funções security definer conseguem ler,
-- mesmo padrão já usado em tentativas_login e limite_acoes.
--
-- PASSO A PASSO PRA APLICAR (nessa ordem — pular a ordem derruba push por
-- um tempo):
--   1. Gere um valor aleatório (ex: um UUID) pra usar como segredo.
--   2. Configure esse valor como secret da Edge Function:
--        supabase secrets set PUSH_INTERNAL_SECRET=<valor-que-voce-gerou>
--      (ou pelo Dashboard → Edge Functions → send-push → Secrets)
--   3. Rode este arquivo no SQL Editor, substituindo
--      'COLE_AQUI_O_MESMO_VALOR_DO_PASSO_1' pelo MESMO valor do passo 1.
--   4. Reimplante a function: supabase functions deploy send-push
--
-- Se pular o passo 2 ou 4, os pushes vão parar de chegar até você terminar
-- (a function passa a rejeitar toda chamada sem o segredo certo — de
-- propósito: falhar fechado é mais seguro que continuar aceitando qualquer
-- chamador).

create table if not exists public.config_interna (
  chave text primary key,
  valor text not null
);

alter table public.config_interna enable row level security;
-- Sem policy nenhuma pra anon/authenticated: só hc_disparar_push (security
-- definer) lê essa tabela.

insert into public.config_interna (chave, valor)
values ('push_internal_secret', 'COLE_AQUI_O_MESMO_VALOR_DO_PASSO_1')
on conflict (chave) do update set valor = excluded.valor;

create or replace function public.hc_disparar_push(
  p_user_id uuid,
  p_titulo text,
  p_corpo text default '',
  p_url text default '/app.html'
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_secret text;
begin
  if p_user_id is null then
    return;
  end if;

  select valor into v_secret from public.config_interna where chave = 'push_internal_secret';

  perform net.http_post(
    url := 'https://zjeyzqxphzzbitgrkoac.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_D5UJYqzJGBI1jU5-NjtwhQ_DqU-qOE2',
      'x-internal-secret', v_secret
    ),
    body := jsonb_build_object(
      'userId', p_user_id,
      'titulo', p_titulo,
      'corpo', p_corpo,
      'url', p_url
    )
  );
end;
$$;
