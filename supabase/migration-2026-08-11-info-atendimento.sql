-- ============================================================================
-- Informações de onde e como o fisio atende (local de atendimento, forma de
-- pagamento, convênios aceitos). Isto NÃO é agenda, reserva, pagamento nem
-- integração com operadora — é só informação declarada pelo profissional
-- pra melhorar a descoberta e a decisão do paciente.
--
-- Roda depois de migration-2026-08-11-contigo-qualidade.sql, no mesmo
-- banco. Aplique no Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colunas novas em fisios — todas nullable/vazias por padrão, de
-- propósito: nenhum fisio cadastrado hoje preencheu isso ainda, e não
-- queremos assumir nada em nome deles (ver hc_listar_fisios mais abaixo,
-- que trata "não informado" com cuidado em vez de esconder todo mundo).
-- ----------------------------------------------------------------------------

alter table public.fisios
  add column if not exists locais_atendimento text[] not null default '{}',
  add column if not exists forma_pagamento text,
  add column if not exists convenios text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fisios_locais_atendimento_check'
  ) then
    alter table public.fisios add constraint fisios_locais_atendimento_check
      check (locais_atendimento <@ array['domicilio', 'clinica', 'consultorio', 'outro']::text[]);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fisios_forma_pagamento_check'
  ) then
    alter table public.fisios add constraint fisios_forma_pagamento_check
      check (forma_pagamento is null or forma_pagamento in ('particular', 'convenio', 'particular_e_convenio'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. hc_cadastrar_fisio — 3 parâmetros novos no final (mantém compatível
-- com quem já chama a assinatura antiga, já que todos têm default).
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
  p_crefito_uf text default null,
  p_locais_atendimento text[] default '{}',
  p_forma_pagamento text default null,
  p_convenios text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
  v_locais text[] := coalesce(p_locais_atendimento, '{}');
  v_convenios text[];
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

  if not (v_locais <@ array['domicilio', 'clinica', 'consultorio', 'outro']::text[]) then
    raise exception 'Local de atendimento inválido.';
  end if;

  if p_forma_pagamento is not null and p_forma_pagamento not in ('particular', 'convenio', 'particular_e_convenio') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  select coalesce(array_agg(nullif(trim(c), '')), '{}')
  into v_convenios
  from unnest(coalesce(p_convenios, '{}')) as c
  where nullif(trim(c), '') is not null;

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
      locais_atendimento = v_locais,
      forma_pagamento = p_forma_pagamento,
      convenios = v_convenios,
      user_id = v_uid
    where id = v_id;
    return v_id;
  end if;

  insert into fisios (
    nome, whatsapp, especialidades, cidade, bairros,
    formacao, resumo, disponibilidade, valor_sessao,
    cep, uf, lat, lng, raio_km, crefito, crefito_uf,
    locais_atendimento, forma_pagamento, convenios, user_id
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
    v_locais, p_forma_pagamento, v_convenios, v_uid
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text, text[], text, text[]
) from public, anon;
grant execute on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text, text[], text, text[]
) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. hc_meu_painel_fisio — expõe os 3 campos pro fisio editar o próprio
-- cadastro (pré-preenchimento do formulário).
-- ----------------------------------------------------------------------------

create or replace function public.hc_meu_painel_fisio()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fisio fisios%rowtype;
begin
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
      'foto_url', v_fisio.foto_url,
      'locais_atendimento', v_fisio.locais_atendimento,
      'forma_pagamento', v_fisio.forma_pagamento,
      'convenios', v_fisio.convenios,
      'qualidade', public.hc_qualidade_fisio(v_fisio.id)
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
          v_fisio.especialidades, v_fisio.cidade, v_fisio.bairros, v_fisio.lat, v_fisio.lng, v_fisio.raio_km,
          p.especialidade, p.cidade, p.bairro, p.lat, p.lng
        )
    ),
    'avaliacoes', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'nota', a.nota,
            'comentario', a.comentario,
            'criado_em', a.criado_em
          ) order by a.criado_em desc
        ),
        '[]'::jsonb
      )
      from avaliacoes a
      where a.fisio_id = v_fisio.id and a.status = 'publicada'
    )
  );
end $$;

revoke all on function public.hc_meu_painel_fisio() from public, anon;
grant execute on function public.hc_meu_painel_fisio() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. hc_obter_fisio_publico — expõe os 3 campos no perfil público, pro
-- paciente ver antes de chamar no WhatsApp.
-- ----------------------------------------------------------------------------

