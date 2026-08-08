-- ============================================================================
-- Fisio em Casa — schema-atual.sql
--
-- Este arquivo SUPERSEDE supabase/schema.sql + os 12 supabase/migration-*.sql
-- que foram aplicados em cima dele em produção, nesta ordem:
--
--   1.  schema.sql
--   2.  migration-auth-paciente.sql
--   3.  migration-confianca.sql
--   4.  migration-fisio-auth.sql
--   5.  migration-editar-cadastro-fisio.sql
--   6.  migration-foto-fisio.sql
--   7.  migration-paciente-auth.sql
--   8.  migration-auditoria-seguranca.sql
--   9.  migration-hardening-avancado.sql
--   10. migration-limpeza-pos-auditoria.sql
--   11. migration-fechar-atendimento.sql
--   12. migration-bloquear-autoavaliacao.sql
--   13. migration-detectar-conta-fisio.sql
--
-- Foi gerado dobrando (fold) esses 13 arquivos na ordem em que rodaram de
-- verdade em produção: pra cada objeto que aparece em mais de um arquivo, o
-- ÚLTIMO arquivo que mexeu nele venceu. Onde um arquivo mais recente
-- apagava algo (tabela "pacientes", a função handle_new_auth_user() e o
-- trigger on_auth_user_created — todos de migration-auth-paciente.sql,
-- removidos por migration-limpeza-pos-auditoria.sql), esse objeto
-- simplesmente não existe mais aqui.
--
-- Os 13 arquivos originais foram movidos pra supabase/archive/ — ficam só
-- como histórico, não rode mais eles.
--
-- Cole este arquivo inteiro no SQL Editor de um projeto Supabase NOVO e
-- clique em Run. Reproduz o estado atual do banco de produção de uma vez só.
--
-- DAQUI PRA FRENTE: qualquer mudança de schema nova vira um arquivo novo,
-- datado — supabase/migration-YYYY-MM-DD-descricao.sql — aplicado por cima
-- deste. NÃO edite este arquivo depois que uma migração nova já tiver
-- rodado em produção; ele deixaria de bater com o banco real. Quando o
-- número de migrações acumuladas ficar grande de novo, aí sim vale gerar um
-- novo schema-atual.sql consolidado, do mesmo jeito que este foi gerado.
--
-- IDEIA CENTRAL DA SEGURANÇA
-- Ninguém acessa as tabelas direto com a chave pública do site. O RLS está
-- ligado e sem nenhuma política para o papel anônimo nas tabelas sensíveis,
-- então uma tentativa de ler a tabela de pedidos pelo navegador volta
-- vazia. Todo acesso do público passa pelas funções hc_* abaixo, a maioria
-- delas hoje exigindo login (auth.uid()) em vez de confiar em WhatsApp
-- digitado — isso foi corrigido ao longo das migrações depois de dois
-- vazamentos de dado confirmados ao vivo em 2026-08-01.
--
-- Você (logada no Painel, com uma linha em public.admins) é o único papel
-- com leitura ampla.
--
-- COMO O MATCH FUNCIONA
-- Paciente e fisioterapeuta informam o CEP. O app converte em coordenadas e
-- guarda latitude e longitude. O fisioterapeuta diz até quantos quilômetros
-- aceita se deslocar. O match é: mesma especialidade + distância dentro do
-- raio. Se faltar coordenada de algum dos dois, cai no critério antigo de
-- cidade e bairro por texto.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- TABELAS
-- ============================================================================

create table if not exists public.fisios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  whatsapp text not null,
  -- Últimos 8 dígitos do telefone. Serve de chave de acesso legada e resolve
  -- o problema de a pessoa digitar com ou sem o 9, com ou sem DDI.
  whatsapp_chave text generated always as (
    right(regexp_replace(whatsapp, '[^0-9]', '', 'g'), 8)
  ) stored,
  especialidades text[] not null default '{}',
  cidade text not null,
  bairros text[] not null default '{}',
  disponibilidade text,
  formacao text,
  resumo text,
  valor_sessao numeric,
  contador_cliques integer not null default 0,
  criado_em timestamptz not null default now(),
  cep text,
  uf text,
  lat double precision,
  lng double precision,
  raio_km integer not null default 10,
  foto_url text,
  -- Soft delete: hc_listar_fisios e o Painel nunca mostram quem tem isto
  -- preenchido.
  deletado_em timestamptz,
  crefito text,
  crefito_uf text,
  -- Campos de criptografia (migration-limpeza pendente, ver seção "ADMIN"
  -- mais abaixo): nenhum código do app grava nem lê estes dois hoje.
  crefito_encrypted text,
  crefito_status text default 'pendente'
    check (crefito_status in ('pendente', 'verificado', 'rejeitado')),
  crefito_verificado_em timestamptz,
  email text,
  notificacoes_ativas boolean default true,
  -- Dona da conta (auth.users) que fez ou adotou este cadastro. Nulo só em
  -- cadastros muito antigos, de antes do login do fisio existir.
  user_id uuid references auth.users (id) on delete set null
);

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  whatsapp text not null,
  whatsapp_chave text generated always as (
    right(regexp_replace(whatsapp, '[^0-9]', '', 'g'), 8)
  ) stored,
  especialidade text not null,
  cidade text not null,
  bairro text not null,
  urgencia text not null,
  observacoes text,
  status text not null default 'ativo'
    check (status in ('ativo', 'arquivado')),
  criado_em timestamptz not null default now(),
  cep text,
  uf text,
  lat double precision,
  lng double precision,
  deletado_em timestamptz,
  observacoes_encrypted text,
  -- Dona da conta (auth.users) que criou o pedido. Pedidos sem conta (de
  -- antes do login do paciente existir) deixam de aparecer em "meus
  -- pedidos" — aceito de propósito em migration-paciente-auth.sql.
  user_id uuid references auth.users (id) on delete set null
);

create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  fisio_id uuid not null references public.fisios (id) on delete cascade,
  data date not null,
  horario time not null,
  -- 'pendente'/'recusado' foram testados em migration-auth-paciente.sql e
  -- revertidos em migration-limpeza-pos-auditoria.sql: o frontend nunca
  -- soube exibi-los. Fica só o conjunto original.
  status text not null default 'agendado'
    check (status in ('agendado', 'concluido', 'cancelado')),
  criado_em timestamptz not null default now()
);

