-- ============================================================================
-- Stub de CI — NUNCA rodar em produção.
--
-- schema-atual.sql assume um projeto Supabase de verdade (schemas auth. e
-- storage., papéis anon/authenticated, auth.uid()). Este arquivo recria só o
-- suficiente disso num Postgres vanilla (o container de teste do GitHub
-- Actions) pra schema-atual.sql e as migrations aplicarem sem erro e as
-- funções hc_* rodarem de verdade contra tabelas reais — em vez de mockar o
-- Supabase em JS, que só testaria se o frontend chama o nome certo, não se a
-- regra de negócio no banco está correta.
-- ============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Mesma lógica do auth.uid() real do Supabase: lê o sub do JWT da sessão.
-- Nos testes, simulamos "logar como X" com SET request.jwt.claim.sub.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Versão simplificada do auth.jwt() real (que lê request.jwt.claims cheio).
-- Aqui só embrulha o mesmo sub simulado acima — nenhum teste ainda precisa
-- de outras claims (como "email" ou "aal"), então elas saem null, e as
-- checagens que dependem delas (hc_aal_suficiente, hc_limpar_tentativas_login)
-- se comportam como "sem MFA ativo" / "sem sessão", que é o padrão seguro.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true));
$$;

-- hc_aal_suficiente() (migration-2026-08-08-mfa.sql) consulta esta tabela
-- pra saber se a conta tem MFA verificado. Nos testes ninguém ativa MFA, só
-- precisa existir vazia pra não quebrar o "select 1 from auth.mfa_factors".
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id),
  status text
);

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid
);

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
