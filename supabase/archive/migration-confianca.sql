-- ============================================================================
-- Migração: Camada de Confiança
--
-- Adiciona: persistência real do CREFITO no cadastro do fisio, contador
-- público de profissionais (prova social) e leitura pública de avaliações
-- (sem expor dado de paciente — a tabela avaliacoes já é anônima por design).
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

alter table public.fisios add column if not exists crefito text;
alter table public.fisios add column if not exists crefito_uf text;
alter table public.fisios add column if not exists deletado_em timestamptz;

-- ============================================================================
-- Recria hc_cadastrar_fisio para aceitar e persistir o CREFITO.
-- Precisa dropar antes: mudar a lista de parâmetros não é permitido com
-- "create or replace".
-- ============================================================================

drop function if exists public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer
);

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
      raio_km = p_raio_km,
      crefito = nullif(trim(p_crefito), ''),
      crefito_uf = nullif(upper(trim(coalesce(p_crefito_uf, ''))), '')
    where id = v_id;
    return v_id;
  end if;

  insert into fisios (
    nome, whatsapp, especialidades, cidade, bairros,
    formacao, resumo, disponibilidade, valor_sessao,
    cep, uf, lat, lng, raio_km, crefito, crefito_uf
  )
  values (
    trim(p_nome), trim(p_whatsapp), p_especialidades, trim(p_cidade),
    coalesce(p_bairros, '{}'),
    nullif(trim(p_formacao), ''), nullif(trim(p_resumo), ''),
    nullif(trim(p_disponibilidade), ''), p_valor_sessao,
    nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), ''),
    nullif(upper(trim(coalesce(p_uf, ''))), ''),
    p_lat, p_lng, p_raio_km,
    nullif(trim(p_crefito), ''), nullif(upper(trim(coalesce(p_crefito_uf, ''))), '')
  )
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.hc_cadastrar_fisio(
  text, text, text[], text, text, text[], text, text, numeric, text, text,
  double precision, double precision, integer, text, text
) to anon, authenticated;

-- ============================================================================
-- Recria hc_listar_fisios para trazer CREFITO e a nota média de avaliações.
-- ============================================================================

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

-- ============================================================================
-- Contador público de fisios cadastrados — prova social real na landing.
-- Não expõe nenhum dado individual, só a contagem total.
-- ============================================================================

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

-- ============================================================================
-- Avaliações públicas de um fisio — a tabela avaliacoes já não guarda nome
-- nem contato do paciente, então é seguro expor comentário e nota.
-- ============================================================================

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