create table if not exists public.avaliacoes (
  id uuid primary key default gen_random_uuid(),
  fisio_id uuid not null references public.fisios (id) on delete cascade,
  nota integer not null check (nota between 1 and 5),
  comentario text,
  criado_em timestamptz not null default now(),
  -- Vínculo com o atendimento avaliado. Nunca devolvido por
  -- hc_avaliacoes_fisio (a tabela continua anônima pro público) — serve só
  -- pra hc_avaliar impedir duas avaliações do mesmo atendimento.
  agendamento_id uuid references public.agendamentos (id) on delete cascade
);

create table if not exists public.mensagens (
  id uuid primary key default gen_random_uuid(),
  agendamento_id uuid not null references public.agendamentos (id) on delete cascade,
  remetente text not null check (remetente in ('paciente', 'fisio')),
  remetente_nome text not null,
  texto text not null,
  criado_em timestamptz not null default now()
);

-- Note: a tabela "pacientes" (criada em migration-auth-paciente.sql, junto
-- com a função handle_new_auth_user() e o trigger on_auth_user_created em
-- auth.users) foi removida por migration-limpeza-pos-auditoria.sql — nunca
-- foi lida por nenhuma tela e virou só coleta de dado duplicado sem uso.
-- Não existe mais e não é recriada aqui.

create index if not exists fisios_chave_idx on public.fisios (whatsapp_chave);
create index if not exists fisios_coord_idx on public.fisios (lat, lng);
-- Um cadastro por conta. Índice parcial: permite múltiplos user_id nulos
-- (cadastros antigos, de antes do login existir).
create unique index if not exists fisios_user_id_idx on public.fisios (user_id) where user_id is not null;

create index if not exists pedidos_chave_idx on public.pedidos (whatsapp_chave);
create index if not exists pedidos_status_idx on public.pedidos (status, criado_em desc);
create index if not exists pedidos_coord_idx on public.pedidos (lat, lng);
create index if not exists pedidos_user_id_idx on public.pedidos (user_id);

create index if not exists agendamentos_pedido_idx on public.agendamentos (pedido_id);
create index if not exists agendamentos_fisio_idx on public.agendamentos (fisio_id);
-- Um pedido só pode virar um agendamento. Sem isso, dois fisios poderiam
-- fechar o mesmo pedido ao mesmo tempo (condição de corrida) — o índice
-- único faz o segundo INSERT falhar no banco, não só na checagem da
-- aplicação. (migration-fechar-atendimento.sql)
create unique index if not exists agendamentos_pedido_unico on public.agendamentos (pedido_id);

create index if not exists avaliacoes_fisio_idx on public.avaliacoes (fisio_id);
-- Trava contra avaliação duplicada do mesmo atendimento (migration-hardening-avancado.sql).
create unique index if not exists avaliacoes_agendamento_unico on public.avaliacoes (agendamento_id) where agendamento_id is not null;

create index if not exists mensagens_agendamento_idx on public.mensagens (agendamento_id, criado_em);

-- ============================================================================
-- QUEM PODE ABRIR O PAINEL
--
-- Estar logada não basta. A conta precisa estar nesta tabela. Assim, mesmo
-- que alguém consiga criar uma conta no seu Supabase, continua sem
-- enxergar um único dado de paciente.
-- ============================================================================

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  criado_em timestamptz not null default now()
);

alter table public.admins enable row level security;
-- Nenhuma política: a tabela só é lida pela função hc_e_admin() abaixo,
-- nunca pelo navegador.

-- Definida aqui, logo depois de "admins" e antes de qualquer policy ou
-- seção que dependa dela (auditoria, RLS das tabelas principais) — mover
-- pra "HELPERS" mais abaixo quebra a ordem de criação: SQL processa o
-- arquivo de cima pra baixo, então uma policy não pode chamar uma função
-- que ainda não existe.
-- MFA (migration-2026-08-08-mfa.sql): implementa o padrão oficial do
-- Supabase pra "aplicação opcional" de aal2 — só exige o segundo fator de
-- quem já tem um fator verificado. Quem nunca ativou MFA (todo paciente,
-- hoje) continua liberado em aal1 sem nenhuma mudança.
create or replace function public.hc_aal_suficiente()
returns boolean
language sql
stable
as $$
  select case
    when exists (
      select 1 from auth.mfa_factors
      where user_id = auth.uid() and status = 'verified'
    )
    then (select auth.jwt() ->> 'aal') = 'aal2'
    else true
  end;
$$;

revoke all on function public.hc_aal_suficiente() from public, anon;
grant execute on function public.hc_aal_suficiente() to authenticated;

-- Mesma checagem de sempre (conta na tabela admins) + exige aal2 se a conta
-- tiver MFA ativado. Admin que ainda não passou pelo desafio nesta sessão é
-- tratado como "não admin" até verificar — falha fechada, não aberta.
create or replace function public.hc_e_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from admins where user_id = auth.uid())
     and public.hc_aal_suficiente();
$$;

grant execute on function public.hc_e_admin() to authenticated;

-- ============================================================================
-- AUDITORIA — log de quem fez o quê e quando
-- ============================================================================

create table if not exists public.auditoria (
  id uuid primary key default gen_random_uuid(),
  tabela text not null,
  operacao text not null,
  usuario_id uuid,
  linha_id uuid,
  dados_antigos jsonb,
  dados_novos jsonb,
  ip_address inet,
  user_agent text,
  criada_em timestamptz not null default now()
);

create index if not exists auditoria_tabela_idx on public.auditoria (tabela, criada_em desc);
create index if not exists auditoria_usuario_idx on public.auditoria (usuario_id, criada_em desc);
create index if not exists auditoria_linha_idx on public.auditoria (linha_id, criada_em desc);

alter table public.auditoria enable row level security;
revoke all on public.auditoria from anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'auditoria' and policyname = 'auditoria_admin_only'
  ) then
    create policy auditoria_admin_only on public.auditoria for all to authenticated
      using (public.hc_e_admin())
      with check (public.hc_e_admin());
  end if;
end $$;

