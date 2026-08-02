-- ============================================================================
-- Migração: correções da auditoria de segurança completa (2026-08-01)
--
-- O usuário pediu uma auditoria completa depois que fechamos o vazamento de
-- dados do paciente por WhatsApp (migration-paciente-auth.sql). Revisando
-- toda a superfície de RPCs e políticas RLS ao vivo em produção, apareceram
-- mais quatro problemas reais, dois deles críticos. Todos já foram aplicados
-- direto em produção via SQL Editor; este arquivo documenta e reproduz essas
-- mesmas correções.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CRÍTICO: hc_meus_pedidos_auth() — função esquecida de
-- migration-auth-paciente.sql, nunca usada pelo frontend (confirmado por
-- busca no código). Identificava o paciente lendo
-- auth.users.raw_user_meta_data->>'whatsapp' — um campo que QUALQUER
-- usuário autenticado pode escrever em si mesmo (via supabase.auth.
-- updateUser ou já no cadastro). Bastava uma conta qualquer definir esse
-- metadado como o WhatsApp de outra pessoa para ler os pedidos dela.
-- Estava liberada até pra "anon" (sem login nenhum). Solução: apagar —
-- hc_meus_pedidos() (auth.uid()-based) já resolve o mesmo caso de uso.
-- ----------------------------------------------------------------------------

drop function if exists public.hc_meus_pedidos_auth();

-- ----------------------------------------------------------------------------
-- 2. CRÍTICO: hc_anonimizar_paciente(uuid) — ferramenta de anonimização
-- LGPD, claramente pensada para uso administrativo (comentário original:
-- "FUNÇÃO PARA ANONIMIZAR DADOS (LGPD)"), mas nunca teve checagem de quem
-- podia chamar. Estava liberada pra "anon": qualquer visitante do site,
-- sem login nenhum, podia apagar/corromper o pedido de qualquer paciente
-- (nome, WhatsApp, observações) e cancelar o agendamento associado, só
-- sabendo o id do pedido. Confirmado ao vivo antes de corrigir. Solução:
-- mesma checagem hc_e_admin() que já protege o Painel.
-- ----------------------------------------------------------------------------

