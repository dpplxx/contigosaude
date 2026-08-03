-- ============================================================================
-- REVERTIDA no mesmo dia por migration-2026-08-03-remover-pedidos-compativeis.sql:
-- a seção inteira de "pedidos compatíveis" foi removida do painel do fisio
-- (o funil que a alimentava — hc_criar_pedido — nunca teve tela chamando
-- ele). Fica só como registro histórico.
-- ============================================================================

-- ============================================================================
-- Migração: fisio pode excluir (ignorar) um pedido compatível da lista dele
--
-- O painel do fisio mostra "pedidos compatíveis" calculados na hora por
-- hc_compativel (especialidade + cidade/bairro + raio) — não existe hoje
-- nenhuma forma de tirar um pedido dali sem fechar o atendimento. Isso cria
-- a tabela pedidos_ignorados_fisio (um registro por par pedido+fisio) e o
-- RPC hc_ignorar_pedido pra gravar nela, e ajusta hc_meu_painel_fisio pra
-- não devolver mais pedidos que o próprio fisio já ignorou.
--
-- Fica só do lado do fisio que ignorou: o pedido continua ativo e visível
-- pra qualquer outro fisio compatível — ignorar não é o mesmo que arquivar.
--
-- ÚLTIMA FONTE do corpo de hc_meu_painel_fisio: migration-2026-08-02-verificar-crefito.sql
-- (única definição com crefito_status no objeto "fisio").
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela pedidos_ignorados_fisio
-- ----------------------------------------------------------------------------

create table if not exists public.pedidos_ignorados_fisio (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  fisio_id uuid not null references public.fisios (id) on delete cascade,
  criado_em timestamptz not null default now(),
  unique (pedido_id, fisio_id)
);

create index if not exists pedidos_ignorados_fisio_fisio_idx
  on public.pedidos_ignorados_fisio (fisio_id);

alter table public.pedidos_ignorados_fisio enable row level security;
revoke all on public.pedidos_ignorados_fisio from anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pedidos_ignorados_fisio'
      and policyname = 'painel_total'
  ) then
    create policy painel_total on public.pedidos_ignorados_fisio for all to authenticated
      using (public.hc_e_admin())
      with check (public.hc_e_admin());
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. hc_ignorar_pedido — só a própria conta de fisio, e só pra ela mesma.
-- ----------------------------------------------------------------------------

create or replace function public.hc_ignorar_pedido(
  p_pedido_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fisio_id uuid;
begin
  select id into v_fisio_id from fisios where user_id = auth.uid() limit 1;

  if v_fisio_id is null then
    raise exception 'Só contas de fisioterapeuta podem ignorar um pedido.';
  end if;

  insert into pedidos_ignorados_fisio (pedido_id, fisio_id)
  values (p_pedido_id, v_fisio_id)
  on conflict (pedido_id, fisio_id) do nothing;
end $$;

revoke all on function public.hc_ignorar_pedido(uuid) from public, anon;
grant execute on function public.hc_ignorar_pedido(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. hc_meu_painel_fisio — mesma assinatura de hoje, só acrescenta o filtro
--    de pedidos_ignorados_fisio em pedidos_compativeis.
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
      'crefito_status', v_fisio.crefito_status,
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
        and not exists (
          select 1 from pedidos_ignorados_fisio pi
          where pi.pedido_id = p.id and pi.fisio_id = v_fisio.id
        )
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