-- ============================================================================
-- RLS DAS TABELAS PRINCIPAIS — tudo trancado, e depois liberado só para as
-- contas administradoras (+ soft delete escondido de todo mundo)
-- ============================================================================

alter table public.fisios enable row level security;
alter table public.pedidos enable row level security;
alter table public.agendamentos enable row level security;
alter table public.avaliacoes enable row level security;
alter table public.mensagens enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['fisios', 'pedidos', 'agendamentos', 'avaliacoes', 'mensagens']
  loop
    execute format('drop policy if exists painel_total on public.%I', t);
    execute format(
      'create policy painel_total on public.%I for all to authenticated '
      || 'using (public.hc_e_admin()) with check (public.hc_e_admin())',
      t
    );
  end loop;
end $$;

-- O papel anônimo não recebe nenhuma política de propósito: sem função, não
-- lê nem escreve nada.
revoke all on public.fisios, public.pedidos, public.agendamentos,
  public.avaliacoes, public.mensagens, public.admins from anon;

-- Nunca mostrar dados soft-deletados pro Painel. "to" vem antes de "using":
-- é a ordem exigida pelo Postgres em CREATE POLICY.
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

-- ============================================================================
-- STORAGE — foto de perfil do fisio (migration-foto-fisio.sql)
-- ============================================================================

-- Bucket público (as fotos aparecem pros pacientes na busca, sem login).
-- 2MB de limite e só tipos de imagem comuns.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fotos-fisios',
  'fotos-fisios',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

do $$
begin
  -- Qualquer um pode ver (bucket público, mas a policy de SELECT também
  -- precisa existir explicitamente pra funcionar por baixo do RLS do storage).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos_fisios_leitura_publica'
  ) then
    create policy fotos_fisios_leitura_publica on storage.objects for select
      to public
      using (bucket_id = 'fotos-fisios');
  end if;

  -- Cada fisio só escreve na própria pasta: fotos-fisios/{seu user_id}/...
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos_fisios_upload_proprio'
  ) then
    create policy fotos_fisios_upload_proprio on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'fotos-fisios'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos_fisios_atualizar_proprio'
  ) then
    create policy fotos_fisios_atualizar_proprio on storage.objects for update
      to authenticated
      using (
        bucket_id = 'fotos-fisios'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos_fisios_apagar_proprio'
  ) then
    create policy fotos_fisios_apagar_proprio on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'fotos-fisios'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;

-- ============================================================================
-- RATE LIMITING GENÉRICO (migration-2026-08-08-rate-limiting.sql)
--
-- Mesmo espírito do bloqueio de login (tentativas_login, mais abaixo): um
-- contador por (chave, ação) numa janela de tempo, que zera sozinho quando
-- a janela expira. hc_checar_limite não é exposta pro cliente — só outras
-- funções security definer chamam.
-- ============================================================================

create table if not exists public.limite_acoes (
  chave text not null,
  acao text not null,
  contador int not null default 0,
  janela_inicio timestamptz not null default now(),
  primary key (chave, acao)
);

alter table public.limite_acoes enable row level security;
-- Sem policy nenhuma pra anon/authenticated: só hc_checar_limite (security
-- definer) toca essa tabela.

create or replace function public.hc_checar_limite(
  p_chave text,
  p_acao text,
  p_max int,
  p_janela_minutos int
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro record;
begin
  select * into v_registro from limite_acoes
  where chave = p_chave and acao = p_acao
  for update;

  if v_registro is null then
    insert into limite_acoes (chave, acao, contador, janela_inicio)
    values (p_chave, p_acao, 1, now());
    return true;
  end if;

  if v_registro.janela_inicio < now() - (p_janela_minutos || ' minutes')::interval then
    update limite_acoes set contador = 1, janela_inicio = now()
    where chave = p_chave and acao = p_acao;
    return true;
  end if;

  if v_registro.contador >= p_max then
    return false;
  end if;

  update limite_acoes set contador = contador + 1
  where chave = p_chave and acao = p_acao;
  return true;
end $$;

revoke all on function public.hc_checar_limite(text, text, int, int) from public, anon, authenticated;

-- ============================================================================
-- LIMPEZA DE ASSINATURAS ANTIGAS (defensivo)
--
-- Nenhuma destas funções/assinaturas é criada por este arquivo — todas
-- foram substituídas por versões mais novas (assinatura diferente) ou
-- apagadas de vez ao longo das migrações. O Postgres não deixa trocar a
-- lista de parâmetros nem o tipo de retorno com "create or replace", então
-- as migrações originais sempre "dropavam" a versão antiga antes de criar a
-- nova. Reproduzido aqui só como cinto e suspensório, caso este arquivo
-- rode por cima de um banco restaurado de um snapshot antigo — em um
-- projeto novo e vazio, todos estes são no-ops.
-- ============================================================================

drop function if exists public.hc_compativel(text[], text, text[], text, text, text);
drop function if exists public.hc_criar_pedido(text, text, text, text, text, text, text);
drop function if exists public.hc_cadastrar_fisio(text, text, text[], text, text[], text, text, text, numeric);
drop function if exists public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer
);
drop function if exists public.hc_painel_fisio(text);
drop function if exists public.hc_marcar_status_agendamento(uuid, text, text);
drop function if exists public.hc_meus_pedidos(text);
drop function if exists public.hc_enviar_mensagem(uuid, text, text, text, text);
drop function if exists public.hc_avaliar(uuid, integer, text, text);
drop function if exists public.hc_meus_pedidos_auth();

-- ============================================================================
-- HELPERS
--
-- hc_e_admin() já foi definida lá em cima, logo depois da tabela "admins"
-- (é usada por policies que vêm antes desta seção no arquivo).
-- ============================================================================

