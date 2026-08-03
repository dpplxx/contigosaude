-- ============================================================================
-- Migração: nome do avaliador, denúncia e moderação de avaliações
--
-- Até aqui a tabela avaliacoes era propositalmente anônima (nem nome nem
-- contato do paciente) — decisão de migration-confianca.sql depois de dois
-- vazamentos de dado. Esta migração reintroduz um nome, mas não o nome
-- completo: guarda só "Primeiro U." (hc_nome_curto), o suficiente pra dar
-- credibilidade à avaliação sem expor a identidade completa de quem avaliou.
--
-- Além disso adiciona denúncia pública (qualquer um pode reportar uma
-- avaliação) e moderação administrativa (só admin decide manter ou remover),
-- com uma barreira simples contra publicidade disfarçada (link/telefone no
-- comentário) direto na escrita.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colunas novas em avaliacoes
-- ----------------------------------------------------------------------------

alter table public.avaliacoes
  add column if not exists nome_avaliador text,
  add column if not exists status text not null default 'publicada';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'avaliacoes_status_check'
  ) then
    alter table public.avaliacoes
      add constraint avaliacoes_status_check check (status in ('publicada', 'removida'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Tabela de denúncias
-- ----------------------------------------------------------------------------

create table if not exists public.avaliacoes_denuncias (
  id uuid primary key default gen_random_uuid(),
  avaliacao_id uuid not null references public.avaliacoes (id) on delete cascade,
  motivo text not null check (
    motivo in ('falsa', 'concorrencia', 'autopromocao', 'ofensiva', 'publicidade', 'outro')
  ),
  detalhes text,
  resolvido boolean not null default false,
  criado_em timestamptz not null default now()
);

create index if not exists avaliacoes_denuncias_avaliacao_idx
  on public.avaliacoes_denuncias (avaliacao_id);

alter table public.avaliacoes_denuncias enable row level security;

drop policy if exists painel_total on public.avaliacoes_denuncias;
create policy painel_total on public.avaliacoes_denuncias for all to authenticated
  using (public.hc_e_admin()) with check (public.hc_e_admin());

revoke all on public.avaliacoes_denuncias from anon;

-- ----------------------------------------------------------------------------
-- 3. hc_nome_curto — "Maria Silva Santos" vira "Maria S."
-- ----------------------------------------------------------------------------

create or replace function public.hc_nome_curto(p_nome text)
returns text
language plpgsql
immutable
as $$
declare
  partes text[];
begin
  if p_nome is null or trim(p_nome) = '' then
    return null;
  end if;
  partes := regexp_split_to_array(trim(p_nome), '\s+');
  if array_length(partes, 1) = 1 then
    return partes[1];
  end if;
  return partes[1] || ' ' || left(partes[array_length(partes, 1)], 1) || '.';
end $$;

-- ----------------------------------------------------------------------------
-- 4. hc_avaliar — agora grava nome_avaliador e barra link/telefone no
--    comentário (barreira simples contra publicidade disfarçada; a denúncia
--    + moderação cobre o resto: avaliação falsa, concorrência desleal,
--    autopromoção, conteúdo ofensivo).
-- ----------------------------------------------------------------------------

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
  v_nome_paciente text;
  v_comentario text;
begin
  if p_nota < 1 or p_nota > 5 then
    raise exception 'Nota inválida.';
  end if;

  if exists (select 1 from fisios where id = p_fisio_id and user_id = auth.uid()) then
    raise exception 'Você não pode avaliar seu próprio cadastro.';
  end if;

  select a.id, p.nome into v_agendamento_id, v_nome_paciente
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

  v_comentario := nullif(trim(p_comentario), '');

  if v_comentario is not null and (
    v_comentario ~* 'https?://|www\.|\.com\b'
    or regexp_replace(v_comentario, '[^0-9]', '', 'g') ~ '[0-9]{8,}'
  ) then
    raise exception 'O comentário não pode conter links ou telefones. Fale só sobre o atendimento.';
  end if;

  insert into avaliacoes (fisio_id, nota, comentario, agendamento_id, nome_avaliador, status)
  values (p_fisio_id, p_nota, v_comentario, v_agendamento_id, hc_nome_curto(v_nome_paciente), 'publicada');
end $$;

revoke all on function public.hc_avaliar(uuid, integer, text) from public, anon;
grant execute on function public.hc_avaliar(uuid, integer, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. hc_admin_avaliar — ganha p_nome_avaliador opcional (registro manual,
--    ex.: paciente avaliou por telefone). Sem barreira de link/telefone
--    aqui: quem decide se o texto é legítimo é o admin, não o sistema.
-- ----------------------------------------------------------------------------

create or replace function public.hc_admin_avaliar(
  p_fisio_id uuid,
  p_nota integer,
  p_comentario text default null,
  p_nome_avaliador text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  if p_nota < 1 or p_nota > 5 then
    raise exception 'Nota inválida.';
  end if;

  if exists (select 1 from fisios where id = p_fisio_id and user_id = auth.uid()) then
    raise exception 'Você não pode avaliar seu próprio cadastro.';
  end if;

  insert into avaliacoes (fisio_id, nota, comentario, nome_avaliador, status)
  values (
    p_fisio_id, p_nota, nullif(trim(p_comentario), ''),
    hc_nome_curto(p_nome_avaliador), 'publicada'
  );
end $$;

revoke all on function public.hc_admin_avaliar(uuid, integer, text, text) from public, anon;
grant execute on function public.hc_admin_avaliar(uuid, integer, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. hc_avaliacoes_fisio — leitura pública, agora com id (pra denunciar) e
--    nome_avaliador, só avaliações com status = 'publicada'.
-- ----------------------------------------------------------------------------

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
        'id', a.id,
        'nota', a.nota,
        'comentario', a.comentario,
        'nome_avaliador', a.nome_avaliador,
        'criado_em', a.criado_em
      )
      order by a.criado_em desc
    ),
    '[]'::jsonb
  )
  from (
    select id, nota, comentario, nome_avaliador, criado_em
    from avaliacoes
    where fisio_id = p_fisio_id and status = 'publicada'
    order by criado_em desc
    limit 10
  ) a;
$$;

-- ----------------------------------------------------------------------------
-- 7. hc_listar_fisios — nota_media e total_avaliacoes só contam avaliações
--    publicadas, senão uma avaliação removida por moderação continuaria
--    inflando ou derrubando a nota pública.
-- ----------------------------------------------------------------------------

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
          select round(avg(a.nota)::numeric, 1) from avaliacoes a
          where a.fisio_id = f.id and a.status = 'publicada'
        ),
        'total_avaliacoes', (
          select count(*) from avaliacoes a
          where a.fisio_id = f.id and a.status = 'publicada'
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

-- ----------------------------------------------------------------------------
-- 8. hc_denunciar_avaliacao — qualquer um pode denunciar, sem precisar de
--    login (quem busca fisio não está necessariamente autenticado).
-- ----------------------------------------------------------------------------

create or replace function public.hc_denunciar_avaliacao(
  p_avaliacao_id uuid,
  p_motivo text,
  p_detalhes text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_motivo not in ('falsa', 'concorrencia', 'autopromocao', 'ofensiva', 'publicidade', 'outro') then
    raise exception 'Motivo inválido.';
  end if;

  if not exists (select 1 from avaliacoes where id = p_avaliacao_id and status = 'publicada') then
    raise exception 'Avaliação não encontrada.';
  end if;

  insert into avaliacoes_denuncias (avaliacao_id, motivo, detalhes)
  values (p_avaliacao_id, p_motivo, nullif(trim(p_detalhes), ''));
end $$;

grant execute on function public.hc_denunciar_avaliacao(uuid, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9. hc_avaliacoes_moderacao — fila de moderação do admin: só avaliações com
--    ao menos uma denúncia ainda não resolvida.
-- ----------------------------------------------------------------------------

create or replace function public.hc_avaliacoes_moderacao()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', av.id,
          'fisio_id', av.fisio_id,
          'fisio_nome', f.nome,
          'nota', av.nota,
          'comentario', av.comentario,
          'nome_avaliador', av.nome_avaliador,
          'status', av.status,
          'criado_em', av.criado_em,
          'denuncias', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', d.id, 'motivo', d.motivo, 'detalhes', d.detalhes,
                  'criado_em', d.criado_em
                )
                order by d.criado_em desc
              ),
              '[]'::jsonb
            )
            from avaliacoes_denuncias d
            where d.avaliacao_id = av.id and d.resolvido = false
          )
        )
        order by av.criado_em desc
      )
      from avaliacoes av
      join fisios f on f.id = av.fisio_id
      where exists (
        select 1 from avaliacoes_denuncias d
        where d.avaliacao_id = av.id and d.resolvido = false
      )
    ),
    '[]'::jsonb
  );
end $$;

revoke all on function public.hc_avaliacoes_moderacao() from public, anon;
grant execute on function public.hc_avaliacoes_moderacao() to authenticated;

-- ----------------------------------------------------------------------------
-- 10. hc_moderar_avaliacao — admin decide manter (só resolve a denúncia) ou
--     remover (esconde a avaliação de tudo que é público, mas não apaga —
--     fica em 'removida' pra manter o histórico).
-- ----------------------------------------------------------------------------

create or replace function public.hc_moderar_avaliacao(
  p_avaliacao_id uuid,
  p_acao text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not hc_e_admin() then
    raise exception 'Sem permissão. Esta ação é restrita a administradores.';
  end if;

  if p_acao not in ('manter', 'remover') then
    raise exception 'Ação inválida.';
  end if;

  if p_acao = 'remover' then
    update avaliacoes set status = 'removida' where id = p_avaliacao_id;
  end if;

  update avaliacoes_denuncias set resolvido = true where avaliacao_id = p_avaliacao_id;
end $$;

revoke all on function public.hc_moderar_avaliacao(uuid, text) from public, anon;
grant execute on function public.hc_moderar_avaliacao(uuid, text) to authenticated;
