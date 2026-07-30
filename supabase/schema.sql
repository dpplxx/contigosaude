-- ============================================================================
-- Fisio em Casa — schema completo
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- Pode rodar mais de uma vez sem quebrar nada: as tabelas usam
-- "if not exists", as colunas usam "add column if not exists" e as funções são
-- recriadas do zero. Rodar de novo não apaga dado nenhum.
--
-- IDEIA CENTRAL DA SEGURANÇA
-- Ninguém acessa as tabelas direto com a chave pública do site. O RLS está
-- ligado e sem nenhuma política para visitante anônimo, então uma tentativa de
-- ler a tabela de pedidos pelo navegador volta vazia. Todo acesso do público
-- passa pelas funções hc_* abaixo, que devolvem só o que a pessoa tem direito
-- de ver, identificada pelo próprio WhatsApp.
--
-- Você (logada no Painel) é o único papel com leitura ampla.
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
  -- Últimos 8 dígitos do telefone. Serve de chave de acesso e resolve o
  -- problema de a pessoa digitar com ou sem o 9, com ou sem DDI.
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
  criado_em timestamptz not null default now()
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
  criado_em timestamptz not null default now()
);

-- Colunas de localização. Ficam em "add column if not exists" para quem já
-- rodou a primeira versão deste arquivo antes da geolocalização existir.
alter table public.fisios add column if not exists cep text;
alter table public.fisios add column if not exists uf text;
alter table public.fisios add column if not exists lat double precision;
alter table public.fisios add column if not exists lng double precision;
alter table public.fisios add column if not exists raio_km integer not null default 10;

alter table public.pedidos add column if not exists cep text;
alter table public.pedidos add column if not exists uf text;
alter table public.pedidos add column if not exists lat double precision;
alter table public.pedidos add column if not exists lng double precision;

create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  fisio_id uuid not null references public.fisios (id) on delete cascade,
  data date not null,
  horario time not null,
  status text not null default 'agendado'
    check (status in ('agendado', 'concluido', 'cancelado')),
  criado_em timestamptz not null default now()
);

create table if not exists public.avaliacoes (
  id uuid primary key default gen_random_uuid(),
  fisio_id uuid not null references public.fisios (id) on delete cascade,
  nota integer not null check (nota between 1 and 5),
  comentario text,
  criado_em timestamptz not null default now()
);

create table if not exists public.mensagens (
  id uuid primary key default gen_random_uuid(),
  agendamento_id uuid not null references public.agendamentos (id) on delete cascade,
  remetente text not null check (remetente in ('paciente', 'fisio')),
  remetente_nome text not null,
  texto text not null,
  criado_em timestamptz not null default now()
);

create index if not exists fisios_chave_idx on public.fisios (whatsapp_chave);
create index if not exists fisios_coord_idx on public.fisios (lat, lng);
create index if not exists pedidos_chave_idx on public.pedidos (whatsapp_chave);
create index if not exists pedidos_status_idx on public.pedidos (status, criado_em desc);
create index if not exists pedidos_coord_idx on public.pedidos (lat, lng);
create index if not exists agendamentos_pedido_idx on public.agendamentos (pedido_id);
create index if not exists agendamentos_fisio_idx on public.agendamentos (fisio_id);
create index if not exists avaliacoes_fisio_idx on public.avaliacoes (fisio_id);
create index if not exists mensagens_agendamento_idx on public.mensagens (agendamento_id, criado_em);

-- ============================================================================
-- QUEM PODE ABRIR O PAINEL
--
-- Estar logada não basta. A conta precisa estar nesta tabela. Assim, mesmo que
-- alguém consiga criar uma conta no seu Supabase, continua sem enxergar um
-- único dado de paciente.
-- ============================================================================

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  criado_em timestamptz not null default now()
);

alter table public.admins enable row level security;
-- Nenhuma política: a tabela só é lida pela função abaixo, nunca pelo navegador.