-- Normaliza um telefone digitado de qualquer jeito para a mesma chave de 8
-- dígitos usada nas colunas geradas.
create or replace function public.hc_chave(p_whatsapp text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select right(regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g'), 8);
$$;

-- Distância em linha reta entre dois pontos, em quilômetros (fórmula de
-- haversine). Não precisa de PostGIS nem de nenhuma extensão paga.
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

-- Regra de compatibilidade. Preferimos distância real; quando falta
-- coordenada de um dos lados, caímos no casamento por cidade e bairro em
-- texto, que era o critério da primeira versão.
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

-- ============================================================================
-- ESCRITA PÚBLICA / AUTENTICADA — os dois formulários da home
-- ============================================================================

-- Cria um pedido. Exige login (migration-paciente-auth.sql) e bloqueia
-- contas que já têm cadastro de fisio (migration-bloquear-autoavaliacao.sql
-- — evita a fraude de logar como fisio, criar um pedido falso pra si mesmo
-- e se autoavaliar). Devolve o id do pedido e quantos fisioterapeutas já
-- atendem aquele endereço.
--
-- ÚLTIMA FONTE: migration-bloquear-autoavaliacao.sql (idêntica em
-- migration-detectar-conta-fisio.sql, que não voltou a tocar nesta função).
create or replace function public.hc_criar_pedido(
  p_nome text,
  p_whatsapp text,
  p_especialidade text,
  p_cidade text,
  p_bairro text,
  p_urgencia text,
  p_observacoes text default null,
  p_cep text default null,
  p_uf text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_proximos integer;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Você precisa estar logado para pedir atendimento.';
  end if;

  if exists (select 1 from fisios where user_id = v_uid) then
    raise exception 'Esta conta já tem um cadastro de fisioterapeuta. Use outra conta para pedir atendimento como paciente.';
  end if;

  if length(coalesce(trim(p_nome), '')) < 2 then
    raise exception 'Informe o nome de quem vai receber o atendimento.';
  end if;

  if length(hc_chave(p_whatsapp)) < 8 then
    raise exception 'WhatsApp inválido.';
  end if;

  if length(coalesce(trim(p_cidade), '')) < 2
     or length(coalesce(trim(p_bairro), '')) < 2 then
    raise exception 'Informe cidade e bairro.';
  end if;

  if (
    select count(*)
    from pedidos
    where user_id = v_uid
      and status = 'ativo'
  ) >= 5 then
    raise exception 'Você já tem pedidos abertos. Aguarde o contato da equipe.';
  end if;

  if not hc_checar_limite('pedido:' || v_uid::text, 'criar_pedido', 3, 10) then
    raise exception 'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.';
  end if;

  insert into pedidos (
    nome, whatsapp, especialidade, cidade, bairro, urgencia, observacoes,
    cep, uf, lat, lng, user_id
  )
  values (
    trim(p_nome), trim(p_whatsapp), p_especialidade,
    trim(p_cidade), trim(p_bairro), p_urgencia, nullif(trim(p_observacoes), ''),
    nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), ''),
    nullif(upper(trim(coalesce(p_uf, ''))), ''),
    p_lat, p_lng, v_uid
  )
  returning id into v_id;

  select count(*) into v_proximos
  from fisios f
  where hc_compativel(
    f.especialidades, f.cidade, f.bairros, f.lat, f.lng, f.raio_km,
    p_especialidade, trim(p_cidade), trim(p_bairro), p_lat, p_lng
  );

  return jsonb_build_object('id', v_id, 'fisios_proximos', v_proximos);
end $$;

revoke all on function public.hc_criar_pedido(
  text, text, text, text, text, text, text, text, text,
  double precision, double precision
) from public, anon;
grant execute on function public.hc_criar_pedido(
  text, text, text, text, text, text, text, text, text,
  double precision, double precision
) to authenticated;

-- Cadastra ou atualiza o cadastro do fisio. Exige login e vincula à conta
-- (migration-fisio-auth.sql): procura primeiro um cadastro já vinculado à
-- conta logada; se não achar, adota um cadastro órfão (sem user_id, de
-- antes do login existir) com o mesmo WhatsApp, preservando cadastros
-- antigos.
--
-- ÚLTIMA FONTE do corpo: migration-fisio-auth.sql. As permissões finais
-- (revoke/grant) foram reafirmadas depois por migration-paciente-auth.sql.
create or replace function public.hc_cadastrar_fisio(
  p_nome text,
  p_whatsapp text,
  p_especialidades text[],
  p_cidade text,
  p_formacao text,
  p_bairros text[] default '{}',
  p_resumo text default null,
  p_disponibilidade text default null,
  p_valor_sessao numeric default null,
  p_cep text default null,
  p_uf text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_raio_km integer default 10,
  p_crefito text default null,
  p_crefito_uf text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Você precisa estar logado para se cadastrar.';
  end if;

  if not hc_checar_limite('cadastro_fisio:' || v_uid::text, 'cadastrar_fisio', 10, 10) then
    raise exception 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.';
  end if;

  if length(coalesce(trim(p_nome), '')) < 2 then
    raise exception 'Informe seu nome.';
  end if;

  if length(hc_chave(p_whatsapp)) < 8 then
    raise exception 'WhatsApp inválido.';
  end if;

  if coalesce(array_length(p_especialidades, 1), 0) = 0 then
    raise exception 'Escolha ao menos uma especialidade.';
  end if;

  if length(coalesce(trim(p_cidade), '')) < 2 then
    raise exception 'Informe a cidade onde você atende.';
  end if;

  if p_raio_km is null or p_raio_km < 1 or p_raio_km > 100 then
    raise exception 'O raio de atendimento deve ficar entre 1 e 100 km.';
  end if;

  -- Cadastro já vinculado a esta conta tem prioridade.
  select id into v_id from fisios where user_id = v_uid limit 1;

  -- Sem isso, adota um cadastro órfão (de antes do login existir) com o
  -- mesmo WhatsApp.
  if v_id is null then
    select id into v_id from fisios
    where whatsapp_chave = hc_chave(p_whatsapp) and user_id is null
    limit 1;
  end if;

  if v_id is not null then
    update fisios set
      nome = trim(p_nome),
      whatsapp = trim(p_whatsapp),
      especialidades = p_especialidades,
      cidade = trim(p_cidade),
      bairros = coalesce(p_bairros, '{}'),
      formacao = nullif(trim(p_formacao), ''),
      resumo = nullif(trim(p_resumo), ''),
      disponibilidade = nullif(trim(p_disponibilidade), ''),
      valor_sessao = p_valor_sessao,
      cep = nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), ''),
      uf = nullif(upper(trim(coalesce(p_uf, ''))), ''),
      lat = p_lat,
      lng = p_lng,
      raio_km = p_raio_km,
      crefito = nullif(trim(p_crefito), ''),
      crefito_uf = nullif(upper(trim(coalesce(p_crefito_uf, ''))), ''),
      user_id = v_uid
    where id = v_id;
    return v_id;
  end if;

  insert into fisios (
    nome, whatsapp, especialidades, cidade, bairros,
    formacao, resumo, disponibilidade, valor_sessao,
    cep, uf, lat, lng, raio_km, crefito, crefito_uf, user_id
  )
  values (
    trim(p_nome), trim(p_whatsapp), p_especialidades, trim(p_cidade),
    coalesce(p_bairros, '{}'),
    nullif(trim(p_formacao), ''), nullif(trim(p_resumo), ''),
    nullif(trim(p_disponibilidade), ''), p_valor_sessao,
    nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), ''),
    nullif(upper(trim(coalesce(p_uf, ''))), ''),
    p_lat, p_lng, p_raio_km,
    nullif(trim(p_crefito), ''), nullif(upper(trim(coalesce(p_crefito_uf, ''))), ''),
    v_uid
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text
) from public, anon;
grant execute on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text
) to authenticated;