create or replace function public.hc_obter_fisio_publico(
  p_fisio_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', f.id,
    'nome', f.nome,
    'formacao', f.formacao,
    'foto_url', f.foto_url,
    'whatsapp', f.whatsapp,
    'bairros', f.bairros,
    'cidade', f.cidade,
    'uf', f.uf,
    'crefito', f.crefito,
    'crefito_uf', f.crefito_uf,
    'crefito_status', f.crefito_status,
    'especialidades', f.especialidades,
    'resumo', f.resumo,
    'disponibilidade', f.disponibilidade,
    'nota_media', (
      select round(avg(a.nota)::numeric, 1) from avaliacoes a
      where a.fisio_id = f.id and a.status = 'publicada'
    ),
    'total_avaliacoes', (
      select count(*) from avaliacoes a
      where a.fisio_id = f.id and a.status = 'publicada'
    ),
    'qualidade', public.hc_qualidade_fisio(f.id),
    'raio_km', f.raio_km,
    'locais_atendimento', f.locais_atendimento,
    'forma_pagamento', f.forma_pagamento,
    'convenios', f.convenios
  )
  from public.fisios f
  where f.id = p_fisio_id
    and f.deletado_em is null;
$$;

revoke all on function public.hc_obter_fisio_publico(uuid) from public;
grant execute on function public.hc_obter_fisio_publico(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. hc_listar_fisios — 3 parâmetros novos de busca:
--
-- p_local_atendimento: FILTRO de verdade (exclui quem não bate). Fisios
-- que ainda não preencheram locais_atendimento (array vazio — hoje é 100%
-- deles) continuam aparecendo em buscas por "domicílio", porque o produto
-- inteiro sempre foi atendimento domiciliar; não fazemos essa suposição
-- pra "clínica" ou "consultório", que são informação nova.
--
-- p_forma_pagamento e p_convenio: só DESEMPATAM a ordem (dentro da mesma
-- banda de distância, antes do nível de qualidade), nunca excluem
-- ninguém — do contrário, filtrar por convênio hoje devolveria zero
-- resultados, já que nenhum fisio preencheu isso ainda.
-- ----------------------------------------------------------------------------

create or replace function public.hc_listar_fisios(
  p_especialidade text,
  p_cidade text,
  p_bairro text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_local_atendimento text default null,
  p_forma_pagamento text default null,
  p_convenio text default null
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
        'locais_atendimento', f.locais_atendimento,
        'forma_pagamento', f.forma_pagamento,
        'nota_media', (
          select round(avg(a.nota)::numeric, 1) from avaliacoes a
          where a.fisio_id = f.id and a.status = 'publicada'
        ),
        'total_avaliacoes', (
          select count(*) from avaliacoes a
          where a.fisio_id = f.id and a.status = 'publicada'
        ),
        'qualidade', q.dados,
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
          then floor(hc_distancia_km(f.lat, f.lng, p_lat, p_lng) / 2)
          else 999
        end,
        case
          when p_convenio is null then 0
          when p_convenio = any(f.convenios) then 0
          else 1
        end,
        case
          when p_forma_pagamento is null then 0
          when p_forma_pagamento = 'particular'
            and (f.forma_pagamento is null or f.forma_pagamento in ('particular', 'particular_e_convenio'))
            then 0
          when p_forma_pagamento = 'convenio'
            and f.forma_pagamento in ('convenio', 'particular_e_convenio')
            then 0
          else 1
        end,
        coalesce((q.dados ->> 'nivel')::int, 0) desc,
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
  cross join lateral (select public.hc_qualidade_fisio(f.id) as dados) q
  where hc_compativel(
    f.especialidades, f.cidade, f.bairros, f.lat, f.lng, f.raio_km,
    p_especialidade, p_cidade, p_bairro, p_lat, p_lng
  )
  and f.deletado_em is null
  and (
    p_local_atendimento is null
    or p_local_atendimento = any(f.locais_atendimento)
    or (p_local_atendimento = 'domicilio' and coalesce(array_length(f.locais_atendimento, 1), 0) = 0)
  );
$$;

revoke all on function public.hc_listar_fisios(
  text, text, text, double precision, double precision, text, text, text
) from public;
grant execute on function public.hc_listar_fisios(
  text, text, text, double precision, double precision, text, text, text
) to anon, authenticated;