create or replace function public.hc_e_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

grant execute on function public.hc_e_admin() to authenticated;

-- ============================================================================
-- RLS — tudo trancado, e depois liberado só para as contas administradoras
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

-- O papel anônimo não recebe nenhuma política de propósito: sem função, não lê
-- nem escreve nada.
revoke all on public.fisios, public.pedidos, public.agendamentos,
  public.avaliacoes, public.mensagens, public.admins from anon;

-- ============================================================================
-- LIMPEZA DE VERSÕES ANTERIORES
--
-- O Postgres não deixa trocar o tipo de retorno nem a lista de parâmetros de
-- uma função com "create or replace", então as assinaturas antigas saem antes.
-- ============================================================================

drop function if exists public.hc_compativel(text[], text, text[], text, text, text);
drop function if exists public.hc_criar_pedido(text, text, text, text, text, text, text);
drop function if exists public.hc_cadastrar_fisio(text, text, text[], text, text[], text, text, text, numeric);

-- ============================================================================
-- HELPERS
-- ============================================================================

-- Normaliza um telefone digitado de qualquer jeito para a mesma chave de 8
-- dígitos usada nas colunas geradas.
create or replace function public.hc_chave(p_whatsapp text)
returns text
language sql
immutable
as $$
  select right(regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g'), 8);
$$;

-- Distância em linha reta entre dois pontos, em quilômetros (fórmula de
-- haversine). Não precisa de PostGIS nem de nenhuma extensão paga: é só
-- trigonometria, roda em qualquer Postgres.
create or replace function public.hc_distancia_km(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
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

-- Regra de compatibilidade. Preferimos distância real; quando falta coordenada
-- de um dos lados, caímos no casamento por cidade e bairro em texto, que era o
-- critério da primeira versão.
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
-- ESCRITA PÚBLICA — os dois formulários da home
-- ============================================================================

-- Devolve o id do pedido e quantos fisioterapeutas já atendem aquele endereço.
-- O app usa esse número para dar uma resposta concreta na hora ("3 profissionais
-- atendem sua região") em vez de um "recebemos seu pedido" genérico.
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
begin
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

  -- Trava simples de spam: no máximo 5 pedidos abertos por telefone.
  if (
    select count(*)
    from pedidos
    where whatsapp_chave = hc_chave(p_whatsapp)
      and status = 'ativo'
  ) >= 5 then
    raise exception 'Você já tem pedidos abertos. Aguarde o contato da equipe.';
  end if;

  insert into pedidos (
    nome, whatsapp, especialidade, cidade, bairro, urgencia, observacoes,
    cep, uf, lat, lng
  )
  values (
    trim(p_nome), trim(p_whatsapp), p_especialidade,
    trim(p_cidade), trim(p_bairro), p_urgencia, nullif(trim(p_observacoes), ''),
    nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), ''),
    nullif(upper(trim(coalesce(p_uf, ''))), ''),
    p_lat, p_lng
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
  p_raio_km integer default 10
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
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

  -- Recadastro com o mesmo telefone atualiza o cadastro em vez de duplicar.
  select id into v_id from fisios where whatsapp_chave = hc_chave(p_whatsapp) limit 1;

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
      raio_km = p_raio_km
    where id = v_id;
    return v_id;
  end if;

  insert into fisios (
    nome, whatsapp, especialidades, cidade, bairros,
    formacao, resumo, disponibilidade, valor_sessao,
    cep, uf, lat, lng, raio_km
  )
  values (
    trim(p_nome), trim(p_whatsapp), p_especialidades, trim(p_cidade),
    coalesce(p_bairros, '{}'),
    nullif(trim(p_formacao), ''), nullif(trim(p_resumo), ''),
    nullif(trim(p_disponibilidade), ''), p_valor_sessao,
    nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), ''),
    nullif(upper(trim(coalesce(p_uf, ''))), ''),
    p_lat, p_lng, p_raio_km
  )
  returning id into v_id;

  return v_id;
