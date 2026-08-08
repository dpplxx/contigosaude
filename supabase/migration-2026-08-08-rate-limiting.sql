-- Rate limiting genérico, no mesmo espírito do bloqueio de login (migration-
-- 2026-08-07-bloqueio-login.sql): antes, o único limite existente no app
-- era por conta de login errada. Nenhum formulário público tinha limite de
-- quantas vezes a mesma conta pode chamá-lo por minuto — o Turnstile barra
-- bot que nem consegue gerar token, mas não impede uma conta autenticada
-- de, por exemplo, mandar 500 mensagens de chat em 10 segundos.
--
-- hc_checar_limite() é reutilizável: guarda um contador por (chave, ação)
-- numa janela de tempo, e zera sozinho quando a janela expira. Não é
-- exposta pro cliente (revoke de tudo) — só outras funções security
-- definer chamam.
--
-- Aplicado em três pontos, com limites generosos o bastante pra nunca
-- incomodar quem está usando o app normalmente:
--   - hc_enviar_mensagem: 20 mensagens por minuto por conta (chat)
--   - hc_criar_pedido: 3 pedidos novos por 10 minutos por conta
--   - hc_cadastrar_fisio: 10 chamadas por 10 minutos por conta (cobre
--     tanto o cadastro inicial quanto edições de perfil, que usam a mesma
--     função)
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.

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

-- ----------------------------------------------------------------------------
-- hc_enviar_mensagem: mesmo corpo de schema-atual.sql, com o limite logo
-- após confirmar que a pessoa tem permissão pra falar naquela conversa.
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- hc_criar_pedido: mesmo corpo, com o limite antes do insert. O limite de 5
-- pedidos "ativo" simultâneos que já existia continua — isso aqui cobre o
-- caso de criar, ser atendido/cancelado e criar de novo em sequência
-- rápida, o que o limite de "ativos" sozinho não pega.
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- hc_cadastrar_fisio: mesmo corpo, com o limite logo no início. 10 chamadas
-- em 10 minutos é folgado o bastante pra cobrir alguém editando o cadastro
-- várias vezes seguidas sem incomodar, mas barra automação.
-- ----------------------------------------------------------------------------

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

  select id into v_id from fisios where user_id = v_uid limit 1;

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