create or replace function public.hc_anonimizar_paciente(p_paciente_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  update public.pedidos
  set
    nome = 'Paciente Anônimo',
    whatsapp = null,
    observacoes = null,
    observacoes_encrypted = null,
    deletado_em = now()
  where id = p_paciente_id;

  update public.agendamentos
  set status = 'cancelado'
  where pedido_id = p_paciente_id;
end $$;

-- ----------------------------------------------------------------------------
-- 3. MÉDIO: hc_limpar_auditoria() — apaga registros de auditoria com mais
-- de 90 dias. Também sem checagem de quem chama, também liberada pra
-- "anon". Não afeta dados atuais, mas qualquer um podia disparar essa
-- limpeza à vontade. Mesma correção: só admin.
-- ----------------------------------------------------------------------------

create or replace function public.hc_limpar_auditoria()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  delete from auditoria
  where criada_em < now() - interval '90 days';
end $$;

-- ----------------------------------------------------------------------------
-- Postgres concede EXECUTE a PUBLIC por padrão toda vez que uma função é
-- recriada do zero (mesmo problema já documentado em
-- migration-paciente-auth.sql) — reforçando o revoke explícito de
-- "public, anon" nas duas funções acima.
-- ----------------------------------------------------------------------------

revoke all on function public.hc_anonimizar_paciente(uuid) from public, anon;
grant execute on function public.hc_anonimizar_paciente(uuid) to authenticated;

revoke all on function public.hc_limpar_auditoria() from public, anon;
grant execute on function public.hc_limpar_auditoria() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. BAIXO (mas nunca chegou a rodar): as políticas soft_delete_fisios e
-- soft_delete_pedidos já existiam no schema.sql (seção "SEGURANÇA:
-- AUDITORIA, SOFT DELETE, CRIPTOGRAFIA"), mas o arquivo nunca foi rodado
-- de novo por inteiro depois que essa seção foi escrita — então elas nunca
-- existiram em produção. Sem impacto real hoje (zero pedidos/fisios
-- soft-deletados no banco), mas sem elas o Painel administrativo mostraria
-- registros já anonimizados/apagados, o que quebra a intenção do soft
-- delete. Recriando aqui, idempotente.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fisios' and policyname = 'soft_delete_fisios'
  ) then
    create policy soft_delete_fisios on public.fisios for select
      to authenticated
      using (deletado_em is null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pedidos' and policyname = 'soft_delete_pedidos'
  ) then
    create policy soft_delete_pedidos on public.pedidos for select
      to authenticated
      using (deletado_em is null);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. BAIXO: hardening apontado pelo Security Advisor nativo do Supabase
-- (Database → Advisors → Security). Funções puras sem search_path fixo
-- (hc_chave, hc_distancia_km, hc_compativel) — baixo risco real, já que
-- não são security definer e só usam operadores/funções nativas, mas
-- custa zero fixar. E a função de trigger handle_new_auth_user (de
-- migration-auth-paciente.sql) tinha EXECUTE liberado pra public/anon/
-- authenticated por padrão, sem necessidade — funções de trigger não
-- precisam de grant explícito pra rodar via trigger, e essa não é chamada
-- por RPC em lugar nenhum do frontend.
-- ----------------------------------------------------------------------------

create or replace function public.hc_chave(p_whatsapp text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select right(regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g'), 8);
$$;

create or replace function public.hc_distancia_km(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null
      then null
    else 6371 * 2 * asin(
      least(1, sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2)
        + cos(radians(p_lat1)) * cos(radians(p_lat2))
          * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      ))
    )
  end;
$$;

create or replace function public.hc_compativel(
  p_especialidades text[],
  p_fisio_cidade text,
  p_fisio_bairros text[],
  p_fisio_lat double precision,
  p_fisio_lng double precision,
  p_raio_km integer,
  p_pedido_especialidade text,
  p_pedido_cidade text,
  p_pedido_bairro text,
  p_pedido_lat double precision,
  p_pedido_lng double precision
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    (
      p_pedido_especialidade = 'Não sei / preciso de orientação'
      or p_pedido_especialidade = any (p_especialidades)
    )
    and case
      when p_fisio_lat is not null and p_pedido_lat is not null then
        hc_distancia_km(p_fisio_lat, p_fisio_lng, p_pedido_lat, p_pedido_lng)
          <= coalesce(p_raio_km, 10)
      else
        (
          lower(p_fisio_cidade) like '%' || lower(p_pedido_cidade) || '%'
          or lower(p_pedido_cidade) like '%' || lower(p_fisio_cidade) || '%'
        )
        and (
          coalesce(array_length(p_fisio_bairros, 1), 0) = 0
          or exists (
            select 1
            from unnest(p_fisio_bairros) as b
            where lower(b) like '%' || lower(p_pedido_bairro) || '%'
               or lower(p_pedido_bairro) like '%' || lower(b) || '%'
          )
        )
    end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- NÃO CORRIGIDO NESTA MIGRAÇÃO (documentado para decisão futura):
--
-- - Tabela "pacientes" (de migration-auth-paciente.sql): RLS está correto
--   (cada um só vê a própria linha), mas a tabela não é lida por nenhum
--   código do frontend hoje — é preenchida por um trigger em todo signup
--   (paciente OU fisio, já que dividem o mesmo auth.users) só guardando
--   nome/email duplicados. Não é risco de segurança, é coleta de dado sem
--   uso — vale decidir se remove ou se vira parte de alguma feature futura.
--
-- - agendamentos.status ganhou default 'pendente' nessa mesma migração
--   esquecida, mas o frontend (STATUS_AGENDAMENTO em src/lib/utils.js) só
--   reconhece 'agendado'/'concluido'/'cancelado'. Agendamentos novos criados
--   pelo Painel nascem com um status que a tela de fisio não sabe exibir
--   direito até alguém trocar manualmente. Bug de comportamento, não de
--   segurança — precisa de uma decisão de produto (remover o default, ou
--   ensinar o frontend sobre 'pendente'/'recusado').
--
-- - Captcha desligado no Supabase Auth (Authentication → Attack
--   Protection). Rate limits do Supabase (30 signups/5min por IP) já dão
--   alguma proteção, mas captcha reduziria bots de verdade. Requer criar
--   conta num provedor (hCaptcha ou Turnstile) e mexer no formulário de
--   cadastro — feature nova, não incluída aqui.
-- ============================================================================