end $$;

-- ============================================================================
-- LEITURA DO PACIENTE — só os próprios pedidos, achados pelo WhatsApp
-- ============================================================================

create or replace function public.hc_meus_pedidos(p_whatsapp text)
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
  where p.whatsapp_chave = hc_chave(p_whatsapp)
    and length(hc_chave(p_whatsapp)) = 8;
$$;

-- ============================================================================
-- LEITURA DO FISIOTERAPEUTA — o próprio cadastro, agenda e pedidos que casam
-- ============================================================================

create or replace function public.hc_painel_fisio(p_whatsapp text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fisio fisios%rowtype;
begin
  if length(hc_chave(p_whatsapp)) <> 8 then
    return jsonb_build_object('fisio', null);
  end if;

  select * into v_fisio from fisios where whatsapp_chave = hc_chave(p_whatsapp) limit 1;

  if v_fisio.id is null then
    return jsonb_build_object('fisio', null);
  end if;

  return jsonb_build_object(
    'fisio', jsonb_build_object(
      'id', v_fisio.id,
      'nome', v_fisio.nome,
      'cidade', v_fisio.cidade,
      'bairros', v_fisio.bairros,
      'especialidades', v_fisio.especialidades,
      'valor_sessao', v_fisio.valor_sessao,
      'contador_cliques', v_fisio.contador_cliques,
      'raio_km', v_fisio.raio_km,
      'tem_coordenadas', v_fisio.lat is not null
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
              -- O telefone do paciente só aparece depois de agendado, porque aí
              -- o fisio precisa mesmo falar com ele para ir até a casa.
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
    -- Pedidos ainda sem agendamento que batem com a região e especialidade.
    -- Vai sem nome e sem telefone: é só o sinal de que há demanda, o contato
    -- quem faz é você pelo Painel.
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

-- ============================================================================
-- AÇÕES DAS DUAS PONTAS
-- ============================================================================

-- Só manda mensagem quem é uma das duas pontas daquele agendamento.
create or replace function public.hc_enviar_mensagem(
  p_agendamento_id uuid,
  p_whatsapp text,
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

  select exists (
    select 1
    from agendamentos a
    join pedidos p on p.id = a.pedido_id
    join fisios f on f.id = a.fisio_id
    where a.id = p_agendamento_id
      and (
        (p_remetente = 'paciente' and p.whatsapp_chave = hc_chave(p_whatsapp))
        or (p_remetente = 'fisio' and f.whatsapp_chave = hc_chave(p_whatsapp))
      )
  ) into v_ok;

  if not v_ok then
    raise exception 'Sem permissão para esta conversa.';
  end if;

  insert into mensagens (agendamento_id, remetente, remetente_nome, texto)
  values (p_agendamento_id, p_remetente, trim(p_remetente_nome), trim(p_texto))
  returning id into v_id;

  return v_id;
end $$;

-- O fisioterapeuta marca o próprio atendimento como concluído ou cancelado.
create or replace function public.hc_marcar_status_agendamento(
  p_agendamento_id uuid,
  p_status text,
  p_whatsapp text
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
    and f.whatsapp_chave = hc_chave(p_whatsapp);

  if not found then
    raise exception 'Sem permissão para alterar este agendamento.';
  end if;
end $$;

-- Só avalia quem teve um atendimento com aquele fisioterapeuta.
create or replace function public.hc_avaliar(
  p_fisio_id uuid,
  p_nota integer,
  p_comentario text,
  p_whatsapp text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_nota < 1 or p_nota > 5 then
    raise exception 'Nota inválida.';
  end if;

  if not exists (
    select 1
    from agendamentos a
    join pedidos p on p.id = a.pedido_id
    where a.fisio_id = p_fisio_id
      and p.whatsapp_chave = hc_chave(p_whatsapp)
  ) then
    raise exception 'Você só pode avaliar um profissional que já te atendeu.';
  end if;

  insert into avaliacoes (fisio_id, nota, comentario)
  values (p_fisio_id, p_nota, nullif(trim(p_comentario), ''));
end $$;

-- Contador de quantas vezes o botão de WhatsApp daquele profissional foi usado.
create or replace function public.hc_registrar_clique(p_fisio_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update fisios set contador_cliques = contador_cliques + 1 where id = p_fisio_id;
end $$;

-- ============================================================================
-- PERMISSÕES DAS FUNÇÕES
-- ============================================================================

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'hc_criar_pedido(text,text,text,text,text,text,text,text,text,double precision,double precision)',
    'hc_cadastrar_fisio(text,text,text[],text,text,text[],text,text,numeric,text,text,double precision,double precision,integer)',
    'hc_meus_pedidos(text)',
    'hc_painel_fisio(text)',
    'hc_enviar_mensagem(uuid,text,text,text,text)',
    'hc_marcar_status_agendamento(uuid,text,text)',
    'hc_avaliar(uuid,integer,text,text)',
    'hc_registrar_clique(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to anon, authenticated', fn);
  end loop;
end $$;

-- ============================================================================
-- SEGURANÇA: AUDITORIA, SOFT DELETE, CRIPTOGRAFIA (GRÁTIS)
-- ============================================================================

-- 1. SOFT DELETE: marcar como deletado, não remover dados
alter table public.fisios add column if not exists deletado_em timestamptz;
alter table public.pedidos add column if not exists deletado_em timestamptz;

-- RLS automático: nunca mostrar dados deletados
create policy soft_delete_fisios on public.fisios for select
  using (deletado_em IS NULL)
  to authenticated;

create policy soft_delete_pedidos on public.pedidos for select
  using (deletado_em IS NULL)
  to authenticated;

-- 2. CRIPTOGRAFIA: CREFITO e observações sensíveis (pgcrypto)
alter table public.fisios add column if not exists crefito text;
alter table public.fisios add column if not exists crefito_encrypted text;

alter table public.pedidos add column if not exists observacoes_encrypted text;

-- 3. AUDITORIA: log de quem fez o quê e quando
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

-- Índices para auditoria eficiente
create index if not exists auditoria_tabela_idx on public.auditoria (tabela, criada_em desc);
create index if not exists auditoria_usuario_idx on public.auditoria (usuario_id, criada_em desc);
create index if not exists auditoria_linha_idx on public.auditoria (linha_id, criada_em desc);

-- Retenção automática: deletar registros com mais de 90 dias
-- Executar manualmente 1x ao mês ou via cron job
create or replace function public.hc_limpar_auditoria()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from auditoria
  where criada_em < now() - interval '90 days';
$$;

-- 4. FUNÇÃO PARA ENCRIPTAR DADOS SENSÍVEIS
create or replace function public.hc_encriptar_crefito(p_crefito text)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select pgp_sym_encrypt(p_crefito, 'chave-segura-fisio-em-casa-2026');
$$;

create or replace function public.hc_descriptografar_crefito(p_encrypted text)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select pgp_sym_decrypt(p_encrypted::bytea, 'chave-segura-fisio-em-casa-2026');
$$;

-- 5. FUNÇÃO PARA ANONIMIZAR DADOS (LGPD)
create or replace function public.hc_anonimizar_paciente(p_paciente_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
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
$$;

-- 6. PERMISSÕES
alter table public.auditoria enable row level security;
revoke all on public.auditoria from anon;
create policy auditoria_admin_only on public.auditoria for all to authenticated
  using (public.hc_e_admin())
  with check (public.hc_e_admin());

grant execute on function public.hc_limpar_auditoria() to authenticated;
grant execute on function public.hc_encriptar_crefito(text) to anon, authenticated;
grant execute on function public.hc_descriptografar_crefito(text) to authenticated;
grant execute on function public.hc_anonimizar_paciente(uuid) to authenticated;