-- Salva a URL pública da foto no cadastro do fisio logado. Separado de
-- hc_cadastrar_fisio de propósito: o upload acontece na hora que a pessoa
-- escolhe o arquivo. (migration-foto-fisio.sql; grants reafirmados por
-- migration-paciente-auth.sql)
create or replace function public.hc_atualizar_foto_fisio(p_foto_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update fisios
  set foto_url = nullif(trim(p_foto_url), '')
  where user_id = auth.uid();

  if not found then
    raise exception 'Nenhum cadastro encontrado para esta conta. Cadastre-se primeiro.';
  end if;
end $$;

revoke all on function public.hc_atualizar_foto_fisio(text) from public, anon;
grant execute on function public.hc_atualizar_foto_fisio(text) to authenticated;

-- Contador de quantas vezes o botão de WhatsApp daquele profissional foi
-- usado. Continua público de propósito (não exige login). (schema.sql)
create or replace function public.hc_registrar_clique(p_fisio_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update fisios set contador_cliques = contador_cliques + 1 where id = p_fisio_id;
end $$;

revoke all on function public.hc_registrar_clique(uuid) from public;
grant execute on function public.hc_registrar_clique(uuid) to anon, authenticated;

-- ============================================================================
-- BUSCA E LEITURA PÚBLICA (não exigem login — "modelo Uber": busca aberta,
-- contato só depois)
-- ============================================================================

-- ÚLTIMA FONTE: migration-confianca.sql (traz CREFITO e nota média).
create or replace function public.hc_listar_fisios(
  p_especialidade text,
  p_cidade text,
  p_bairro text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'nome', f.nome,
        'foto_url', f.foto_url,
        'especialidades', f.especialidades,
        'formacao', f.formacao,
        'bairro', (f.bairros[1]),
        'whatsapp', f.whatsapp,
        'crefito', f.crefito,
        'crefito_uf', f.crefito_uf,
        'nota_media', (
          select round(avg(a.nota)::numeric, 1) from avaliacoes a where a.fisio_id = f.id
        ),
        'total_avaliacoes', (
          select count(*) from avaliacoes a where a.fisio_id = f.id
        ),
        'distancia_km',
          case
            when p_lat is not null and f.lat is not null
            then hc_distancia_km(f.lat, f.lng, p_lat, p_lng)
            else null
          end
      )
      order by
        case
          when p_lat is not null and f.lat is not null
          then hc_distancia_km(f.lat, f.lng, p_lat, p_lng)
          else 999
        end,
        f.nome
    ),
    '[]'::jsonb
  )
  from fisios f
  where hc_compativel(
    f.especialidades, f.cidade, f.bairros, f.lat, f.lng, f.raio_km,
    p_especialidade, p_cidade, p_bairro, p_lat, p_lng
  )
  and f.deletado_em is null;
$$;

grant execute on function public.hc_listar_fisios(
  text, text, text, double precision, double precision
) to anon, authenticated;

-- Contador público de fisios cadastrados — prova social real na landing.
-- (migration-confianca.sql)
create or replace function public.hc_contar_fisios()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer from fisios where deletado_em is null;
$$;

grant execute on function public.hc_contar_fisios() to anon, authenticated;

-- Avaliações públicas de um fisio — a tabela avaliacoes já não guarda nome
-- nem contato do paciente. (migration-confianca.sql)
create or replace function public.hc_avaliacoes_fisio(p_fisio_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'nota', a.nota,
        'comentario', a.comentario,
        'criado_em', a.criado_em
      )
      order by a.criado_em desc
    ),
    '[]'::jsonb
  )
  from (
    select nota, comentario, criado_em
    from avaliacoes
    where fisio_id = p_fisio_id
    order by criado_em desc
    limit 10
  ) a;
$$;

grant execute on function public.hc_avaliacoes_fisio(uuid) to anon, authenticated;

-- ============================================================================
-- LEITURA E AÇÕES DO PACIENTE — só a própria conta logada
-- ============================================================================

-- ÚLTIMA FONTE: migration-paciente-auth.sql. Trocou de
-- "hc_meus_pedidos(whatsapp)" pra "hc_meus_pedidos()" sem parâmetro:
-- identidade só pela conta logada.
create or replace function public.hc_meus_pedidos()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'nome', p.nome,
        'especialidade', p.especialidade,
        'cidade', p.cidade,
        'bairro', p.bairro,
        'urgencia', p.urgencia,
        'observacoes', p.observacoes,
        'status', p.status,
        'criado_em', p.criado_em,
        'agendamento', (
          select jsonb_build_object(
            'id', a.id,
            'data', a.data,
            'horario', a.horario,
            'status', a.status,
            'fisio', jsonb_build_object(
              'id', f.id,
              'nome', f.nome,
              'whatsapp', f.whatsapp,
              'cidade', f.cidade,
              'especialidades', f.especialidades,
              'formacao', f.formacao,
              'distancia_km', round(
                hc_distancia_km(f.lat, f.lng, p.lat, p.lng)::numeric, 1
              )
            ),
            'mensagens', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', m.id,
                    'remetente', m.remetente,
                    'remetente_nome', m.remetente_nome,
                    'texto', m.texto,
                    'criado_em', m.criado_em
                  ) order by m.criado_em
                ),
                '[]'::jsonb
              )
              from mensagens m
              where m.agendamento_id = a.id
            )
          )
          from agendamentos a
          join fisios f on f.id = a.fisio_id
          where a.pedido_id = p.id
          order by a.criado_em desc
          limit 1
        )
      ) order by p.criado_em desc
    ),
    '[]'::jsonb
  )
  from pedidos p
  where p.user_id = auth.uid()
    and p.deletado_em is null;
