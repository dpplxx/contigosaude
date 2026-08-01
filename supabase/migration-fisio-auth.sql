-- ============================================================================
-- Migração: Isolar dados do fisio pela conta logada
--
-- Hoje (mesmo com o login que acabamos de adicionar), o cadastro do fisio,
-- o painel de agendamentos, marcar status e mandar mensagem continuam
-- identificando "quem é o fisio" pelo WHATSAPP digitado — não pela sessão
-- autenticada. Ou seja: qualquer fisio logado que souber o WhatsApp de outro
-- profissional consegue ver e mexer nos agendamentos dele.
--
-- Esta migração vincula cada cadastro de fisio à conta (auth.users) que o
-- criou, e troca as funções que dependiam de WhatsApp como "senha" por
-- checagem de auth.uid(). O lado paciente continua como está — não foi pedido
-- e mudaria mais coisa (ainda usa WhatsApp de propósito, por enquanto).
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- Rode DEPOIS de migration-confianca.sql (esta aqui espera as colunas
-- crefito/crefito_uf que aquela cria).
-- ============================================================================

alter table public.fisios add column if not exists user_id uuid references auth.users (id) on delete set null;

-- Um cadastro por conta. Índice parcial: permite múltiplos user_id nulos
-- (cadastros antigos, de antes do login existir).
create unique index if not exists fisios_user_id_idx on public.fisios (user_id) where user_id is not null;

-- ============================================================================
-- hc_cadastrar_fisio — agora exige login e vincula o cadastro à conta.
--
-- Mesma assinatura de antes (16 parâmetros), então não precisa dropar a
-- função. Muda só a lógica: em vez de achar o cadastro existente pelo
-- WhatsApp, primeiro procura pela conta logada. Se a conta ainda não tem
-- cadastro, adota um cadastro órfão (sem user_id) com o mesmo WhatsApp —
-- isso preserva cadastros feitos antes desta migração.
-- ============================================================================

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
) from anon;
grant execute on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text
) to authenticated;

-- ============================================================================
-- Painel do fisio — troca hc_painel_fisio(whatsapp) por hc_meu_painel_fisio(),
-- que usa a conta logada em vez de confiar num número digitado.
-- ============================================================================

drop function if exists public.hc_painel_fisio(text);

create or replace function public.hc_meu_painel_fisio()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fisio fisios%rowtype;
begin
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

grant execute on function public.hc_meu_painel_fisio() to authenticated;

-- ============================================================================
-- Marcar status do agendamento — troca o parâmetro p_whatsapp por checagem
-- de auth.uid() (a assinatura muda, então precisa dropar a versão antiga).
-- ============================================================================

drop function if exists public.hc_marcar_status_agendamento(uuid, text, text);

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

grant execute on function public.hc_marcar_status_agendamento(uuid, text) to authenticated;

-- ============================================================================
-- Enviar mensagem — mesma assinatura de antes (não precisa dropar). Muda só
-- a checagem do lado fisio: em vez de comparar WhatsApp, confere se a conta
-- logada é dona do fisio daquele agendamento. O lado paciente continua como
-- estava, por WhatsApp — não faz parte desta migração.
-- ============================================================================

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
        or (p_remetente = 'fisio' and f.user_id = auth.uid())
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