$$;

revoke all on function public.hc_meus_pedidos() from public, anon;
grant execute on function public.hc_meus_pedidos() to authenticated;

-- Só manda mensagem quem é uma das duas pontas daquele agendamento — hoje
-- ambos os lados (paciente e fisio) checados por auth.uid().
-- ÚLTIMA FONTE: migration-paciente-auth.sql (assinatura caiu de 5 pra 4
-- parâmetros: saiu o p_whatsapp, que só servia pro lado paciente).
create or replace function public.hc_enviar_mensagem(
  p_agendamento_id uuid,
  p_remetente text,
  p_remetente_nome text,
  p_texto text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_ok boolean;
begin
  if length(coalesce(trim(p_texto), '')) = 0 then
    raise exception 'Mensagem vazia.';
  end if;

  if p_remetente not in ('paciente', 'fisio') then
    raise exception 'Remetente inválido.';
  end if;

  select exists (
    select 1
    from agendamentos a
    join pedidos p on p.id = a.pedido_id
    join fisios f on f.id = a.fisio_id
    where a.id = p_agendamento_id
      and (
        (p_remetente = 'paciente' and p.user_id = auth.uid())
        or (p_remetente = 'fisio' and f.user_id = auth.uid())
      )
  ) into v_ok;

  if not v_ok then
    raise exception 'Sem permissão para esta conversa.';
  end if;

  if not hc_checar_limite('msg:' || auth.uid()::text, 'mensagem', 20, 1) then
    raise exception 'Você está enviando mensagens rápido demais. Aguarde um minuto.';
  end if;

  insert into mensagens (agendamento_id, remetente, remetente_nome, texto)
  values (p_agendamento_id, p_remetente, trim(p_remetente_nome), trim(p_texto))
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.hc_enviar_mensagem(uuid, text, text, text) from public, anon;
grant execute on function public.hc_enviar_mensagem(uuid, text, text, text) to authenticated;

-- ============================================================================
-- LEITURA E AÇÕES DO FISIOTERAPEUTA — só a própria conta logada
-- ============================================================================

-- Painel do fisio: cadastro completo (pra pré-preencher o formulário de
-- edição), agenda, pedidos compatíveis ainda sem fisio e avaliações
-- recebidas.
-- ÚLTIMA FONTE do corpo: migration-foto-fisio.sql (adicionou foto_url ao
-- objeto "fisio"). As permissões finais foram reafirmadas depois por
-- migration-paciente-auth.sql.
create or replace function public.hc_meu_painel_fisio()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fisio fisios%rowtype;
begin
  -- MFA (migration-2026-08-08-mfa.sql): esta função devolve nome/WhatsApp/
  -- observações dos pacientes do fisio logado — a maior superfície de dado
  -- sensível do lado fisio, por isso exige aal2 de quem já ativou o
  -- segundo fator. O app já checa isso antes de chamar (mostra a tela de
  -- desafio primeiro); isso aqui é a garantia de que não dá pra pular
  -- chamando o RPC direto.
  if not public.hc_aal_suficiente() then
    raise exception 'Complete a verificação em duas etapas para continuar.';
  end if;

  select * into v_fisio from fisios where user_id = auth.uid() limit 1;

  if v_fisio.id is null then
    return jsonb_build_object('fisio', null);
  end if;

  return jsonb_build_object(
    'fisio', jsonb_build_object(
      'id', v_fisio.id,
      'nome', v_fisio.nome,
      'whatsapp', v_fisio.whatsapp,
      'cidade', v_fisio.cidade,
      'bairros', v_fisio.bairros,
      'especialidades', v_fisio.especialidades,
      'valor_sessao', v_fisio.valor_sessao,
      'contador_cliques', v_fisio.contador_cliques,
      'raio_km', v_fisio.raio_km,
      'tem_coordenadas', v_fisio.lat is not null,
      'formacao', v_fisio.formacao,
      'resumo', v_fisio.resumo,
      'disponibilidade', v_fisio.disponibilidade,
      'cep', v_fisio.cep,
      'uf', v_fisio.uf,
      'lat', v_fisio.lat,
      'lng', v_fisio.lng,
      'crefito', v_fisio.crefito,
      'crefito_uf', v_fisio.crefito_uf,
      'foto_url', v_fisio.foto_url
    ),
    'agendamentos', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'data', a.data,
            'horario', a.horario,
            'status', a.status,
            'pedido', jsonb_build_object(
              'id', p.id,
              'nome', p.nome,
              'whatsapp', p.whatsapp,
              'cidade', p.cidade,
              'bairro', p.bairro,
              'especialidade', p.especialidade,
              'observacoes', p.observacoes,
              'distancia_km', round(
                hc_distancia_km(v_fisio.lat, v_fisio.lng, p.lat, p.lng)::numeric, 1
              )
            ),
            'mensagens', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', m.id,
                    'remetente', m.remetente,
                    'remetente_nome', m.remetente_nome,
                    'texto', m.texto,
                    'criado_em', m.criado_em
                  ) order by m.criado_em
                ),
                '[]'::jsonb
              )
              from mensagens m
              where m.agendamento_id = a.id
            )
          ) order by a.data desc, a.horario desc
        ),
        '[]'::jsonb
      )
      from agendamentos a
      join pedidos p on p.id = a.pedido_id
      where a.fisio_id = v_fisio.id
    ),
    'pedidos_compativeis', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'especialidade', p.especialidade,
            'cidade', p.cidade,
            'bairro', p.bairro,
            'urgencia', p.urgencia,
            'criado_em', p.criado_em,
            'distancia_km', round(
              hc_distancia_km(v_fisio.lat, v_fisio.lng, p.lat, p.lng)::numeric, 1
            )
          ) order by
            hc_distancia_km(v_fisio.lat, v_fisio.lng, p.lat, p.lng) nulls last,
            p.criado_em desc
        ),
        '[]'::jsonb
      )
      from pedidos p
      where p.status = 'ativo'
        and not exists (select 1 from agendamentos a where a.pedido_id = p.id)
        and hc_compativel(
          v_fisio.especialidades, v_fisio.cidade, v_fisio.bairros,
          v_fisio.lat, v_fisio.lng, v_fisio.raio_km,
          p.especialidade, p.cidade, p.bairro, p.lat, p.lng
        )
    ),
    'avaliacoes', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', av.id,
            'nota', av.nota,
            'comentario', av.comentario,
            'criado_em', av.criado_em
          ) order by av.criado_em desc
        ),
        '[]'::jsonb
      )
      from avaliacoes av
      where av.fisio_id = v_fisio.id
    )
  );
end $$;

revoke all on function public.hc_meu_painel_fisio() from public, anon;
grant execute on function public.hc_meu_painel_fisio() to authenticated;

-- O fisioterapeuta marca o próprio atendimento como concluído ou cancelado.
-- ÚLTIMA FONTE do corpo: migration-fisio-auth.sql (única definição desta
-- assinatura de 2 parâmetros). Permissões reafirmadas por
-- migration-paciente-auth.sql.
create or replace function public.hc_marcar_status_agendamento(
  p_agendamento_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('agendado', 'concluido', 'cancelado') then
    raise exception 'Status inválido.';
  end if;

  update agendamentos a
  set status = p_status
  from fisios f
  where a.id = p_agendamento_id
    and f.id = a.fisio_id
    and f.user_id = auth.uid();

  if not found then
    raise exception 'Sem permissão para alterar este agendamento.';
  end if;
end $$;

revoke all on function public.hc_marcar_status_agendamento(uuid, text) from public, anon;
grant execute on function public.hc_marcar_status_agendamento(uuid, text) to authenticated;

-- O fisio fecha um atendimento diretamente a partir de um pedido
-- compatível: confirma data/horário e o WhatsApp do paciente é liberado.
-- Bloqueia fechar um pedido criado pela própria conta (mesma fraude que
-- hc_criar_pedido e hc_avaliar bloqueiam por outros ângulos — ver comentário
-- de migration-bloquear-autoavaliacao.sql abaixo).
--
-- ÚLTIMA FONTE: migration-bloquear-autoavaliacao.sql (idêntica em
-- migration-detectar-conta-fisio.sql, que não voltou a tocar nesta função).
create or replace function public.hc_fechar_agendamento(
  p_pedido_id uuid,
  p_data date,
  p_horario time
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fisio fisios%rowtype;
  v_pedido pedidos%rowtype;
  v_agendamento_id uuid;
begin
  select * into v_fisio from fisios where user_id = auth.uid() limit 1;
  if v_fisio.id is null then
    raise exception 'Você precisa ter um cadastro de fisioterapeuta pra fechar um atendimento.';
  end if;

  select * into v_pedido from pedidos
  where id = p_pedido_id and status = 'ativo' and deletado_em is null;
  if v_pedido.id is null then
    raise exception 'Pedido não encontrado ou já foi atendido.';
  end if;

  if v_pedido.user_id = auth.uid() then
    raise exception 'Você não pode fechar um pedido enviado pela sua própria conta.';
  end if;

  if not hc_compativel(
    v_fisio.especialidades, v_fisio.cidade, v_fisio.bairros, v_fisio.lat, v_fisio.lng, v_fisio.raio_km,
    v_pedido.especialidade, v_pedido.cidade, v_pedido.bairro, v_pedido.lat, v_pedido.lng
  ) then
    raise exception 'Esse pedido não é compatível com sua região ou especialidade.';
  end if;

  begin
    insert into agendamentos (pedido_id, fisio_id, data, horario, status)
    values (p_pedido_id, v_fisio.id, p_data, p_horario, 'agendado')
    returning id into v_agendamento_id;
  exception when unique_violation then
    raise exception 'Esse pedido já foi fechado por outro profissional.';
  end;

  return jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'paciente_nome', v_pedido.nome,
    'paciente_whatsapp', v_pedido.whatsapp
  );
end $$;

revoke all on function public.hc_fechar_agendamento(uuid, date, time) from public, anon;
grant execute on function public.hc_fechar_agendamento(uuid, date, time) to authenticated;

-- Deixa o app perguntar "essa conta já é de fisio?" pra travar direto na
-- aba certa e nem mostrar a opção de virar paciente.
-- ÚLTIMA FONTE: migration-detectar-conta-fisio.sql (única definição).
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

-- ============================================================================
-- CONFIANÇA / AVALIAÇÕES
-- ============================================================================

-- Só avalia quem teve um atendimento com aquele fisioterapeuta, uma vez por
-- atendimento (trava contra avaliação duplicada, migration-hardening-
-- avancado.sql), e nunca a própria conta (migration-bloquear-
-- autoavaliacao.sql — última rede de segurança contra a fraude de autoavaliação,
-- válida mesmo que hc_criar_pedido e hc_fechar_agendamento sejam contornados
-- de algum jeito, ou já exista um pedido antigo de uma conta que virou fisio
-- depois).
--
-- ÚLTIMA FONTE: migration-bloquear-autoavaliacao.sql (idêntica em
-- migration-detectar-conta-fisio.sql, que não voltou a tocar nesta função).
create or replace function public.hc_avaliar(
  p_fisio_id uuid,
  p_nota integer,
  p_comentario text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agendamento_id uuid;
begin
  if p_nota < 1 or p_nota > 5 then
    raise exception 'Nota inválida.';
  end if;

  if exists (select 1 from fisios where id = p_fisio_id and user_id = auth.uid()) then
    raise exception 'Você não pode avaliar seu próprio cadastro.';
  end if;

  select a.id into v_agendamento_id
  from agendamentos a
  join pedidos p on p.id = a.pedido_id
  where a.fisio_id = p_fisio_id
    and p.user_id = auth.uid()
  order by a.criado_em desc
  limit 1;

  if v_agendamento_id is null then
    raise exception 'Você só pode avaliar um profissional que já te atendeu.';
  end if;

  if exists (select 1 from avaliacoes where agendamento_id = v_agendamento_id) then
    raise exception 'Você já avaliou este atendimento.';
  end if;

  insert into avaliacoes (fisio_id, nota, comentario, agendamento_id)
  values (p_fisio_id, p_nota, nullif(trim(p_comentario), ''), v_agendamento_id);
end $$;

revoke all on function public.hc_avaliar(uuid, integer, text) from public, anon;
grant execute on function public.hc_avaliar(uuid, integer, text) to authenticated;

-- ============================================================================
-- ADMIN — LGPD, auditoria, criptografia (grátis), notificações
-- ============================================================================

-- Retenção automática: deletar registros de auditoria com mais de 90 dias.
-- Restrita a administradores. (schema.sql; reafirmada sem mudança de corpo
-- por migration-auditoria-seguranca.sql)
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

revoke all on function public.hc_limpar_auditoria() from public, anon;
grant execute on function public.hc_limpar_auditoria() to authenticated;

-- Anonimização LGPD. Restrita a administradores. (schema.sql; reafirmada
-- sem mudança de corpo por migration-auditoria-seguranca.sql)
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

revoke all on function public.hc_anonimizar_paciente(uuid) from public, anon;
grant execute on function public.hc_anonimizar_paciente(uuid) to authenticated;

-- FUNÇÕES DE CRIPTOGRAFIA DE CREFITO: removidas em 2026-08-08
-- (migration-2026-08-08-remover-crefito-encriptado.sql). Existiam desde o
-- schema.sql original mas nunca funcionaram de verdade (search_path errado
-- pra achar pgp_sym_encrypt) e nenhuma tela do app as chamava — só ficavam
-- ali com uma chave de criptografia fixa no código, versionada no Git, sem
-- proteger nenhum dado real. Removidas em vez de "consertadas" porque não
-- havia uso nenhum pra justificar reconstruir com chave em cofre (Vault).
-- Se um dia precisar de verdade encriptar o CREFITO, refazer do zero com a
-- chave no Supabase Vault, não fixa no SQL.

-- Notificações quando um pedido compatível é criado. TODO de schema.sql:
-- hoje só conta quantos fisios seriam notificáveis, não envia nada de
-- verdade (nenhuma integração de email/SMS plugada ainda).
create or replace function public.hc_notificar_fisios(p_pedido_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido record;
  v_count integer := 0;
begin
  select * into v_pedido from public.pedidos where id = p_pedido_id;
  if v_pedido is null then
    return jsonb_build_object('erro', 'Pedido não encontrado');
  end if;

  select count(*) into v_count
  from public.fisios f
  where f.especialidades @> array[v_pedido.especialidade]
    and f.cidade = v_pedido.cidade
    and f.notificacoes_ativas = true
    and f.deletado_em is null;

  -- TODO: Enviar email/SMS real para fisios compatíveis (Supabase Email ou
  -- serviço externo — SendGrid, Twilio, etc). Ver supabase/functions/notify-sendgrid.

  return jsonb_build_object(
    'pedido_id', p_pedido_id,
    'fisios_notificaveis', v_count,
    'mensagem', 'Notificações prontas para envio'
  );
end;
$$;

grant execute on function public.hc_notificar_fisios(uuid) to authenticated;

-- ============================================================================
-- AUDITORIA — trigger que grava de verdade (migration-hardening-avancado.sql)
--
-- A tabela "auditoria" existia desde o schema.sql original, com política
-- RLS e função de limpeza, mas nada escrevia nela até esta migração. Toda
-- INSERT/UPDATE/DELETE em pedidos, fisios, agendamentos e mensagens fica
-- registrada: quem (auth.uid()), o quê, quando, e o antes/depois.
-- ============================================================================

create or replace function public.hc_registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.auditoria (tabela, operacao, usuario_id, linha_id, dados_antigos, dados_novos)
  values (
    TG_TABLE_NAME,
    TG_OP,
    auth.uid(),
    coalesce(new.id, old.id),
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end $$;

-- Função de trigger: não precisa de grant explícito pra rodar via trigger,
-- e não é chamada por RPC em lugar nenhum do frontend.
revoke all on function public.hc_registrar_auditoria() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'auditoria_pedidos') then
    create trigger auditoria_pedidos
      after insert or update or delete on public.pedidos
      for each row execute function public.hc_registrar_auditoria();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'auditoria_fisios') then
    create trigger auditoria_fisios
      after insert or update or delete on public.fisios
      for each row execute function public.hc_registrar_auditoria();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'auditoria_agendamentos') then
    create trigger auditoria_agendamentos
      after insert or update or delete on public.agendamentos
      for each row execute function public.hc_registrar_auditoria();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'auditoria_mensagens') then
    create trigger auditoria_mensagens
      after insert or update or delete on public.mensagens
      for each row execute function public.hc_registrar_auditoria();
  end if;
end $$;

-- ============================================================================
-- FIM
--
-- NÃO CORRIGIDO / DECISÃO FUTURA (herdado de migration-auditoria-
-- seguranca.sql, ainda válido):
--
-- - agendamentos.status: o default e o check já estão no valor final
--   correto aqui ('agendado', sem 'pendente'/'recusado').
-- - Captcha desligado no Supabase Auth (Authentication → Attack
--   Protection). Rate limits do Supabase (30 signups/5min por IP) já dão
--   alguma proteção, mas captcha reduziria bots de verdade — requer criar
--   conta num provedor (hCaptcha ou Turnstile) e mexer no formulário de
--   cadastro. Feature nova, fora do escopo deste arquivo.
-- - crefito e observacoes (pedidos) são guardados em texto puro nas
--   colunas normais (crefito, observacoes) — as colunas *_encrypted nunca
--   foram escritas por nenhuma RPC. CREFITO é um dado público (registro
--   profissional), mas "observacoes" pode conter detalhe de saúde do
--   paciente; hoje só RLS protege isso, não há criptografia em repouso.
--   Encriptar de verdade exigiria chave no Supabase Vault + mudar as RPCs
--   de criar/ler pedido — feature nova, fora do escopo deste arquivo.
-- ============================================================================
